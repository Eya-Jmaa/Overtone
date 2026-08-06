import { useRef, useState, useCallback } from "react";
import { transcribeAudio } from "../services/messageApi.js";
import { acquireMicStream, releaseMicStream } from "../services/micStream.js";

export function useAudioRecorder(token, onTranscript, onChunk, onRecordingComplete) {
  const mediaRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startTimeRef = useRef(null);
  const stopResolveRef = useRef(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [duration, setDuration] = useState(null);

  const start = useCallback(async () => {
    if (recording || transcribing) return;

    try {
      const stream = await acquireMicStream();
      mediaRef.current = stream; 

      const audioStream = new MediaStream(stream.getAudioTracks());
      const recorder = new MediaRecorder(audioStream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      startTimeRef.current = Date.now();
      setAudioBlob(null);
      setDuration(null);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          onChunk?.(e.data);
        }
      };

      recorder.onstop = async () => {
        const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        releaseMicStream();
        setAudioBlob(blob);
        setDuration(elapsed);

        onRecordingComplete?.(blob, elapsed);

        setTranscribing(true);
        let transcript = "";
        try {
          const res = await transcribeAudio(token, blob);
          transcript = res.transcript || "";
          onTranscript?.(transcript);
        } catch (e) {
          console.error("Transcription error:", e);
        } finally {
          setTranscribing(false);
        }

        stopResolveRef.current?.({ blob, transcript, duration: elapsed });
        stopResolveRef.current = null;
      };

      recorder.start(250);
      recorderRef.current = recorder;
      setRecording(true);
    } catch (e) {
      console.error("Microphone access error:", e);
    }
  }, [recording, transcribing, token, onTranscript, onChunk, onRecordingComplete]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setRecording(false);
      return Promise.resolve(null);
    }
    setRecording(false);
    return new Promise((resolve) => {
      stopResolveRef.current = resolve;
      recorder.stop();
    });
  }, []);

  return { start, stop, recording, transcribing, audioBlob, duration, stream: mediaRef.current };
}
