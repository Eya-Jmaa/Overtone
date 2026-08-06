import { useRef, useEffect, useState, Fragment } from "react";

// A cleared box is held as a space so the digits after it keep their position
// instead of sliding left. Trailing blanks are trimmed off.
const BLANK = " ";

const isBlank = (char) => !char || char === BLANK;

export default function CodeInput({ value, onChange, autoFocus, error }) {
  const refs = useRef([]);
  const [focusedIdx, setFocusedIdx] = useState(-1);

  useEffect(() => {
    if (autoFocus && refs.current[0]) refs.current[0].focus();
  }, [autoFocus]);

  const handleChange = (idx, char) => {
    const cleaned = char.replace(/\D/g, "").slice(0, 1);
    const arr = value.padEnd(6, BLANK).split("");
    arr[idx] = cleaned || BLANK;
    const next = arr.join("").slice(0, 6).replace(/ +$/, "");
    onChange(next);
    if (cleaned && idx < 5) refs.current[idx + 1]?.focus();
  };

  const handleKeyDown = (idx, e) => {
    if (e.key === "Backspace" && isBlank(value[idx]) && idx > 0) {
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

  const caretIdx = Math.min(value.length, 5);

  return (
    <div>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        marginBottom: error ? 12 : 0,
      }}>
        {Array.from({ length: 6 }).map((_, idx) => {
          const char = isBlank(value[idx]) ? "" : value[idx];
          const filled = !!char;
          const isFocused = idx === focusedIdx;
          const isCaret = focusedIdx === -1 && idx === caretIdx;
          const borderColor =
            error ? "var(--rose)"
            : isFocused ? "var(--gold)"
            : filled ? "var(--gold)"
            : isCaret ? "var(--whisper)"
            : "var(--whisper-2)";
          return (
            <Fragment key={idx}>
              {idx === 3 && (
                <span aria-hidden="true" style={{
                  width: 10, height: 2, borderRadius: 2,
                  background: "var(--whisper-2)", flexShrink: 0, margin: "0 2px",
                }} />
              )}
              <input
                ref={(el) => (refs.current[idx] = el)}
                type="text"
                inputMode="numeric"
                autoComplete={idx === 0 ? "one-time-code" : "off"}
                aria-label={`Digit ${idx + 1} of 6`}
                maxLength={1}
                value={char}
                onChange={(e) => handleChange(idx, e.target.value)}
                onKeyDown={(e) => handleKeyDown(idx, e)}
                onPaste={handlePaste}
                onFocus={(e) => { setFocusedIdx(idx); e.target.select(); }}
                onBlur={() => setFocusedIdx((cur) => (cur === idx ? -1 : cur))}
                style={{
                  width: 52,
                  height: 62,
                  flexShrink: 0,
                  background: filled || isFocused ? "var(--ink-3)" : "var(--ink-2)",
                  border: `1.5px solid ${borderColor}`,
                  boxShadow: isFocused
                    ? `0 0 0 4px ${error ? "color-mix(in srgb, var(--rose) 22%, transparent)" : "var(--gold-soft)"}`
                    : "none",
                  transform: isFocused ? "translateY(-2px)" : "none",
                  borderRadius: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 26,
                  fontWeight: 500,
                  textAlign: "center",
                  color: "var(--bone)",
                  caretColor: "var(--gold)",
                  outline: "none",
                  padding: 0,
                  transition: "border-color 150ms, background 150ms, box-shadow 150ms, transform 150ms cubic-bezier(.2,.7,.2,1)",
                }}
              />
            </Fragment>
          );
        })}
      </div>
      {error && (
        <div role="alert" style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          fontSize: 11.5,
          color: "var(--rose)",
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: 0.3,
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
          </svg>
          {error}
        </div>
      )}
    </div>
  );
}
