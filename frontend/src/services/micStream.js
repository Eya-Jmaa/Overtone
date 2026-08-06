let _stream = null;
let _refcount = 0;
let _acquiring = null;
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => {
    try { fn(_stream); } catch (e) { /* ignore */ }
  });
}

export async function acquireMicStream() {
  _refcount++;
  if (_stream) return _stream;
  if (!_acquiring) {
    _acquiring = (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        _stream = s;
        notify();
        return s;
      } finally {
        _acquiring = null;
      }
    })();
  }
  try {
    return await _acquiring;
  } catch (e) {
    _refcount = Math.max(0, _refcount - 1);
    throw e;
  }
}

export function releaseMicStream() {
  _refcount = Math.max(0, _refcount - 1);
  if (_refcount === 0 && _stream) {
    _stream.getTracks().forEach((t) => t.stop());
    _stream = null;
    notify();
  }
}

export function getMicStream() {
  return _stream;
}

export function subscribeMicStream(fn) {
  listeners.add(fn);
  fn(_stream);
  return () => listeners.delete(fn);
}

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

export function disableVideoTrack() {
  _stream?.getVideoTracks().forEach((t) => (t.enabled = false));
}
