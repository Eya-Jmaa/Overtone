"""
WebSocket endpoint for live audio streaming and real-time transcription with TTS.
"""
import asyncio
import json
import time
import tempfile
import os
from fastapi import WebSocket, WebSocketDisconnect, Query
from sqlalchemy.orm import Session
from database import get_db
from services.db_models import Conversation
from services.security import decode_token
from services.session_store import get_session_store, SessionState
from services.turn_service import process_user_turn_stream
from services.tts_service import tts_synthesize, sentences_from_deltas


from routers.transcribe import _get_model


# Transcription settings
TRANSCRIPTION_WINDOW_MS = 500
MIN_AUDIO_BYTES = 2000


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

                # Raw .receive() delivers the disconnect as a plain message
                # (type "websocket.disconnect") rather than raising
                # WebSocketDisconnect - that only happens with the
                # receive_text()/receive_json() wrappers. Calling .receive()
                # again after this message is delivered is invalid per the
                # ASGI spec and raises a RuntimeError, so we must stop here.
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
            session_store.delete(connection_id)
            db.close()
    
    return ws_router


async def send_state(websocket: WebSocket, state: str) -> None:
    await websocket.send_json({"type": "state", "value": state})


async def send_error(websocket: WebSocket, message: str) -> None:
    await websocket.send_json({"type": "error", "message": message})


def get_timestamp_ms(session_state: SessionState) -> int:
    return int((time.monotonic() - session_state.session_start_ts) * 1000)


async def handle_audio_chunk(
    websocket: WebSocket,
    connection_id: str,
    session_state: SessionState,
    chunk: bytes,
) -> None:
    """
    Handle incoming audio chunk.
    Buffers chunks and triggers windowed transcription periodically.
    """
    if session_state.header_chunk is None:
        session_state.header_chunk = chunk
    
    session_state.audio_chunks.append(chunk)
    session_state.audio_buffer += chunk
    session_state.recent_chunks.append(chunk)
    
    elapsed_ms = (time.monotonic() - session_state.session_start_ts) * 1000
    buffer_size = len(session_state.audio_buffer)
    
    if buffer_size >= MIN_AUDIO_BYTES and not session_state.transcribing:
        if elapsed_ms - session_state.last_transcription_ms >= TRANSCRIPTION_WINDOW_MS:
            session_state.last_transcription_ms = elapsed_ms
            asyncio.create_task(
                run_windowed_transcription(websocket, session_state)
            )


async def run_windowed_transcription(
    websocket: WebSocket,
    session_state: SessionState,
) -> None:
    """Run windowed transcription on current audio buffer."""
    if not session_state.header_chunk or len(session_state.audio_buffer) < MIN_AUDIO_BYTES:
        return
    
    session_state.transcribing = True
    try:
        decode_buffer = session_state.header_chunk + b"".join(session_state.recent_chunks)
        # Greedy decoding (beam_size=1) for live partials — these are disposable
        # and re-run constantly, so latency matters more than accuracy here.
        transcript = await asyncio.to_thread(
            transcribe_audio_buffer,
            decode_buffer,
            1,
        )
        
        if transcript:
            session_state.partial_transcript = transcript
            await websocket.send_json({
                "type": "partial_transcript",
                "text": transcript,
                "ts": get_timestamp_ms(session_state),
            })
    except Exception as e:
        print(f"Windowed transcription error: {e}")
    finally:
        session_state.transcribing = False


def transcribe_audio_buffer(audio_bytes: bytes, beam_size: int = 5) -> str:
    """
    Transcribe audio buffer using Whisper.

    beam_size trades latency for accuracy: use 1 (greedy) for the frequent,
    disposable live partials to keep them real-time, and the default 5 for the
    final transcript that actually drives the coach's reply.
    """
    model = _get_model()

    # Safety check: ensure we have enough data
    if len(audio_bytes) < 100:
        return ""

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        segments, _ = model.transcribe(
            tmp_path,
            beam_size=beam_size,
            condition_on_previous_text=False,  # faster + avoids drift on short windows
            vad_filter=True,                   # skip silence: faster + no silence-hallucination
            vad_parameters={"min_silence_duration_ms": 300},
        )
        transcript = " ".join(seg.text.strip() for seg in segments)
        return transcript
    except Exception as e:
        print(f"Transcription fallback: {e}")
        return ""
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except:
                pass


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
            session_state.vad_state = "listening"
            await send_state(websocket, "listening")
        
        elif msg_type == "end_turn":
            session_state.vad_state = "processing"
            await send_state(websocket, "processing")
            
            # Transcribe the FULL accumulated audio for the user message
            final_transcript = ""
            if session_state.audio_buffer and len(session_state.audio_buffer) >= MIN_AUDIO_BYTES:
                final_transcript = await asyncio.to_thread(
                    transcribe_audio_buffer,
                    session_state.audio_buffer,
                )
            
            # Reset buffers for next turn
            session_state.audio_buffer = bytes()
            session_state.audio_chunks = []
            session_state.recent_chunks.clear()
            session_state.partial_transcript = ""
            session_state.last_transcription_ms = 0
            
            first_audio_sent = False
            # Ordered TTS pipeline: the producer streams LLM sentences and kicks
            # off TTS for each one IMMEDIATELY (concurrently, bounded), pushing the
            # synth task onto an ordered queue. The consumer awaits those tasks in
            # order and sends audio the instant each is ready. This overlaps LLM
            # generation with TTS + network, so the coach starts speaking on
            # sentence 1 while sentence 2 is still being written/synthesized.
            audio_q: asyncio.Queue = asyncio.Queue()
            tts_sem = asyncio.Semaphore(3)  # cap concurrent TTS calls to Kokoro

            async def _synth(text: str):
                async with tts_sem:
                    try:
                        return await tts_synthesize(text)
                    except Exception as tts_error:
                        print(f"TTS error for sentence: {tts_error}")
                        return None

            async def _produce_sentences():
                try:
                    async for sentence in sentences_from_deltas(
                        process_user_turn_stream(
                            db,
                            session_state.conversation_id,
                            final_transcript or "User spoke",
                        )
                    ):
                        await websocket.send_json({"type": "assistant_delta", "text": sentence})
                        await audio_q.put(asyncio.create_task(_synth(sentence)))
                finally:
                    await audio_q.put(None)  # sentinel (even on error) so consumer exits

            async def _send_audio():
                nonlocal first_audio_sent
                while True:
                    task = await audio_q.get()
                    if task is None:
                        break
                    audio_bytes = await task
                    if audio_bytes:
                        if not first_audio_sent:
                            await send_state(websocket, "speaking")
                            first_audio_sent = True
                        await websocket.send_bytes(audio_bytes)

            try:
                await asyncio.gather(_produce_sentences(), _send_audio())

                await websocket.send_json({"type": "assistant_done"})
                await send_state(websocket, "listening")

            except Exception as e:
                # process_user_turn_stream() may have already flushed (but not
                # committed) the user message before failing. `db` is held open
                # for this WHOLE websocket connection (not per-request like the
                # HTTP routes), so an un-rolled-back transaction here keeps
                # holding SQLite's single writer lock for as long as the socket
                # stays open - blocking every other write (e.g. creating or
                # deleting a conversation from any tab) with "database is
                # locked" until this connection eventually closes. Roll back
                # immediately so the lock is released as soon as the error
                # happens instead of lingering.
                db.rollback()
                print(f"Turn processing error: {e}")
                await send_error(websocket, f"Assistant error: {str(e)}")
                await send_state(websocket, "listening")
        
        else:
            await send_error(websocket, f"Unknown message type: {msg_type}")
    
    except json.JSONDecodeError:
        await send_error(websocket, "Invalid JSON message")


router = get_websocket_router()