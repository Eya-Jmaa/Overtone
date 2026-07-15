import { useState, useRef, useEffect } from "react";

const MODES = [
  {
    id: "psy",
    label: "Psychology",
    desc: "Emotional wellbeing, self-awareness",
    color: "#a78bfa",
  },
  {
    id: "professional",
    label: "Professional",
    desc: "Career, negotiation, workplace",
    color: "#d4a574",
  },
  {
    id: "sport",
    label: "Sport",
    desc: "Performance mindset, anxiety",
    color: "#34d399",
  },
];

/**
 * Coaching mode selector pill + popover.
 * - Shows as a compact pill in the input bar
 * - Tap opens a popover with 3 options
 * - Locks (shows lock icon) after first message sent
 */
export default function ModePicker({ value = "professional", onChange, locked = false }) {
  const [open, setOpen] = useState(false);
  const popRef = useRef(null);

  const current = MODES.find((m) => m.id === value) || MODES[1];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={popRef} style={{ position: "relative", flexShrink: 0 }}>
      {/* Pill trigger */}
      <button
        onClick={() => !locked && setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 10px",
          borderRadius: 8,
          background: "var(--gold-soft)",
          border: "0.5px solid rgba(212, 165, 116, 0.2)",
          cursor: locked ? "default" : "pointer",
          transition: "all 150ms",
          fontFamily: "inherit",
          opacity: locked ? 0.7 : 1,
        }}
        onMouseEnter={(e) => {
          if (!locked) e.currentTarget.style.background = "rgba(212, 165, 116, 0.18)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--gold-soft)";
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: current.color,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--gold)",
          }}
        >
          {current.label}
        </span>
        <span style={{ fontSize: 10, color: "var(--bone-faint)", marginLeft: 1 }}>
          {locked ? "🔒" : "▾"}
        </span>
      </button>

      {/* Popover */}
      {open && !locked && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: 0,
            width: 220,
            background: "var(--ink-2)",
            border: "1px solid var(--whisper-2)",
            borderRadius: 12,
            padding: 5,
            zIndex: 50,
            animation: "fadeUp 200ms cubic-bezier(.2,.7,.2,1) both",
            boxShadow: "0 16px 48px -12px rgba(0, 0, 0, 0.5)",
          }}
        >
          <div
            style={{
              padding: "6px 10px 8px",
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              color: "var(--bone-faint)",
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Coaching mode
          </div>
          {MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => {
                onChange?.(mode.id);
                setOpen(false);
              }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 10px",
                borderRadius: 8,
                background: value === mode.id ? "var(--ink-3)" : "transparent",
                border: "none",
                cursor: "pointer",
                transition: "background 100ms",
                fontFamily: "inherit",
                textAlign: "left",
              }}
              onMouseEnter={(e) => {
                if (value !== mode.id) e.currentTarget.style.background = "var(--ink-3)";
              }}
              onMouseLeave={(e) => {
                if (value !== mode.id) e.currentTarget.style.background = "transparent";
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: mode.color,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--bone)" }}>
                  {mode.label}
                </div>
                <div style={{ fontSize: 11, color: "var(--bone-faint)" }}>
                  {mode.desc}
                </div>
              </div>
              {value === mode.id && (
                <span style={{ fontSize: 14, color: "var(--gold)" }}>✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
