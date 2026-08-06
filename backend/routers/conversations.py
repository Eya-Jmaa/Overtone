import json
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from services import report_service
from services.db_models import Conversation, Message, CoachingReport
from services.llm_service import LLMError
from services.schemas import (
    ConversationCreate,
    ConversationOut,
    ConversationOutWithPreview,
    ConversationDetail,
    MessageCreate,
    MessageItemOut,
    CoachingReportOut,
    EndSessionOut,
    ScenarioOut,
)
from routers.auth import get_current_user

router = APIRouter(prefix="/conversations", tags=["conversations"])

VALID_MODES = {"psy", "professional", "sport"}
SCENARIOS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "scenarios")


def _get_ai_response(mode: str, history: list[dict], scenario_id: Optional[str] = None) -> str:
    """TODO: Replace with real call to llm_service.get_coach_response() or a scenario-aware system prompt from rag_engine.py."""
    return (
        f"This is a placeholder AI response for mode='{mode}', "
        f"scenario='{scenario_id or 'none'}'. "
        f"Wire llm_service.py to generate real responses."
    )


def _generate_coaching_report(conversation_id: int, db: Session) -> CoachingReport:
    """Generate + persist the real coaching report (see services/report_service)."""
    try:
        return report_service.generate_report(conversation_id, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except LLMError as e:
        db.rollback()
        raise HTTPException(status_code=502, detail=str(e))


def _load_scenario(scenario_id: str) -> Optional[dict]:
    """Load a single scenario by its ID."""
    path = os.path.join(SCENARIOS_DIR, f"{scenario_id}.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _list_scenarios() -> list[dict]:
    """List all available scenarios from the scenarios directory."""
    scenarios = []
    if not os.path.isdir(SCENARIOS_DIR):
        return scenarios
    for fname in sorted(os.listdir(SCENARIOS_DIR)):
        if fname.endswith(".json"):
            path = os.path.join(SCENARIOS_DIR, fname)
            with open(path, encoding="utf-8") as f:
                scenarios.append(json.load(f))
    return scenarios


@router.get("/", response_model=list[ConversationOutWithPreview])
def list_conversations(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all conversations for the current user, with message count and last message preview."""
    convs = (
        db.query(Conversation)
        .filter(Conversation.user_id == current_user.id)
        .order_by(Conversation.created_at.desc())
        .all()
    )

    result = []
    for conv in convs:
        last_msg = (
            db.query(Message)
            .filter(Message.conversation_id == conv.id)
            .order_by(Message.created_at.desc())
            .first()
        )
        message_count = (
            db.query(Message)
            .filter(Message.conversation_id == conv.id)
            .count()
        )
        result.append(
            ConversationOutWithPreview(
                id=conv.id,
                user_id=conv.user_id,
                mode=conv.mode,
                title=conv.title,
                created_at=conv.created_at,
                message_count=message_count,
                last_message_preview=last_msg.content[:80] if last_msg else None,
            )
        )
    return result


@router.post("/", response_model=ConversationOut)
def create_conversation(
    body: ConversationCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new conversation. Mode is locked at creation."""
    if body.mode not in VALID_MODES:
        raise HTTPException(status_code=400, detail="Invalid coaching mode")

    conv = Conversation(
        user_id=current_user.id,
        mode=body.mode,
        title=body.title,
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


@router.get("/{conv_id}", response_model=ConversationDetail)
def get_conversation(
    conv_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a conversation with all its messages."""
    conv = (
        db.query(Conversation)
        .filter(Conversation.id == conv_id, Conversation.user_id == current_user.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.delete("/{conv_id}")
def delete_conversation(
    conv_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a conversation and all associated messages/reports."""
    conv = (
        db.query(Conversation)
        .filter(Conversation.id == conv_id, Conversation.user_id == current_user.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    db.delete(conv)
    db.commit()
    return {"message": "Conversation deleted"}


@router.post("/{conv_id}/end", response_model=EndSessionOut)
def end_session(
    conv_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """End a coaching session and generate a coaching report."""
    conv = (
        db.query(Conversation)
        .filter(Conversation.id == conv_id, Conversation.user_id == current_user.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    existing = (
        db.query(CoachingReport)
        .filter(CoachingReport.conversation_id == conv_id)
        .first()
    )
    if existing:
        return EndSessionOut(
            message="Session already ended. Report already exists.",
            coaching_report=CoachingReportOut.model_validate(existing),
        )

    report = _generate_coaching_report(conv_id, db)
    return EndSessionOut(
        message="Session ended. Coaching report generated.",
        coaching_report=CoachingReportOut.model_validate(report),
    )


@router.get("/{conv_id}/report", response_model=CoachingReportOut)
def get_report(
    conv_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get the coaching report for a conversation."""
    conv = (
        db.query(Conversation)
        .filter(Conversation.id == conv_id, Conversation.user_id == current_user.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    report = (
        db.query(CoachingReport)
        .filter(CoachingReport.conversation_id == conv_id)
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="No coaching report found. End the session first.")

    return report


@router.get("/scenarios/list", response_model=list[ScenarioOut])
def list_scenarios():
    """List all available role-play scenarios."""
    return _list_scenarios()


@router.get("/scenarios/{scenario_id}", response_model=ScenarioOut)
def get_scenario(scenario_id: str):
    """Get a specific scenario by its ID."""
    scenario = _load_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return scenario
