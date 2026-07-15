import { useState, useRef, useEffect, useCallback } from "react";

/**
 * Webcam hook for real-time video capture.
 * Provides stream management and frame capture capability.
 * MediaPipe processing can be added later.
 */
export function useWebcam() {
  const [active, setActive] = useState(false);
  const [error, setError] = useState(null);
  const streamRef = useRef(null);
  const videoRef = useRef(null);

  // When stream is available and video element is ready, attach the stream
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
        video: { width: 320, height: 240, facingMode: "user" },
      });
      streamRef.current = stream;

      // Don't try to set srcObject here - the useEffect will handle it
      // when the video element mounts

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

  /**
   * Capture a single frame as a blob.
   * Returns null if webcam is not active.
   */
  const captureFrame = useCallback(() => {
    if (!videoRef.current || !active) return null;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 320;
    canvas.height = videoRef.current.videoHeight || 240;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(videoRef.current, 0, 0);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.7);
    });
  }, [active]);

  return { start, stop, active, error, videoRef, captureFrame, stream: streamRef.current };
}