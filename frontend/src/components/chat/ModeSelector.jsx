const MODES = [
  { id: "psy", label: "Psychology", color: "#a78bfa" },
  { id: "professional", label: "Professional", color: "#d4a574" },
  { id: "sport", label: "Sport", color: "#34d399" },
];

export default function ModeSelector({ value = "professional", onChange }) {
  return (
    <div
      role="radiogroup"
      aria-label="Coaching mode"
      style={{
        display: "inline-flex",
        gap: 3,
        padding: 4,
        background: "var(--ink-2)",
        border: "1px solid var(--whisper-2)",
        borderRadius: 999,
        boxShadow: "0 6px 20px -12px rgba(0,0,0,0.6)",
      }}
    >
      {MODES.map((m) => {
        const active = m.id === value;
        return (
          <button
            key={m.id}
            role="radio"
            aria-checked={active}
            onClick={() => onChange?.(m.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "7px 15px",
              borderRadius: 999,
              border: "none",
              background: active ? "var(--gold-soft)" : "transparent",
              cursor: "pointer",
              color: active ? "var(--gold)" : "var(--bone-dim)",
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: "'Inter', system-ui, sans-serif",
              transition: "background 200ms, color 200ms",
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.color = "var(--bone)";
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.color = "var(--bone-dim)";
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: m.color,
                opacity: active ? 1 : 0.45,
                transition: "opacity 200ms",
                boxShadow: active ? `0 0 8px ${m.color}` : "none",
              }}
            />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
