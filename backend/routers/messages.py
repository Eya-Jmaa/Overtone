from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from services.db_models import Conversation, Message
from services.schemas import MessageCreate, MessageItemOut
from services.turn_service import (
    analyze_text_emotion_for_message,
    generate_title_for_conversation,
    process_user_turn,
)
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


@router.post("/{conv_id}/messages", response_model=list[MessageItemOut])
def send_message(
    conv_id: int,
    body: MessageCreate,
    background_tasks: BackgroundTasks,
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

    background_tasks.add_task(
        analyze_text_emotion_for_message,
        result["user_message"].id,
    )

    return [result["user_message"], result["assistant_message"]]
