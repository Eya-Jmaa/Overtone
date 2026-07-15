import { useRef, useCallback, useEffect } from "react";

/**
 * Tier-A TTS playback hook.
 * 
 * Provides a simple queue-based audio playback interface that can be
 * swapped later for a Tier-B Web Audio API implementation with visualization.
 * 
 * - enqueue(chunk): Add an audio chunk (ArrayBuffer) to the playback queue
 * - stop(): Stop playback and clear the queue
 * - isSpeaking: Current speaking state
 */
export function useTTSPlayer() {
  const audioQueueRef = useRef([]);
  const isSpeakingRef = useRef(false);
  const currentAudioRef = useRef(null);

  const enqueue = useCallback((audioChunk) => {
    if (!audioChunk) return;
    
    // Convert ArrayBuffer to audio URL if needed
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
    
    // Start playback if not already speaking
    if (!isSpeakingRef.current) {
      playNext();
    }
  }, []);

  const playNext = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isSpeakingRef.current = false;
      // Dispatch custom event to signal end of speech
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
      // Clean up URL
      URL.revokeObjectURL(audioUrl);
      currentAudioRef.current = null;
      // Dispatch event to signal audio frame ended
      window.dispatchEvent(new CustomEvent("tts:frame_end"));
      // Play next in queue
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
    // Clear queue
    audioQueueRef.current.forEach(url => {
      URL.revokeObjectURL(url);
    });
    audioQueueRef.current = [];
    
    // Stop current playback
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    
    isSpeakingRef.current = false;
  }, []);

  // Cleanup on unmount
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