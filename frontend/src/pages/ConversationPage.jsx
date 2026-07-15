import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
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
import { getOutputPlayer, getAudioContext } from "../services/audioEngine.js";
import { uploadAudio, sendMessage } from "../services/messageApi.js";
import { getWebSocketClient, WS_STATES } from "../services/wsClient.js";
import VoiceMode from "../components/voice/VoiceMode.jsx";

const MODE_LABELS = {
  psy: "psychology",
  professional: "professional",
  sport: "sport performance",
};

const GREETING_TEMPLATE = (name, mode) =>
  `Hello ${name}, I'm your ${MODE_LABELS[mode] || "professional"} communication coach. What would you like to practice today?`;

const HERO_SUBTITLE = {
  psy: "A calm space to explore what you're feeling and how you want to show up.",
  professional: "Rehearse the hard conversation before it happens — negotiations, feedback, interviews.",
  sport: "Sharpen your mindset, focus, and resilience before it counts.",
};

const SUGGESTIONS = {
  psy: [
    "Help me set a boundary with someone",
    "Work through a difficult emotion",
    "Reflect on a relationship",
  ],
  professional: [
    "Prepare for a salary negotiation",
    "Practice giving tough feedback",
    "Rehearse a job interview",
  ],
  sport: [
    "Build pre-competition focus",
    "Push through a motivation slump",
    "Handle performance pressure",
  ],
};

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
  const { messages, loading, sending, loadMessages, send, clear, currentConvId, addMessages, setSending, replaceOptimisticMessages } = useMessageStore();
  const toast = useToastStore((s) => s.add);
  const [input, setInput] = useState("");
  const [modeLocked, setModeLocked] = useState(false);
  const [videoActive, setVideoActive] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false); // full-screen immersive mode
  const [animateId, setAnimateId] = useState(null);  // assistant msg id to write out

  // WebSocket live transcription state
  const [wsAiStatus, setWsAiStatus] = useState(null);
  const [streamingAssistantText, setStreamingAssistantText] = useState("");
  
  // Track if coach is speaking to mute mic
  const coachSpeakingRef = useRef(false);
  
  // Track if we're waiting for WS turn to complete
  const waitingForTurnRef = useRef(false);

  const location = useLocation();
  const navigate = useNavigate();
  const conversation = conversations.find((c) => String(c.id) === id);
  const mode = conversation?.mode || "professional";
  const title = conversation?.title || "New conversation";

  // Greeting (shown as first AI message)
  const greeting = conversation && messages.length === 0 && !loading
    ? GREETING_TEMPLATE(userName, mode)
    : null;

  // WebSocket client
  const wsClient = getWebSocketClient();

  // Setup WebSocket connection
  useEffect(() => {
    if (id && token) {
      if (wsClient.getState() !== WS_STATES.CLOSED && wsClient.connectionId !== Number(id)) {
        wsClient.disconnect();
      }

      wsClient.connect(Number(id), token);

      // Named handlers so cleanup can actually remove them: off(event, handler)
      // filters by identity, so the previous one-arg off() calls removed nothing
      // and leaked a handler per effect run — which would double-enqueue audio.
      const onPartial = ({ text }) => setInput(text);

      const onState = (payload) => {
        // backend sends { value: 'processing'|'speaking'|'listening' };
        // connection lifecycle emits a bare string ('OPEN'/'CLOSED') — ignore it.
        const v = typeof payload === "string" ? null : payload?.value;
        if (!v) return;
        setWsAiStatus(v);
        coachSpeakingRef.current = v === "speaking";
      };

      const onAssistantDelta = ({ text }) => setStreamingAssistantText((prev) => prev + text);

      const onAssistantDone = () => {
        setStreamingAssistantText("");
        setWsAiStatus(null);
        coachSpeakingRef.current = false;
        waitingForTurnRef.current = false;
        loadMessages(token, id);
      };

      // Single audio path: the gapless singleton player (Tier-B). Tier-A
      // useTTSPlayer is removed so audio plays through exactly one system.
      const onAudioFrame = (buffer) => getOutputPlayer().enqueue(buffer);
      const onStopAudio = () => getOutputPlayer().stop(); // barge-in hook

      const onError = ({ message }) => {
        toast(message, "error");
        waitingForTurnRef.current = false;
      };

      wsClient.on("partial_transcript", onPartial);
      wsClient.on("state", onState);
      wsClient.on("assistant_delta", onAssistantDelta);
      wsClient.on("assistant_done", onAssistantDone);
      wsClient.on("audio_frame", onAudioFrame);
      wsClient.on("stop_audio", onStopAudio);
      wsClient.on("error", onError);

      return () => {
        wsClient.disconnect();
        wsClient.off("partial_transcript", onPartial);
        wsClient.off("state", onState);
        wsClient.off("assistant_delta", onAssistantDelta);
        wsClient.off("assistant_done", onAssistantDone);
        wsClient.off("audio_frame", onAudioFrame);
        wsClient.off("stop_audio", onStopAudio);
        wsClient.off("error", onError);
      };
    }
  }, [id, token, toast]);

  // Audio recorder with WebSocket streaming
  const { start, stop, recording, transcribing, audioBlob, duration, stream } = useAudioRecorder(
    token,
    (transcript) => setInput((prev) => (prev ? `${prev} ${transcript}` : transcript).trim()),
    (chunk) => {
      if (!coachSpeakingRef.current) {
        wsClient.sendAudioChunk(chunk);
      }
    },
    (blob, elapsed) => {
      // Store blob for upload after WS turn completes
      // This allows us to upload the audio for playback later
    },
  );

  // VAD for speech detection - VAD triggers WS turn processing
  const { startVAD, stopVAD } = useVAD(
    stream,
    () => {
      // On speech start, just show UI state
      wsClient.sendControlMessage("start_turn");
    },
    async () => {
      // On speech end, process turn via WebSocket with TTS
      // Show optimistic user message immediately using the partial transcript
      const partialText = input.trim() || "Voice message";
      const tempAudioUrl = audioBlob ? URL.createObjectURL(audioBlob) : null;
      
      const tempId = `temp-${Date.now()}`;
      const optimisticMsg = {
        id: tempId,
        role: "user",
        content: partialText,
        audio_url: tempAudioUrl,
        audio_duration: duration,
        created_at: new Date().toISOString(),
      };
      
      setSending(true);
      addMessages([optimisticMsg]);
      setInput("");
      waitingForTurnRef.current = true;
      
      // Trigger the server to process this turn (transcribe full audio, get LLM response, TTS)
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
  const pendingHandledForRef = useRef(null);

  useEffect(() => {
    if (!id || !token) return;
    const prevId = prevIdRef.current;
    prevIdRef.current = id;

    const pendingMessage = location.state?.pendingMessage;
    const pendingAudio = location.state?.pendingAudio;
    if ((pendingMessage || pendingAudio) && pendingHandledForRef.current !== id) {
      pendingHandledForRef.current = id;
      clear();
      const afterSend = () => {
        const msgs = useMessageStore.getState().messages;
        const last = msgs[msgs.length - 1];
        if (last?.role === "assistant" && last.id != null) setAnimateId(last.id);
        refreshConversation(Number(id), token);
      };
      if (pendingMessage) {
        send(token, id, pendingMessage).then(afterSend);
      } else {
        send(token, id, pendingAudio.content, pendingAudio.audio_url, pendingAudio.duration).then(afterSend);
      }
      navigate(`/app/${id}`, { replace: true });
      return;
    }

    if (prevId !== id) {
      clear();
      loadMessages(token, id);
    }
  }, [id, token, location.state, currentConvId, send, clear, loadMessages, navigate, refreshConversation]);

  useEffect(() => {
    setModeLocked(messages.length > 1);
  }, [messages.length]);

  const handleSend = useCallback(async (text, inputType = "text") => {
    if (!text.trim() || !id) return;
    setInput("");

    try {
      await send(token, id, text.trim());
      // Write-out animation for the just-arrived assistant reply.
      const msgs = useMessageStore.getState().messages;
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant" && last.id != null) setAnimateId(last.id);
      const isFirst = messages.length === 0;
      if (isFirst) refreshConversation(Number(id), token);
    } catch (e) {
      toast(e.message || "Failed to send message", "error");
    }
  }, [id, token, send, messages.length, refreshConversation, toast]);

  // Voice message in normal chat: on stop, persist the recording (audio_url) +
  // its transcription as the message content, so it appears as a playable
  // AudioBubble with the transcript. `result` = { blob, transcript, duration }.
  const handleAudioSend = useCallback(async (result) => {
    const blob = result?.blob;
    if (!blob || !id) return;

    const transcript = (result?.transcript || "").trim();
    const textToSend = transcript || "Voice message";
    const tempAudioUrl = URL.createObjectURL(blob);
    const tempId = `temp-${Date.now()}`;
    const wasFirst = messages.length === 0;

    setSending(true);
    addMessages([
      {
        id: tempId,
        role: "user",
        content: textToSend,
        audio_url: tempAudioUrl,
        audio_duration: result?.duration ?? null,
        created_at: new Date().toISOString(),
      },
    ]);
    setInput("");

    try {
      const { audio_url, duration: audioDuration } = await uploadAudio(token, blob);
      const [userMsg, assistantMsg] = await sendMessage(token, id, textToSend, audio_url, audioDuration);
      replaceOptimisticMessages([userMsg, assistantMsg]);
      if (assistantMsg?.id != null) setAnimateId(assistantMsg.id);
      URL.revokeObjectURL(tempAudioUrl);
      if (wasFirst) refreshConversation(Number(id), token);
    } catch (e) {
      loadMessages(token, id);
      setSending(false);
      toast(e.message || "Failed to send audio message", "error");
    }
  }, [id, token, messages.length, addMessages, replaceOptimisticMessages, loadMessages, refreshConversation, toast]);

  const handleMicToggle = async () => {
    if (recording) {
      // stop() resolves with the finalized recording + clean transcript.
      const result = await stop();
      if (result?.blob) handleAudioSend(result);
    } else {
      getAudioContext(); // unlock audio output for TTS within this user gesture
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
  const isEmpty = !loading && messages.length === 0;

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
          {/* Loading skeletons */}
          {loading && (
            <div style={{ flex: 1, overflow: "hidden", padding: "20px 20px 8px", maxWidth: 820, margin: "0 auto", width: "100%" }}>
              <SkeletonMessage align="left" />
              <div style={{ height: 40 }} />
              <SkeletonMessage align="right" />
              <div style={{ height: 40 }} />
              <SkeletonMessage align="left" />
              <div style={{ height: 40 }} />
              <SkeletonMessage align="right" />
            </div>
          )}

          {/* Empty state — centered "hero" composer (starts in the middle) */}
          {isEmpty && (
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "32px 20px 48px",
              }}
            >
              <div style={{ width: "100%", maxWidth: 720, animation: "fadeUp 520ms cubic-bezier(.2,.7,.2,1) both" }}>
                <div style={{ textAlign: "center", marginBottom: 26 }}>
                  <div
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11,
                      letterSpacing: 2.5,
                      textTransform: "uppercase",
                      color: "var(--gold)",
                      marginBottom: 16,
                    }}
                  >
                    {MODE_LABELS[mode] || "professional"} coach
                  </div>
                  <h1 className="display" style={{ fontSize: "clamp(30px, 4.2vw, 46px)", margin: 0 }}>
                    Hello {userName.split(" ")[0]}
                    <span style={{ color: "var(--gold)" }}>.</span>
                  </h1>
                  <p
                    style={{
                      color: "var(--bone-dim)",
                      fontSize: 15.5,
                      lineHeight: 1.6,
                      marginTop: 14,
                      maxWidth: 520,
                      marginLeft: "auto",
                      marginRight: "auto",
                    }}
                  >
                    {HERO_SUBTITLE[mode] || HERO_SUBTITLE.professional}
                  </p>
                </div>

                <InputBar
                  variant="hero"
                  autoFocus
                  mode={mode}
                  onModeChange={() => {}}
                  modeLocked={true}
                  micActive={recording}
                  videoActive={videoActive}
                  onMicToggle={handleMicToggle}
                  onVideoToggle={handleVideoToggle}
                  onSend={handleSend}
                  disabled={sending || transcribing}
                  value={input}
                  onChange={setInput}
                />

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 24 }}>
                  {(SUGGESTIONS[mode] || SUGGESTIONS.professional).map((s) => (
                    <SuggestionChip key={s} onClick={() => handleSend(s)}>
                      {s}
                    </SuggestionChip>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Active conversation — docked composer */}
          {!loading && !isEmpty && (
            <>
              {aiStatus && (
                <div style={{ padding: "10px 20px 0", maxWidth: 820, margin: "0 auto", width: "100%" }}>
                  <AIStatus status={aiStatus} />
                </div>
              )}

              <MessageList
                messages={messages.map(normalizeMessage)}
                greeting={null}
                isAiTyping={sending && !streamingAssistantText}
                streamingAssistantText={streamingAssistantText}
                animateId={animateId}
              />

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
                variant="docked"
                mode={mode}
                onModeChange={() => {}}
                modeLocked={true}
                micActive={recording}
                videoActive={videoActive}
                onMicToggle={handleMicToggle}
                onVideoToggle={handleVideoToggle}
                onSend={handleSend}
                disabled={sending || transcribing}
                value={input}
                onChange={setInput}
              />
            </>
          )}
        </div>
      </div>

      {/* Launch full-screen immersive voice mode */}
      <button
        onClick={() => {
          getAudioContext(); // resume AudioContext within the user gesture
          setVoiceMode(true);
        }}
        title="Voice mode"
        aria-label="Enter voice mode"
        style={{
          position: "absolute",
          right: 20,
          bottom: 84,
          width: 48,
          height: 48,
          borderRadius: "50%",
          border: "1px solid var(--whisper-2)",
          background: "var(--gold-soft)",
          color: "var(--gold)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
        </svg>
      </button>

      {/* Webcam self-view (PiP) */}
      {videoActive && webcam.active && (
        <SelfVideo videoRef={webcam.videoRef} onClose={handleVideoClose} />
      )}

      {/* Full-screen immersive voice/video takeover (position:fixed z-index:50) */}
      {voiceMode && (
        <VoiceMode
          conversationId={id}
          wsClient={wsClient}
          onEnd={() => setVoiceMode(false)}
        />
      )}
    </div>
  );
}

function SuggestionChip({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 16px",
        borderRadius: 999,
        border: "1px solid var(--whisper-2)",
        background: "var(--ink-2)",
        color: "var(--bone-dim)",
        fontSize: 13,
        fontFamily: "'Inter', system-ui, sans-serif",
        cursor: "pointer",
        transition: "all 200ms cubic-bezier(.2,.7,.2,1)",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--gold)";
        e.currentTarget.style.color = "var(--bone)";
        e.currentTarget.style.background = "var(--gold-soft)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--whisper-2)";
        e.currentTarget.style.color = "var(--bone-dim)";
        e.currentTarget.style.background = "var(--ink-2)";
        e.currentTarget.style.transform = "none";
      }}
    >
      {children}
    </button>
  );
}