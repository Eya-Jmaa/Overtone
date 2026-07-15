import { useEffect, useRef } from "react";
import WaveformViz from "./WaveformViz.jsx";

/**
 * Right media panel for video mode.
 * - Webcam preview with live recording dot
 * - Voice activity waveform
 * - Session emotion arc (mini sparkline)
 * Slides in from the right when video mode is activated.
 */
export default function WebcamPanel({
  active = false,
  videoRef = null,
  analyserNode = null,
}) {
  const arcCanvasRef = useRef(null);
  const tRef = useRef(0);
  const arcRaf = useRef(null);

  // Simulated emotion arc (will be replaced with real data)
  useEffect(() => {
    if (!active) return;
    const canvas = arcCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    ctx.scale(dpr, dpr);

    const drawArc = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      tRef.current += 16;
      const t = tRef.current;

      // Draw sparkline
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const progress = x / w;
        const y =
          h * 0.5 +
          Math.sin(progress * 6 + t * 0.0003) * h * 0.25 +
          Math.sin(progress * 2.5 + t * 0.0008) * h * 0.15;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(212, 165, 116, 0.5)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      arcRaf.current = requestAnimationFrame(drawArc);
    };
    drawArc();

    return () => {
      if (arcRaf.current) cancelAnimationFrame(arcRaf.current);
    };
  }, [active]);

  return (
    <div
      style={{
        width: active ? 220 : 0,
        overflow: "hidden",
        borderLeft: active ? "1px solid var(--whisper-2)" : "none",
        background: "var(--ink)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        transition: "width 350ms cubic-bezier(.2,.7,.2,1)",
      }}
    >
      <div style={{ width: 220, flexShrink: 0 }}>
        {/* Webcam feed */}
        <div
          style={{
            margin: 10,
            borderRadius: 12,
            aspectRatio: "4 / 3",
            background: "var(--ink-2)",
            border: "1px solid var(--whisper-2)",
            overflow: "hidden",
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {videoRef ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: "scaleX(-1)",
              }}
            />
          ) : (
            <span style={{ color: "var(--whisper)", fontSize: 28 }}>👤</span>
          )}

          {/* Recording dot */}
          <div
            style={{
              position: "absolute",
              top: 7,
              right: 7,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#ef4444",
              animation: "breathe 2s ease-in-out infinite",
            }}
          />

          {/* Label */}
          <div
            style={{
              position: "absolute",
              bottom: 6,
              left: 7,
              fontSize: 9,
              fontFamily: "'JetBrains Mono', monospace",
              color: "var(--bone-faint)",
              background: "rgba(10, 11, 16, 0.6)",
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            you
          </div>
        </div>

        {/* Voice activity */}
        <div style={{ padding: "0 10px 6px" }}>
          <div
            style={{
              background: "var(--ink-2)",
              borderRadius: 8,
              padding: "8px 10px",
              border: "1px solid var(--whisper-2)",
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontFamily: "'JetBrains Mono', monospace",
                color: "var(--bone-faint)",
                letterSpacing: 0.8,
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              voice activity
            </div>
            <WaveformViz active={active} analyserNode={analyserNode} height={24} />
          </div>
        </div>

        {/* Session arc */}
        <div style={{ padding: "0 10px", flex: 1 }}>
          <div
            style={{
              background: "var(--ink-2)",
              borderRadius: 8,
              padding: "8px 10px",
              border: "1px solid var(--whisper-2)",
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontFamily: "'JetBrains Mono', monospace",
                color: "var(--bone-faint)",
                letterSpacing: 0.8,
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              session arc
            </div>
            <canvas
              ref={arcCanvasRef}
              style={{ width: "100%", height: 36, display: "block" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
