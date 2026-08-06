import { useState, useEffect, useRef } from "react";

export default function Typewriter({ text = "", animate = false, onTick }) {
  const [count, setCount] = useState(animate ? 0 : text.length);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!animate) {
      setCount(text.length);
      return;
    }
    let i = 0;
    let last = performance.now();
    const CHARS_PER_SEC = 55;

    const step = (now) => {
      const dt = (now - last) / 1000;
      const advance = Math.max(1, Math.round(dt * CHARS_PER_SEC));
      i = Math.min(text.length, i + advance);
      last = now;
      setCount(i);
      onTick?.();
      if (i < text.length) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, animate]);

  const done = count >= text.length;
  return (
    <>
      {text.slice(0, count)}
      {animate && !done && (
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 7,
            height: "1em",
            marginLeft: 2,
            transform: "translateY(1px)",
            background: "var(--gold)",
            borderRadius: 1,
            animation: "breathe 1s ease-in-out infinite",
          }}
        />
      )}
    </>
  );
}
