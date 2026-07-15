import { useState, useRef, useEffect } from "react";

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Playable audio voice message bubble.
 * - Shows waveform (simulated bars) + play/pause button + duration
 * - Click to expand/collapse transcription underneath
 */
export default function AudioBubble({ audioUrl, duration, transcription }) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const audioRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, []);

  const togglePlay = () => {
    if (!audioRef.current) {
      const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
      audioRef.current = new Audio(`${API_URL}${audioUrl}`);
      audioRef.current.onended = () => {
        setPlaying(false);
        setCurrentTime(0);
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
      audioRef.current.onerror = () => {
        setPlaying(false);
        setCurrentTime(0);
      };
    }

    if (playing) {
      audioRef.current.pause();
      if (intervalRef.current) clearInterval(intervalRef.current);
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
      intervalRef.current = setInterval(() => {
        if (audioRef.current) {
          setCurrentTime(audioRef.current.currentTime);
        }
      }, 250);
    }
  };

  const progress = duration && duration > 0
    ? Math.min((currentTime / duration) * 100, 100)
    : 0;

  const displayTime = playing ? currentTime : 0;

  return (
    <div style={{ minWidth: 200 }}>
      {/* Audio player bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "rgba(0,0,0,0.08)",
          borderRadius: 10,
          padding: "8px 12px",
        }}
      >
        {/* Play/pause button */}
        <button
          onClick={togglePlay}
          aria-label={playing ? "Pause audio" : "Play audio"}
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "none",
            background: "var(--gold)",
            color: "var(--ink)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            fontSize: 14,
            flexShrink: 0,
            transition: "transform 150ms, box-shadow 200ms",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "scale(1.05)";
            e.currentTarget.style.boxShadow = "0 0 12px var(--gold-glow)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          {playing ? "⏸" : "▶"}
        </button>

        {/* Waveform visualization */}
        <div
          style={{
            flex: 1,
            height: 28,
            display: "flex",
            alignItems: "center",
            gap: 2,
          }}
        >
          {Array.from({ length: 20 }).map((_, i) => {
            const barHeight = 6 + Math.sin(i * 0.8) * 8 + Math.random() * 4;
            const isPlayed = duration && (i / 20) * duration <= currentTime;
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: playing ? barHeight : 8 + Math.sin(i * 0.8) * 6,
                  borderRadius: 3,
                  background: isPlayed
                    ? "var(--gold)"
                    : playing
                      ? "rgba(212,165,116,0.5)"
                      : "var(--whisper)",
                  transition: "height 200ms, background 200ms",
                  minWidth: 3,
                }}
              />
            );
          })}
        </div>

        {/* Duration */}
        <span
          style={{
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            color: "var(--bone-dim)",
            flexShrink: 0,
            minWidth: 32,
            textAlign: "right",
          }}
        >
          {playing ? formatDuration(displayTime) : formatDuration(duration)}
        </span>
      </div>

      {/* Expandable transcription */}
      {transcription && (
        <div style={{ marginTop: 6 }}>
          <button
            onClick={() => setShowTranscript(!showTranscript)}
            aria-label={showTranscript ? "Hide transcription" : "Show transcription"}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              color: "var(--bone-faint)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              transition: "color 200ms",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--gold)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--bone-faint)"; }}
          >
            {showTranscript ? "▲" : "▼"} {showTranscript ? "Hide" : "Show"} transcription
          </button>
          {showTranscript && (
            <div
              style={{
                marginTop: 6,
                padding: "8px 12px",
                background: "rgba(0,0,0,0.06)",
                borderRadius: 8,
                fontSize: 13,
                color: "var(--bone-dim)",
                lineHeight: 1.5,
                animation: "fadeUp 200ms ease both",
              }}
            >
              {transcription}
            </div>
          )}
        </div>
      )}
    </div>
  );
}