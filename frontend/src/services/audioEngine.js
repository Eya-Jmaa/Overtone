let _ctx = null;
export function getAudioContext() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

export function createInputAnalyser(micStream) {
  const ctx = getAudioContext();
  const source = ctx.createMediaStreamSource(micStream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.8;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const freq = new Uint8Array(analyser.frequencyBinCount);
  return {
    analyser,
    getLevel() {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / data.length) * 2.2);
    },
    getSpectrum: (out) => readSpectrum(analyser, freq, out),
    disconnect() { try { source.disconnect(); } catch (e) {} },
  };
}

function readSpectrum(analyser, scratch, out) {
  analyser.getByteFrequencyData(scratch);
  const n = out.length;
  const usable = Math.floor(scratch.length * 0.6);
  for (let i = 0; i < n; i++) {
    const lo = Math.floor(Math.pow(i / n, 1.7) * usable);
    const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / n, 1.7) * usable));
    let peak = 0;
    for (let j = lo; j < hi; j++) if (scratch[j] > peak) peak = scratch[j];
    out[i] = peak / 255;
  }
  return out;
}

export function createOutputPlayer() {
  const ctx = getAudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.85;
  const gain = ctx.createGain();
  gain.gain.value = 1;
  analyser.connect(gain);
  gain.connect(ctx.destination);

  const data = new Uint8Array(analyser.frequencyBinCount);
  const freq = new Uint8Array(analyser.frequencyBinCount);

  let nextStartTime = 0;
  let activeSources = [];
  let pending = 0;
  let speaking = false;
  // Scheduling runs one-at-a-time down this chain. decodeAudioData resolves in
  // whatever order the decodes happen to finish, so without it a short chunk
  // can claim nextStartTime ahead of the longer chunk that precedes it and the
  // reply plays out of order. `generation` lets stop() drop in-flight decodes.
  let scheduleChain = Promise.resolve();
  let generation = 0;

  const startListeners = new Set();
  const endListeners = new Set();

  function markStart() {
    if (!speaking) { speaking = true; startListeners.forEach((f) => f()); }
  }
  function maybeEnd() {
    if (pending === 0 && ctx.currentTime >= nextStartTime - 0.02) {
      if (speaking) { speaking = false; endListeners.forEach((f) => f()); }
    }
  }

  async function schedule(arrayBuffer, forGeneration) {
    if (forGeneration !== generation) return;

    let buf;
    try {
      buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch (e) {
      console.warn('[audioEngine] decode failed', e);
      return;
    }
    if (forGeneration !== generation) return;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(analyser);

    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.02, nextStartTime);
    src.start(startAt);
    nextStartTime = startAt + buf.duration;

    markStart();
    activeSources.push(src);
    src.onended = () => {
      activeSources = activeSources.filter((s) => s !== src);
      maybeEnd();
    };
  }

  function enqueue(arrayBuffer) {
    pending++;
    const forGeneration = generation;
    scheduleChain = scheduleChain
      .then(() => schedule(arrayBuffer, forGeneration))
      .catch((e) => console.warn('[audioEngine] schedule failed', e))
      .finally(() => {
        // stop() zeroes pending, so clamp rather than let in-flight
        // decrements drive it negative and wedge maybeEnd().
        pending = Math.max(0, pending - 1);
        maybeEnd();
      });
    return scheduleChain;
  }

  function stop() {
    generation++;
    activeSources.forEach((s) => { try { s.stop(); } catch (e) {} });
    activeSources = [];
    pending = 0;
    nextStartTime = ctx.currentTime;
    if (speaking) { speaking = false; endListeners.forEach((f) => f()); }
  }

  function getLevel() {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / data.length) * 2.4);
  }

  return {
    enqueue,
    stop,
    getLevel,
    getSpectrum: (out) => readSpectrum(analyser, freq, out),
    isSpeaking: () => speaking,
    onStart(fn) { startListeners.add(fn); return () => startListeners.delete(fn); },
    onEnd(fn) { endListeners.add(fn); return () => endListeners.delete(fn); },
  };
}

let _outputPlayer = null;
export function getOutputPlayer() {
  if (!_outputPlayer) _outputPlayer = createOutputPlayer();
  return _outputPlayer;
}
