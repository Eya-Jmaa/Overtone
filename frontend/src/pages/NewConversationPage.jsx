import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore.js";
import { useDraftStore } from "../stores/draftStore.js";
import { useConvStore } from "../stores/convStore.js";
import { useMessageStore } from "../stores/messageStore.js";
import { useToastStore } from "../stores/toastStore.js";
import { useAudioRecorder } from "../hooks/useAudioRecorder.js";
import { MODE_CONFIG } from "../components/topbar/ModeTag.jsx";
import MessageList from "../components/chat/MessageList.jsx";
import InputBar from "../components/chat/InputBar.jsx";
import { uploadAudio } from "../services/messageApi.js";
import { getAudioContext } from "../services/audioEngine.js";

const MODE_LABELS = {
  psy: "psychology",
  professional: "professional",
  sport: "sport performance",
};

const GREETING = (name, mode) =>
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

export default function NewConversationPage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.accessToken);
  const userName = useAuthStore((s) => s.user?.name || "there");
  const createConversation = useConvStore((s) => s.createConversation);
  const clearMessages = useMessageStore((s) => s.clear);
  const toast = useToastStore((s) => s.add);
  const [mode, setMode] = useState("professional");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const navigatedRef = useRef(false);
  const createdConvRef = useRef(null);

  const { start, stop, recording, transcribing, audioBlob, duration: audioDuration } = useAudioRecorder(
    token,
    (transcript) => setInput((prev) => (prev ? `${prev} ${transcript}` : transcript).trim()),
  );

  const handleSend = useCallback(async (text, inputType = "text") => {
    if (!text.trim() || sending || navigatedRef.current) return;
    setSending(true);

    try {
      let conv = createdConvRef.current;
      if (!conv) {
        conv = await createConversation({ mode, title: null }, token);
        if (!conv) throw new Error("Failed to create conversation");
        createdConvRef.current = conv;
      }

      navigatedRef.current = true;
      clearMessages();
      navigate(`/app/${conv.id}`, {
        replace: true,
        state: { pendingMessage: text.trim() },
      });
    } catch (e) {
      console.error("Send error:", e);
      navigatedRef.current = false;
      setSending(false);
      toast(e.message || "Failed to send message", "error");
    }
  }, [mode, sending, token, createConversation, clearMessages, navigate, toast]);

  const handleAudioSend = useCallback(async (result) => {
    const blob = result?.blob || audioBlob;
    const dur = result?.duration ?? audioDuration;
    if (!blob || sending || navigatedRef.current) return;
    setSending(true);

    try {
      const { audio_url } = await uploadAudio(token, blob);

      let conv = createdConvRef.current;
      if (!conv) {
        conv = await createConversation({ mode, title: null }, token);
        if (!conv) throw new Error("Failed to create conversation");
        createdConvRef.current = conv;
      }

      const transcript = (result?.transcript || "").trim();
      const content = transcript || input.trim() || "Voice message";

      navigatedRef.current = true;
      clearMessages();
      navigate(`/app/${conv.id}`, {
        replace: true,
        state: { pendingAudio: { audio_url, content, duration: dur } },
      });
    } catch (e) {
      console.error("Audio send error:", e);
      navigatedRef.current = false;
      setSending(false);
      toast(e.message || "Failed to send audio message", "error");
    }
  }, [audioBlob, audioDuration, sending, mode, token, input, createConversation, clearMessages, navigate, toast]);

  const handleMicToggle = async () => {
    if (recording) {
      const result = await stop();
      if (result?.blob) handleAudioSend(result);
    } else {
      start();
    }
  };

  const handleStartLive = useCallback(async (withVideo) => {
    if (sending || navigatedRef.current) return;
    setSending(true);

    getAudioContext();

    try {
      let conv = createdConvRef.current;
      if (!conv) {
        conv = await createConversation({ mode, title: null }, token);
        if (!conv) throw new Error("Failed to create conversation");
        createdConvRef.current = conv;
      }

      navigatedRef.current = true;
      clearMessages();
      navigate(`/app/${conv.id}`, {
        replace: true,
        state: { startLive: { video: withVideo } },
      });
    } catch (e) {
      console.error("Start live session error:", e);
      navigatedRef.current = false;
      setSending(false);
      toast(e.message || "Failed to start the session", "error");
    }
  }, [sending, mode, token, createConversation, clearMessages, navigate, toast]);

  const modeColor = MODE_CONFIG[mode]?.color || "var(--gold)";

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
      <div
        style={{
          height: 52,
          borderBottom: "1px solid var(--whisper-2)",
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          flexShrink: 0,
        }}
      >
        <span style={{
          fontFamily: "'Fraunces', serif",
          fontSize: 16,
          fontWeight: 500,
          color: "var(--bone)",
          letterSpacing: -0.3,
        }}>
          New conversation
        </span>
        <span
          style={{
            fontSize: 10,
            fontFamily: "'JetBrains Mono', monospace",
            padding: "3px 8px",
            borderRadius: 6,
            background: `${modeColor}15`,
            color: modeColor,
            marginLeft: 12,
          }}
        >
          {mode}
        </span>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 20px 48px",
          minHeight: 0,
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
                color: modeColor,
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

          {transcribing && (
            <div style={{ textAlign: "center", marginBottom: 10, fontSize: 12, color: "var(--gold)", fontFamily: "'JetBrains Mono', monospace" }}>
              Transcribing…
            </div>
          )}

          <InputBar
            variant="hero"
            autoFocus
            mode={mode}
            onModeChange={setMode}
            modeLocked={false}
            micActive={recording}
            videoActive={false}
            onMicToggle={handleMicToggle}
            onVideoToggle={() => {}}
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

          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            margin: "30px auto 0", maxWidth: 420,
          }}>
            <div style={{ flex: 1, height: 1, background: "var(--whisper-2)" }} />
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
              letterSpacing: 2, color: "var(--bone-faint)", textTransform: "uppercase",
            }}>or talk instead</span>
            <div style={{ flex: 1, height: 1, background: "var(--whisper-2)" }} />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", marginTop: 18 }}>
            <LiveButton
              onClick={() => handleStartLive(false)}
              disabled={sending || transcribing}
              accent={modeColor}
              icon={LiveMicIcon}
              label="Start voice conversation"
            />
            <LiveButton
              onClick={() => handleStartLive(true)}
              disabled={sending || transcribing}
              accent={modeColor}
              icon={LiveVideoIcon}
              label="Start video conversation"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const LiveMicIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
  </svg>
);

const LiveVideoIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M23 7l-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="2" />
  </svg>
);

function LiveButton({ onClick, disabled, accent, icon, label }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: 9,
        padding: "12px 20px", borderRadius: 999,
        border: `1px solid ${accent}`,
        background: `color-mix(in srgb, ${accent} 12%, transparent)`,
        color: accent,
        fontSize: 13.5, fontWeight: 500,
        fontFamily: "'Inter', system-ui, sans-serif",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all 200ms cubic-bezier(.2,.7,.2,1)",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = `color-mix(in srgb, ${accent} 22%, transparent)`;
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = `color-mix(in srgb, ${accent} 12%, transparent)`;
        e.currentTarget.style.transform = "none";
      }}
    >
      {icon}
      {label}
    </button>
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
