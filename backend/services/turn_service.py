"""
Turn processing service - shared logic for HTTP and WebSocket paths.

This module contains the core turn processing logic that both the HTTP POST /conversations/{id}/messages
route and the WebSocket handler use. It ensures a single source of truth for:
- Saving user messages
- Building conversation history
- Calling the LLM
- Saving assistant messages
- Generating conversation titles on first turn
"""
from typing import Optional, TypedDict, AsyncGenerator
from sqlalchemy.orm import Session
from fastapi import HTTPException
import asyncio

from database import SessionLocal
from services.db_models import Conversation, Message
from services.llm_service import get_coach_response, generate_title, get_coach_response_stream


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
    """
    Generate and persist a conversation title, using its own DB session.

    Designed to run as a fire-and-forget background task (e.g. FastAPI
    BackgroundTasks) so title generation - which is a second LLM call - stays
    off the critical path of the first message's HTTP response. Re-checks that
    the conversation still has no title so concurrent first messages don't
    generate it twice.
    """
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


async def process_user_turn_stream(
    db: Session,
    conversation_id: int,
    user_text: str,
    *,
    audio_url: Optional[str] = None,
    audio_duration: Optional[int] = None,
) -> AsyncGenerator[str, None]:
    """
    Process a user turn with streaming LLM response.
    
    Saves user message, streams LLM deltas, then saves complete assistant message.
    Yields text deltas as they arrive from the LLM.
    
    Args:
        db: Database session
        conversation_id: Conversation ID
        user_text: User's message content
        audio_url: Optional audio file URL
        audio_duration: Optional audio duration in seconds
    
    Yields:
        str: Text chunks from LLM
    
    Raises:
        HTTPException: If conversation not found or LLM fails
    """
    # 1. Verify conversation exists (ownership check should be done by caller)
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    is_first_message = not conv.title

    # 2. Build history for LLM (last N messages so far). The user message is
    # intentionally NOT added/flushed here - see process_user_turn's comment
    # for why: flushing opens a real SQLite write transaction, and this
    # streaming path can run for many seconds (LLM + TTS). Holding the
    # writer lock for that whole duration would block every other write in
    # the app (creating/deleting a conversation) until the stream finishes.
    # This section only reads, so it can't block other writers.
    history_rows = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
        .limit(CONTEXT_WINDOW)
        .all()
    )
    history = [{"role": m.role, "content": m.content} for m in history_rows]

    # 3. Stream the LLM response token-by-token AS IT ARRIVES.
    #
    # get_coach_response_stream is a BLOCKING generator (OpenAI SDK). We run it
    # on a worker thread and hand each delta to the event loop through a queue,
    # so the first tokens reach the client (and TTS) within a few hundred ms
    # instead of only after the whole reply has been generated. Collecting the
    # whole response first (the old `list(...)`) was the main source of delay.
    full_response = ""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    _DONE = object()

    def _produce():
        try:
            for delta in get_coach_response_stream(conv.mode, history, user_text):
                loop.call_soon_threadsafe(queue.put_nowait, delta)
        except Exception as exc:  # surface LLM errors to the consumer
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

    # 4. Now that the LLM has actually finished, save both messages together -
    # this is the only point where a write transaction opens, and it's short.
    user_msg = Message(
        conversation_id=conversation_id,
        role="user",
        content=user_text,
        audio_url=audio_url,
        audio_duration=audio_duration,
    )
    db.add(user_msg)

    # 5. Generate title from first exchange
    if is_first_message:
        try:
            conv.title = generate_title(user_text, full_response)
            db.add(conv)
        except Exception:
            # Fallback to truncated user message
            conv.title = user_text[:60]
            db.add(conv)

    # 6. Save assistant message
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
    """
    Process a user turn: save user message, call LLM, save assistant reply, generate title if first turn.

    This is the shared turn processing logic used by both HTTP and WebSocket paths.

    Args:
        db: Database session
        conversation_id: Conversation ID
        user_text: User's message content
        audio_url: Optional audio file URL
        audio_duration: Optional audio duration in seconds
        defer_title: If True, skip the (extra, blocking) title-generation LLM
            call here so the caller can run it in the background. The returned
            ``is_first_turn`` flag tells the caller whether a title is still
            needed.

    Returns:
        TurnResult with user_message, assistant_message, optional title (if
        generated inline), and is_first_turn.

    Raises:
        HTTPException: If conversation not found or LLM fails
    """
    # 1. Verify conversation exists (ownership check should be done by caller)
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    is_first_message = not conv.title

    # 2. Build history for LLM (last N messages so far - the new user message
    # isn't added yet, so there's nothing to exclude by id).
    #
    # NOTE: the user message is intentionally NOT added/flushed until AFTER
    # the LLM call succeeds (step 4 below). Flushing first would open a real
    # SQLite write transaction and hold its writer lock for the ENTIRE
    # duration of the LLM call - if the LLM endpoint is ever slow or hangs,
    # every other write in the app (creating/deleting a conversation) starts
    # failing with "database is locked" for as long as that call takes. This
    # section only reads, so it can't block other writers.
    history_rows = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
        .limit(CONTEXT_WINDOW)
        .all()
    )
    history = [{"role": m.role, "content": m.content} for m in history_rows]

    # 3. Call LLM (batch version - streaming variant added in Step 5)
    try:
        assistant_text = get_coach_response(conv.mode, history, user_text)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {str(e)}")

    # 4. Now that the LLM has actually responded, save both messages together -
    # this is the only point where a write transaction opens, and it's short.
    user_msg = Message(
        conversation_id=conversation_id,
        role="user",
        content=user_text,
        audio_url=audio_url,
        audio_duration=audio_duration,
    )
    db.add(user_msg)

    # 5. Generate title from first exchange (unless deferred to a background task)
    generated_title = None
    if is_first_message and not defer_title:
        try:
            conv.title = generate_title(user_text, assistant_text)
            generated_title = conv.title
            db.add(conv)
        except Exception:
            # Fallback to truncated user message
            conv.title = user_text[:60]
            generated_title = conv.title
            db.add(conv)

    # 6. Save assistant message
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
