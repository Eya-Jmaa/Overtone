"""WebSocket endpoint for live audio streaming and real-time transcription with TTS."""
import asyncio
import base64
import json
import re
import time
import tempfile
import os
from typing import Optional
import cv2
import numpy as np
from fastapi import WebSocket, WebSocketDisconnect, Query
from sqlalchemy.orm import Session
from config import settings
from database import get_db
from services.db_models import Conversation, Message
from services.security import decode_token
from services.session_store import get_session_store, SessionState
from services.turn_service import process_user_turn_stream
from services.tts_service import chunks_from_deltas
from services.audio_pcm import decode_to_pcm16k, SAMPLE_RATE
from services.stt_router import get_stt_router, detect_language
from services.tts_router import synthesize_for_language
from services.language_service import LanguageResolver, LanguageState
from services import face_analyzer, fusion
from services.emotion_model import analyze_emotion_chunked
from services.text_emotion import analyze_text_emotion


from routers.transcribe import _get_model


MIN_AUDIO_BYTES = 2000

# How often we look for a chunk of speech that can be transcribed early.
INCREMENTAL_WINDOW_MS = 1200

# Live audio is only ever cut in a silence this long, never mid-utterance.
# Cutting inside speech makes Whisper re-decode overlapping audio, which both
# duplicates words at the seam and roughly doubles the CPU cost of the turn.
MIN_SILENCE_SECONDS = 0.35

# Audio nearer than this to the live edge is left alone — the user is probably
# mid-word, and a pause that recent may not be a real one.
TAIL_GUARD_SECONDS = 0.7

# Never transcribe less than this at once; short fragments decode poorly.
MIN_COMMIT_SECONDS = 1.2

# If someone talks this long without a usable pause, cut anyway rather than let
# the whole turn land on end_turn.
MAX_PENDING_SECONDS = 25.0

# Live chunks decode at ~0.4x real time even at the full beam, so there is no
# reason to trade accuracy for speed here — a narrower beam measured worse with
# no meaningful CPU saving.
INCREMENTAL_BEAM_SIZE = 5
FINAL_BEAM_SIZE = 5

# Language detection needs a real stretch of speech — asking it about a two-word
# fragment returns confident nonsense.
LANGUAGE_DETECT_MIN_SECONDS = 3.0
LANGUAGE_DETECT_MIN_CONFIDENCE = 0.6


def _active_language(session_state: SessionState) -> str:
    """Current active_language for a session, seeding state on first use."""
    if session_state.language_state is None:
        session_state.language_state = LanguageState()
    return session_state.language_state.active


def _resolve_language(
    session_state: SessionState,
    detected: Optional[str],
    confidence: float,
    transcript: str,
):
    """Fold this turn's detection into the session's active_language."""
    if session_state.language_state is None:
        session_state.language_state = LanguageState()
    resolver = LanguageResolver(
        session_state.language_state,
        session_id=f"{session_state.user_id}:{session_state.conversation_id}",
    )
    decision = resolver.resolve(detected, confidence, transcript=transcript)
    return decision


router = None


def get_websocket_router():
    """Create and return the WebSocket router."""
    from fastapi import APIRouter

    ws_router = APIRouter(prefix="/ws", tags=["websocket"])

    @ws_router.websocket("/conversation/{conversation_id}")
    async def websocket_endpoint(
        websocket: WebSocket,
        conversation_id: int,
        token: str = Query(..., description="JWT access token"),
    ):
        user_id = decode_token(token, expected_type="access")
        if not user_id:
            await websocket.close(code=1008, reason="Invalid or expired token")
            return

        db_gen = get_db()
        db: Session = next(db_gen)

        conv = (
            db.query(Conversation)
            .filter(Conversation.id == conversation_id, Conversation.user_id == user_id)
            .first()
        )
        if not conv:
            await websocket.close(code=1008, reason="Conversation not found")
            db.close()
            return

        await websocket.accept()

        session_store = get_session_store()
        connection_id = f"{user_id}:{conversation_id}:{time.monotonic()}"

        session_state = SessionState(
            conversation_id=conversation_id,
            user_id=user_id,
            session_start_ts=time.monotonic(),
        )
        session_store.set(connection_id, session_state)

        await send_state(websocket, "listening")

        try:
            while True:
                data = await websocket.receive()

                if data["type"] == "websocket.disconnect":
                    break

                if data["type"] == "websocket.receive":
                    if "bytes" in data:
                        await handle_audio_chunk(
                            websocket,
                            connection_id,
                            session_state,
                            data["bytes"],
                        )
                    elif "text" in data:
                        await handle_control_message(
                            websocket,
                            connection_id,
                            session_state,
                            data["text"],
                            conv.mode,
                            db,
                        )

        except WebSocketDisconnect:
            pass

        finally:
            task = session_state.turn_task
            if task is not None and not task.done():
                task.cancel()
                try:
                    await task
                except BaseException:
                    pass
            session_store.delete(connection_id)
            db.close()

    return ws_router


async def send_state(websocket: WebSocket, state: str) -> None:
    await websocket.send_json({"type": "state", "value": state})


async def send_error(websocket: WebSocket, message: str) -> None:
    await websocket.send_json({"type": "error", "message": message})


async def send_stop_audio(websocket: WebSocket) -> None:
    """Tell the client to immediately stop/flush coach audio (barge-in)."""
    await websocket.send_json({"type": "stop_audio"})


def get_timestamp_ms(session_state: SessionState) -> int:
    return int((time.monotonic() - session_state.session_start_ts) * 1000)


async def handle_audio_chunk(
    websocket: WebSocket,
    connection_id: str,
    session_state: SessionState,
    chunk: bytes,
) -> None:
    """Handle incoming audio chunk."""
    session_state.audio_buffer += chunk

    elapsed_ms = (time.monotonic() - session_state.session_start_ts) * 1000
    buffer_size = len(session_state.audio_buffer)

    if buffer_size >= MIN_AUDIO_BYTES and not session_state.transcribing:
        if elapsed_ms - session_state.last_transcription_ms >= INCREMENTAL_WINDOW_MS:
            session_state.last_transcription_ms = elapsed_ms
            # Claim the slot here, not inside the task: the task body doesn't run
            # until the next loop iteration, and the chunk after this one would
            # otherwise see transcribing=False and start a second pass.
            session_state.transcribing = True
            asyncio.create_task(
                run_incremental_transcription(websocket, session_state)
            )


def reset_turn_audio(session_state: SessionState) -> None:
    """Drop this turn's buffered audio and everything derived from it."""
    session_state.audio_buffer = bytes()
    session_state.partial_transcript = ""
    session_state.committed_transcript = ""
    session_state.committed_samples = 0
    session_state.last_transcription_ms = 0
    # Detection is per turn — the resolver needs a fresh reading each time or
    # the session could never switch language after the first turn.
    session_state.detected_language = None
    session_state.detect_confidence = 0.0


def _pending_pcm(audio: bytes, committed_samples: int) -> np.ndarray:
    """The not-yet-transcribed tail of `audio`, as PCM. Blocking — use to_thread."""
    wav = decode_to_pcm16k(audio)
    if wav.size <= committed_samples:
        return np.zeros(0, dtype=np.float32)
    return wav[committed_samples:]


def _find_silence_cut(pending: np.ndarray) -> int:
    """How many samples of `pending` end in a silence and can be transcribed now.

    Returns 0 when the user is still mid-utterance and nothing should be cut yet.
    """
    from faster_whisper.vad import get_speech_timestamps, VadOptions

    gap = int(MIN_SILENCE_SECONDS * SAMPLE_RATE)
    limit = pending.size - int(TAIL_GUARD_SECONDS * SAMPLE_RATE)
    if limit <= int(MIN_COMMIT_SECONDS * SAMPLE_RATE):
        return 0

    try:
        speech = get_speech_timestamps(
            pending,
            VadOptions(min_silence_duration_ms=int(MIN_SILENCE_SECONDS * 1000),
                       speech_pad_ms=100),
        )
    except Exception as e:
        print(f"[voice] VAD failed, deferring to end_turn: {e}")
        return 0

    if not speech:
        # Nothing but silence buffered — drop all but the guard so it doesn't
        # pile up, without emitting a transcription for it.
        return limit if pending.size >= MAX_PENDING_SECONDS * SAMPLE_RATE else 0

    # Cut in the middle of the last usable silence, so neither side clips a word.
    cut = 0
    boundaries = [(a["end"], b["start"]) for a, b in zip(speech, speech[1:])]
    boundaries.append((speech[-1]["end"], pending.size))
    for speech_end, next_start in boundaries:
        if next_start - speech_end >= gap and speech_end <= limit:
            cut = max(cut, speech_end + gap // 2)

    if cut == 0 and pending.size >= MAX_PENDING_SECONDS * SAMPLE_RATE:
        cut = limit  # unbroken speech for too long; take the hit on one seam

    if cut < MIN_COMMIT_SECONDS * SAMPLE_RATE:
        return 0
    return min(cut, pending.size)


async def run_incremental_transcription(
    websocket: WebSocket,
    session_state: SessionState,
) -> None:
    """Transcribe whatever the user has already finished saying, mid-turn.

    Each pass takes the audio since `committed_samples`, cuts it at the last
    real pause, and transcribes only that. Every region of the turn is therefore
    decoded exactly once, and by the time the user stops talking only the audio
    since their last pause is left — which is the wait this removes from the
    start of every reply.
    """
    session_state.transcribing = True
    try:
        start = session_state.committed_samples
        pending = await asyncio.to_thread(
            _pending_pcm, session_state.audio_buffer, start
        )
        if pending.size == 0:
            return

        cut = await asyncio.to_thread(_find_silence_cut, pending)
        if cut <= 0:
            return

        # Whisper's own per-call detection is unreliable on a short fragment, so
        # ask once on a decent stretch of audio and reuse the answer. end_turn
        # re-detects over the whole turn for the language resolver.
        if (
            session_state.detected_language is None
            and cut >= LANGUAGE_DETECT_MIN_SECONDS * SAMPLE_RATE
        ):
            lang, conf = await asyncio.to_thread(detect_language, pending[:cut])
            if lang and conf >= LANGUAGE_DETECT_MIN_CONFIDENCE:
                session_state.detected_language = lang
                session_state.detect_confidence = conf

        result = await asyncio.to_thread(
            get_stt_router().transcribe_turn,
            pending[:cut],
            session_state.detected_language or _active_language(session_state),
            detect=False,
            beam_size=INCREMENTAL_BEAM_SIZE,
        )

        session_state.committed_samples = start + cut
        text = result.transcript.strip()
        if text:
            session_state.committed_transcript = (
                f"{session_state.committed_transcript} {text}".strip()
            )
            session_state.partial_transcript = session_state.committed_transcript
            await websocket.send_json({
                "type": "partial_transcript",
                "text": session_state.committed_transcript,
                "ts": get_timestamp_ms(session_state),
            })
    except Exception as e:
        print(f"Incremental transcription error: {e}")
    finally:
        session_state.transcribing = False


async def finalize_transcript(
    session_state: SessionState,
) -> tuple[str, Optional[str], float]:
    """The turn's full transcript: text committed live, plus the remaining tail.

    Returns (transcript, detected_language, confidence).
    """
    # Let an in-flight live pass settle so its commit isn't raced or wasted.
    for _ in range(40):
        if not session_state.transcribing:
            break
        await asyncio.sleep(0.05)

    start = session_state.committed_samples
    committed = session_state.committed_transcript.strip()

    wav = await asyncio.to_thread(decode_to_pcm16k, session_state.audio_buffer)

    # Detection encodes a 30s window, so it is worth as much as the tail decode
    # itself. The live pass already ran it on a clean stretch of this same turn;
    # only pay for it again when it never got the chance (very short turns).
    detected_lang = session_state.detected_language
    detect_conf = session_state.detect_confidence
    if not detected_lang:
        detected_lang, detect_conf = await asyncio.to_thread(detect_language, wav)

    tail = wav[start:] if wav.size > start else np.zeros(0, dtype=np.float32)
    tail_text = ""
    if tail.size:
        result = await asyncio.to_thread(
            get_stt_router().transcribe_turn,
            tail,
            detected_lang if detect_conf >= LANGUAGE_DETECT_MIN_CONFIDENCE
            else _active_language(session_state),
            detect=False,
            beam_size=FINAL_BEAM_SIZE,
        )
        tail_text = result.transcript.strip()

    transcript = f"{committed} {tail_text}".strip()
    print(
        f"[voice] transcript: {len(committed)} chars committed live "
        f"({start / SAMPLE_RATE:.1f}s), {len(tail_text)} chars from a "
        f"{tail.size / SAMPLE_RATE:.1f}s tail"
    )
    return transcript, detected_lang, detect_conf


async def handle_video_frame(session_state: SessionState, data_b64: Optional[str]) -> None:
    """Decode + analyze one throttled webcam frame; latest-frame-wins."""
    if not settings.video_analysis_enabled or not data_b64:
        return

    now_ms = time.monotonic() * 1000
    if session_state.video_processing:
        return
    if now_ms - session_state.last_video_frame_ms < settings.face_min_frame_interval_ms:
        return

    session_state.last_video_frame_ms = now_ms
    session_state.video_processing = True
    try:
        frame_rgb = await asyncio.to_thread(_decode_frame_rgb, data_b64)
        if frame_rgb is None:
            return
        if session_state.face_analyzer is None:
            session_state.face_analyzer = face_analyzer.FaceAnalyzer()
        signal = await asyncio.to_thread(session_state.face_analyzer.analyze_frame, frame_rgb)
        session_state.latest_video_signal = signal
        _log_video_signal(signal)
    except Exception as e:
        print(f"[video] frame analysis failed: {e}")
    finally:
        session_state.video_processing = False


_last_expression: Optional[str] = None
_last_expression_log_ms: float = 0.0
_EXPRESSION_HEARTBEAT_MS = 5000


def _log_video_signal(signal: Optional[dict]) -> None:
    """Print the face signal when it CHANGES (plus a periodic heartbeat)."""
    global _last_expression, _last_expression_log_ms
    now_ms = time.monotonic() * 1000

    expr = ((signal or {}).get("expression") or {})
    label = expr.get("label")
    if not signal or not label:
        if now_ms - _last_expression_log_ms < _EXPRESSION_HEARTBEAT_MS:
            return
        _last_expression = None
        _last_expression_log_ms = now_ms
        print("[face] no face detected in frame")
        return

    changed = label != _last_expression
    if not changed and now_ms - _last_expression_log_ms < _EXPRESSION_HEARTBEAT_MS:
        return

    _last_expression = label
    _last_expression_log_ms = now_ms

    parts = [f"expression={label or 'none'} ({expr.get('confidence') or 0:.2f})"]
    eye = signal.get("eye_contact") or {}
    if eye.get("ratio") is not None:
        parts.append(f"eye_contact={int(eye['ratio'] * 100)}%")
    if (signal.get("self_touch") or {}).get("detected"):
        parts.append("self_touch=yes")
    print(f"[face] {' '.join(parts)}{'' if changed else '  (heartbeat)'}")


def _decode_frame_rgb(data_b64: str) -> Optional[np.ndarray]:
    """Base64 JPEG (optionally a 'data:image/jpeg;base64,...' URL) -> RGB uint8 ndarray, or None if it doesn't decode."""
    try:
        if data_b64.startswith("data:"):
            data_b64 = data_b64.split(",", 1)[1]
        raw = base64.b64decode(data_b64)
        arr = np.frombuffer(raw, dtype=np.uint8)
        bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if bgr is None:
            return None
        return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    except Exception as e:
        print(f"[video] frame decode failed: {e}")
        return None


_FILLER_RE = re.compile(
    r"\b(um+|uh+|erm+|hmm+|mm+|like|you know|i mean|sort of|kind of|basically|actually)\b",
    re.IGNORECASE,
)

_VERBATIM_PROMPT = (
    "Transcribe verbatim including filler words like um, uh, like, you know."
)


def count_fillers_verbatim(audio_bytes: bytes) -> Optional[int]:
    """Count disfluencies in `audio_bytes` via a verbatim second decode."""
    if len(audio_bytes) < MIN_AUDIO_BYTES:
        return None

    model = _get_model()
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        segments, _ = model.transcribe(
            tmp_path,
            beam_size=5,
            condition_on_previous_text=False,
            vad_filter=False,
            initial_prompt=_VERBATIM_PROMPT,
        )
        text = " ".join(seg.text.strip() for seg in segments)
        return len(_FILLER_RE.findall(text))
    except Exception as e:
        print(f"[metrics] filler pass failed: {e}")
        return None
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def _analyze_turn_emotion(audio: bytes) -> Optional[dict]:
    """Vocal emotion for one whole turn (blocking — call via asyncio.to_thread)."""
    result = analyze_emotion_chunked(audio)
    if result is None:
        print(
            "[emotion] voice -> no result (provider off, checkpoint missing, "
            "audio decode failed, or inference failed — the preceding [emotion] "
            "line says which)"
        )
        return None
    top = sorted(result["all_probabilities"].items(), key=lambda kv: -kv[1])[:3]
    detail = " ".join(f"{label}={prob:.2f}" for label, prob in top)
    print(
        f"[emotion] voice -> {result['emotion']} ({result['confidence']:.2f}) "
        f"over {result['chunks']} window(s) | {detail}"
    )
    return result


async def _await_metric(task: Optional[asyncio.Task]):
    """Await one best-effort metric task; None if absent, cancelled or failed."""
    if task is None:
        return None
    try:
        return await task
    except (asyncio.CancelledError, Exception):
        return None


async def apply_turn_metrics(
    db: Session,
    conversation_id: int,
    filler_task: Optional[asyncio.Task] = None,
    emotion_task: Optional[asyncio.Task] = None,
    session_state: Optional[SessionState] = None,
    text_emotion_task: Optional[asyncio.Task] = None,
) -> None:
    """Attach this turn's measured metrics to the user message just written."""
    count = await _await_metric(filler_task)
    emotion = await _await_metric(emotion_task)
    text_emotion = await _await_metric(text_emotion_task)
    if count is None and emotion is None and text_emotion is None:
        return

    try:
        msg = (
            db.query(Message)
            .filter(Message.conversation_id == conversation_id, Message.role == "user")
            .order_by(Message.id.desc())
            .first()
        )
        if msg is None:
            return
        if count is not None:
            msg.filler_count = count
        if emotion is not None:
            msg.emotion = emotion.get("emotion")
        if text_emotion is not None:
            msg.text_emotion = text_emotion.get("emotion")
            msg.text_emotion_confidence = text_emotion.get("confidence")
            msg.text_emotion_evidence = text_emotion.get("evidence")
        db.add(msg)
        db.commit()
        if session_state is not None:
            word_count = len((msg.content or "").split())
            session_state.last_voice_signal = fusion.voice_signal(
                count, word_count, emotion=emotion
            )
            session_state.last_text_signal = fusion.text_signal(text_emotion)
    except Exception as e:
        db.rollback()
        print(f"[metrics] could not persist turn metrics: {e}")


async def cancel_active_turn(
    websocket: WebSocket,
    session_state: SessionState,
    *,
    notify_client: bool,
) -> None:
    """Cancel an in-flight coach turn (barge-in) and wait for it to unwind."""
    task = session_state.turn_task
    if task is not None and not task.done():
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
        if notify_client:
            try:
                await send_stop_audio(websocket)
            except Exception:
                pass
    session_state.turn_task = None


async def run_turn(
    websocket: WebSocket,
    session_state: SessionState,
    db: Session,
    user_text: str,
    filler_task: Optional[asyncio.Task] = None,
    language: str = "en",
    live_signals: str = "",
    emotion_task: Optional[asyncio.Task] = None,
    text_emotion_task: Optional[asyncio.Task] = None,
) -> None:
    """Stream one coach reply (text + spoken audio) for `user_text`."""
    first_audio_sent = False
    audio_q: asyncio.Queue = asyncio.Queue()
    tts_sem = asyncio.Semaphore(3)

    async def _synth(text: str):
        async with tts_sem:
            try:
                return await synthesize_for_language(text, language)
            except Exception as tts_error:
                print(f"TTS error for sentence: {tts_error}")
                return None

    async def _produce_sentences():
        try:
            async for chunk in chunks_from_deltas(
                process_user_turn_stream(
                    db,
                    session_state.conversation_id,
                    user_text,
                    language=language,
                    live_signals=live_signals,
                )
            ):
                await websocket.send_json({"type": "assistant_delta", "text": chunk})
                await audio_q.put(asyncio.create_task(_synth(chunk)))
        finally:
            await audio_q.put(None)

    async def _send_audio():
        nonlocal first_audio_sent
        while True:
            task = await audio_q.get()
            if task is None:
                break
            audio_bytes = await task
            if audio_bytes:
                if not first_audio_sent:
                    session_state.vad_state = "speaking"
                    await send_state(websocket, "speaking")
                    first_audio_sent = True
                await websocket.send_bytes(audio_bytes)

    try:
        await asyncio.gather(_produce_sentences(), _send_audio())

        await websocket.send_json({"type": "assistant_done"})
        session_state.vad_state = "listening"
        await send_state(websocket, "listening")

        await apply_turn_metrics(
            db, session_state.conversation_id, filler_task, emotion_task, session_state,
            text_emotion_task,
        )

    except asyncio.CancelledError:
        for t in (filler_task, emotion_task, text_emotion_task):
            if t is not None:
                t.cancel()
        db.rollback()
        raise

    except Exception as e:
        for t in (filler_task, emotion_task, text_emotion_task):
            if t is not None:
                t.cancel()
        db.rollback()
        print(f"Turn processing error: {e}")
        await send_error(websocket, f"Assistant error: {str(e)}")
        session_state.vad_state = "listening"
        await send_state(websocket, "listening")

    finally:
        session_state.turn_task = None


async def handle_control_message(
    websocket: WebSocket,
    connection_id: str,
    session_state: SessionState,
    message_text: str,
    mode: str,
    db: Session,
) -> None:
    """Handle JSON control messages from client."""
    try:
        message = json.loads(message_text)
        msg_type = message.get("type")

        if msg_type == "start_turn":
            await cancel_active_turn(websocket, session_state, notify_client=True)
            reset_turn_audio(session_state)
            session_state.vad_state = "listening"
            await send_state(websocket, "listening")

        elif msg_type == "cancel_turn":
            await cancel_active_turn(websocket, session_state, notify_client=True)
            reset_turn_audio(session_state)
            session_state.vad_state = "listening"
            await send_state(websocket, "listening")

        elif msg_type == "end_turn":
            await cancel_active_turn(websocket, session_state, notify_client=False)

            session_state.vad_state = "processing"
            await send_state(websocket, "processing")

            final_transcript, detected_lang, detect_conf = await finalize_transcript(
                session_state
            )

            filler_task: Optional[asyncio.Task] = None
            emotion_task: Optional[asyncio.Task] = None
            text_emotion_task: Optional[asyncio.Task] = None
            turn_audio = session_state.audio_buffer
            if turn_audio and len(turn_audio) >= MIN_AUDIO_BYTES:
                filler_task = asyncio.create_task(
                    asyncio.to_thread(count_fillers_verbatim, turn_audio)
                )
                emotion_task = asyncio.create_task(
                    asyncio.to_thread(_analyze_turn_emotion, turn_audio)
                )

            _buf = session_state.audio_buffer
            print(f"[voice] end_turn buffer={len(_buf)}B head={_buf[:4].hex()} "
                  f"transcript={final_transcript!r}")
            try:
                _dbg = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "debug_audio")
                os.makedirs(_dbg, exist_ok=True)
                with open(os.path.join(_dbg, "last_turn.webm"), "wb") as _f:
                    _f.write(_buf)
            except Exception as _e:
                print(f"[voice] debug save failed: {_e}")

            reset_turn_audio(session_state)

            user_text = (final_transcript or "").strip()
            if not user_text:
                for t in (filler_task, emotion_task, text_emotion_task):
                    if t is not None:
                        t.cancel()
                session_state.vad_state = "listening"
                await send_state(websocket, "listening")
                return

            text_emotion_task = asyncio.create_task(
                asyncio.to_thread(analyze_text_emotion, user_text)
            )

            decision = _resolve_language(
                session_state, detected_lang, detect_conf, user_text
            )
            language = decision.active_language

            if decision.switched:
                await websocket.send_json({
                    "type": "language",
                    "value": language,
                    "confidence": round(decision.confidence, 3),
                })

            fused = fusion.fuse(
                session_state.latest_video_signal,
                session_state.last_voice_signal,
                session_state.last_text_signal,
            )
            live_signals = fusion.summary_line(fused)

            session_state.turn_task = asyncio.create_task(
                run_turn(websocket, session_state, db, user_text, filler_task, language,
                         live_signals, emotion_task, text_emotion_task)
            )

        elif msg_type == "video_frame":
            await handle_video_frame(session_state, message.get("data"))

        else:
            await send_error(websocket, f"Unknown message type: {msg_type}")

    except json.JSONDecodeError:
        await send_error(websocket, "Invalid JSON message")


router = get_websocket_router()
