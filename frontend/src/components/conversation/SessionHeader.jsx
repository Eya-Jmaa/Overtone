import { useRef, useEffect } from "react";

export default function SessionHeader({
  title, mode, isModeLocked, sessionTime, onEndSession,
  showModeMenu, setShowModeMenu, onModeSelect, modeMenuRef, coachingModes,
}) {
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <header className="conv-header">
      <div className="conv-header-left">
        <h1 className="conv-title">{title}</h1>
        <div className="conv-mode-wrapper" ref={modeMenuRef}>
          <button className={`conv-mode-pill ${isModeLocked ? "locked" : ""}`}
            onClick={() => !isModeLocked && setShowModeMenu(!showModeMenu)}
            style={{ "--mode-color": mode?.color }}>
            <span className="conv-mode-dot" />
            <span className="conv-mode-label">{mode?.label}</span>
            {!isModeLocked && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
            )}
            {isModeLocked && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
            )}
          </button>
          {showModeMenu && !isModeLocked && (
            <div className="conv-mode-popover">
              {coachingModes.map((m) => (
                <button key={m.id} className={`conv-mode-option ${mode?.id === m.id ? "active" : ""}`}
                  onClick={() => onModeSelect(m.id)} style={{ "--mode-color": m.color }}>
                  <span className="conv-mode-option-dot" />
                  <div className="conv-mode-option-info">
                    <span className="conv-mode-option-name">{m.label}</span>
                    <span className="conv-mode-option-desc">
                      {m.id === "psychology" && "Emotional intelligence & empathy coaching"}
                      {m.id === "professional" && "Career, negotiation & leadership skills"}
                      {m.id === "sport" && "Performance under pressure & mental game"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="conv-header-right">
        <span className="conv-timer">{formatTime(sessionTime)}</span>
        <button className="end-session-btn" onClick={onEndSession}>End session</button>
      </div>
    </header>
  );
}
