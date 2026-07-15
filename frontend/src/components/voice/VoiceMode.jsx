// VoiceMode.jsx
// Full-screen immersive voice/video takeover — a quiet room for practising a
// hard conversation with the coach. The coach's orb is the presence in the
// room; your self-view (when video is on) is secondary.
//
// Audio wiring is unchanged and deliberately single-path:
//   - mic comes from the shared, ref-counted micStream service (no 2nd
//     getUserMedia); this component holds ONE ref for its whole lifetime.
//   - TTS plays through the SINGLETON output player, fed by ConversationPage
//     from `audio_frame`. VoiceMode only OBSERVES it (onStart/onEnd + getLevel)
//     for the orb — it never enqueues, so there is exactly one audio path.
//   - the orb reacts to REAL amplitude: mic level while you record, TTS level
//     while the coach speaks, both from audioEngine's analysers.
//   - video is added LAZILY to the same stream (enableVideoTrack) only when you
//     toggle it on, so voice-only use never prompts for the camera.
//
// This file is a UI redesign only — same WS client and protocol.

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import VoiceOrb from './VoiceOrb';
import { createInputAnalyser, getOutputPlayer, getAudioContext } from '../../services/audioEngine';
import { acquireMicStream, releaseMicStream, enableVideoTrack, disableVideoTrack } from '../../services/micStream';
import { WS_STATES } from '../../services/wsClient';

// ---- state model ----------------------------------------------------------
// A single `phase` drives the whole UI. Each phase has a distinct colour token,
// orb behaviour (in VoiceOrb), a text LABEL and a DESCRIPTION — so conversation
// state is never conveyed by colour alone.
const META = {
  connecting:      { orb: 'connecting',   color: 'var(--whisper)',  label: 'CONNECTING',   desc: 'Setting up your session…' },
  reconnecting:    { orb: 'reconnecting', color: 'var(--whisper)',  label: 'RECONNECTING', desc: 'Connection dropped — trying to restore it…' },
  listening:       { orb: 'listening',    color: 'var(--bone-dim)', label: 'YOUR TURN',    desc: 'Hold the mic or press Space to talk' },
  recording:       { orb: 'recording',    color: 'var(--sage)',     label: 'LISTENING',    desc: 'Release to send' },
  thinking:        { orb: 'thinking',     color: 'var(--bone-dim)', label: 'THINKING',     desc: 'The coach is composing a reply' },
  speaking:        { orb: 'speaking',     color: 'var(--gold)',     label: 'SPEAKING',     desc: 'The coach is speaking' },
  'mic-denied':    { orb: 'error',        color: 'var(--rose)',     label: 'MIC BLOCKED',  desc: 'Microphone access is blocked. Allow it in your browser, then retry.' },
  'mic-nodevice':  { orb: 'error',        color: 'var(--rose)',     label: 'NO MICROPHONE',desc: 'No microphone was found on this device.' },
  'mic-error':     { orb: 'error',        color: 'var(--rose)',     label: 'MIC ERROR',    desc: 'Could not access the microphone.' },
  'no-connection': { orb: 'error',        color: 'var(--rose)',     label: 'DISCONNECTED', desc: 'Connection lost. Reconnect to continue the conversation.' },
};

export default function VoiceMode({
  conversationId,     // reserved (turn pipeline still lives in ConversationPage)
  wsClient,           // the shared WebSocket client (getWebSocketClient())
  onEnd,              // close the full-screen mode
}) {
  const [videoMode, setVideoMode] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [talking, setTalking] = useState(false);   // push-to-talk held

  const [micStatus, setMicStatus] = useState('acquiring'); // acquiring|ready|denied|nodevice|error
  const [connStatus, setConnStatus] = useState('connecting'); // connecting|open|reconnecting|lost
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [turnState, setTurnState] = useState(null); // null|processing|speaking|listening
  const [coachSpeaking, setCoachSpeaking] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const inputAnalyserRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startTimeRef = useRef(null);
  const micOnRef = useRef(true);
  const coachSpeakingRef = useRef(false);
  const heldMicRef = useRef(false);
  const disposedRef = useRef(false);
  const talkingRef = useRef(false);
  const videoModeRef = useRef(false);

  useEffect(() => { micOnRef.current = micOn; }, [micOn]);
  useEffect(() => { talkingRef.current = talking; }, [talking]);
  useEffect(() => { videoModeRef.current = videoMode; }, [videoMode]);

  // ---- derive the single phase ---------------------------------------------
  const phase = useMemo(() => {
    if (micStatus === 'denied') return 'mic-denied';
    if (micStatus === 'nodevice') return 'mic-nodevice';
    if (micStatus === 'error') return 'mic-error';
    if (connStatus === 'lost') return 'no-connection';
    if (connStatus === 'reconnecting') return 'reconnecting';
    if (connStatus === 'connecting' || micStatus === 'acquiring') return 'connecting';
    if (coachSpeaking || turnState === 'speaking') return 'speaking';
    if (turnState === 'processing') return 'thinking';
    if (talking) return 'recording';
    return 'listening';
  }, [micStatus, connStatus, turnState, coachSpeaking, talking]);

  const meta = META[phase] || META.listening;
  const orbState = meta.orb;
  const canTalk = micStatus === 'ready' && connStatus === 'open';
  const canTalkRef = useRef(false);
  useEffect(() => { canTalkRef.current = canTalk; }, [canTalk]);

  // ---- mic acquisition (retryable) -----------------------------------------
  const acquireMic = useCallback(async () => {
    setMicStatus('acquiring');
    try {
      const s = await acquireMicStream();
      if (disposedRef.current) { releaseMicStream(); return; }
      heldMicRef.current = true;
      streamRef.current = s;
      inputAnalyserRef.current?.disconnect();
      inputAnalyserRef.current = createInputAnalyser(s);
      if (videoRef.current && s.getVideoTracks().length) videoRef.current.srcObject = s;
      setMicStatus('ready');
    } catch (e) {
      const name = e?.name;
      const status =
        name === 'NotAllowedError' || name === 'SecurityError' ? 'denied'
        : name === 'NotFoundError' || name === 'DevicesNotFoundError' ? 'nodevice'
        : 'error';
      console.error('[VoiceMode] mic acquire failed', e);
      setMicStatus(status);
    }
  }, []);

  // ---- acquire mic + observe the singleton TTS player ----------------------
  useEffect(() => {
    getAudioContext(); // resume on the click that opened this (user gesture)
    disposedRef.current = false;
    acquireMic();

    const player = getOutputPlayer();
    const offStart = player.onStart(() => { coachSpeakingRef.current = true; setCoachSpeaking(true); });
    const offEnd = player.onEnd(() => { coachSpeakingRef.current = false; setCoachSpeaking(false); });

    return () => {
      disposedRef.current = true;
      offStart();
      offEnd();
      inputAnalyserRef.current?.disconnect();
      inputAnalyserRef.current = null;
      if (heldMicRef.current) { releaseMicStream(); heldMicRef.current = false; }
    };
  }, [acquireMic]);

  // ---- wire WS connection + turn state -------------------------------------
  useEffect(() => {
    if (!wsClient) return;
    setConnStatus(wsClient.getState() === WS_STATES.OPEN ? 'open' : 'connecting');

    const onState = (payload) => {
      // Connection lifecycle arrives as a bare string; backend turn state as { value }.
      if (typeof payload === 'string') {
        if (payload === WS_STATES.OPEN) {
          setConnStatus('open');
          setReconnectAttempt(0);
        } else if (payload === WS_STATES.CLOSED) {
          // wsClient auto-reconnects up to maxReconnectAttempts; reconnectAttempts
          // is still the pre-increment value at emit time.
          const a = wsClient.reconnectAttempts ?? 0;
          const m = wsClient.maxReconnectAttempts ?? 0;
          if (a < m) { setConnStatus('reconnecting'); setReconnectAttempt(a + 1); }
          else { setConnStatus('lost'); }
        }
        return;
      }
      const v = payload?.value;
      if (v === 'processing' || v === 'speaking' || v === 'listening') setTurnState(v);
    };

    wsClient.on('state', onState);
    return () => wsClient.off('state', onState);
  }, [wsClient]);

  // ---- the orb reads DIFFERENT analysers depending on state ----------------
  const getLevel = useCallback(() => {
    if (orbState === 'speaking') return getOutputPlayer().getLevel();
    if (orbState === 'recording' && micOnRef.current) return inputAnalyserRef.current?.getLevel() ?? 0;
    return 0;
  }, [orbState]);

  // ---- recorder (unchanged protocol) ---------------------------------------
  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    const client = wsClient;
    if (!stream || recorderRef.current) return;
    try {
      const audioStream = new MediaStream(stream.getAudioTracks());
      const recorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      startTimeRef.current = Date.now();
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          // Send the Blob directly. WebSocket.send preserves call order, so the
          // webm header chunk stays first. Going via e.data.arrayBuffer().then()
          // could reorder chunks and corrupt the stream (whisper then fails with
          // "Invalid data found when processing input").
          if (client && !coachSpeakingRef.current) client.sendAudioChunk(e.data);
        }
      };
      recorder.start(250);
      recorderRef.current = recorder;
    } catch (e) {
      console.error('[VoiceMode] recorder start error:', e);
    }
  }, [wsClient]);

  // Resolves only AFTER the recorder flushes its final chunk (onstop fires after
  // the last ondataavailable), so end_turn is sent once the complete webm has
  // been transmitted — otherwise the server transcribes a truncated stream.
  const stopRecording = useCallback(() => new Promise((resolve) => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder || recorder.state === 'inactive') { resolve(); return; }
    recorder.onstop = () => resolve();
    try { recorder.stop(); } catch (e) { resolve(); }
  }), []);

  // ---- push-to-talk ---------------------------------------------------------
  const startTalking = useCallback(() => {
    if (!wsClient || !canTalkRef.current || talkingRef.current) return;
    // Barge-in: if the coach is speaking, silence it instantly and stop
    // suppressing our mic chunks so this interrupting speech is captured. The
    // server also cancels the coach turn on receiving start_turn.
    getOutputPlayer().stop();
    coachSpeakingRef.current = false;
    setCoachSpeaking(false);
    talkingRef.current = true;   // set synchronously so a stray stop can't race
    wsClient.sendControlMessage('start_turn');
    startRecording();
    setTalking(true);
  }, [wsClient, startRecording]);

  const stopTalking = useCallback(async () => {
    if (!wsClient || !talkingRef.current) return;
    talkingRef.current = false;  // guard against double stop (mouseup + mouseleave)
    setTalking(false);
    // Wait for the recorder to flush its final chunk BEFORE end_turn, so the
    // server transcribes the complete utterance rather than a truncated webm.
    await stopRecording();
    wsClient.sendControlMessage('end_turn');
  }, [wsClient, stopRecording]);

  // ---- controls -------------------------------------------------------------
  const toggleMic = useCallback(() => {
    setMicOn((on) => {
      const next = !on;
      streamRef.current?.getAudioTracks().forEach((tr) => { tr.enabled = next; });
      return next;
    });
  }, []);

  const toggleVideo = useCallback(async () => {
    if (videoModeRef.current) {
      disableVideoTrack();
      setVideoMode(false);
      return;
    }
    // Mount the self-view first, THEN acquire the camera. enableVideoTrack adds
    // a camera track to the shared mic stream (no second mic getUserMedia).
    setCameraError(false);
    setVideoMode(true);
    const s = await enableVideoTrack();
    const hasVideo = !!s && s.getVideoTracks().length > 0;
    if (!hasVideo) { setCameraError(true); return; }
    // Attach now if the <video> is already mounted; the effect below is the
    // fallback for the mount race (element not ready when this resolves).
    if (videoRef.current) {
      videoRef.current.srcObject = s;
      videoRef.current.play?.().catch(() => {});
    }
  }, []);

  // Attach the shared stream to the self-view whenever video is on and the
  // <video> is mounted. Assigning the live MediaStream is enough — the camera
  // track added by enableVideoTrack shows up on it even if attached slightly
  // before the track lands.
  useEffect(() => {
    if (videoMode && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play?.().catch(() => {});
    }
  }, [videoMode]);

  const endSession = useCallback(() => {
    getOutputPlayer().stop();
    coachSpeakingRef.current = false;
    stopRecording();
    setTalking(false);
    onEnd?.();
  }, [stopRecording, onEnd]);

  const reconnect = useCallback(() => {
    if (!wsClient) return;
    wsClient.reconnectAttempts = 0;
    wsClient.reconnectDelay = 1000;
    const cid = wsClient.connectionId ?? (conversationId != null ? Number(conversationId) : null);
    if (wsClient.currentToken && cid != null) {
      setConnStatus('connecting');
      wsClient.connect(cid, wsClient.currentToken);
    }
  }, [wsClient, conversationId]);

  // ---- keyboard: Space = push-to-talk, Esc = exit, M = mute, V = video ------
  useEffect(() => {
    const onKeyDown = (e) => {
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;
      if (e.key === 'Escape') { e.preventDefault(); endSession(); return; }
      if (e.code === 'Space') {
        e.preventDefault(); // also stops Space from activating a focused button
        if (!e.repeat) startTalking();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'm') { e.preventDefault(); toggleMic(); }
      else if (k === 'v') { e.preventDefault(); toggleVideo(); }
    };
    const onKeyUp = (e) => {
      if (e.code === 'Space') { e.preventDefault(); stopTalking(); }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [startTalking, stopTalking, toggleMic, toggleVideo, endSession]);

  const isError = orbState === 'error';
  const description = phase === 'reconnecting' && reconnectAttempt
    ? `Connection dropped — reconnecting (attempt ${reconnectAttempt} of ${wsClient?.maxReconnectAttempts ?? 5})…`
    : meta.desc;

  // ---------------------------------------------------------------------------
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Voice conversation with your coach"
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'var(--ink)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Inter', system-ui, sans-serif",
        animation: 'fadeIn 320ms ease both',
        overflow: 'hidden',
      }}
    >
      {/* phase-tinted glow (isolated layer so it degrades to plain ink) */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `radial-gradient(55% 45% at 50% 40%, color-mix(in srgb, ${meta.color} 20%, transparent), transparent 72%)`,
        transition: 'background 600ms ease',
      }} />

      {/* status header — the "whose turn is it" line (announced to SRs) */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'absolute', top: 'clamp(28px, 6vh, 56px)', left: 0, right: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          padding: '0 24px', textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span aria-hidden="true" style={{
            width: 8, height: 8, borderRadius: '50%', background: meta.color,
            boxShadow: `0 0 12px ${meta.color}`,
            animation: (orbState === 'thinking' || orbState === 'connecting' || orbState === 'reconnecting')
              ? 'breathe 1.4s ease-in-out infinite' : 'none',
          }} />
          <span style={{
            color: meta.color, fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: 4, textTransform: 'uppercase', transition: 'color .4s',
          }}>{meta.label}</span>
        </div>
        <div style={{
          fontSize: 13, color: 'var(--text-muted)',
          fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: 0.2, maxWidth: 420,
        }}>
          {description}
        </div>
      </div>

      {/* main stage — the orb is always the hero */}
      <div style={{
        width: 'min(58vh, 78vw, 460px)', height: 'min(58vh, 78vw, 460px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <VoiceOrb state={orbState} getLevel={getLevel} size="lg" />
      </div>

      {/* recovery actions for the unglamorous states */}
      {isError && (
        <div style={{ position: 'absolute', top: '62%', display: 'flex', gap: 12 }}>
          {phase === 'no-connection' ? (
            <ActionButton onClick={reconnect} label="Reconnect" primary />
          ) : (
            <ActionButton onClick={acquireMic} label="Retry microphone" primary />
          )}
        </div>
      )}

      {/* self-view: a small, secondary PiP in the corner (video mode only) */}
      {videoMode && (
        <div style={{
          position: 'absolute', right: 'clamp(16px, 3vw, 28px)', bottom: 'clamp(104px, 16vh, 132px)',
          width: 'clamp(120px, 20vw, 190px)', aspectRatio: '4 / 3', borderRadius: 16,
          overflow: 'hidden', background: 'var(--ink-3)', border: '1px solid var(--border)',
          boxShadow: '0 20px 50px -18px rgba(0,0,0,0.7)',
          animation: 'fadeUp 300ms cubic-bezier(.2,.7,.2,1) both',
        }}>
          <video ref={videoRef} autoPlay playsInline muted
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
          {cameraError && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', textAlign: 'center', padding: 12, fontSize: 11,
              color: 'var(--rose)', fontFamily: "'Inter', system-ui, sans-serif",
            }}>Camera unavailable</div>
          )}
          <div style={{
            position: 'absolute', bottom: 8, left: 10, fontSize: 10, color: 'var(--text-muted)',
            fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1,
            background: 'rgba(10,11,16,0.55)', padding: '2px 8px', borderRadius: 6,
          }}>YOU</div>
        </div>
      )}

      {/* controls — floating glass bar */}
      <div style={{
        position: 'absolute', bottom: 'clamp(24px, 5vh, 40px)', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 18px', borderRadius: 999,
        background: 'rgba(19,21,28,0.62)', border: '1px solid var(--border)',
        backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        boxShadow: '0 20px 60px -20px rgba(0,0,0,0.8)',
        maxWidth: '92vw', flexWrap: 'wrap', justifyContent: 'center',
      }}>
        {/* push-to-talk */}
        <CtrlBtn
          active={talking}
          disabled={!canTalk}
          onMouseDown={startTalking}
          onMouseUp={stopTalking}
          onMouseLeave={talking ? stopTalking : undefined}
          onTouchStart={(e) => { e.preventDefault(); startTalking(); }}
          onTouchEnd={(e) => { e.preventDefault(); stopTalking(); }}
          title="Hold to talk (Space)"
          ariaLabel={talking ? 'Recording — release to send' : 'Hold to talk'}
          accent="var(--sage)"
        >
          {talking ? MicActiveIcon : MicIcon}
        </CtrlBtn>

        {/* mute */}
        <CtrlBtn active={micOn} onClick={toggleMic}
          title={micOn ? 'Mute (M)' : 'Unmute (M)'}
          ariaLabel={micOn ? 'Mute microphone' : 'Unmute microphone'}
          alert={!micOn}>
          {micOn ? MicIcon : MicOffIcon}
        </CtrlBtn>

        {/* video */}
        <CtrlBtn active={videoMode} onClick={toggleVideo}
          title="Toggle video (V)"
          ariaLabel={videoMode ? 'Turn camera off' : 'Turn camera on'}>
          {videoMode ? VideoIcon : VideoOffIcon}
        </CtrlBtn>

        {/* exit */}
        <button onClick={endSession} title="Exit (Esc)" aria-label="Exit voice mode"
          style={{
            width: 52, height: 52, borderRadius: '50%', border: '1px solid var(--rose)',
            background: 'color-mix(in srgb, var(--rose) 22%, transparent)', color: 'var(--rose)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          {EndIcon}
        </button>
      </div>
    </div>
  );
}

// ---- small presentational helpers -----------------------------------------
function CtrlBtn({ active = true, disabled, onClick, onMouseDown, onMouseUp, onMouseLeave,
  onTouchStart, onTouchEnd, title, ariaLabel, children, accent = 'var(--gold)', alert }) {
  const borderColor = alert ? 'var(--rose)' : active ? 'var(--border)' : 'var(--border)';
  const color = alert ? 'var(--rose)' : active ? 'var(--text-base)' : 'var(--text-muted)';
  return (
    <button
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      title={title}
      aria-label={ariaLabel || title}
      aria-pressed={onClick ? active : undefined}
      disabled={disabled}
      style={{
        width: 52, height: 52, borderRadius: '50%',
        border: `1px solid ${borderColor}`,
        background: active && accent && !alert ? `color-mix(in srgb, ${accent} 16%, transparent)` : 'var(--ink-3)',
        color, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all .15s',
      }}>
      {children}
    </button>
  );
}

function ActionButton({ onClick, label, primary }) {
  return (
    <button onClick={onClick} style={{
      padding: '11px 20px', borderRadius: 8, cursor: 'pointer',
      fontFamily: "'Inter', system-ui, sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 0.3,
      border: primary ? 'none' : '1px solid var(--border)',
      background: primary ? 'var(--gold)' : 'transparent',
      color: primary ? 'var(--ink)' : 'var(--text-base)',
    }}>
      {label}
    </button>
  );
}

// ---- icons ----------------------------------------------------------------
const MicIcon = (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4"/></svg>);
const MicActiveIcon = (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8" fill="currentColor" opacity="0.18"/><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4"/></svg>);
const MicOffIcon = (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v4"/></svg>);
const VideoIcon = (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>);
const VideoOffIcon = (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/></svg>);
const EndIcon = (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67" transform="rotate(135 12 12)"/></svg>);
