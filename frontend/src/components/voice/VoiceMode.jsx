import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import VoiceOrb from './VoiceOrb';
import { createInputAnalyser, getOutputPlayer, getAudioContext } from '../../services/audioEngine';
import { acquireMicStream, releaseMicStream, enableVideoTrack, disableVideoTrack } from '../../services/micStream';
import { WS_STATES } from '../../services/wsClient';
import { captureFrameDataUrl } from '../../utils/frameCapture';

const VIDEO_FRAME_INTERVAL_MS = 500;

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
  conversationId,
  wsClient,
  autoVideo = false,
  onEnd,
  onEndSession,
}) {
  const [videoMode, setVideoMode] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [talking, setTalking] = useState(false);

  const [micStatus, setMicStatus] = useState('acquiring');
  const [connStatus, setConnStatus] = useState('connecting');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [turnState, setTurnState] = useState(null);
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
  const canInterruptRef = useRef(false);

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

  useEffect(() => {
    getAudioContext();
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

  useEffect(() => {
    if (!wsClient) return;
    setConnStatus(wsClient.getState() === WS_STATES.OPEN ? 'open' : 'connecting');

    const onState = (payload) => {
      if (typeof payload === 'string') {
        if (payload === WS_STATES.OPEN) {
          setConnStatus('open');
          setReconnectAttempt(0);
        } else if (payload === WS_STATES.CLOSED) {
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

  const getLevel = useCallback(() => {
    if (orbState === 'speaking') return getOutputPlayer().getLevel();
    if (orbState === 'recording' && micOnRef.current) return inputAnalyserRef.current?.getLevel() ?? 0;
    return 0;
  }, [orbState]);

  const getSpectrum = useCallback((out) => {
    if (orbState === 'speaking') return getOutputPlayer().getSpectrum?.(out) ?? out.fill(0);
    if (orbState === 'recording' && micOnRef.current) {
      return inputAnalyserRef.current?.getSpectrum?.(out) ?? out.fill(0);
    }
    return out.fill(0);
  }, [orbState]);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    const client = wsClient;
    if (!stream || recorderRef.current) return;
    try {
      const _t = stream.getAudioTracks()[0];
      console.log('[VoiceMode] recording audio track:', _t && {
        label: _t.label, muted: _t.muted, enabled: _t.enabled,
        readyState: _t.readyState, settings: _t.getSettings?.(),
      });
      const audioStream = new MediaStream(stream.getAudioTracks());
      const recorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      startTimeRef.current = Date.now();
      let _sent = 0, _suppressed = 0, _noClient = 0;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          if (client && !coachSpeakingRef.current) {
            client.sendAudioChunk(e.data);
            _sent++;
          } else if (!client) {
            _noClient++;
          } else {
            _suppressed++;
          }
        }
      };
      recorder.addEventListener('stop', () => {
        console.log(
          `[VoiceMode] chunks sent=${_sent} suppressed(coachSpeaking)=${_suppressed} noClient=${_noClient}`
        );
        _sent = 0; _suppressed = 0; _noClient = 0;
      });
      recorder.start(250);
      recorderRef.current = recorder;
    } catch (e) {
      console.error('[VoiceMode] recorder start error:', e);
    }
  }, [wsClient]);

  const stopRecording = useCallback(() => new Promise((resolve) => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder || recorder.state === 'inactive') { resolve(); return; }
    recorder.onstop = () => resolve();
    try { recorder.stop(); } catch (e) { resolve(); }
  }), []);

  const startTalking = useCallback(() => {
    if (!wsClient || !canTalkRef.current || talkingRef.current) return;
    getOutputPlayer().stop();
    coachSpeakingRef.current = false;
    setCoachSpeaking(false);
    talkingRef.current = true;
    wsClient.sendControlMessage('start_turn');
    startRecording();
    setTalking(true);
  }, [wsClient, startRecording]);

  const stopTalking = useCallback(async () => {
    if (!wsClient || !talkingRef.current) return;
    talkingRef.current = false;
    setTalking(false);
    await stopRecording();
    wsClient.sendControlMessage('end_turn');
  }, [wsClient, stopRecording]);

  const canInterrupt =
    connStatus === 'open' && (orbState === 'thinking' || orbState === 'speaking');
  useEffect(() => { canInterruptRef.current = canInterrupt; }, [canInterrupt]);

  const interruptTurn = useCallback(() => {
    getOutputPlayer().stop();
    coachSpeakingRef.current = false;
    setCoachSpeaking(false);
    setTurnState('listening');
    wsClient?.sendControlMessage('cancel_turn');
  }, [wsClient]);

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
    setCameraError(false);
    setVideoMode(true);
    const s = await enableVideoTrack();
    const hasVideo = !!s && s.getVideoTracks().length > 0;
    if (!hasVideo) { setCameraError(true); return; }
    if (videoRef.current) {
      videoRef.current.srcObject = s;
      videoRef.current.play?.().catch(() => {});
    }
  }, []);

  const autoVideoDoneRef = useRef(false);
  useEffect(() => {
    if (!autoVideo || autoVideoDoneRef.current || micStatus !== 'ready') return;
    autoVideoDoneRef.current = true;
    toggleVideo();
  }, [autoVideo, micStatus, toggleVideo]);

  useEffect(() => {
    if (videoMode && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play?.().catch(() => {});
    }
  }, [videoMode]);

  const frameCanvasRef = useRef(null);
  useEffect(() => {
    if (!videoMode || !wsClient) return;
    if (!frameCanvasRef.current) frameCanvasRef.current = document.createElement('canvas');
    const id = setInterval(() => {
      const frame = captureFrameDataUrl(videoRef.current, frameCanvasRef.current);
      if (frame) wsClient.sendVideoFrame(frame);
    }, VIDEO_FRAME_INTERVAL_MS);
    return () => clearInterval(id);
  }, [videoMode, wsClient]);

  const teardown = useCallback(() => {
    getOutputPlayer().stop();
    coachSpeakingRef.current = false;
    stopRecording();
    setTalking(false);
  }, [stopRecording]);

  const exitToChat = useCallback(() => {
    teardown();
    onEnd?.();
  }, [teardown, onEnd]);

  const finishSession = useCallback(() => {
    teardown();
    (onEndSession || onEnd)?.();
  }, [teardown, onEndSession, onEnd]);

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

  useEffect(() => {
    const onKeyDown = (e) => {
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;
      if (e.key === 'Escape') { e.preventDefault(); exitToChat(); return; }
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) startTalking();
        return;
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && canInterruptRef.current) {
        e.preventDefault();
        interruptTurn();
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
  }, [startTalking, stopTalking, toggleMic, toggleVideo, exitToChat, interruptTurn]);

  const isError = orbState === 'error';
  const description = phase === 'reconnecting' && reconnectAttempt
    ? `Connection dropped — reconnecting (attempt ${reconnectAttempt} of ${wsClient?.maxReconnectAttempts ?? 5})…`
    : meta.desc;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Voice conversation with your coach"
      className="aurora"
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background:
          'radial-gradient(120% 90% at 50% 0%, var(--ink-2), var(--ink) 62%)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Inter', system-ui, sans-serif",
        animation: 'fadeIn 320ms ease both',
        overflow: 'hidden',
      }}
    >
      <style>{VOICE_CSS}</style>

      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `radial-gradient(55% 45% at 50% 42%, color-mix(in srgb, ${meta.color} 22%, transparent), transparent 72%)`,
        transition: 'background 600ms ease',
      }} />

      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(120% 100% at 50% 50%, transparent 42%, rgba(0,0,0,.55) 100%)',
      }} />

      <button
        onClick={exitToChat}
        className="glass vm-back"
        title="Back to chat (Esc)"
        aria-label="Back to chat"
        style={{
          position: 'absolute', top: 'clamp(20px, 4vh, 32px)', left: 'clamp(16px, 3vw, 28px)',
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '9px 15px 9px 11px', borderRadius: 999,
          color: 'var(--text-muted)', cursor: 'pointer',
          fontFamily: "'Inter', system-ui, sans-serif", fontSize: 13, fontWeight: 500,
          animation: 'slideInLeft 460ms var(--ease-out) 120ms both',
        }}
      >
        <span className="vm-back-icon">{BackIcon}</span>
        Back to chat
      </button>

      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'absolute', top: 'clamp(28px, 6vh, 56px)', left: 0, right: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          padding: '0 24px', textAlign: 'center',
        }}
      >
        <div
          key={meta.label}
          className="glass vm-chip"
          style={{ borderColor: `color-mix(in srgb, ${meta.color} 45%, var(--border))` }}
        >
          <span aria-hidden="true" className="vm-chip-dot" style={{
            background: meta.color,
            boxShadow: `0 0 12px ${meta.color}`,
            animation: (orbState === 'thinking' || orbState === 'connecting' || orbState === 'reconnecting')
              ? 'breathe 1.4s ease-in-out infinite' : 'none',
          }} />
          <span style={{
            color: meta.color, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: 3.4, textTransform: 'uppercase', transition: 'color .4s',
          }}>{meta.label}</span>
        </div>
        <div key={description} style={{
          fontSize: 13, color: 'var(--text-muted)',
          fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: 0.2, maxWidth: 420,
          animation: 'fadeIn 420ms ease both',
        }}>
          {description}
        </div>
      </div>

      <div className={`vm-stage${videoMode ? ' vm-stage--split' : ''}`}>
        <div className="vm-panel vm-panel--orb">
          <div className="vm-orb-wrap">
            <VoiceOrb state={orbState} getLevel={getLevel} getSpectrum={getSpectrum} size="lg" />
          </div>

          <SoundMeter
            active={orbState === 'recording' || orbState === 'speaking'}
            color={meta.color}
            getSpectrum={getSpectrum}
          />

          {isError && (
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              {phase === 'no-connection' ? (
                <ActionButton onClick={reconnect} label="Reconnect" primary />
              ) : (
                <ActionButton onClick={acquireMic} label="Retry microphone" primary />
              )}
            </div>
          )}
        </div>

        {videoMode && (
          <div
            className={`vm-panel vm-panel--cam vm-cam${talking ? ' vm-cam--live' : ''}`}
            style={{ '--cam-accent': talking ? 'var(--sage)' : 'var(--border)' }}
          >
            <div className="vm-cam-frame">
              <video ref={videoRef} autoPlay playsInline muted className="vm-cam-video" />

              <span className="vm-tick vm-tick--tl" aria-hidden="true" />
              <span className="vm-tick vm-tick--tr" aria-hidden="true" />
              <span className="vm-tick vm-tick--bl" aria-hidden="true" />
              <span className="vm-tick vm-tick--br" aria-hidden="true" />

              {cameraError && (
                <div className="vm-cam-error">
                  <span style={{ fontSize: 18, opacity: .8 }}>⚠</span>
                  Camera unavailable
                </div>
              )}

              <div className="vm-cam-bar">
                <span className="vm-cam-label">
                  <span className={`vm-cam-dot${talking ? ' vm-cam-dot--live' : ''}`} aria-hidden="true" />
                  YOU
                </span>
                {!micOn && <span className="vm-cam-muted">MUTED</span>}
              </div>
            </div>
          </div>
        )}
      </div>

      {canInterrupt && (
        <button
          onClick={interruptTurn}
          className="glass vm-interrupt"
          title="Stop the coach and take your turn again (Esc cancels, ⌫ redoes)"
          aria-label="Stop the coach and redo your turn"
        >
          {StopIcon}
          {orbState === 'thinking' ? 'Stop composing — redo my turn' : 'Stop — redo my turn'}
        </button>
      )}

      <div className="glass vm-dock">
        <CtrlBtn
          primary
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

        <CtrlBtn active={micOn} onClick={toggleMic}
          title={micOn ? 'Mute (M)' : 'Unmute (M)'}
          ariaLabel={micOn ? 'Mute microphone' : 'Unmute microphone'}
          alert={!micOn}>
          {micOn ? MicIcon : MicOffIcon}
        </CtrlBtn>

        <CtrlBtn active={videoMode} onClick={toggleVideo}
          title="Toggle video (V)"
          ariaLabel={videoMode ? 'Turn camera off' : 'Turn camera on'}>
          {videoMode ? VideoIcon : VideoOffIcon}
        </CtrlBtn>

      </div>

      <button
        onClick={finishSession}
        className="vm-end"
        title="End session and get your report"
        aria-label="End session and get your report"
      >
        {EndIcon}
        <span className="vm-end-label">End session</span>
      </button>

      <div className="vm-keys" aria-hidden="true">
        <kbd>Space</kbd> talk <span>·</span> <kbd>M</kbd> mute <span>·</span>
        <kbd>V</kbd> video <span>·</span> <kbd>⌫</kbd> redo <span>·</span>
        <kbd>Esc</kbd> back
      </div>
    </div>
  );
}

function SoundMeter({ active, color, getSpectrum }) {
  const canvasRef = useRef(null);
  const activeRef = useRef(active);
  const colorRef = useRef(color);
  const specFnRef = useRef(getSpectrum);
  const wakeRef = useRef(null);
  const colorReaderRef = useRef(null);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { specFnRef.current = getSpectrum; }, [getSpectrum]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const BARS = 44;
    const spec = new Float32Array(BARS);
    const shown = new Float32Array(BARS);
    let raf = 0, W = 0, H = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let accent = '#e0b183';
    const readAccent = () => { accent = getComputedStyle(canvas).color || accent; };
    readAccent();
    colorReaderRef.current = readAccent;

    let settled = false;
    let paused = document.hidden;

    const draw = () => {
      let ok = false;
      if (activeRef.current && specFnRef.current) {
        try { specFnRef.current(spec); ok = true; } catch (e) {}
      }

      const mid = H / 2;
      const gap = W / BARS;
      const bw = Math.max(2, gap * 0.42);
      let moving = false;

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = accent;
      for (let i = 0; i < BARS; i++) {
        const half = Math.abs((i / (BARS - 1)) * 2 - 1);
        const target = ok ? spec[Math.min(BARS - 1, Math.floor(half * BARS))] : 0;
        const k = target > shown[i] ? 0.5 : 0.12;
        shown[i] += (target - shown[i]) * (reduced ? 1 : k);
        if (shown[i] > 0.002) moving = true; else shown[i] = 0;
        const h = Math.max(2, Math.pow(shown[i], 1.2) * H * 0.92);
        const x = i * gap + (gap - bw) / 2;
        ctx.globalAlpha = 0.22 + shown[i] * 0.78;
        ctx.beginPath();
        ctx.roundRect(x, mid - h / 2, bw, h, bw / 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      settled = !ok && !moving;
      if (settled || paused) { raf = 0; return; }
      raf = requestAnimationFrame(draw);
    };

    const wake = () => { if (!raf && !paused) { raf = requestAnimationFrame(draw); } };
    wakeRef.current = wake;

    const onVisibility = () => {
      paused = document.hidden;
      if (!paused) wake();
    };
    document.addEventListener('visibilitychange', onVisibility);

    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      wakeRef.current = null;
      colorReaderRef.current = null;
    };
  }, []);

  useEffect(() => { if (active) wakeRef.current?.(); }, [active]);
  useEffect(() => { colorReaderRef.current?.(); wakeRef.current?.(); }, [color]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="vm-meter"
      style={{ color, opacity: active ? 1 : 0.35 }}
    />
  );
}

function CtrlBtn({ active = true, disabled, primary, onClick, onMouseDown, onMouseUp, onMouseLeave,
  onTouchStart, onTouchEnd, title, ariaLabel, children, accent = 'var(--gold)', alert }) {
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
      className={`vm-btn${primary ? ' vm-btn--primary' : ''}${active ? ' is-active' : ''}${alert ? ' is-alert' : ''}`}
      style={{
        '--btn-accent': alert ? 'var(--rose)' : accent,
        color,
      }}
    >
      {primary && active && <span className="vm-btn-ring" aria-hidden="true" />}
      <span className="vm-btn-icon">{children}</span>
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

const VOICE_CSS = `
/* Entrance keyframes for elements centred with translateX(-50%).
   The shared riseIn/popIn end on \`transform: none\`, and with fill-mode
   \`both\` that final frame keeps applying after the animation finishes — so
   it silently wiped the centring transform and left the control dock sitting
   with its LEFT edge on the screen's centre line. Any centred element must
   animate with keyframes that carry the -50% through every frame. */
@keyframes riseInCentered {
  from { opacity: 0; transform: translateX(-50%) translateY(14px); }
  to   { opacity: 1; transform: translateX(-50%); }
}
@keyframes popInCentered {
  from { opacity: 0; transform: translateX(-50%) scale(.86); }
  to   { opacity: 1; transform: translateX(-50%) scale(1); }
}

/* status chip */
.vm-chip {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 7px 15px 7px 12px; border-radius: 999px;
  animation: popIn 420ms var(--ease-back) both;
}
.vm-chip-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

/* back button */
.vm-back { transition: color .18s, transform .18s var(--ease), box-shadow .18s; }
.vm-back:hover { color: var(--text-base); transform: translateX(-2px); }
.vm-back-icon { display: inline-flex; transition: transform .18s var(--ease); }
.vm-back:hover .vm-back-icon { transform: translateX(-3px); }

/* linear spectrum strip */
.vm-meter {
  width: min(420px, 62vw); height: 46px; display: block;
  margin-top: -8px;
  transition: opacity 500ms ease;
}

/* ── stage ─────────────────────────────────────────────────────────── */
/* Reserved space top and bottom so the stage can never grow under the
   status header or the dock — the split layout has to shrink to fit, not
   overlap. */
.vm-stage {
  position: absolute;
  top: clamp(104px, 17vh, 150px);
  bottom: clamp(128px, 20vh, 168px);
  left: clamp(16px, 3vw, 36px);
  right: clamp(16px, 3vw, 36px);
  display: flex; align-items: center; justify-content: center;
  gap: clamp(16px, 3vw, 34px);
  min-height: 0;
}
.vm-panel {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  min-width: 0; min-height: 0;
}
.vm-panel--orb { flex: 1 1 0; height: 100%; }
.vm-orb-wrap {
  /* Square, and bounded by BOTH axes: in the split layout the panel is half
     as wide, so a width-only rule would let the orb overflow vertically. */
  width: min(100%, 58vh, 460px);
  aspect-ratio: 1;
  max-height: 100%;
  animation: popIn 700ms var(--ease-out) both;
}

/* 50/50 when the camera is on — equal billing for you and the coach.
   flex-basis 0 (not 50%) so the two halves divide the free space exactly;
   with a percentage basis their differing content widths skew the split. */
.vm-stage--split .vm-panel--orb { flex: 1 1 0; }
.vm-stage--split .vm-panel--cam { flex: 1 1 0; }
.vm-stage--split .vm-orb-wrap { width: min(100%, 44vh, 380px); }

/* ── self-view ─────────────────────────────────────────────────────── */
.vm-cam {
  width: 100%; max-height: 100%;
  padding: 3px; border-radius: 22px;
  background: linear-gradient(150deg,
    color-mix(in srgb, var(--cam-accent) 90%, transparent),
    var(--border) 45%,
    color-mix(in srgb, var(--cam-accent) 40%, transparent));
  box-shadow: var(--shadow-lg);
  animation: riseIn 420ms var(--ease-out) both;
  /* Only box-shadow animates. A transform on this element would rasterise the
     live <video> into a composited layer every frame it changes. */
  transition: box-shadow 300ms ease;
}
.vm-cam--live {
  box-shadow: var(--shadow-lg), 0 0 0 4px color-mix(in srgb, var(--sage) 22%, transparent);
}
.vm-cam-frame {
  position: relative; aspect-ratio: 16 / 9; border-radius: 19px;
  overflow: hidden; background: var(--ink-2);
  max-height: 100%;
}
.vm-cam-video {
  width: 100%; height: 100%; object-fit: cover;
  transform: scaleX(-1);           /* mirror — you expect to see yourself */
  display: block;
}
/* viewfinder ticks */
.vm-tick {
  position: absolute; width: 13px; height: 13px; pointer-events: none;
  border: 1.5px solid rgba(255,255,255,.42); opacity: .7;
}
.vm-tick--tl { top: 8px;  left: 8px;  border-right: 0; border-bottom: 0; border-radius: 4px 0 0 0; }
.vm-tick--tr { top: 8px;  right: 8px; border-left: 0;  border-bottom: 0; border-radius: 0 4px 0 0; }
.vm-tick--bl { bottom: 8px; left: 8px;  border-right: 0; border-top: 0; border-radius: 0 0 0 4px; }
.vm-tick--br { bottom: 8px; right: 8px; border-left: 0;  border-top: 0; border-radius: 0 0 4px 0; }

.vm-cam-bar {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 18px 10px 8px;
  background: linear-gradient(to top, rgba(4,5,9,.82), transparent);
}
.vm-cam-label {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 1.6px;
  color: rgba(255,255,255,.86);
}
.vm-cam-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--text-faint); transition: background .2s;
}
.vm-cam-dot--live { background: var(--sage); animation: breathe 1.1s ease-in-out infinite; }
.vm-cam-muted {
  font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 1.4px;
  color: var(--rose); border: 1px solid currentColor; border-radius: 5px; padding: 1px 5px;
}
.vm-cam-error {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; text-align: center; padding: 12px;
  font-size: 11.5px; color: var(--rose); background: var(--ink-2);
}

/* ── control dock ──────────────────────────────────────────────────── */
/* The media cluster sits on the true horizontal centre of the viewport. It
   contains ONLY the three round buttons, so nothing variable-width can push
   it off — "End session" is anchored separately below. */
.vm-dock {
  position: absolute; bottom: clamp(56px, 9vh, 78px); left: 50%;
  transform: translateX(-50%);
  display: flex; align-items: center; gap: 14px;
  padding: 11px 18px; border-radius: 999px;
  justify-content: center;
  animation: riseInCentered 520ms var(--ease-out) 80ms both;
}

/* ── interrupt ─────────────────────────────────────────────────────── */
.vm-interrupt {
  position: absolute; bottom: clamp(128px, 19.5vh, 160px); left: 50%;
  transform: translateX(-50%);
  display: inline-flex; align-items: center; gap: 9px;
  padding: 9px 17px 9px 14px; border-radius: 999px;
  color: var(--text-base); cursor: pointer; white-space: nowrap;
  font-family: 'Inter', system-ui, sans-serif; font-size: 12.5px; font-weight: 500;
  border-color: color-mix(in srgb, var(--gold) 45%, var(--border));
  animation: popInCentered 260ms var(--ease-back) both;
  transition: background 180ms, border-color 180ms, box-shadow 180ms;
  z-index: 2;
}
.vm-interrupt:hover {
  border-color: var(--gold);
  box-shadow: var(--edge-light), 0 8px 24px -12px var(--gold-glow);
}
.vm-interrupt:active { transform: translateX(-50%) scale(.97); }

.vm-btn {
  position: relative;
  width: 50px; height: 50px; border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: var(--edge-light);
  transition: transform .16s var(--ease-back), background .2s, border-color .2s, box-shadow .2s;
}
.vm-btn.is-active {
  background: color-mix(in srgb, var(--btn-accent) 18%, var(--bg-elevated));
  border-color: color-mix(in srgb, var(--btn-accent) 52%, var(--border));
}
.vm-btn.is-alert { border-color: var(--rose); }
.vm-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--btn-accent) 65%, var(--border));
  box-shadow: var(--edge-light), 0 8px 22px -10px color-mix(in srgb, var(--btn-accent) 70%, transparent);
}
.vm-btn:active:not(:disabled) { transform: translateY(0) scale(.94); }
.vm-btn:disabled { opacity: .42; cursor: not-allowed; }
.vm-btn-icon { display: inline-flex; position: relative; z-index: 1; }

.vm-btn--primary { width: 62px; height: 62px; }
.vm-btn--primary.is-active {
  background: color-mix(in srgb, var(--btn-accent) 30%, var(--bg-elevated));
}
/* expanding ring while push-to-talk is held */
.vm-btn-ring {
  position: absolute; inset: -2px; border-radius: 50%;
  border: 2px solid var(--btn-accent);
  animation: pulseRing 1.5s var(--ease-out) infinite;
  pointer-events: none;
}

.vm-end {
  position: absolute; bottom: clamp(56px, 9vh, 78px);
  right: clamp(16px, 3vw, 36px);
  display: inline-flex; align-items: center; gap: 9px;
  height: 50px; padding: 0 18px 0 15px; border-radius: 999px;
  animation: riseIn 520ms var(--ease-out) 140ms both;
  border: 1px solid color-mix(in srgb, var(--rose) 55%, var(--border));
  background: color-mix(in srgb, var(--rose) 16%, var(--bg-elevated));
  color: var(--rose); cursor: pointer;
  font-family: 'Inter', system-ui, sans-serif; font-size: 13px; font-weight: 600;
  letter-spacing: .2px; white-space: nowrap;
  box-shadow: var(--edge-light);
  transition: transform .16s var(--ease-back), background .2s, box-shadow .2s;
}
.vm-end:hover {
  transform: translateY(-2px);
  background: color-mix(in srgb, var(--rose) 28%, var(--bg-elevated));
  box-shadow: var(--edge-light), 0 10px 26px -12px var(--rose);
}
.vm-end:active { transform: translateY(0) scale(.96); }

.vm-keys {
  position: absolute; bottom: clamp(18px, 3.2vh, 28px); left: 50%;
  transform: translateX(-50%);
  display: flex; align-items: center; gap: 7px;
  font-size: 11px; color: var(--text-faint);
  animation: fadeIn 700ms ease 500ms both;
}
.vm-keys kbd {
  font-family: 'JetBrains Mono', monospace; font-size: 10px;
  border: 1px solid var(--border); border-radius: 5px;
  padding: 2px 6px; color: var(--text-muted); background: var(--bg-surface);
}
.vm-keys span { opacity: .45; }

/* Portrait / narrow: a side-by-side split would make both halves useless, so
   the stage stacks instead — camera on top (it's the thing you check), orb
   below. Still a split, just along the other axis. */
@media (max-width: 860px), (max-aspect-ratio: 4/5) {
  .vm-stage--split { flex-direction: column-reverse; gap: 12px; }
  .vm-stage--split .vm-panel--orb,
  .vm-stage--split .vm-panel--cam { flex: 1 1 50%; width: 100%; }
  .vm-stage--split .vm-orb-wrap { width: min(100%, 34vh, 300px); }
  .vm-stage--split .vm-cam { width: min(100%, 74vh); }
}

@media (max-width: 720px) {
  .vm-end-label { display: none; }
  .vm-end { padding: 0; width: 50px; justify-content: center; }
  .vm-keys { display: none; }
  /* The meter is the first thing to go when height is scarce — the orb
     already carries the same signal. */
  .vm-stage--split .vm-meter { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .vm-btn-ring, .vm-cam-dot--live { animation: none; }
  .vm-btn:hover:not(:disabled), .vm-end:hover, .vm-back:hover { transform: none; }
}
`;

const BackIcon = (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>);
const MicIcon = (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4"/></svg>);
const MicActiveIcon = (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8" fill="currentColor" opacity="0.18"/><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4"/></svg>);
const MicOffIcon = (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v4"/></svg>);
const VideoIcon = (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>);
const VideoOffIcon = (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/></svg>);
const StopIcon = (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor" stroke="none" opacity="0.9"/></svg>);
const EndIcon = (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9.25"/><rect x="8.75" y="8.75" width="6.5" height="6.5" rx="1.6" fill="currentColor" stroke="none"/></svg>);
