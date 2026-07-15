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
      // Reuse the app's single shared mic stream (ref-counted). In normal chat
      // nothing else holds it, so it's released after this turn just like before;
      // in VoiceMode the overlay holds a ref so it stays live across turns.
      const stream = await acquireMicStream();
      mediaRef.current = stream; // Set stream ref immediately

      // Record AUDIO ONLY — the shared stream may also carry a (disabled) video
      // track once the user has toggled video in VoiceMode.
      const audioStream = new MediaStream(stream.getAudioTracks());
      const recorder = new MediaRecorder(audioStream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      startTimeRef.current = Date.now();
      setAudioBlob(null);
      setDuration(null);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          // Send chunk to WebSocket for live transcription
          onChunk?.(e.data);
        }
      };

      recorder.onstop = async () => {
        const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        // Release our ref instead of hard-stopping tracks: the stream only
        // actually stops when nobody else (e.g. VoiceMode) holds it.
        releaseMicStream();
        setAudioBlob(blob);
        setDuration(elapsed);

        // Notify parent that recording is complete with full blob
        onRecordingComplete?.(blob, elapsed);

        // Transcribe the full recording (batch path) for the message text.
        // We resolve the stop() promise only *after* this completes so callers
        // get the final, clean transcript instead of racing a setTimeout.
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

        // Resolve the promise returned by stop() with everything a caller needs
        // to persist the audio message with its transcription.
        stopResolveRef.current?.({ blob, transcript, duration: elapsed });
        stopResolveRef.current = null;
      };

      // Add timeslice for streaming: fires ondataavailable every 250ms
      recorder.start(250);
      recorderRef.current = recorder;
      setRecording(true);
    } catch (e) {
      console.error("Microphone access error:", e);
    }
  }, [recording, transcribing, token, onTranscript, onChunk, onRecordingComplete]);

  // Returns a Promise that resolves to { blob, transcript, duration } once the
  // recording is finalized and transcribed, or null if nothing was recording.
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
