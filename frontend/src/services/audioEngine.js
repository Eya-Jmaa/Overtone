// audioEngine.js
// Single shared AudioContext + two analysers (input/output) that the blob reads,
// plus a GAPLESS scheduler for TTS output chunks (Tier B — replaces the Tier A
// `new Audio()` queue in useTTSPlayer). This is what makes the blob react to REAL
// amplitude and what removes the inter-sentence gap in coach speech.

let _ctx = null;
export function getAudioContext() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Browsers suspend the context until a user gesture — resume on demand.
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

// ---------------------------------------------------------------------------
// INPUT ANALYSER — taps the mic MediaStream so the blob reacts while the user
// speaks. Reuses the SAME stream the recorder/VoiceMode already opened via
// micStream.js; it does NOT open a second getUserMedia.
// ---------------------------------------------------------------------------
export function createInputAnalyser(micStream) {
  const ctx = getAudioContext();
  const source = ctx.createMediaStreamSource(micStream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.8;
  source.connect(analyser);
  // NOTE: do NOT connect analyser to ctx.destination — we don't want to hear the mic.
  const data = new Uint8Array(analyser.frequencyBinCount);
  return {
    analyser,
    // 0..1 RMS level
    getLevel() {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / data.length) * 2.2);
    },
    disconnect() { try { source.disconnect(); } catch (e) {} },
  };
}

// ---------------------------------------------------------------------------
// OUTPUT PLAYER — GAPLESS scheduled playback of TTS audio chunks.
// Each chunk (MP3/WAV bytes from Kokoro over the WS) is decoded and scheduled
// back-to-back on the AudioContext timeline so there is NO gap between
// sentences. Also exposes an analyser the blob reads while the coach speaks.
//
// onStart/onEnd are multi-subscriber (add/remove) so the singleton can be
// driven by ConversationPage (enqueue) AND observed by VoiceMode (orb state)
// at the same time.
// ---------------------------------------------------------------------------
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

  let nextStartTime = 0;   // running timeline cursor for gapless scheduling
  let activeSources = [];  // scheduled BufferSourceNodes (for stop/barge-in)
  let pending = 0;         // chunks currently decoding (not yet scheduled)
  let speaking = false;

  const startListeners = new Set();
  const endListeners = new Set();

  function markStart() {
    if (!speaking) { speaking = true; startListeners.forEach((f) => f()); }
  }
  function maybeEnd() {
    // Ended when nothing is decoding AND the timeline cursor has passed, i.e.
    // the last scheduled chunk has finished playing.
    if (pending === 0 && ctx.currentTime >= nextStartTime - 0.02) {
      if (speaking) { speaking = false; endListeners.forEach((f) => f()); }
    }
  }

  async function enqueue(arrayBuffer) {
    pending++;
    let buf;
    try {
      // decodeAudioData handles MP3/WAV containers from Kokoro.
      buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch (e) {
      pending--;
      console.warn('[audioEngine] decode failed', e);
      maybeEnd();
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(analyser);

    const now = ctx.currentTime;
    // If we've fallen behind (cursor in the past), start slightly ahead to avoid
    // a click; otherwise chain right after the previous chunk => gapless.
    const startAt = Math.max(now + 0.02, nextStartTime);
    src.start(startAt);
    nextStartTime = startAt + buf.duration;

    markStart();
    activeSources.push(src);
    src.onended = () => {
      activeSources = activeSources.filter((s) => s !== src);
      maybeEnd();
    };
    // This chunk is now scheduled (no longer "pending decode").
    pending--;
  }

  function stop() {
    // Barge-in / end session: kill everything immediately.
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
    isSpeaking: () => speaking,
    onStart(fn) { startListeners.add(fn); return () => startListeners.delete(fn); },
    onEnd(fn) { endListeners.add(fn); return () => endListeners.delete(fn); },
  };
}

// ---------------------------------------------------------------------------
// SINGLETON output player — one audio path for the whole app so TTS plays
// through exactly one system (replaces the Tier-A useTTSPlayer). ConversationPage
// enqueues into it; VoiceMode observes it for the speaking orb.
// ---------------------------------------------------------------------------
let _outputPlayer = null;
export function getOutputPlayer() {
  if (!_outputPlayer) _outputPlayer = createOutputPlayer();
  return _outputPlayer;
}
