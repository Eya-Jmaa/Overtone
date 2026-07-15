import { useParams, useNavigate } from "react-router-dom";

export default function ReportPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  return (
    <div style={{ padding: 40, color: "var(--text-base)" }}>
      <button
        onClick={() => navigate("/app")}
        style={{
          background: "transparent",
          border: "1px solid var(--border)",
          color: "var(--text-muted)",
          padding: "6px 12px",
          borderRadius: 8,
          fontSize: 12,
          cursor: "pointer",
          marginBottom: 20,
        }}
      >
        ← Back
      </button>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Coaching report</h1>
      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Session {id} — full report coming in M6</p>
    </div>
  );
}