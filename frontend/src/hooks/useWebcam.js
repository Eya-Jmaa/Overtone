import { useState, useRef, useEffect, useCallback } from "react";
import { captureFrameDataUrl } from "../utils/frameCapture.js";

const DEFAULT_FPS = 2;

export function useWebcam({ onFrame, fps = DEFAULT_FPS } = {}) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState(null);
  const streamRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null); 

  useEffect(() => {
    if (active && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch((e) => {
        console.warn("Video play failed:", e);
      });
    }
  }, [active]);

  const start = useCallback(async () => {
    if (active) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
      });
      streamRef.current = stream;


      setActive(true);
      setError(null);
    } catch (e) {
      setError(e.message || "Camera access denied");
      console.error("Webcam error:", e);
    }
  }, [active]);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setActive(false);
  }, []);

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !active) return null;
    if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
    return captureFrameDataUrl(videoRef.current, canvasRef.current);
  }, [active]);

  useEffect(() => {
    if (!active || !onFrame) return;
    const intervalMs = Math.max(200, Math.round(1000 / fps));
    const id = setInterval(() => {
      const frame = captureFrame();
      if (frame) onFrame(frame);
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, onFrame, fps, captureFrame]);

  return { start, stop, active, error, videoRef, captureFrame, stream: streamRef.current };
}
