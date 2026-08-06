import { useState, useRef, useEffect, useMemo } from "react";

const BARS = 32;

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function barProfile(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = [];
  for (let i = 0; i < BARS; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    const r = ((h >>> 8) & 0xffff) / 0xffff;
    const env = Math.sin((i / (BARS - 1)) * Math.PI) * 0.55 + 0.45;
    out.push(0.22 + r * 0.78 * env);
  }
  return out;
}

export default function AudioBubble({ audioUrl, duration, transcription }) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const audioRef = useRef(null);
  const rafRef = useRef(0);
  const bars = useMemo(() => barProfile(audioUrl || "clip"), [audioUrl]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, []);

  const tick = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
    rafRef.current = requestAnimationFrame(tick);
  };

  const ensureAudio = () => {
    if (audioRef.current) return audioRef.current;
    const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
    const el = new Audio(`${API_URL}${audioUrl}`);
    el.onended = () => {
      setPlaying(false);
      setCurrentTime(0);
      cancelAnimationFrame(rafRef.current);
    };
    el.onerror = () => {
      setPlaying(false);
      setCurrentTime(0);
      cancelAnimationFrame(rafRef.current);
    };
    audioRef.current = el;
    return el;
  };

  const togglePlay = () => {
    const el = ensureAudio();
    if (playing) {
      el.pause();
      cancelAnimationFrame(rafRef.current);
      setPlaying(false);
    } else {
      el.play();
      setPlaying(true);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tick);
    }
  };

  const seekTo = (e) => {
    if (!duration || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const el = ensureAudio();
    el.currentTime = frac * duration;
    setCurrentTime(el.currentTime);
  };

  const progressFrac = duration && duration > 0
    ? Math.min(currentTime / duration, 1)
    : 0;

  const displayTime = currentTime > 0 ? currentTime : 0;

  return (
    <div style={{ minWidth: 220 }}>
      <style>{AUDIO_CSS}</style>

      <div className="ab-shell">
        <button
          onClick={togglePlay}
          className={`ab-play${playing ? " is-playing" : ""}`}
          aria-label={playing ? "Pause audio" : "Play audio"}
        >
          {playing && <span className="ab-play-ring" aria-hidden="true" />}
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="4" width="4.5" height="16" rx="1.4" />
              <rect x="13.5" y="4" width="4.5" height="16" rx="1.4" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M7 4.5l13 7.5-13 7.5z" />
            </svg>
          )}
        </button>

        <div
          className="ab-wave"
          onClick={seekTo}
          role="slider"
          tabIndex={0}
          aria-label="Seek audio"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration || 0)}
          aria-valuenow={Math.round(displayTime)}
          aria-valuetext={formatDuration(displayTime)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const el = ensureAudio();
            const delta = e.key === "ArrowRight" ? 5 : -5;
            el.currentTime = Math.max(0, Math.min(duration || 0, el.currentTime + delta));
            setCurrentTime(el.currentTime);
          }}
        >
          {bars.map((amp, i) => {
            const played = (i + 1) / BARS <= progressFrac;
            return (
              <span
                key={i}
                className={`ab-bar${played ? " is-played" : ""}${playing ? " is-live" : ""}`}
                style={{
                  height: `${Math.round(amp * 100)}%`,
                  animationDelay: `${(i % 8) * 90}ms`,
                }}
              />
            );
          })}
        </div>

        <span className="ab-time">
          {playing || currentTime > 0 ? formatDuration(displayTime) : formatDuration(duration)}
        </span>
      </div>

      {transcription && (
        <div style={{ marginTop: 6 }}>
          <button
            onClick={() => setShowTranscript(!showTranscript)}
            className="ab-toggle"
            aria-expanded={showTranscript}
            aria-label={showTranscript ? "Hide transcription" : "Show transcription"}
          >
            <span className="ab-caret" style={{ transform: showTranscript ? "rotate(90deg)" : "none" }}>›</span>
            {showTranscript ? "Hide" : "Show"} transcription
          </button>
          {showTranscript && (
            <div className="ab-transcript">{transcription}</div>
          )}
        </div>
      )}
    </div>
  );
}

const AUDIO_CSS = `
.ab-shell {
  display: flex; align-items: center; gap: 11px;
  background: color-mix(in srgb, var(--ink) 28%, transparent);
  border: 1px solid var(--border-soft);
  border-radius: 12px; padding: 8px 12px;
}

.ab-play {
  position: relative; flex-shrink: 0;
  width: 32px; height: 32px; border-radius: 50%;
  border: none; padding: 0;
  background: linear-gradient(135deg, color-mix(in srgb, var(--gold) 75%, #fff), var(--gold));
  color: var(--ink);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: transform 160ms var(--ease-back), box-shadow 200ms;
}
.ab-play:hover { transform: scale(1.08); box-shadow: 0 0 14px var(--gold-glow); }
.ab-play:active { transform: scale(.94); }
.ab-play svg { position: relative; z-index: 1; }
.ab-play-ring {
  position: absolute; inset: -3px; border-radius: 50%;
  border: 2px solid var(--gold);
  animation: pulseRing 1.8s var(--ease-out) infinite;
}

.ab-wave {
  flex: 1; height: 30px; min-width: 90px;
  display: flex; align-items: center; gap: 2px;
  cursor: pointer; border-radius: 4px;
}
.ab-wave:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

.ab-bar {
  flex: 1; min-width: 2px; border-radius: 2px;
  background: var(--whisper);
  transform-origin: center;
  transition: background 220ms ease, transform 220ms ease;
}
.ab-bar.is-played { background: var(--gold); }
/* Only the un-played bars idle-animate, so the played run reads as a solid,
   stationary progress mark rather than more moving noise. */
.ab-bar.is-live:not(.is-played) {
  background: color-mix(in srgb, var(--gold) 45%, transparent);
  animation: abPulse 1.1s ease-in-out infinite alternate;
}
@keyframes abPulse { from { transform: scaleY(.72); } to { transform: scaleY(1); } }

.ab-time {
  font-size: 11px; font-family: 'JetBrains Mono', monospace;
  color: var(--text-muted); flex-shrink: 0; min-width: 34px; text-align: right;
  font-variant-numeric: tabular-nums;
}

.ab-toggle {
  background: none; border: none; padding: 0;
  font-size: 11px; font-family: 'JetBrains Mono', monospace;
  color: var(--text-faint); cursor: pointer;
  display: flex; align-items: center; gap: 5px;
  transition: color 200ms;
}
.ab-toggle:hover { color: var(--accent); }
.ab-caret { display: inline-block; transition: transform 220ms var(--ease); }

.ab-transcript {
  margin-top: 7px; padding: 9px 12px;
  background: color-mix(in srgb, var(--ink) 22%, transparent);
  border-left: 2px solid var(--accent);
  border-radius: 0 8px 8px 0;
  font-size: 13px; color: var(--text-muted); line-height: 1.55;
  animation: riseIn 260ms var(--ease-out) both;
}

@media (prefers-reduced-motion: reduce) {
  .ab-play-ring, .ab-bar.is-live:not(.is-played) { animation: none; }
  .ab-play:hover { transform: none; }
}
`;
