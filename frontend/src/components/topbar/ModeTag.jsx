const MODE_CONFIG = {
  psy:          { label: "Psychology",   color: "#34d399", soft: "rgba(52,211,153,0.12)" },
  professional: { label: "Professional", color: "#60a5fa", soft: "rgba(96,165,250,0.12)" },
  sport:        { label: "Sport",        color: "#fbbf24", soft: "rgba(251,191,36,0.12)" },
};

export default function ModeTag({ mode, size = "md" }) {
  const config = MODE_CONFIG[mode] || MODE_CONFIG.professional;
  const padding = size === "sm" ? "2px 8px" : "4px 10px";
  const fontSize = size === "sm" ? 10 : 11;

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding,
      borderRadius: 6,
      background: config.soft,
      color: config.color,
      fontSize,
      fontWeight: 600,
      letterSpacing: 0.3,
      textTransform: "uppercase",
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: config.color }} />
      {config.label}
    </span>
  );
}

export { MODE_CONFIG };