import { useState } from "react";
import AudioBubble from "./AudioBubble.jsx";
import Typewriter from "./Typewriter.jsx";

const TYPE_ICONS = {
  text: "⌨",
  audio: "🎙",
  video: "📹",
};

export default function MessageBubble({ message, index = 0, animate = false, onType }) {
  const [hovered, setHovered] = useState(false);
  const isUser = message.role === "user";
  const isDraft = message.draft;
  const hasAudio = message.audio_url;

  const formatTime = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  if (!isUser) {
    return (
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          maxWidth: "94%",
          animation: `fadeUp 420ms cubic-bezier(.2,.7,.2,1) ${40 + index * 24}ms both`,
        }}
      >
        <div
          style={{
            color: isDraft ? "var(--bone)" : "var(--bone)",
            fontSize: 15,
            lineHeight: 1.75,
            fontFamily: "'Inter', system-ui, sans-serif",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {isDraft ? (
            <>
              {message.content}
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 7,
                  height: "1em",
                  marginLeft: 2,
                  transform: "translateY(1px)",
                  background: "var(--gold)",
                  borderRadius: 1,
                  animation: "breathe 1s ease-in-out infinite",
                }}
              />
            </>
          ) : (
            <Typewriter text={message.content || ""} animate={animate} onTick={onType} />
          )}
        </div>

        <div
          style={{
            height: 14,
            marginTop: 6,
            opacity: hovered ? 1 : 0,
            transition: "opacity 200ms",
            fontSize: 10,
            fontFamily: "'JetBrains Mono', monospace",
            color: "var(--bone-faint)",
          }}
        >
          {formatTime(message.timestamp)}
        </div>
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        justifyContent: "flex-end",
        animation: `fadeUp 400ms cubic-bezier(.2,.7,.2,1) ${40 + index * 24}ms both`,
      }}
    >
      <div
        style={{
          maxWidth: hasAudio ? "85%" : "78%",
          padding: hasAudio ? "8px 10px" : "11px 15px",
          borderRadius: 18,
          borderBottomRightRadius: 5,
          background: "linear-gradient(160deg, color-mix(in srgb, var(--accent) 17%, var(--bg-elevated)), var(--bg-surface))",
          border: "1px solid color-mix(in srgb, var(--accent) 30%, var(--border))",
          boxShadow: hovered
            ? "var(--edge-light), var(--shadow-md)"
            : "var(--edge-light), var(--shadow-sm)",
          color: "var(--bone)",
          fontSize: 14.5,
          lineHeight: 1.6,
          position: "relative",
          transform: hovered ? "translateY(-1px)" : "none",
          transition: "transform 200ms var(--ease), box-shadow 200ms",
        }}
      >
        {hasAudio ? (
          <AudioBubble
            audioUrl={message.audio_url}
            duration={message.audio_duration}
            transcription={message.content}
          />
        ) : (
          <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{message.content}</div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 6,
            marginTop: 4,
            height: 14,
            opacity: message.pending ? 1 : hovered ? 1 : 0,
            transition: "opacity 200ms",
          }}
        >
          {message.pending ? (
            <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "var(--gold)" }}>
              queued — will send when back online
            </span>
          ) : (
            <>
              <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "var(--bone-faint)" }}>
                {formatTime(message.timestamp)}
              </span>
              {message.inputType && (
                <span style={{ fontSize: 9, opacity: 0.5 }}>{TYPE_ICONS[message.inputType] || ""}</span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
