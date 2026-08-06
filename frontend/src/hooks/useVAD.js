import { useRef, useCallback, useEffect } from "react";

export function useVAD(stream, onSpeechStart, onSpeechEnd) {
  const vadRef = useRef(null);
  const isListeningRef = useRef(false);

  const startVAD = useCallback(async () => {
    if (!stream || vadRef.current || isListeningRef.current) return;

    try {
      isListeningRef.current = true;
      
      let myVad;
      try {
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

  useEffect(() => {
    return () => {
      stopVAD();
    };
  }, [stopVAD]);

  useEffect(() => {
    if (stream && isListeningRef.current) {
      stopVAD();
      startVAD();
    }
  }, [stream, startVAD, stopVAD]);

  return { startVAD, stopVAD };
}
