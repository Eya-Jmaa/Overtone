// VoiceOrb.jsx
// The coach's presence in the room — a canvas orb that morphs per conversation
// state and reacts to REAL audio amplitude.
//
//   state: 'connecting' | 'reconnecting' | 'listening' | 'recording'
//          | 'thinking'  | 'speaking'    | 'error'
//   getLevel: () => number   // live 0..1 RMS from the input OR output analyser
//
// The parent (VoiceMode) decides which analyser feeds getLevel:
//   - recording -> mic input analyser (your turn)
//   - speaking  -> TTS output analyser (coach's turn)
//   - everything else -> ~0 (no amplitude, calm motion only)
//
// Colours come from the app's design tokens (index.css), resolved from CSS
// variables so the orb stays on-palette AND theme-aware (light/dark). Gold is
// the coach (speaking); sage is you (recording); rose is an error; muted
// whisper/bone for the in-between states.
//
// Honours prefers-reduced-motion: the wobble/rotation drop to a calm, mostly
// static orb with a gentle breathe. State is never conveyed by colour alone —
// motion differs per state and VoiceMode always renders a text label too.

import { useRef, useEffect } from 'react';

const N = 96;

// Which design token drives each state, plus how reactive/energetic it is.
// `react` scales how strongly live amplitude deforms the orb.
const STATE_STYLE = {
  connecting:   { token: 'whisper',  react: 0,    spin: 0.0 },
  reconnecting: { token: 'whisper',  react: 0,    spin: 0.0 },
  listening:    { token: 'boneDim',  react: 0,    spin: 0.4 },
  recording:    { token: 'sage',     react: 0.45, spin: 0.7 },
  thinking:     { token: 'whisper',  react: 0,    spin: 1.1 },
  speaking:     { token: 'gold',     react: 0.45, spin: 0.7 },
  error:        { token: 'rose',     react: 0,    spin: 0.0 },
};

function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const g = (name, fb) => (cs.getPropertyValue(name).trim() || fb);
  return {
    ink:      g('--ink', '#0a0b10'),
    bone:     g('--bone', '#f5f1e8'),
    boneDim:  g('--bone-dim', '#a8a294'),
    whisper:  g('--whisper', '#3d4458'),
    gold:     g('--gold', '#d4a574'),
    sage:     g('--sage', '#8fa896'),
    rose:     g('--rose', '#c97f6a'),
  };
}

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

    // Design tokens, re-read when the theme (root class) flips light/dark.
    let tok = readTokens();
    const themeObserver = new MutationObserver(() => { tok = readTokens(); });
    themeObserver.observe(document.documentElement, {
      attributes: true, attributeFilter: ['class', 'data-theme'],
    });

    // Reduced motion: calm fallback (no wobble/rotation, gentle breathe only).
    const rmq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = rmq.matches;
    const onRM = (e) => { reduced = e.matches; };
    rmq.addEventListener?.('change', onRM);

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
      const style = STATE_STYLE[st] || STATE_STYLE.listening;
      const color = tok[style.token] || tok.boneDim;

      // Live level (0..1) — only reactive states listen to the analyser.
      let raw = 0;
      try { raw = style.react ? (levelFnRef.current?.() ?? 0) : 0; } catch (e) {}
      smooth += (raw - smooth) * Math.min(1, dt * 14);
      const level = Math.max(0, Math.min(1, smooth));

      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2;
      const baseR = Math.min(W, H) * (size === 'sm' ? 0.15 : 0.2);

      // Calm breathing baseline; a touch faster while "thinking".
      const breatheSpeed = st === 'thinking' ? 2.2 : 1.4;
      const breatheAmt = reduced ? 0.025 : 0.045;
      const breathe = 1 + breatheAmt * Math.sin(t * breatheSpeed);
      const push = level * style.react;

      // ---- soft glow halo ----------------------------------------------------
      const glowLayers = reduced ? 2 : 5;
      for (let gi = glowLayers; gi > 0; gi--) {
        const gr = baseR * breathe * (1 + push * 0.5) * (1 + gi * 0.42);
        const grd = ctx.createRadialGradient(cx, cy, gr * 0.2, cx, cy, gr);
        grd.addColorStop(0, hexA(color, (0.05 + push * 0.10) / gi * 1.4));
        grd.addColorStop(1, hexA(color, 0));
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(cx, cy, gr, 0, Math.PI * 2); ctx.fill();
      }

      // ---- rotating rings (skipped in reduced motion) ------------------------
      if (!reduced && style.spin > 0) {
        ctx.save(); ctx.translate(cx, cy);
        for (let ring = 0; ring < 3; ring++) {
          ctx.save();
          ctx.rotate(t * style.spin * (0.15 + ring * 0.08) * (ring % 2 ? 1 : -1));
          const rr = baseR * (1.5 + ring * 0.35) * (1 + push * 0.6);
          ctx.beginPath();
          for (let i = 0; i <= N; i++) {
            const a = (i / N) * Math.PI * 2;
            const wob = 1 + noise(a * 2 + ring, t * 0.8) * 0.06 + push * 0.12 * Math.sin(a * 6 + t * 4);
            const x = Math.cos(a) * rr * wob, y = Math.sin(a) * rr * wob;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.strokeStyle = hexA(color, 0.06 + push * 0.10);
          ctx.lineWidth = 1; ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
      }

      // ---- reconnecting: a single sweeping arc so waiting reads as "working" --
      if (st === 'reconnecting' && !reduced) {
        ctx.save(); ctx.translate(cx, cy);
        ctx.rotate(t * 2.4);
        ctx.beginPath();
        ctx.arc(0, 0, baseR * 1.7, 0, Math.PI * 0.5);
        ctx.strokeStyle = hexA(color, 0.5);
        ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke();
        ctx.restore();
      }

      // ---- main blob ---------------------------------------------------------
      ctx.save(); ctx.translate(cx, cy); ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const organic = reduced ? 0 : noise(a, t * 0.9) * 0.10;
        const audioWob = reduced
          ? 0
          : push * (0.35 * Math.sin(a * 5 + t * 6) + 0.25 * Math.sin(a * 9 - t * 4));
        const r = baseR * breathe * (1 + organic + audioWob + (reduced ? push * 0.12 : 0));
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      const bg = ctx.createRadialGradient(-baseR * 0.3, -baseR * 0.3, baseR * 0.1, 0, 0, baseR * 1.4);
      bg.addColorStop(0, hexA(color, 0.95));
      bg.addColorStop(0.6, hexA(color, 0.85));
      bg.addColorStop(1, hexA(color, 0.45));
      ctx.fillStyle = bg;
      ctx.shadowColor = color; ctx.shadowBlur = (reduced ? 18 : 30) + push * 60;
      ctx.fill();
      ctx.restore();

      // ---- inner highlight ---------------------------------------------------
      ctx.save(); ctx.translate(cx, cy);
      const coreR = baseR * 0.5 * (1 + push * 0.5);
      const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR);
      cg.addColorStop(0, hexA(tok.bone, 0.5 + push * 0.3));
      cg.addColorStop(0.5, hexA(color, 0.25));
      cg.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(0, 0, coreR, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      rafRef.current = requestAnimationFrame(frame);
    }
    // Paint one frame synchronously so the orb is never blank before the first
    // rAF (e.g. in a backgrounded/throttled tab); frame() self-schedules the rest.
    frame(performance.now());

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      themeObserver.disconnect();
      rmq.removeEventListener?.('change', onRM);
    };
  }, [size]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}
