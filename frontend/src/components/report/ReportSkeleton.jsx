export default function ReportSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Generating your coaching report"
      style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}
    >
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11, letterSpacing: 2.5, textTransform: "uppercase",
        color: "var(--gold)", marginBottom: 14,
      }}>
        Analysing your session…
      </div>
      <p style={{
        color: "var(--bone-dim)", fontSize: 14, lineHeight: 1.6,
        margin: "0 0 32px 0", maxWidth: 460,
      }}>
        Reading the transcript, pulling relevant coaching techniques, and writing
        your debrief. This takes a few seconds.
      </p>

      <Bar w="60%" h={30} mb={26} />

      <Block lines={3} />
      <div style={{ height: 28 }} />
      <Bar w="35%" h={16} mb={16} />
      <Card />
      <Card />
      <div style={{ height: 22 }} />
      <Bar w="42%" h={16} mb={16} />
      <Card />
      <Card />

      <style>{`
        @keyframes reportPulse {
          0%, 100% { opacity: 0.38; }
          50%      { opacity: 0.72; }
        }
      `}</style>
    </div>
  );
}

const pulse = {
  background: "var(--ink-3)",
  borderRadius: 8,
  animation: "reportPulse 1.8s ease-in-out infinite",
};

function Bar({ w, h, mb = 0 }) {
  return <div style={{ ...pulse, width: w, height: h, marginBottom: mb }} />;
}

function Block({ lines = 3 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          style={{ ...pulse, height: 12, width: i === lines - 1 ? "72%" : "100%",
                   animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
}

function Card() {
  return (
    <div style={{
      border: "1px solid var(--whisper-2)",
      borderLeft: "3px solid var(--ink-3)",
      borderRadius: 12,
      padding: "16px 18px",
      marginBottom: 12,
      display: "flex", flexDirection: "column", gap: 9,
    }}>
      <div style={{ ...pulse, height: 13, width: "45%" }} />
      <div style={{ ...pulse, height: 11, width: "100%", animationDelay: "120ms" }} />
      <div style={{ ...pulse, height: 11, width: "66%", animationDelay: "240ms" }} />
    </div>
  );
}
