import ModeTag from "./ModeTag.jsx";

export default function Topbar({ title, mode, right }) {
  return (
    <div style={{
      height: 56, flexShrink: 0,
      padding: "0 20px",
      background: "var(--bg-base)",
      borderBottom: "1px solid var(--border)",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <span style={{
          fontSize: 14, fontWeight: 600,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {title || "Conversation"}
        </span>
        {mode && <ModeTag mode={mode} />}
      </div>
      <div>{right}</div>
    </div>
  );
}