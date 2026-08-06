import { useRef, useEffect } from 'react';

const N = 128;
const BANDS = 48;

const STATE_STYLE = {
  connecting:   { token: 'whisper',  react: 0,    spin: 0.0, bars: false },
  reconnecting: { token: 'whisper',  react: 0,    spin: 0.0, bars: false },
  listening:    { token: 'boneDim',  react: 0,    spin: 0.4, bars: false },
  recording:    { token: 'sage',     react: 0.45, spin: 0.7, bars: true  },
  thinking:     { token: 'whisper',  react: 0,    spin: 1.1, bars: false },
  speaking:     { token: 'gold',     react: 0.45, spin: 0.7, bars: true  },
  error:        { token: 'rose',     react: 0,    spin: 0.0, bars: false },
};

function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const g = (name, fb) => (cs.getPropertyValue(name).trim() || fb);
  return {
    ink:      g('--ink', '#07080d'),
    bone:     g('--bone', '#f5f1e8'),
    boneDim:  g('--bone-dim', '#a8a294'),
    whisper:  g('--whisper', '#4d566f'),
    gold:     g('--gold', '#e0b183'),
    sage:     g('--sage', '#9dbba6'),
    rose:     g('--rose', '#dd8b74'),
    azure:    g('--azure', '#7fa8d8'),
  };
}

export default function VoiceOrb({ state = 'listening', getLevel, getSpectrum, size = 'lg' }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(state);
  const levelFnRef = useRef(getLevel);
  const specFnRef = useRef(getSpectrum);
  const rafRef = useRef(0);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { levelFnRef.current = getLevel; }, [getLevel]);
  useEffect(() => { specFnRef.current = getSpectrum; }, [getSpectrum]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let W, H, DPR;
    const seed = Array.from({ length: 5 }, () => Math.random() * 1000);

    let tok = readTokens();
    const themeObserver = new MutationObserver(() => { tok = readTokens(); });
    themeObserver.observe(document.documentElement, {
      attributes: true, attributeFilter: ['class', 'data-theme'],
    });

    const rmq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = rmq.matches;
    const onRM = (e) => { reduced = e.matches; };
    rmq.addEventListener?.('change', onRM);

    function resize() {
      DPR = Math.min(1.5, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
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

    const spec = new Float32Array(BANDS);
    const smoothSpec = new Float32Array(BANDS);
    const bandAt = (i) => {
      const half = Math.abs(((i / N) * 2) % 2 - 1);
      return smoothSpec[Math.min(BANDS - 1, Math.floor(half * BANDS))];
    };

    let t = 0, last = performance.now();
    let smooth = 0;

    let paused = document.hidden;
    const onVisibility = () => {
      const nowHidden = document.hidden;
      if (nowHidden === paused) return;
      paused = nowHidden;
      if (!paused) { last = performance.now(); rafRef.current = requestAnimationFrame(frame); }
    };
    document.addEventListener('visibilitychange', onVisibility);

    function frame(now) {
      if (paused) { rafRef.current = 0; return; }
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      t += dt;

      const st = stateRef.current;
      const style = STATE_STYLE[st] || STATE_STYLE.listening;
      const color = tok[style.token] || tok.boneDim;

      let raw = 0;
      try { raw = style.react ? (levelFnRef.current?.() ?? 0) : 0; } catch (e) {}
      smooth += (raw - smooth) * Math.min(1, dt * 14);
      const level = Math.max(0, Math.min(1, smooth));

      let haveSpec = false;
      if (style.react && specFnRef.current) {
        try { specFnRef.current(spec); haveSpec = true; } catch (e) {}
      }
      for (let i = 0; i < BANDS; i++) {
        const target = haveSpec ? spec[i] : 0;
        const k = target > smoothSpec[i] ? 0.55 : Math.min(1, dt * 7);
        smoothSpec[i] += (target - smoothSpec[i]) * k;
      }

      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2;
      const baseR = Math.min(W, H) * (size === 'sm' ? 0.15 : 0.2);

      const breatheSpeed = st === 'thinking' ? 2.2 : 1.4;
      const breatheAmt = reduced ? 0.025 : 0.045;
      const breathe = 1 + breatheAmt * Math.sin(t * breatheSpeed);
      const push = level * style.react;

      const glowLayers = reduced ? 2 : 3;
      for (let gi = glowLayers; gi > 0; gi--) {
        const gr = baseR * breathe * (1 + push * 0.5) * (1 + gi * 0.42);
        const grd = ctx.createRadialGradient(cx, cy, gr * 0.2, cx, cy, gr);
        grd.addColorStop(0, hexA(color, (0.05 + push * 0.10) / gi * 1.4));
        grd.addColorStop(1, hexA(color, 0));
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(cx, cy, gr, 0, Math.PI * 2); ctx.fill();
      }

      if (style.bars && !reduced) {
        ctx.save(); ctx.translate(cx, cy);
        ctx.rotate(-Math.PI / 2 + t * 0.06);
        const inner = baseR * 1.34;
        const barW = Math.max(1.6, baseR * 0.022);
        ctx.lineCap = 'round';
        ctx.lineWidth = barW;
        for (let i = 0; i < BANDS * 2; i++) {
          const b = smoothSpec[i < BANDS ? i : BANDS * 2 - 1 - i];
          const a = (i / (BANDS * 2)) * Math.PI * 2;
          const len = baseR * (0.06 + Math.pow(b, 1.25) * 0.62);
          const ca = Math.cos(a), sa = Math.sin(a);
          ctx.beginPath();
          ctx.moveTo(ca * inner, sa * inner);
          ctx.lineTo(ca * (inner + len), sa * (inner + len));
          ctx.strokeStyle = hexA(color, 0.16 + b * 0.6);
          ctx.stroke();
        }
        ctx.restore();
      }

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

      if (st === 'reconnecting' && !reduced) {
        ctx.save(); ctx.translate(cx, cy);
        ctx.rotate(t * 2.4);
        ctx.beginPath();
        ctx.arc(0, 0, baseR * 1.7, 0, Math.PI * 0.5);
        ctx.strokeStyle = hexA(color, 0.5);
        ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke();
        ctx.restore();
      }

      ctx.save(); ctx.translate(cx, cy); ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const organic = reduced ? 0 : noise(a, t * 0.9) * 0.10;
        const spectral = (!reduced && style.react) ? bandAt(i) * 0.26 * (0.35 + level) : 0;
        const audioWob = reduced
          ? 0
          : push * (0.22 * Math.sin(a * 5 + t * 6) + 0.16 * Math.sin(a * 9 - t * 4));
        const r = baseR * breathe * (1 + organic + spectral + audioWob + (reduced ? push * 0.12 : 0));
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
      ctx.shadowBlur = 0;
      ctx.strokeStyle = hexA(tok.bone, 0.10 + push * 0.22);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

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
    frame(performance.now());

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      themeObserver.disconnect();
      rmq.removeEventListener?.('change', onRM);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [size]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}
