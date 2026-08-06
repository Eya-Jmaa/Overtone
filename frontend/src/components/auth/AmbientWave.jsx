import { useEffect, useRef } from "react";

export default function AmbientWave() {
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: -9999, y: -9999, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    let t = 0;
    let dpr = window.devicePixelRatio || 1;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const handleMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        active: true,
      };
    };
    const handleLeave = () => { mouseRef.current.active = false; };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseleave", handleLeave);

    const LINES = 7;
    const FREQ_BASE = 0.0015;

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      const grad = ctx.createRadialGradient(w * 0.4, h * 0.5, 0, w * 0.4, h * 0.5, w * 0.7);
      grad.addColorStop(0, "rgba(212, 165, 116, 0.06)");
      grad.addColorStop(1, "rgba(212, 165, 116, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      const breath = (Math.sin(t * 0.0008) + 1) / 2; 
      const amp = 18 + breath * 32;

      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const mActive = mouseRef.current.active;

      for (let l = 0; l < LINES; l++) {
        const yBase = h * (0.25 + (l / (LINES - 1)) * 0.5);
        const phase = l * 0.7;
        const lineAmp = amp * (0.4 + 0.6 * Math.sin(l * 1.3 + t * 0.0005));

        ctx.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const dx = mActive ? x - mx : 0;
          const dy = mActive ? yBase - my : 0;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const proximity = mActive ? Math.max(0, 1 - dist / 220) : 0;

          const y =
            yBase +
            Math.sin(x * FREQ_BASE + t * 0.001 + phase) * lineAmp +
            Math.sin(x * FREQ_BASE * 2.3 + t * 0.0015 + phase) * lineAmp * 0.35 +
            proximity * 14;

          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        const alpha = 0.04 + (l / LINES) * 0.08 + breath * 0.05;
        const goldMix = 0.3 + (l / LINES) * 0.4;
        ctx.strokeStyle = `rgba(212, 165, 116, ${alpha * goldMix + 0.02})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const midY = h * 0.5;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 3) {
        const dx = mActive ? x - mx : 0;
        const dy = mActive ? midY - my : 0;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const proximity = mActive ? Math.max(0, 1 - dist / 200) : 0;

        const y =
          midY +
          Math.sin(x * FREQ_BASE * 0.8 + t * 0.0009) * (amp * 0.9) +
          Math.sin(x * FREQ_BASE * 2.1 + t * 0.0014) * (amp * 0.3) +
          proximity * 20;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(212, 165, 116, ${0.18 + breath * 0.12})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      t += 16;
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseleave", handleLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    />
  );
}
