// VoiceOrb.jsx
// Sora-style animated blob. Pure presentational: give it `state` and a
// `getLevel()` function (returns 0..1 live amplitude) and it renders.
//
//   state: 'connecting' | 'listening' | 'thinking' | 'speaking'
//   getLevel: () => number   // live RMS from the input OR output analyser
//
// The parent decides which analyser feeds getLevel:
//   - listening  -> mic input analyser
//   - speaking   -> TTS output analyser
//   - thinking   -> returns ~0 (idle breathing only)

import { useRef, useEffect } from 'react';

const PALETTES = {
  connecting: { core: '#3f3f46', glow: '#52525b', ring: '#71717a', label: 'CONNECTING' },
  listening:  { core: '#7c3aed', glow: '#a78bfa', ring: '#c4b5fd', label: 'LISTENING' },
  thinking:   { core: '#6366f1', glow: '#818cf8', ring: '#a5b4fc', label: 'THINKING' },
  speaking:   { core: '#d4a574', glow: '#e8c9a0', ring: '#f0dcc0', label: 'SPEAKING' }, // your gold accent
};

const N = 96;

export default function VoiceOrb({ state = 'listening', getLevel, size = 'lg' }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(state);
  const levelFnRef = useRef(getLevel);
  const rafRef = useRef(0);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { levelFnRef.current = getLevel; }, [getLevel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let W, H, DPR;
    const seed = Array.from({ length: 5 }, () => Math.random() * 1000);

    function resize() {
      DPR = window.devicePixelRatio || 1;
      const r = canvas.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = W * DPR; canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const hexA = (hex, a) => {
      const h = hex.replace('#', '');
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${a})`;
    };
    const noise = (a, tt) =>
      Math.sin(a * 1.3 + seed[0] + tt) * 0.5 +
      Math.sin(a * 2.7 + seed[1]) * 0.25 +
      Math.sin(a * 5.1 + seed[2]) * 0.15 +
      Math.sin(a * 8.3 + seed[3]) * 0.1;

    let t = 0, last = performance.now();
    let smooth = 0;

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      t += dt;

      const st = stateRef.current;
      const pal = PALETTES[st] || PALETTES.listening;

      // live level (0..1) from whichever analyser the parent wired in
      let raw = 0;
      try { raw = st === 'thinking' || st === 'connecting' ? 0 : (levelFnRef.current?.() ?? 0); } catch (e) {}
      smooth += (raw - smooth) * Math.min(1, dt * 14);
      const level = Math.max(0, Math.min(1, smooth));

      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2;
      const breathe = 1 + 0.04 * Math.sin(t * 1.5);
      const push = level * (st === 'thinking' ? 0.05 : 0.45);
      const baseR = Math.min(W, H) * (size === 'sm' ? 0.13 : 0.19);

      // glow layers
      for (let g = 5; g > 0; g--) {
        const gr = baseR * breathe * (1 + push * 0.5) * (1 + g * 0.42);
        const grd = ctx.createRadialGradient(cx, cy, gr * 0.2, cx, cy, gr);
        grd.addColorStop(0, hexA(pal.glow, (0.05 + push * 0.10) / g * 1.4));
        grd.addColorStop(1, hexA(pal.glow, 0));
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(cx, cy, gr, 0, Math.PI * 2); ctx.fill();
      }

      // rotating rings
      ctx.save(); ctx.translate(cx, cy);
      for (let ring = 0; ring < 3; ring++) {
        ctx.save();
        ctx.rotate(t * (0.15 + ring * 0.08) * (ring % 2 ? 1 : -1));
        const rr = baseR * (1.5 + ring * 0.35) * (1 + push * 0.6);
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
          const a = (i / N) * Math.PI * 2;
          const wob = 1 + noise(a * 2 + ring, t * 0.8) * 0.06 + push * 0.12 * Math.sin(a * 6 + t * 4);
          const x = Math.cos(a) * rr * wob, y = Math.sin(a) * rr * wob;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = hexA(pal.ring, 0.06 + push * 0.10);
        ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
      }
      ctx.restore();

      // main blob
      ctx.save(); ctx.translate(cx, cy); ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const organic = noise(a, t * 0.9) * 0.10;
        const audioWob = push * (0.35 * Math.sin(a * 5 + t * 6) + 0.25 * Math.sin(a * 9 - t * 4));
        const r = baseR * breathe * (1 + organic + audioWob);
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      const bg = ctx.createRadialGradient(-baseR * 0.3, -baseR * 0.3, baseR * 0.1, 0, 0, baseR * 1.4);
      bg.addColorStop(0, hexA(pal.glow, 0.95));
      bg.addColorStop(0.6, hexA(pal.core, 0.9));
      bg.addColorStop(1, hexA(pal.core, 0.5));
      ctx.fillStyle = bg;
      ctx.shadowColor = pal.glow; ctx.shadowBlur = 30 + push * 60;
      ctx.fill();
      ctx.restore();

      // inner highlight
      ctx.save(); ctx.translate(cx, cy);
      const coreR = baseR * 0.5 * (1 + push * 0.5);
      const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR);
      cg.addColorStop(0, hexA('#ffffff', 0.5 + push * 0.3));
      cg.addColorStop(0.5, hexA(pal.glow, 0.25));
      cg.addColorStop(1, hexA(pal.core, 0));
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(0, 0, coreR, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);

    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, [size]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

export { PALETTES };
