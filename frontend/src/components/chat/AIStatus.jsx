/**
 * AI status chip.
 * - "Listening..." with pulsing gold dot
 * - "Coach is thinking..." with breathing animation
 * - "Coach is speaking..." with waveform icon
 * Fades in/out with the same easing as auth page elements.
 */
export default function AIStatus({ status = null }) {
  if (!status) return null;

  const configs = {
    listening: { label: "Listening", color: "var(--gold)", pulse: true },
    thinking: { label: "Coach is thinking", color: "var(--bone-dim)", pulse: true },
    speaking: { label: "Coach is speaking", color: "var(--gold)", pulse: false, wave: true },
  };

  const cfg = configs[status];
  if (!cfg) return null;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 12px",
        background: "var(--gold-soft)",
        borderRadius: 8,
        animation: "fadeUp 250ms cubic-bezier(.2,.7,.2,1) both",
      }}
    >
      {cfg.pulse && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: cfg.color,
            animation: "breathe 2s ease-in-out infinite",
          }}
        />
      )}
      {cfg.wave && (
        <span style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 12 }}>
          {[4, 8, 12, 8, 4].map((h, i) => (
            <span
              key={i}
              style={{
                width: 2,
                height: h,
                borderRadius: 1,
                background: "var(--gold)",
                opacity: 0.6,
                animation: `waveBar 1s ease-in-out ${i * 0.1}s infinite alternate`,
              }}
            />
          ))}
        </span>
      )}
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: cfg.color,
        }}
      >
        {cfg.label}
      </span>
    </div>
  );
}
