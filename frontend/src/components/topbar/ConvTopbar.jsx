import { useState, useEffect } from "react";

/**
 * Conversation-specific topbar.
 * - Scenario title in Fraunces serif (matching login display font)
 * - Locked mode badge
 * - Live session timer
 * - End session button with confirmation
 * - Thin gold bottom border
 */
export default function ConvTopbar({
  scenario = null,
  mode = "professional",
  onEndSession,
  startTime = null,
}) {
  const [elapsed, setElapsed] = useState("0:00");
  const [showConfirm, setShowConfirm] = useState(false);

  // Session timer
  useEffect(() => {
    if (!startTime) return;
    const tick = () => {
      const diff = Math.floor((Date.now() - startTime) / 1000);
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setElapsed(`${m}:${s.toString().padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime]);

  const MODE_COLORS = {
    psy: "#a78bfa",
    professional: "#d4a574",
    sport: "#34d399",
  };

  return (
    <>
      <div
        style={{
          height: 52,
          borderBottom: "1px solid var(--whisper-2)",
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          justifyContent: "space-between",
          flexShrink: 0,
          position: "relative",
        }}
      >
        {/* Gold accent line at bottom */}
        <div
          style={{
            position: "absolute",
            bottom: -1,
            left: 20,
            right: 20,
            height: 1,
            background: "linear-gradient(90deg, var(--gold) 0%, transparent 100%)",
            opacity: 0.15,
          }}
        />

        {/* Left: title + mode badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontFamily: "'Fraunces', serif",
              fontSize: 16,
              fontWeight: 500,
              color: "var(--bone)",
              letterSpacing: -0.3,
            }}
          >
            {scenario?.title || "New conversation"}
          </span>
          <span
            style={{
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              padding: "3px 8px",
              borderRadius: 6,
              background: `${MODE_COLORS[mode] || MODE_COLORS.professional}15`,
              color: MODE_COLORS[mode] || MODE_COLORS.professional,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span style={{ fontSize: 8 }}>🔒</span>
            {mode}
          </span>
        </div>

      </div>

      {/* Confirmation overlay */}
      {showConfirm && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(10, 11, 16, 0.75)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: "fadeIn 200ms ease both",
          }}
        >
          <div
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--whisper-2)",
              borderRadius: 16,
              padding: "28px 32px",
              maxWidth: 380,
              width: "90%",
              animation: "fadeUp 300ms cubic-bezier(.2,.7,.2,1) both",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontFamily: "'Fraunces', serif",
                fontSize: 18,
                color: "var(--bone)",
                marginBottom: 8,
              }}
            >
              End this session?
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--bone-dim)",
                lineHeight: 1.6,
                marginBottom: 24,
              }}
            >
              Your conversation will be analyzed and a coaching report will be generated.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                onClick={() => setShowConfirm(false)}
                style={{
                  padding: "9px 20px",
                  borderRadius: 8,
                  border: "1px solid var(--whisper-2)",
                  background: "transparent",
                  color: "var(--bone-dim)",
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all 200ms",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--whisper)";
                  e.currentTarget.style.color = "var(--bone)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--whisper-2)";
                  e.currentTarget.style.color = "var(--bone-dim)";
                }}
              >
                Keep going
              </button>
              <button
                onClick={() => {
                  setShowConfirm(false);
                  onEndSession?.();
                }}
                style={{
                  padding: "9px 20px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--gold)",
                  color: "var(--ink)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all 200ms",
                  position: "relative",
                  overflow: "hidden",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = "0 0 20px 3px var(--gold-glow)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                End & get report
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
