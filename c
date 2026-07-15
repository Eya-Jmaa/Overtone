import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useLocation } from "react-router-dom";
import ConvTopbar from "../components/topbar/ConvTopbar.jsx";
import MessageList from "../components/chat/MessageList.jsx";
import InputBar from "../components/chat/InputBar.jsx";
import AIStatus from "../components/chat/AIStatus.jsx";
import SelfVideo from "../components/chat/SelfVideo.jsx";
import SkeletonMessage from "../components/SkeletonMessage.jsx";
import { useAuthStore } from "../stores/authStore.js";
import { useMessageStore } from "../stores/messageStore.js";
import { useConvStore } from "../stores/convStore.js";
import { useToastStore } from "../stores/toastStore.js";
import { useAudioRecorder } from "../hooks/useAudioRecorder.js";
import { useVAD } from "../hooks/useVAD.js";
import { useWebcam } from "../hooks/useWebcam.js";
import { uploadAudio, sendMessage } from "../services/messageApi.js";
import { getWebSocketClient, WS_STATES } from "../services/wsClient.js";

const MODE_LABELS = {
  psy: "psychology",
  professional: "professional",
  sport: "sport performance",
};

const GREETING_TEMPLATE = (name, mode) =>
  `Hello ${name}, I'm your ${MODE_LABELS[mode] || "professional"} communication coach. What would you like to practice today?`;

function normalizeMessage(msg) {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    audio_url: msg.audio_url || null,
    audio_duration: msg.audio_duration || null,
    timestamp: msg.created_at,
    inputType: msg.audio_url ? "audio" : "text",
  };
}

export default function ConversationPage() {
  const { id } = useParams();
  const token = useAuthStore((s) => s.accessToken);
  const userName = useAuthStore((s) => s.user?.name || "there");
  const conversations = useConvStore((s) => s.conversations);
  const refreshConversation = useConvStore((s) => s.refreshConversation);
  const { messages, loading, sending, loadMessages, send, clear, currentConvId, setSending, addMessages, replaceOptimisticMessages } = useMessageStore();
  const toast = useToastStore((s) => s.add);
  const [input, setInput] = useState("");
  const [modeLocked, setModeLocked] = useState(false);
  const [videoActive, setVideoActive] = useState(false);
  
  // WebSocket live transcription state
  const [wsAiStatus, setWsAiStatus] = useState(null); // listening | processing | speaking
  const [streamingAssistantText, setStreamingAssistantText] = useState("");

  const location = useLocation();
  const conversation = conversations.find((c) => String(c.id) === id);
  const mode = conversation?.mode || "professional";
  const title = conversation?.title || "New conversation";

  // Greeting (shown as first AI message)
  const greeting = conversation && messages.length === 0 && !loading
    ? GREETING_TEMPLATE(userName, mode)
    : null;

  // WebSocket client
  const wsClient = getWebSocketClient();
  const mediaStreamRef = useRef(null);

  // Setup WebSocket connection
  useEffect(() => {
    if (id && token) {
      // Disconnect existing connection if conversation ID changed
      if (wsClient.getState() !== WS_STATES.CLOSED && wsClient.connectionId !== Number(id)) {
        wsClient.disconnect();
      }

      wsClient.connect(Number(id), token);
      
      // Handle WebSocket messages
      wsClient.on("partial_transcript", ({ text }) => {
        // Show partial transcript directly in input bar
        setInput(text);
      });
      
      wsClient.on("final_transcript", ({ text }) => {
        // Final transcript - keep it in input bar for user to edit/send
        setInput(text);
      });
      
      wsClient.on("state", (state) => {
        setWsAiStatus(state);
      });
      
      wsClient.on("assistant_delta", ({ text }) => {
        setStreamingAssistantText((prev) => prev + text);
      });
      
      wsClient.on("assistant_done", ({ message_id }) => {
        setStreamingAssistantText("");
        setWsAiStatus(null);
        
        // Reload messages to get the complete conversation state from the server
        // This ensures consistency between WebSocket and HTTP paths
        loadMessages(token, id);
      });
      
      wsClient.on("error", ({ message }) => {
        toast(message, "error");
      });

      return () => {
        wsClient.disconnect();
        wsClient.off("partial_transcript");
        wsClient.off("final_transcript");
        wsClient.off("state");
        wsClient.off("assistant_delta");
        wsClient.off("assistant_done");
        wsClient.off("error");
      };
    }
  }, [id, token, toast]);

  // Audio recorder with WebSocket streaming
  const { start, stop, recording, transcribing, audioBlob, duration, stream } = useAudioRecorder(
    token,
    (transcript) => setInput((prev) => (prev ? `${prev} ${transcript}` : transcript).trim()),
    (chunk) => {
      // Send audio chunk to WebSocket for live transcription
      wsClient.sendAudioChunk(chunk);
    },
    (blob, elapsed) => {
      // Recording complete - save to backend for playback
      // This keeps the batch upload path working
      mediaStreamRef.current = blob;
    },
  );

  // VAD for speech detection - only initialize when stream is available
  const { startVAD, stopVAD } = useVAD(
    stream,
    () => {
      // Speech start
      wsClient.sendControlMessage("start_turn");
    },
    () => {
      // Speech end
      wsClient.sendControlMessage("end_turn");
    },
  );

  // Start VAD when recording starts and stream is available
  useEffect(() => {
    if (recording && stream) {
      startVAD();
    } else {
      stopVAD();
    }
  }, [recording, stream, startVAD, stopVAD]);

  // Webcam
  const webcam = useWebcam();

  const prevIdRef = useRef(null);

  useEffect(() => {
    if (id && token) {
      const prevId = prevIdRef.current;
      prevIdRef.current = id;

      // Skip loading if we just came from NewConversationPage with skipLoad flag
      // and messages are already loaded for this conversation
      const alreadyLoaded = currentConvId !== null && currentConvId == id;
      const skipLoad = location.state?.skipLoad && prevId === null && alreadyLoaded;

      // Only load messages if switching to a different conversation
      // or if the store is empty (fresh mount)
      if (!skipLoad && prevId !== id) {
        clear();
        loadMessages(token, id);
      }
    }
  }, [id, token, location.state?.skipLoad, currentConvId]);

  useEffect(() => {
    setModeLocked(messages.length > 1);
  }, [messages.length]);

  const handleSend = useCallback(async (text, inputType = "text") => {
    if (!text.trim() || !id) return;
    setInput("");

    try {
      await send(token, id, text.trim());
      const isFirst = messages.length === 0;
      if (isFirst) refreshConversation(Number(id), token);
    } catch (e) {
      toast(e.message || "Failed to send message", "error");
    }
  }, [id, token, send, messages.length, refreshConversation, toast]);

  // Audio send: immediately show optimistic message, then upload in background
  const handleAudioSend = useCallback(async () => {
    if (!audioBlob || sending || !id) return;

    const textToSend = input.trim() || "Voice message";
    
    // Create a temporary object URL for immediate playback display
    const tempAudioUrl = URL.createObjectURL(audioBlob);
    
    // Optimistically show the user's message immediately
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg = {
      id: tempId,
      role: "user",
      content: textToSend,
      audio_url: tempAudioUrl,
      audio_duration: duration,
      created_at: new Date().toISOString(),
    };

    // Add optimistic message immediately and set sending state
    setSending(true);
    addMessages([optimisticMsg]);
    setInput("");

    // Now upload in background and send for real
    try {
      const { audio_url, duration: audioDuration } = await uploadAudio(token, audioBlob);
      const [userMsg, assistantMsg] = await sendMessage(token, id, textToSend, audio_url, audioDuration);
      
      // Replace optimistic message with real ones
      replaceOptimisticMessages(tempId, [userMsg, assistantMsg].map(normalizeMessage));
      
      // Clean up temporary URL
      URL.revokeObjectURL(tempAudioUrl);
      
      setSending(false);
      
      const isFirst = messages.length === 0;
      if (isFirst) refreshConversation(Number(id), token);
    } catch (e) {
      // Remove optimistic message on failure - reload to get clean state
      loadMessages(token, id);
      setSending(false);
      toast(e.message || "Failed to send audio message", "error");
    }
  }, [audioBlob, sending, id, token, input, duration, addMessages, replaceOptimisticMessages, messages.length, refreshConversation, toast]);

  const handleMicToggle = () => {
    if (recording) {
      stop();
      // After stopping, if we have audio, auto-send
      setTimeout(() => {
        if (audioBlob) handleAudioSend();
      }, 100);
    } else {
      start();
    }
  };

  const handleVideoToggle = () => {
    if (videoActive) {
      webcam.stop();
      setVideoActive(false);
    } else {
      webcam.start();
      setVideoActive(true);
    }
  };

  const handleVideoClose = () => {
    webcam.stop();
    setVideoActive(false);
  };

  const aiStatus = wsAiStatus || (sending ? "thinking" : recording ? "listening" : transcribing ? "thinking" : null);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        background: "var(--ink)",
        position: "relative",
      }}
    >
      <ConvTopbar
        scenario={conversation ? { title, description: "", persona: "AI coach", turns: "8–12" } : null}
        mode={mode}
        onEndSession={() => console.log("end session")}
      />

      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {aiStatus && (
            <div style={{ padding: "10px 20px 0" }}>
              <AIStatus status={aiStatus} />
            </div>
          )}

          {/* Loading skeletons */}
          {loading && (
            <div style={{ flex: 1, overflow: "hidden", padding: "20px 20px 8px" }}>
              <SkeletonMessage align="left" />
              <div style={{ height: 40 }} />
              <SkeletonMessage align="right" />
              <div style={{ height: 40 }} />
              <SkeletonMessage align="left" />
              <div style={{ height: 40 }} />
              <SkeletonMessage align="right" />
            </div>
          )}

          {!loading && (
            <MessageList
              messages={messages.map(normalizeMessage)}
              greeting={greeting}
              isAiTyping={sending}
              streamingAssistantText={streamingAssistantText}
            />
          )}

          {/* Webcam connection error */}
          {webcam.error && (
            <div
              style={{
                padding: "6px 16px",
                fontSize: 11,
                color: "var(--rose)",
                textAlign: "center",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              ⚠ Camera: {webcam.error}
            </div>
          )}

          <InputBar
            mode={mode}
            onModeChange={() => {}}
            modeLocked={modeLocked}
            micActive={recording}
            videoActive={videoActive}
            onMicToggle={handleMicToggle}
            onVideoToggle={handleVideoToggle}
            onSend={handleSend}
            disabled={sending || transcribing}
            value={input}
            onChange={setInput}
          />
        </div>
      </div>

      {/* Webcam self-view (PiP) */}
      {videoActive && webcam.active && (
        <SelfVideo videoRef={webcam.videoRef} onClose={handleVideoClose} />
      )}
    </div>
  );
}