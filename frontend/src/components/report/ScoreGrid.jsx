const BASIS_NOTE = {
  measured: "Measured",
  llm: "Model estimate",
};

function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export default function ScoreGrid({ scoreGrid = {} }) {
  const confidence = scoreGrid.confidence || null;
  const fillerRate = scoreGrid.filler_rate || null;
  const sessionLength = scoreGrid.session_length || null;
  const eyeContact = scoreGrid.eye_contact || null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <MetricBar
        label="Communication confidence"
        entry={confidence}
        max={10}
        renderValue={(e) => e.value.toFixed(1)}
      />

      <MetricRow
        label="Filler rate"
        entry={fillerRate}
        renderValue={(e) => `${e.value}%`}
        emptyHint="Speak a turn in voice mode to measure this"
      />

      <MetricRow
        label="Session length"
        entry={sessionLength}
        renderValue={(e) => fmtDuration(e.value)}
      />

      <MetricRow
        label="Eye contact"
        entry={eyeContact}
        emptyHint="Requires video analysis — not available yet"
      />
    </div>
  );
}

function MetricShell({ label, entry, children, emptyHint }) {
  const measured = !!entry;
  return (
    <div>
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "baseline", gap: 12, marginBottom: 5,
      }}>
        <span style={{ fontSize: 13, color: "var(--bone-dim)", fontWeight: 500 }}>
          {label}
        </span>
        {children}
      </div>
      <div style={{
        fontSize: 11,
        color: "var(--bone-faint)",
        fontFamily: "'JetBrains Mono', monospace",
        letterSpacing: 0.2,
      }}>
        {measured
          ? [BASIS_NOTE[entry.basis] || "", entry.detail].filter(Boolean).join(" · ")
          : emptyHint || "Not yet measured"}
      </div>
    </div>
  );
}

function MetricRow({ label, entry, renderValue, emptyHint }) {
  return (
    <MetricShell label={label} entry={entry} emptyHint={emptyHint}>
      {entry ? (
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 14, color: "var(--bone)", fontWeight: 500,
        }}>
          {renderValue(entry)}
        </span>
      ) : (
        <NotMeasured />
      )}
    </MetricShell>
  );
}

function MetricBar({ label, entry, max, renderValue }) {
  const pct = entry ? Math.max(0, Math.min(100, (entry.value / max) * 100)) : 0;
  return (
    <div>
      <MetricShell label={label} entry={entry}>
        {entry ? (
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: "var(--bone)" }}>
            {renderValue(entry)}
            <span style={{ color: "var(--bone-faint)", fontWeight: 400 }}> / {max}</span>
          </span>
        ) : (
          <NotMeasured />
        )}
      </MetricShell>
      {entry && (
        <div style={{
          height: 4, background: "var(--ink-3)", borderRadius: 2,
          overflow: "hidden", marginTop: 8,
        }}>
          <div style={{
            height: "100%", width: `${pct}%`, borderRadius: 2,
            background: "linear-gradient(90deg, color-mix(in srgb, var(--gold) 55%, transparent), var(--gold))",
          }} />
        </div>
      )}
    </div>
  );
}

function NotMeasured() {
  return (
    <span style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: "var(--bone-faint)",
      border: "1px solid var(--whisper-2)",
      borderRadius: 5,
      padding: "2px 7px",
      whiteSpace: "nowrap",
    }}>
      Not measured
    </span>
  );
}
