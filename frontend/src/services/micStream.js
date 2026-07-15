// micStream.js
// Single shared microphone MediaStream for the whole app, reference-counted so
// there is exactly ONE getUserMedia for the mic. Both useAudioRecorder and the
// full-screen VoiceMode acquire the SAME stream instead of opening their own.
//
// Refcount behaviour:
//   - Normal chat: the recorder acquires on record-start and releases on stop.
//     Nothing else holds a ref, so the mic is released between turns exactly
//     like before (OS mic indicator turns off).
//   - VoiceMode: holds a ref for its whole lifetime, so the mic stays live
//     across turns (the orb needs a continuous analyser) and the recorder's
//     per-turn release just decrements the count without killing the stream.
//
// Video is added LAZILY to the same stream (enableVideoTrack) only when the
// user toggles video on, so voice-only use never triggers a camera prompt.

let _stream = null;
let _refcount = 0;
let _acquiring = null;
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => {
    try { fn(_stream); } catch (e) { /* ignore */ }
  });
}

/**
 * Acquire (or reuse) the shared mic stream. Increments the refcount.
 * Always audio; video is added on demand via enableVideoTrack().
 * Returns the MediaStream (audio track guaranteed if the mic was granted).
 */
export async function acquireMicStream() {
  _refcount++;
  if (_stream) return _stream;
  if (!_acquiring) {
    _acquiring = (async () => {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      _stream = s;
      _acquiring = null;
      notify();
      return s;
    })();
  }
  try {
    return await _acquiring;
  } catch (e) {
    // Acquisition failed - undo our refcount bump so a later retry can work.
    _refcount = Math.max(0, _refcount - 1);
    throw e;
  }
}

/** Decrement the refcount; stop and drop the stream when nobody holds it. */
export function releaseMicStream() {
  _refcount = Math.max(0, _refcount - 1);
  if (_refcount === 0 && _stream) {
    _stream.getTracks().forEach((t) => t.stop());
    _stream = null;
    notify();
  }
}

/** Current shared stream, or null if none is open. */
export function getMicStream() {
  return _stream;
}

/**
 * Subscribe to stream availability changes. Fires immediately with the current
 * value. Returns an unsubscribe function.
 */
export function subscribeMicStream(fn) {
  listeners.add(fn);
  fn(_stream);
  return () => listeners.delete(fn);
}

/**
 * Lazily add a camera track to the SAME stream (once) and enable it. Prompts
 * for camera permission the first time. No-ops gracefully if there's no camera.
 * Returns the stream (now carrying a video track) or null.
 */
export async function enableVideoTrack() {
  if (!_stream) return null;
  if (_stream.getVideoTracks().length === 0) {
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: true });
      const vt = cam.getVideoTracks()[0];
      if (vt) {
        _stream.addTrack(vt);
        notify();
      }
    } catch (e) {
      console.warn("[micStream] camera unavailable:", e);
      return _stream;
    }
  }
  _stream.getVideoTracks().forEach((t) => (t.enabled = true));
  return _stream;
}

/** Disable (but keep) the video track so it can be re-enabled cheaply. */
export function disableVideoTrack() {
  _stream?.getVideoTracks().forEach((t) => (t.enabled = false));
}
