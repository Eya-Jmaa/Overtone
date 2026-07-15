import { useState, useRef, useCallback, useEffect } from "react";

/**
 * Draggable picture-in-picture webcam self-view.
 * Shows in bottom-right corner when webcam is active.
 * Draggable via mouse/touch.
 */
export default function SelfVideo({ videoRef, onClose }) {
  const [position, setPosition] = useState({ x: window.innerWidth - 220, y: window.innerHeight - 200 });
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  const handleMouseDown = useCallback((e) => {
    setDragging(true);
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!dragging) return;
    setPosition({
      x: Math.max(0, Math.min(window.innerWidth - 180, e.clientX - dragOffset.x)),
      y: Math.max(0, Math.min(window.innerHeight - 200, e.clientY - dragOffset.y)),
    });
  }, [dragging, dragOffset]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  useEffect(() => {
    if (dragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [dragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        width: 160,
        height: 120,
        borderRadius: 12,
        overflow: "hidden",
        border: "2px solid var(--gold)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        zIndex: 50,
        cursor: dragging ? "grabbing" : "grab",
        animation: "fadeUp 300ms ease both",
      }}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          background: "var(--ink-3)",
        }}
      />

      {/* Drag handle overlay */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          position: "absolute",
          inset: 0,
          cursor: dragging ? "grabbing" : "grab",
        }}
      />

      {/* Close button */}
      <button
        onClick={onClose}
        aria-label="Close webcam"
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          width: 22,
          height: 22,
          borderRadius: "50%",
          border: "none",
          background: "rgba(0,0,0,0.6)",
          color: "white",
          fontSize: 11,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
          transition: "background 200ms",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(200,50,50,0.8)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.6)"; }}
      >
        ✕
      </button>

      {/* Label */}
      <div
        style={{
          position: "absolute",
          bottom: 4,
          left: 4,
          fontSize: 9,
          fontFamily: "'JetBrains Mono', monospace",
          color: "rgba(255,255,255,0.7)",
          background: "rgba(0,0,0,0.4)",
          padding: "1px 6px",
          borderRadius: 4,
          letterSpacing: 0.5,
        }}
      >
        YOU
      </div>
    </div>
  );
}