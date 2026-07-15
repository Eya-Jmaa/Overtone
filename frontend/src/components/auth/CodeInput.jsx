import { useRef, useEffect } from "react";

export default function CodeInput({ value, onChange, autoFocus, error }) {
  const refs = useRef([]);

  useEffect(() => {
    if (autoFocus && refs.current[0]) refs.current[0].focus();
  }, [autoFocus]);

  const handleChange = (idx, char) => {
    const cleaned = char.replace(/\D/g, "").slice(0, 1);
    const arr = value.split("");
    arr[idx] = cleaned;
    const next = arr.join("").slice(0, 6);
    onChange(next);
    if (cleaned && idx < 5) refs.current[idx + 1]?.focus();
  };

  const handleKeyDown = (idx, e) => {
    if (e.key === "Backspace" && !value[idx] && idx > 0) {
      refs.current[idx - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && idx > 0) refs.current[idx - 1]?.focus();
    if (e.key === "ArrowRight" && idx < 5) refs.current[idx + 1]?.focus();
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    onChange(pasted);
    const focusIdx = Math.min(pasted.length, 5);
    refs.current[focusIdx]?.focus();
  };

  return (
    <div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(6, 1fr)",
        gap: 8,
        marginBottom: error ? 8 : 0,
      }}>
        {Array.from({ length: 6 }).map((_, idx) => {
          const char = value[idx] || "";
          const filled = !!char;
          return (
            <input
              key={idx}
              ref={(el) => (refs.current[idx] = el)}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={char}
              onChange={(e) => handleChange(idx, e.target.value)}
              onKeyDown={(e) => handleKeyDown(idx, e)}
              onPaste={handlePaste}
              style={{
                aspectRatio: "1",
                background: filled ? "var(--ink-3)" : "var(--ink-2)",
                border: `1px solid ${error ? "var(--rose)" : filled ? "var(--gold)" : "var(--whisper-2)"}`,
                borderRadius: 6,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 22,
                fontWeight: 500,
                textAlign: "center",
                color: "var(--bone)",
                outline: "none",
                transition: "all 150ms",
                padding: 0,
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "var(--gold)";
                e.target.style.boxShadow = "0 0 0 3px var(--gold-soft)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = error
                  ? "var(--rose)"
                  : char ? "var(--gold)" : "var(--whisper-2)";
                e.target.style.boxShadow = "none";
              }}
            />
          );
        })}
      </div>
      {error && (
        <div style={{
          fontSize: 11,
          color: "var(--rose)",
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: 0.3,
        }}>
          {error}
        </div>
      )}
    </div>
  );
}