from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from services.db_models import Conversation, Message
from services.schemas import MessageCreate, MessageItemOut
from services.turn_service import process_user_turn, generate_title_for_conversation
from routers.auth import get_current_user

router = APIRouter(prefix="/conversations", tags=["messages"])


@router.get("/{conv_id}/messages", response_model=list[MessageItemOut])
def get_messages(
    conv_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conv = (
        db.query(Conversation)
        .filter(Conversation.id == conv_id, Conversation.user_id == current_user.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv.messages


# NOTE: this route is intentionally a sync `def`, not `async def`. It performs
# a blocking LLM call, so running it on the event loop would freeze the whole
# server (including the WebSocket path) for the entire round-trip. As a sync
# route FastAPI runs it in a threadpool instead, keeping the loop responsive.
@router.post("/{conv_id}/messages", response_model=list[MessageItemOut])
def send_message(
    conv_id: int,
    body: MessageCreate,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 1. Verify ownership
    conv = (
        db.query(Conversation)
        .filter(Conversation.id == conv_id, Conversation.user_id == current_user.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # 2. Process turn using shared service. Defer title generation (a second
    #    LLM call) to a background task so the first message's response isn't
    #    blocked waiting on it.
    result = process_user_turn(
        db,
        conv_id,
        body.content,
        audio_url=body.audio_url,
        audio_duration=body.audio_duration,
        defer_title=True,
    )

    if result["is_first_turn"]:
        background_tasks.add_task(
            generate_title_for_conversation,
            conv_id,
            result["user_message"].content,
            result["assistant_message"].content,
        )

    return [result["user_message"], result["assistant_message"]]
