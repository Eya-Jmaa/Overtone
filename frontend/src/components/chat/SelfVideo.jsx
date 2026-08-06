import { useState, useRef, useCallback, useEffect } from "react";

const W = 232;
const H = Math.round((W * 9) / 16);
const MARGIN = 18;

export default function SelfVideo({ videoRef, onClose }) {
  const [position, setPosition] = useState(() => ({
    x: MARGIN,
    y: Math.max(MARGIN, window.innerHeight - H - 108),
  }));
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);
  const containerRef = useRef(null);

  const clamp = useCallback((x, y) => ({
    x: Math.max(MARGIN, Math.min(window.innerWidth - W - MARGIN, x)),
    y: Math.max(MARGIN, Math.min(window.innerHeight - H - MARGIN, y)),
  }), []);

  const handleMouseDown = useCallback((e) => {
    setDragging(true);
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const handleMouseMove = useCallback((e) => {
    setPosition(clamp(e.clientX - dragOffset.x, e.clientY - dragOffset.y));
  }, [dragOffset, clamp]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
    setPosition((p) => {
      const left = p.x + W / 2 < window.innerWidth / 2;
      const top = p.y + H / 2 < window.innerHeight / 2;
      return clamp(
        left ? MARGIN : window.innerWidth - W - MARGIN,
        top ? MARGIN : window.innerHeight - H - MARGIN,
      );
    });
  }, [clamp]);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, handleMouseMove, handleMouseUp]);

  useEffect(() => {
    const onResize = () => setPosition((p) => clamp(p.x, p.y));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        width: W,
        zIndex: 50,
        padding: 2,
        borderRadius: 16,
        background: "linear-gradient(150deg, var(--accent), var(--border) 55%, var(--accent))",
        boxShadow: dragging ? "var(--shadow-lg)" : "var(--shadow-md)",
        transition: dragging
          ? "box-shadow 160ms ease, transform 160ms ease"
          : "left 260ms var(--ease-out), top 260ms var(--ease-out), box-shadow 200ms, transform 200ms var(--ease)",
        transform: dragging ? "scale(1.03)" : "scale(1)",
        animation: "riseIn 340ms var(--ease-out) both",
      }}
    >
      <style>{SELF_VIDEO_CSS}</style>

      <div style={{
        position: "relative",
        borderRadius: 14,
        overflow: "hidden",
        aspectRatio: "16 / 9",
        background: "var(--ink-2)",
      }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%", height: "100%", objectFit: "cover",
            transform: "scaleX(-1)",
            display: "block",
          }}
        />

        <div
          onMouseDown={handleMouseDown}
          title="Drag to move"
          style={{ position: "absolute", inset: 0, cursor: dragging ? "grabbing" : "grab" }}
        />

        <div className="sv-controls" style={{ opacity: hovered || dragging ? 1 : 0 }}>
          <span className="sv-grip" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
              <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
              <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
            </svg>
          </span>

          <button onClick={onClose} className="sv-close" aria-label="Turn camera off" title="Turn camera off">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round">
              <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          </button>
        </div>

        <div className="sv-label">
          <span className="sv-dot" aria-hidden="true" />
          YOU
        </div>
      </div>
    </div>
  );
}

const SELF_VIDEO_CSS = `
.sv-controls {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 8px 16px;
  background: linear-gradient(to bottom, rgba(4,5,9,.72), transparent);
  transition: opacity 200ms ease;
  pointer-events: none;
}
.sv-controls > * { pointer-events: auto; }
.sv-grip { color: rgba(255,255,255,.55); display: inline-flex; cursor: grab; }
.sv-close {
  width: 24px; height: 24px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,.18);
  background: rgba(8,9,14,.65);
  color: rgba(255,255,255,.85);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; padding: 0;
  transition: background 180ms, border-color 180ms, transform 180ms var(--ease-back);
}
.sv-close:hover {
  background: var(--rose); border-color: var(--rose);
  color: #fff; transform: scale(1.1);
}
.sv-label {
  position: absolute; bottom: 7px; left: 8px;
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 9px; letter-spacing: 1.4px;
  font-family: 'JetBrains Mono', monospace;
  color: rgba(255,255,255,.82);
  background: rgba(8,9,14,.55); padding: 3px 7px; border-radius: 5px;
  backdrop-filter: blur(6px);
}
.sv-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--rose);
  animation: breathe 2s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .sv-dot { animation: none; }
  .sv-close:hover { transform: none; }
}
`;
