import { useRef, useCallback, useEffect } from "react";

export function useTTSPlayer() {
  const audioQueueRef = useRef([]);
  const isSpeakingRef = useRef(false);
  const currentAudioRef = useRef(null);

  const enqueue = useCallback((audioChunk) => {
    if (!audioChunk) return;
    
    let audioUrl;
    if (audioChunk instanceof ArrayBuffer) {
      const blob = new Blob([audioChunk], { type: "audio/mp3" });
      audioUrl = URL.createObjectURL(blob);
    } else if (typeof audioChunk === "string") {
      audioUrl = audioChunk;
    } else {
      return;
    }

    audioQueueRef.current.push(audioUrl);
    
    if (!isSpeakingRef.current) {
      playNext();
    }
  }, []);

  const playNext = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isSpeakingRef.current = false;
      window.dispatchEvent(new CustomEvent("tts:end"));
      return;
    }

    isSpeakingRef.current = true;
    const audioUrl = audioQueueRef.current.shift();
    
    if (!audioUrl) {
      playNext();
      return;
    }

    const audio = new Audio(audioUrl);
    currentAudioRef.current = audio;

    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      currentAudioRef.current = null;
      window.dispatchEvent(new CustomEvent("tts:frame_end"));
      playNext();
    };

    audio.onerror = (e) => {
      console.error("[TTS] Playback error:", e);
      URL.revokeObjectURL(audioUrl);
      currentAudioRef.current = null;
      playNext();
    };

    audio.play().catch(e => {
      console.warn("[TTS] Play failed:", e);
    });
  }, []);

  const stop = useCallback(() => {
    audioQueueRef.current.forEach(url => {
      URL.revokeObjectURL(url);
    });
    audioQueueRef.current = [];
    
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    
    isSpeakingRef.current = false;
  }, []);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    enqueue,
    stop,
    get isSpeaking() {
      return isSpeakingRef.current;
    },
  };
}
