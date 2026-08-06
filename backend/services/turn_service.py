"""Turn processing service - shared logic for HTTP and WebSocket paths."""
from typing import Optional, TypedDict, AsyncGenerator
from sqlalchemy.orm import Session
from fastapi import HTTPException
import asyncio

from database import SessionLocal
from services import fusion
from services.db_models import Conversation, Message
from services.llm_service import get_coach_response, generate_title, get_coach_response_stream
from services.language_service import resolve_text_language


CONTEXT_WINDOW = 20


class TurnResult(TypedDict):
    """Result of processing a user turn."""
    user_message: Message
    assistant_message: Message
    title: Optional[str]
    is_first_turn: bool


def generate_title_for_conversation(
    conversation_id: int,
    user_text: str,
    assistant_text: str,
) -> None:
    """Generate and persist a conversation title, using its own DB session."""
    db = SessionLocal()
    try:
        conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
        if not conv or conv.title:
            return
        try:
            conv.title = generate_title(user_text, assistant_text)
        except Exception:
            conv.title = user_text[:60]
        db.add(conv)
        db.commit()
    finally:
        db.close()


def _trailing_text_signal(db: Session, conversation_id: int) -> str:
    """'[live signals] ...' line from the last analysed user turn, or ''."""
    try:
        row = (
            db.query(Message)
            .filter(
                Message.conversation_id == conversation_id,
                Message.role == "user",
                Message.text_emotion.isnot(None),
            )
            .order_by(Message.id.desc())
            .first()
        )
        if row is None:
            return ""
        signal = fusion.text_signal({
            "emotion": row.text_emotion,
            "confidence": row.text_emotion_confidence,
            "evidence": row.text_emotion_evidence,
        })
        return fusion.summary_line(fusion.fuse(None, None, signal))
    except Exception as e:
        print(f"[metrics] trailing text signal unavailable: {e}")
        return ""


def analyze_text_emotion_for_message(message_id: int) -> None:
    """Classify one user message's emotion from its text and persist it."""
    from services.text_emotion import analyze_text_emotion

    db = SessionLocal()
    try:
        msg = db.query(Message).filter(Message.id == message_id).first()
        if msg is None or msg.role != "user":
            return
        result = analyze_text_emotion(msg.content or "")
        if result is None:
            return
        msg.text_emotion = result.get("emotion")
        msg.text_emotion_confidence = result.get("confidence")
        msg.text_emotion_evidence = result.get("evidence")
        db.add(msg)
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[metrics] text emotion failed for message {message_id}: {e}")
    finally:
        db.close()


async def process_user_turn_stream(
    db: Session,
    conversation_id: int,
    user_text: str,
    *,
    audio_url: Optional[str] = None,
    audio_duration: Optional[int] = None,
    language: str = "en",
    live_signals: str = "",
) -> AsyncGenerator[str, None]:
    """Process a user turn with streaming LLM response."""
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    is_first_message = not conv.title

    history_rows = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
        .limit(CONTEXT_WINDOW)
        .all()
    )
    history = [{"role": m.role, "content": m.content} for m in history_rows]

    full_response = ""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    _DONE = object()

    def _produce():
        try:
            for delta in get_coach_response_stream(
                conv.mode, history, user_text, language, live_signals=live_signals
            ):
                loop.call_soon_threadsafe(queue.put_nowait, delta)
        except Exception as exc:
            loop.call_soon_threadsafe(queue.put_nowait, exc)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, _DONE)

    producer = asyncio.create_task(asyncio.to_thread(_produce))
    try:
        while True:
            item = await queue.get()
            if item is _DONE:
                break
            if isinstance(item, Exception):
                raise item
            full_response += item
            yield item
    except Exception as e:
        db.rollback()
        await producer
        raise HTTPException(status_code=502, detail=f"LLM error: {str(e)}")
    await producer

    user_msg = Message(
        conversation_id=conversation_id,
        role="user",
        content=user_text,
        audio_url=audio_url,
        audio_duration=audio_duration,
    )
    db.add(user_msg)

    if is_first_message:
        try:
            conv.title = generate_title(user_text, full_response)
            db.add(conv)
        except Exception:
            conv.title = user_text[:60]
            db.add(conv)

    assistant_msg = Message(
        conversation_id=conversation_id,
        role="assistant",
        content=full_response,
    )
    db.add(assistant_msg)
    db.commit()
    db.refresh(user_msg)
    db.refresh(assistant_msg)


def process_user_turn(
    db: Session,
    conversation_id: int,
    user_text: str,
    *,
    audio_url: Optional[str] = None,
    audio_duration: Optional[int] = None,
    defer_title: bool = False,
) -> TurnResult:
    """Process a user turn: save user message, call LLM, save assistant reply, generate title if first turn."""
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    is_first_message = not conv.title

    history_rows = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
        .limit(CONTEXT_WINDOW)
        .all()
    )
    history = [{"role": m.role, "content": m.content} for m in history_rows]

    prior_reply = next(
        (m["content"] for m in reversed(history) if m["role"] == "assistant"), ""
    )
    language = resolve_text_language(user_text, prior_reply)

    live_signals = _trailing_text_signal(db, conversation_id)

    try:
        assistant_text = get_coach_response(
            conv.mode, history, user_text, language, live_signals=live_signals
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {str(e)}")

    user_msg = Message(
        conversation_id=conversation_id,
        role="user",
        content=user_text,
        audio_url=audio_url,
        audio_duration=audio_duration,
    )
    db.add(user_msg)

    generated_title = None
    if is_first_message and not defer_title:
        try:
            conv.title = generate_title(user_text, assistant_text)
            generated_title = conv.title
            db.add(conv)
        except Exception:
            conv.title = user_text[:60]
            generated_title = conv.title
            db.add(conv)

    assistant_msg = Message(
        conversation_id=conversation_id,
        role="assistant",
        content=assistant_text,
    )
    db.add(assistant_msg)
    db.commit()
    db.refresh(user_msg)
    db.refresh(assistant_msg)

    return TurnResult(
        user_message=user_msg,
        assistant_message=assistant_msg,
        title=generated_title,
        is_first_turn=is_first_message,
    )
