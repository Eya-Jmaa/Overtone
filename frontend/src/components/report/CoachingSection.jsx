const PRIORITY_COLOR = {
  high: "var(--rose)",
  medium: "var(--gold)",
  low: "var(--sage)",
};

export default function CoachingSection({ title, items = [], variant = "improve" }) {
  if (!items.length) return null;

  const isWin = variant === "well";

  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{
        fontFamily: "'Fraunces', serif",
        fontSize: 18, fontWeight: 500, color: "var(--bone)",
        margin: "0 0 16px 0",
      }}>
        {title}
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((item, i) => {
          const accent = isWin
            ? "var(--sage)"
            : PRIORITY_COLOR[item.priority] || "var(--gold)";
          return (
            <article
              key={i}
              style={{
                padding: "16px 18px",
                background: "var(--ink-2)",
                border: "1px solid var(--whisper-2)",
                borderLeft: `3px solid ${accent}`,
                borderRadius: 12,
              }}
            >
              <header style={{
                display: "flex", alignItems: "center", gap: 10,
                flexWrap: "wrap", marginBottom: 7,
              }}>
                {item.timestamp && (
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11, color: accent,
                    background: `color-mix(in srgb, ${accent} 14%, transparent)`,
                    padding: "2px 7px", borderRadius: 5,
                  }}>
                    {item.timestamp}
                  </span>
                )}
                <h3 style={{
                  fontSize: 14.5, fontWeight: 600,
                  color: "var(--bone)", margin: 0,
                }}>
                  {item.title}
                </h3>
                {!isWin && item.priority && (
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 9, letterSpacing: 1, textTransform: "uppercase",
                    color: accent, marginLeft: "auto",
                  }}>
                    {item.priority}
                  </span>
                )}
              </header>

              <p style={{
                fontSize: 13, lineHeight: 1.65,
                color: "var(--bone-dim)", margin: 0,
              }}>
                {item.detail}
              </p>

              {item.technique && (
                <div style={{
                  marginTop: 11, paddingTop: 10,
                  borderTop: "1px solid var(--whisper-2)",
                  fontSize: 11.5, color: "var(--bone-faint)",
                  display: "flex", alignItems: "center", gap: 7,
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                  Technique:&nbsp;
                  <strong style={{ color: "var(--bone-dim)", fontWeight: 600 }}>
                    {item.technique}
                  </strong>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
