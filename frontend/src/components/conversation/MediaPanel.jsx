import { useEffect, useRef, useState } from "react";
import WaveformBar from "../chat/WaveformBar.jsx";
import SessionArc from "./SessionArc.jsx";

export default function MediaPanel({ inputMode, isRecording, sessionTime }) {
  const videoRef = useRef(null);
  const [hasCamera, setHasCamera] = useState(false);

  useEffect(() => {
    if (inputMode === "video" && videoRef.current) {
      navigator.mediaDevices?.getUserMedia({ video: true, audio: false })
        .then((stream) => { videoRef.current.srcObject = stream; setHasCamera(true); })
        .catch(() => setHasCamera(false));
    }
    return () => { if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach((t) => t.stop()); };
  }, [inputMode]);

  return (
    <aside className="conv-media-panel">
      {inputMode === "video" && (
        <div className="media-section">
          <div className="media-header"><span className="media-label">Camera</span>{isRecording && <span className="recording-dot" />}</div>
          <div className="webcam-container">
            {hasCamera ? (
              <video ref={videoRef} autoPlay playsInline muted className="webcam-feed" />
            ) : (
              <div className="webcam-placeholder"><div className="webcam-silhouette" /><span className="webcam-label">you</span></div>
            )}
          </div>
        </div>
      )}
      <div className="media-section">
        <div className="media-header"><span className="media-label">Voice activity</span></div>
        <div className="voice-activity"><WaveformBar isActive={isRecording} barCount={24} height={36} /></div>
      </div>
      <div className="media-section">
        <div className="media-header"><span className="media-label">Session arc</span></div>
        <div className="session-arc-container"><SessionArc dataPoints={[0.3, 0.4, 0.5, 0.6, 0.75, 0.8, 0.7, 0.65, 0.6, 0.55]} /></div>
      </div>
    </aside>
  );
}
