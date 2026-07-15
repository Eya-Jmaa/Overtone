import { useState, useRef, useEffect } from "react";
import ModeSelector from "./ModeSelector.jsx";

/**
 * Premium adaptive composer.
 * - variant="hero"   → larger, centered (empty-conversation state)
 * - variant="docked" → compact, bottom-docked (active conversation)
 *
 * Left: coaching-mode pill (locks after first message).
 * Center: auto-growing textarea (shows live transcription while recording).
 * Right: mic, video, send — SVG icons, gold accents, shimmer on send.
 */
export default function InputBar({
  mode = "professional",
  onModeChange,
  modeLocked = false,
  micActive = false,
  videoActive = false,
  onMicToggle,
  onVideoToggle,
  onSend,
  disabled = false,
  value = "",
  onChange,
  variant = "docked",
  placeholder,
  autoFocus = false,
}) {
  const isControlled = value !== undefined && onChange !== undefined;
  const [internalText, setInternalText] = useState("");
  const text = isControlled ? value : internalText;
  const setText = isControlled ? onChange : setInternalText;
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef(null);

  const hero = variant === "hero";

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, hero ? 200 : 140) + "px";
    }
  }, [text, hero]);

  useEffect(() => {
    if (autoFocus && textareaRef.current) textareaRef.current.focus();
  }, [autoFocus]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (text.trim() && !disabled) {
      onSend?.(text.trim(), "text");
      setText("");
    }
  };

  const canSend = text.trim() || micActive;
  const active = focused || micActive;

  return (
    <div
      style={{
        padding: hero ? 0 : "14px 16px 18px",
        background: hero ? "transparent" : "var(--ink)",
        flexShrink: 0,
        width: "100%",
        maxWidth: hero ? 720 : 820,
        margin: "0 auto",
      }}
    >
      {/* Inline mode selector — chosen before the first message, then locked */}
      {hero && !modeLocked && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18, animation: "fadeUp 500ms cubic-bezier(.2,.7,.2,1) both" }}>
          <ModeSelector value={mode} onChange={onModeChange} />
        </div>
      )}

      <div
        className="conv-input-shell"
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 6,
          background: "linear-gradient(180deg, var(--ink-3), var(--ink-2))",
          borderRadius: hero ? 24 : 20,
          padding: hero ? "12px 12px 12px 16px" : "9px 9px 9px 14px",
          border: `1px solid ${active ? "var(--gold)" : "var(--whisper-2)"}`,
          boxShadow: active
            ? "0 18px 50px -18px rgba(0,0,0,0.7), 0 0 0 4px var(--gold-soft)"
            : "0 14px 40px -20px rgba(0,0,0,0.65)",
          transition: "border-color 260ms cubic-bezier(.2,.7,.2,1), box-shadow 260ms cubic-bezier(.2,.7,.2,1)",
          position: "relative",
        }}
      >
        {/* Center: textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder || (micActive ? "Listening…" : "Message your coach…")}
          disabled={disabled}
          rows={1}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            color: "var(--bone)",
            fontSize: hero ? 16 : 14.5,
            fontFamily: "'Inter', system-ui, sans-serif",
            resize: "none",
            outline: "none",
            minHeight: hero ? 28 : 24,
            maxHeight: hero ? 200 : 140,
            lineHeight: 1.55,
            padding: hero ? "6px 4px" : "4px 2px",
          }}
        />

        {/* Right cluster */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: hero ? "flex-end" : "center" }}>
          <IconButton
            onClick={onMicToggle}
            disabled={disabled}
            active={micActive}
            accent="var(--gold)"
            title={micActive ? "Stop recording" : "Record voice"}
          >
            <MicGlyph />
          </IconButton>

          <IconButton
            onClick={onVideoToggle}
            disabled={disabled}
            active={videoActive}
            accent="#e8c9a0"
            title="Toggle video"
          >
            <VideoGlyph />
          </IconButton>

          {/* Send */}
          <button
            className="conv-send-btn"
            onClick={handleSend}
            disabled={disabled || !canSend}
            aria-label="Send"
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              border: "none",
              background: canSend
                ? "linear-gradient(135deg, #e8c9a0, var(--gold))"
                : "var(--ink-4)",
              color: canSend ? "#1a130a" : "var(--bone-faint)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: canSend ? "pointer" : "default",
              transition: "background 200ms, transform 120ms, box-shadow 200ms",
              flexShrink: 0,
              position: "relative",
              overflow: "hidden",
            }}
            onMouseEnter={(e) => {
              if (canSend) {
                e.currentTarget.style.boxShadow = "0 0 20px 2px var(--gold-glow)";
                e.currentTarget.style.transform = "translateY(-1px)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = "none";
              e.currentTarget.style.transform = "none";
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Hint line */}
      {hero && (
        <div
          style={{
            textAlign: "center",
            marginTop: 14,
            fontSize: 11.5,
            color: "var(--bone-faint)",
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: 0.3,
          }}
        >
          Press <b style={{ color: "var(--bone-dim)" }}>Enter</b> to send · <b style={{ color: "var(--bone-dim)" }}>Shift+Enter</b> for a new line
        </div>
      )}
    </div>
  );
}

function IconButton({ onClick, disabled, active, accent, title, children }) {
  return (
    <button
      className="conv-toggle-btn"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{
        width: 38,
        height: 38,
        borderRadius: "50%",
        border: `1px solid ${active ? accent : "var(--whisper-2)"}`,
        background: active ? "var(--gold-soft)" : "transparent",
        color: active ? accent : "var(--bone-dim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 180ms",
        flexShrink: 0,
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled && !active) {
          e.currentTarget.style.borderColor = accent;
          e.currentTarget.style.color = accent;
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = "var(--whisper-2)";
          e.currentTarget.style.color = "var(--bone-dim)";
        }
      }}
    >
      {children}
    </button>
  );
}

const MicGlyph = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" />
  </svg>
);

const VideoGlyph = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 7l-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="3" />
  </svg>
);
