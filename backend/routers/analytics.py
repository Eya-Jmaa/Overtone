"""User-level analytics over the voice metrics already captured per turn."""
from collections import Counter
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from services.db_models import Conversation, Message
from routers.auth import get_current_user

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _iso(dt) -> Optional[str]:
    return dt.isoformat() if dt is not None else None


@router.get("/overview")
def analytics_overview(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Aggregate this user's turn metrics across every conversation they own."""
    rows = (
        db.query(Message, Conversation)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .filter(
            Conversation.user_id == current_user.id,
            Message.role == "user",
        )
        .order_by(Conversation.id.asc(), Message.id.asc())
        .all()
    )

    conversations = (
        db.query(Conversation)
        .filter(Conversation.user_id == current_user.id)
        .order_by(Conversation.created_at.asc())
        .all()
    )

    emotion_counts: Counter = Counter()
    text_emotion_counts: Counter = Counter()
    shift_counts: Counter = Counter()
    text_shift_counts: Counter = Counter()
    per_conv: dict[int, dict] = {}
    timeline: list[dict] = []

    total_turns = 0
    filler_values: list[int] = []

    both_measured = 0
    agreed = 0
    disagreement_counts: Counter = Counter()

    prev_emotion_by_conv: dict[int, str] = {}
    prev_text_emotion_by_conv: dict[int, str] = {}

    for msg, conv in rows:
        total_turns += 1
        entry = per_conv.setdefault(
            conv.id,
            {
                "conversation_id": conv.id,
                "title": conv.title,
                "mode": conv.mode,
                "created_at": _iso(conv.created_at),
                "turns": 0,
                "emotions": Counter(),
                "text_emotions": Counter(),
                "filler_values": [],
            },
        )
        entry["turns"] += 1

        if msg.filler_count is not None:
            filler_values.append(msg.filler_count)
            entry["filler_values"].append(msg.filler_count)

        if msg.emotion:
            emotion_counts[msg.emotion] += 1
            entry["emotions"][msg.emotion] += 1

            prev = prev_emotion_by_conv.get(conv.id)
            if prev and prev != msg.emotion:
                shift_counts[(prev, msg.emotion)] += 1
            prev_emotion_by_conv[conv.id] = msg.emotion

        if msg.text_emotion:
            text_emotion_counts[msg.text_emotion] += 1
            entry["text_emotions"][msg.text_emotion] += 1

            prev_t = prev_text_emotion_by_conv.get(conv.id)
            if prev_t and prev_t != msg.text_emotion:
                text_shift_counts[(prev_t, msg.text_emotion)] += 1
            prev_text_emotion_by_conv[conv.id] = msg.text_emotion

        if msg.emotion and msg.text_emotion:
            both_measured += 1
            if msg.emotion == msg.text_emotion:
                agreed += 1
            else:
                disagreement_counts[(msg.text_emotion, msg.emotion)] += 1

        timeline.append({
            "conversation_id": conv.id,
            "title": conv.title,
            "created_at": _iso(msg.created_at),
            "emotion": msg.emotion,
            "text_emotion": msg.text_emotion,
            "text_emotion_confidence": msg.text_emotion_confidence,
            "filler_count": msg.filler_count,
        })

    measured_emotion_turns = sum(emotion_counts.values())
    measured_text_emotion_turns = sum(text_emotion_counts.values())

    emotion_distribution = [
        {
            "emotion": label,
            "count": count,
            "pct": round(100.0 * count / measured_emotion_turns, 1)
            if measured_emotion_turns
            else 0.0,
        }
        for label, count in emotion_counts.most_common()
    ]

    text_emotion_distribution = [
        {
            "emotion": label,
            "count": count,
            "pct": round(100.0 * count / measured_text_emotion_turns, 1)
            if measured_text_emotion_turns
            else 0.0,
        }
        for label, count in text_emotion_counts.most_common()
    ]

    shifts = [
        {"from": a, "to": b, "count": n}
        for (a, b), n in shift_counts.most_common()
    ]

    text_shifts = [
        {"from": a, "to": b, "count": n}
        for (a, b), n in text_shift_counts.most_common()
    ]

    sessions = []
    for conv in conversations:
        entry = per_conv.get(conv.id)
        if entry is None:
            sessions.append({
                "conversation_id": conv.id,
                "title": conv.title,
                "mode": conv.mode,
                "created_at": _iso(conv.created_at),
                "turns": 0,
                "avg_fillers": None,
                "measured_filler_turns": 0,
                "dominant_emotion": None,
                "emotions": [],
                "dominant_text_emotion": None,
                "text_emotions": [],
            })
            continue

        fv = entry["filler_values"]
        sessions.append({
            "conversation_id": entry["conversation_id"],
            "title": entry["title"],
            "mode": entry["mode"],
            "created_at": entry["created_at"],
            "turns": entry["turns"],
            "avg_fillers": round(sum(fv) / len(fv), 2) if fv else None,
            "measured_filler_turns": len(fv),
            "dominant_emotion": entry["emotions"].most_common(1)[0][0]
            if entry["emotions"]
            else None,
            "emotions": [
                {"emotion": k, "count": v} for k, v in entry["emotions"].most_common()
            ],
            "dominant_text_emotion": entry["text_emotions"].most_common(1)[0][0]
            if entry["text_emotions"]
            else None,
            "text_emotions": [
                {"emotion": k, "count": v}
                for k, v in entry["text_emotions"].most_common()
            ],
        })

    return {
        "totals": {
            "conversations": len(conversations),
            "analysed_turns": total_turns,
            "measured_emotion_turns": measured_emotion_turns,
            "measured_text_emotion_turns": measured_text_emotion_turns,
            "measured_filler_turns": len(filler_values),
            "avg_fillers": round(sum(filler_values) / len(filler_values), 2)
            if filler_values
            else None,
            "total_fillers": sum(filler_values) if filler_values else 0,
            "dominant_emotion": emotion_counts.most_common(1)[0][0]
            if emotion_counts
            else None,
            "dominant_text_emotion": text_emotion_counts.most_common(1)[0][0]
            if text_emotion_counts
            else None,
            "total_shifts": sum(shift_counts.values()),
            "total_text_shifts": sum(text_shift_counts.values()),
        },
        "emotion_distribution": emotion_distribution,
        "text_emotion_distribution": text_emotion_distribution,
        "shifts": shifts,
        "text_shifts": text_shifts,
        "modality_agreement": {
            "both_measured": both_measured,
            "agreed": agreed,
            "disagreed": both_measured - agreed,
            "agreement_pct": round(100.0 * agreed / both_measured, 1)
            if both_measured
            else None,
            "top_disagreements": [
                {"text": t, "voice": v, "count": n}
                for (t, v), n in disagreement_counts.most_common(5)
            ],
        },
        "sessions": sessions,
        "timeline": timeline,
    }
