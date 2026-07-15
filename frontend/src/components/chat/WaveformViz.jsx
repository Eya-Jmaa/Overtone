import { useEffect, useRef } from "react";

/**
 * Gold audio waveform visualizer.
 * When `active` + `analyserNode` provided → renders real mic frequency data.
 * When `active` but no analyser → renders ambient breathing sine (same as login page).
 * When inactive → nothing.
 */
export default function WaveformViz({ active = false, analyserNode = null, height = 32 }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const tRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();

    const dataArray = analyserNode
      ? new Uint8Array(analyserNode.frequencyBinCount)
      : null;

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      if (analyserNode && dataArray) {
        analyserNode.getByteFrequencyData(dataArray);
        const barCount = Math.min(dataArray.length, Math.floor(w / 4));
        const barW = 2.5;
        const gap = (w - barCount * barW) / (barCount + 1);

        for (let i = 0; i < barCount; i++) {
          const val = dataArray[i] / 255;
          const barH = Math.max(2, val * h * 0.9);
          const x = gap + i * (barW + gap);
          const y = (h - barH) / 2;

          const alpha = 0.3 + val * 0.6;
          ctx.fillStyle = `rgba(212, 165, 116, ${alpha})`;
          ctx.beginPath();
          ctx.roundRect(x, y, barW, barH, 1.25);
          ctx.fill();
        }
      } else {
        // Ambient breathing sine — same visual language as login AmbientWave
        tRef.current += 16;
        const t = tRef.current;
        const breath = (Math.sin(t * 0.0008) + 1) / 2;
        const amp = 4 + breath * (h * 0.35);
        const midY = h / 2;

        ctx.beginPath();
        for (let x = 0; x <= w; x += 2) {
          const y =
            midY +
            Math.sin(x * 0.012 + t * 0.001) * amp +
            Math.sin(x * 0.025 + t * 0.0015) * amp * 0.3;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(212, 165, 116, ${0.25 + breath * 0.2})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Second fainter line
        ctx.beginPath();
        for (let x = 0; x <= w; x += 2) {
          const y =
            midY +
            Math.sin(x * 0.01 + t * 0.0007 + 1.2) * amp * 0.6 +
            Math.sin(x * 0.02 + t * 0.0012 + 0.5) * amp * 0.2;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(212, 165, 116, ${0.08 + breath * 0.06})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active, analyserNode]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height,
        display: "block",
        borderRadius: 4,
      }}
    />
  );
}
