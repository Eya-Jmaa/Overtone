// VoiceMode.jsx
// Full-screen immersive voice/video takeover. Toggles between:
//   - voice-only: big centered blob
//   - video-call: user self-view + smaller blob
//
// Wires the blob to REAL audio via audioEngine.js and drives its state from the
// existing WS events. Adapted to this project's actual pipeline:
//   - mic stream comes from the shared, ref-counted micStream service (no 2nd
//     getUserMedia); this component holds a ref for its whole lifetime.
//   - TTS plays through the SINGLETON output player, which ConversationPage
//     feeds from `audio_frame`. VoiceMode only OBSERVES it for the orb — it does
//     not enqueue, so there is exactly one audio path.
//   - backend state arrives as { value: 'processing'|'speaking'|'listening' }.

import { useEffect, useRef, useState, useCallback } from 'react';
import VoiceOrb, { PALETTES } from './VoiceOrb';
import { createInputAnalyser, getOutputPlayer, getAudioContext } from '../../services/audioEngine';
import { acquireMicStream, releaseMicStream, enableVideoTrack, disableVideoTrack } from '../../services/micStream';

export default function VoiceMode({
  conversationId,     // reserved (turn pipeline still lives in ConversationPage)
  wsClient,           // the shared WebSocket client (getWebSocketClient())
  onEnd,              // close the full-screen mode
}) {
  const [orbState, setOrbState] = useState('connecting'); // connecting|listening|thinking|speaking
  const [videoMode, setVideoMode] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [listening, setListening] = useState(false); // push-to-talk state

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const inputAnalyserRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startTimeRef = useRef(null);
  const micOnRef = useRef(true);
  const coachSpeakingRef = useRef(false);
  
  useEffect(() => { micOnRef.current = micOn; }, [micOn]);

  // ---- Acquire the shared mic stream + observe the singleton TTS player -----
  useEffect(() => {
    getAudioContext(); // resume on the click that opened this (user gesture)

    let disposed = false;
    const streamPromise = acquireMicStream();
    streamPromise
      .then((s) => {
        if (disposed) return;
        streamRef.current = s;
        inputAnalyserRef.current = createInputAnalyser(s);
        if (videoRef.current && s.getVideoTracks().length) {
          videoRef.current.srcObject = s;
        }
        setOrbState('listening');
      })
      .catch((e) => {
        console.error('[VoiceMode] mic acquire failed', e);
        setOrbState('listening'); // still show the mode; orb just idles
      });

    // Coach speech drives the orb via the real output analyser.
    const player = getOutputPlayer();
    const offStart = player.onStart(() => {
      coachSpeakingRef.current = true;
      setOrbState('speaking');
    });
    const offEnd = player.onEnd(() => {
      coachSpeakingRef.current = false;
      setOrbState('listening');
    });

    return () => {
      disposed = true;
      offStart();
      offEnd();
      inputAnalyserRef.current?.disconnect();
      inputAnalyserRef.current = null;
      // Release only if the acquire succeeded (matches its refcount bump).
      streamPromise.then(() => releaseMicStream()).catch(() => {});
    };
  }, []);

  // ---- The orb reads DIFFERENT analysers depending on state ----------------
  // listening -> input (mic) ; speaking -> output (TTS) ; else -> idle
  const getLevel = useCallback(() => {
    if (orbState === 'speaking') return getOutputPlayer().getLevel();
    if (orbState === 'listening' && micOnRef.current) return inputAnalyserRef.current?.getLevel() ?? 0;
    return 0;
  }, [orbState]);

  // ---- Wire WS state -> orb state ------------------------------------------
  useEffect(() => {
    if (!wsClient) return;

    const onState = (payload) => {
      // backend: { value: 'processing'|'speaking'|'listening' }.
      // connection lifecycle emits a bare string ('OPEN'/'CLOSED') — ignore it.
      const v = typeof payload === 'string' ? null : payload?.value;
      if (v === 'processing') setOrbState('thinking');
      else if (v === 'speaking') {
        coachSpeakingRef.current = true;
        setOrbState('speaking');
      } else if (v === 'listening') {
        coachSpeakingRef.current = false;
        setOrbState('listening');
      }
    };

    wsClient.on('state', onState);
    return () => wsClient.off('state', onState);
  }, [wsClient]);

  // ---- Controls -------------------------------------------------------------
  const toggleMic = () => {
    setMicOn((on) => {
      const next = !on;
      streamRef.current?.getAudioTracks().forEach((tr) => { tr.enabled = next; });
      return next;
    });
  };

  const toggleVideo = async () => {
    const next = !videoMode;
    if (next) {
      const s = await enableVideoTrack(); // lazily adds camera to the SAME stream
      if (s && videoRef.current) videoRef.current.srcObject = s;
      // >>> WIRE (later): start sending webcam frames for body-language analysis
    } else {
      disableVideoTrack();
    }
    setVideoMode(next);
  };

  // Start recording audio for streaming
  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    const client = wsClient;
    if (!stream || recorderRef.current) return;

    try {
      const audioStream = new MediaStream(stream.getAudioTracks());
      const recorder = new MediaRecorder(audioStream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      startTimeRef.current = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          // Send chunk to WebSocket for live transcription
          if (client && !coachSpeakingRef.current) {
            // Convert blob to arrayBuffer for sending
            e.data.arrayBuffer().then(buffer => {
              client.sendAudioChunk(buffer);
            });
          }
        }
      };

      recorder.start(250); // 250ms timeslice for streaming
      recorderRef.current = recorder;
    } catch (e) {
      console.error('[VoiceMode] recorder start error:', e);
    }
  }, [wsClient]);

  // Stop recording
  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      recorderRef.current = null;
    }
  }, []);

  // Push-to-talk: hold to record, release to send
  const startTalking = () => {
    if (!wsClient) return;
    
    wsClient.sendControlMessage('start_turn');
    startRecording();
    setListening(true);
  };

  const stopTalking = () => {
    if (!wsClient) return;
    
    stopRecording();
    wsClient.sendControlMessage('end_turn');
    setListening(false);
  };

  const endSession = () => {
    getOutputPlayer().stop();
    coachSpeakingRef.current = false;
    stopRecording();
    setListening(false);
    onEnd?.();
  };

  const pal = PALETTES[orbState] || PALETTES.listening;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: `radial-gradient(65% 50% at 50% 34%, ${pal.glow}22, transparent 72%), radial-gradient(90% 80% at 50% 118%, ${pal.core}16, transparent 70%), #07070b`,
      transition: 'background 600ms ease',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', fontFamily: "'Inter', system-ui, sans-serif",
      animation: 'fadeIn 320ms ease both',
    }}>
      {/* status label */}
      <div style={{
        position: 'absolute', top: 44, left: 0, right: 0, textAlign: 'center',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      }}>
        <div style={{
          color: pal.glow, fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: 4, textTransform: 'uppercase', transition: 'color .4s',
        }}>{pal.label}</div>
        <div style={{
          fontSize: 12, color: '#6b6b78', fontFamily: "'Inter', system-ui, sans-serif",
          letterSpacing: 0.3, opacity: orbState === 'speaking' ? 0 : 1, transition: 'opacity .3s',
        }}>
          {listening ? 'Listening — release to send' : 'Hold the mic to talk'}
        </div>
      </div>

      {/* main stage */}
      {videoMode ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 48, flexWrap: 'wrap', justifyContent: 'center' }}>
          <div style={{
            position: 'relative', width: 420, height: 315, borderRadius: 24,
            overflow: 'hidden', background: '#18181b', border: '1px solid #27272a',
            boxShadow: '0 30px 80px rgba(0,0,0,0.55)',
          }}>
            <video ref={videoRef} autoPlay playsInline muted
              style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
            <div style={{
              position: 'absolute', bottom: 12, left: 14, fontSize: 11, color: '#a1a1aa',
              fontFamily: "'DM Mono', monospace", background: 'rgba(0,0,0,0.45)',
              padding: '3px 9px', borderRadius: 6,
            }}>you</div>
          </div>
          <div style={{ width: 220, height: 220 }}>
            <VoiceOrb state={orbState} getLevel={getLevel} size="sm" />
          </div>
        </div>
      ) : (
        <div style={{ width: 'min(52vh, 420px)', height: 'min(52vh, 420px)' }}>
          <VoiceOrb state={orbState} getLevel={getLevel} size="lg" />
        </div>
      )}

      {/* controls — floating glass bar */}
      <div style={{
        position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 18px', borderRadius: 999,
        background: 'rgba(18,18,24,0.55)', border: '1px solid rgba(255,255,255,0.06)',
        backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        boxShadow: '0 20px 60px -20px rgba(0,0,0,0.8)',
      }}>
        <CtrlBtn active={listening} 
          onMouseDown={startTalking} 
          onMouseUp={stopTalking} 
          onMouseLeave={listening ? stopTalking : undefined}
          onTouchStart={startTalking} 
          onTouchEnd={stopTalking}
          title="Hold to talk">
          {listening ? MicActiveIcon : MicIcon}
        </CtrlBtn>
        <CtrlBtn active={micOn} onClick={toggleMic} title={micOn ? 'Mute' : 'Unmute'}>
          {micOn ? MicIcon : MicOffIcon}
        </CtrlBtn>
        <CtrlBtn active={videoMode} onClick={toggleVideo} title="Toggle video">
          {VideoIcon}
        </CtrlBtn>
        <button onClick={endSession} style={{
          width: 56, height: 56, borderRadius: '50%', border: 'none',
          background: '#dc2626', color: '#fff', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}>{EndIcon}</button>
      </div>
    </div>
  );
}

function CtrlBtn({ active, onClick, onMouseDown, onMouseUp, onMouseLeave, onTouchStart, onTouchEnd, title, children }) {
  return (
    <button 
      onClick={onClick} 
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      title={title} 
      style={{
        width: 52, height: 52, borderRadius: '50%',
        border: `1px solid ${active ? '#27272a' : '#7f1d1d'}`,
        background: active ? '#18181b' : '#3f1d1d',
        color: active ? '#e4e4e7' : '#f87171', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all .15s',
      }}>
      {children}
    </button>
  );
}

const MicIcon = (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4"/></svg>);
const MicActiveIcon = (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8" fill="currentColor"/><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4"/></svg>);
const MicOffIcon = (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v4"/></svg>);
const VideoIcon = (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>);
const EndIcon = (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67" transform="rotate(135 12 12)"/></svg>);