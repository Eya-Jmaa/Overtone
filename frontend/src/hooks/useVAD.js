import { useRef, useCallback, useEffect } from "react";

/**
 * Voice Activity Detection hook using @ricky0123/vad-web.
 * 
 * Detects speech start/end boundaries and notifies via callbacks.
 * Separated from useAudioRecorder - VAD detects boundaries, recorder captures/encodes.
 * 
 * @param {MediaStream} stream - Audio stream from getUserMedia
 * @param {Function} onSpeechStart - Called when speech is detected
 * @param {Function} onSpeechEnd - Called when speech ends (silence past threshold)
 */
export function useVAD(stream, onSpeechStart, onSpeechEnd) {
  const vadRef = useRef(null);
  const isListeningRef = useRef(false);

  const startVAD = useCallback(async () => {
    if (!stream || vadRef.current || isListeningRef.current) return;

    try {
      isListeningRef.current = true;
      
      // Initialize VAD - try both APIs for compatibility
      let myVad;
      try {
        // Try new API first (MicVAD class with static new())
        const { MicVAD, getDefaultRealTimeVADOptions } = await import("@ricky0123/vad-web");
        
        const options = {
          ...getDefaultRealTimeVADOptions(),
          stream: stream,
          onSpeechStart: () => {
            onSpeechStart?.();
          },
          onSpeechEnd: () => {
            onSpeechEnd?.();
          },
        };
        
        myVad = await MicVAD.new(options);
        await myVad.start();
      } catch (e) {
        // Fallback to old API (vad function)
        console.warn("VAD: trying fallback vad function", e);
        const { vad } = await import("@ricky0123/vad-web");
        myVad = await vad({
          stream,
          onSpeechStart: () => {
            onSpeechStart?.();
          },
          onSpeechEnd: () => {
            onSpeechEnd?.();
          },
        });
      }
      
      vadRef.current = myVad;
    } catch (e) {
      console.error("VAD initialization error:", e);
      isListeningRef.current = false;
    }
  }, [stream, onSpeechStart, onSpeechEnd]);

  const stopVAD = useCallback(() => {
    if (vadRef.current) {
      try {
        if (typeof vadRef.current.destroy === 'function') {
          vadRef.current.destroy();
        } else if (typeof vadRef.current === 'function') {
          vadRef.current();
        } else if (vadRef.current.pause) {
          vadRef.current.pause();
        }
        vadRef.current = null;
      } catch (e) {
        console.error("VAD stop error:", e);
      }
    }
    isListeningRef.current = false;
  }, []);

  // Cleanup on unmount or when stream changes
  useEffect(() => {
    return () => {
      stopVAD();
    };
  }, [stopVAD]);

  // Restart VAD when stream changes
  useEffect(() => {
    if (stream && isListeningRef.current) {
      stopVAD();
      startVAD();
    }
  }, [stream, startVAD, stopVAD]);

  return { startVAD, stopVAD };
}