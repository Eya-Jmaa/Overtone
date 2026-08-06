"""Coaching report generation — transcript + measured metrics + RAG + LLM."""
import json
from collections import Counter
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from services import rag_engine
from services.db_models import CoachingReport, Conversation, Message
from services.llm_service import LLMError, generate_coaching_report

REPORT_TOP_K = 8

MAX_TRANSCRIPT_CHARS = 12000

_PRIORITIES = {"high", "medium", "low"}


def _fmt_offset(seconds: float) -> str:
    """Seconds from session start -> mm:ss."""
    seconds = max(0, int(seconds))
    return f"{seconds // 60}:{seconds % 60:02d}"


def _build_transcript(messages: list[Message]) -> tuple[str, float]:
    """Render the transcript with [mm:ss] markers; return (text, duration_s)."""
    if not messages:
        return "", 0.0

    start = messages[0].created_at
    lines: list[str] = []
    last_offset = 0.0

    for m in messages:
        offset = 0.0
        if m.created_at and start:
            offset = max(0.0, (m.created_at - start).total_seconds())
        last_offset = max(last_offset, offset)
        speaker = "USER" if m.role == "user" else "COACH"
        lines.append(f"[{_fmt_offset(offset)}] {speaker}: {m.content}")

    text = "\n".join(lines)
    if len(text) > MAX_TRANSCRIPT_CHARS:
        text = "[… earlier turns truncated …]\n" + text[-MAX_TRANSCRIPT_CHARS:]
    return text, last_offset


def _build_tone_summary(messages: list[Message]) -> str:
    """Per-turn vocal tone lines for the report prompt, or '' if none measured."""
    if not messages:
        return ""
    start = messages[0].created_at
    lines: list[str] = []
    for m in messages:
        if m.role != "user" or not m.emotion:
            continue
        offset = 0.0
        if m.created_at and start:
            offset = max(0.0, (m.created_at - start).total_seconds())
        lines.append(f"[{_fmt_offset(offset)}] voice read as: {m.emotion}")
    return "\n".join(lines)


def _build_text_emotion_summary(messages: list[Message]) -> str:
    """Per-turn WORDING emotion lines for the report prompt, or '' if none."""
    if not messages:
        return ""
    start = messages[0].created_at
    lines: list[str] = []
    for m in messages:
        if m.role != "user" or not m.text_emotion:
            continue
        offset = 0.0
        if m.created_at and start:
            offset = max(0.0, (m.created_at - start).total_seconds())
        conf = m.text_emotion_confidence
        conf_s = f" ({conf:.2f})" if isinstance(conf, (int, float)) else ""
        line = f"[{_fmt_offset(offset)}] wording read as: {m.text_emotion}{conf_s}"
        if m.text_emotion_evidence:
            line += f' — from: "{m.text_emotion_evidence}"'
        lines.append(line)
    return "\n".join(lines)


def _measured_metrics(messages: list[Message], duration_s: float) -> dict:
    """Compute only what the stored data actually supports."""
    user_msgs = [m for m in messages if m.role == "user"]
    voiced = [m for m in user_msgs if m.filler_count is not None]

    filler_rate = None
    if voiced:
        fillers = sum(m.filler_count or 0 for m in voiced)
        words = sum(len((m.content or "").split()) for m in voiced)
        if words > 0:
            filler_rate = {
                "value": round(fillers * 100.0 / words, 1),
                "unit": "percent",
                "basis": "measured",
                "detail": f"{fillers} fillers across {len(voiced)} spoken turn(s)",
            }

    toned = [m.emotion for m in user_msgs if m.emotion]
    vocal_tone = None
    if toned:
        counts = Counter(toned)
        label, n = counts.most_common(1)[0]
        vocal_tone = {
            "value": label,
            "unit": None,
            "basis": "measured",
            "detail": f"{n} of {len(toned)} analysed turn(s); "
                      + ", ".join(f"{k} x{v}" for k, v in counts.most_common()),
        }

    texted = [m.text_emotion for m in user_msgs if m.text_emotion]
    text_emotion = None
    if texted:
        counts = Counter(texted)
        label, n = counts.most_common(1)[0]
        text_emotion = {
            "value": label,
            "unit": None,
            "basis": "measured",
            "detail": f"{n} of {len(texted)} analysed turn(s); "
                      + ", ".join(f"{k} x{v}" for k, v in counts.most_common()),
        }

    return {
        "session_length": {
            "value": int(duration_s),
            "unit": "seconds",
            "basis": "measured",
            "detail": f"{len(user_msgs)} of {len(messages)} turns were yours",
        },
        "filler_rate": filler_rate,
        "vocal_tone": vocal_tone,
        "text_emotion": text_emotion,
        "eye_contact": None,
    }


def _coerce_items(raw, *, want_technique: bool) -> list[dict]:
    """Normalize an LLM list into display-safe items, dropping unusable entries."""
    if not isinstance(raw, list):
        return []

    items: list[dict] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        detail = str(entry.get("detail") or "").strip()
        title = str(entry.get("title") or "").strip()
        if not detail and not title:
            continue

        item = {
            "title": title or "Moment",
            "detail": detail,
            "timestamp": str(entry.get("timestamp") or "").strip() or None,
        }
        if want_technique:
            tech = entry.get("technique")
            tech = str(tech).strip() if tech is not None else ""
            item["technique"] = tech if tech.lower() not in ("", "null", "none", "n/a") else None
            priority = str(entry.get("priority") or "").strip().lower()
            item["priority"] = priority if priority in _PRIORITIES else "medium"
        items.append(item)
    return items


def _retrieve_techniques(messages: list[Message], mode: str) -> list[dict]:
    """Pull citable techniques from the KB, keyed off what the USER talked about."""
    user_text = " ".join(
        (m.content or "") for m in messages if m.role == "user"
    ).strip()
    if not user_text:
        return []

    try:
        chunks = rag_engine.retrieve(user_text[:2000], mode, k=REPORT_TOP_K)
    except Exception as exc:
        print(f"[report] technique retrieval failed: {exc}")
        return []

    techniques: list[dict] = []
    seen: set[str] = set()
    for c in chunks:
        meta = c.get("metadata") or {}
        name = meta.get("technique_name") or meta.get("topic") or meta.get("source_name")
        if not name or name in seen:
            continue
        seen.add(name)
        techniques.append({"name": name, "text": " ".join((c.get("text") or "").split())[:600]})
    return techniques


def generate_report(conversation_id: int, db: Session) -> CoachingReport:
    """Build and persist the coaching report for `conversation_id`."""
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise ValueError("Conversation not found")

    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc(), Message.id.asc())
        .all()
    )
    if not any(m.role == "user" for m in messages):
        raise ValueError("This session has no user turns to analyse yet.")

    transcript, duration_s = _build_transcript(messages)
    techniques = _retrieve_techniques(messages, conv.mode)

    tone_summary = _build_tone_summary(messages)
    text_emotion_summary = _build_text_emotion_summary(messages)

    data = generate_coaching_report(
        mode=conv.mode,
        transcript=transcript,
        techniques=techniques,
        language="en",
        tone_summary=tone_summary,
        text_emotion_summary=text_emotion_summary,
    )

    summary = str(data.get("summary") or "").strip() or (
        "Session complete. The debrief could not be summarised automatically."
    )
    went_well = _coerce_items(data.get("went_well"), want_technique=False)
    improve = _coerce_items(data.get("improve"), want_technique=True)

    score_grid = _measured_metrics(messages, duration_s)

    raw_conf = data.get("confidence_score")
    try:
        conf = float(raw_conf)
    except (TypeError, ValueError):
        conf = None
    if tone_summary and text_emotion_summary:
        _conf_fallback = "Judged from your wording, its measured emotion, and measured vocal tone."
    elif tone_summary:
        _conf_fallback = "Judged from transcript wording and measured vocal tone."
    elif text_emotion_summary:
        _conf_fallback = (
            "Judged from your wording and its measured emotion — tone was not analysed."
        )
    else:
        _conf_fallback = "Judged from transcript wording only — tone was not analysed."
    score_grid["confidence"] = (
        {
            "value": round(max(0.0, min(10.0, conf)), 1),
            "max": 10,
            "basis": "llm",
            "detail": str(data.get("confidence_rationale") or "").strip() or _conf_fallback,
        }
        if conf is not None
        else None
    )

    drill_raw = data.get("practice_drill")
    drill = None
    if isinstance(drill_raw, dict):
        drill_detail = str(drill_raw.get("detail") or "").strip()
        if drill_detail:
            try:
                minutes = int(drill_raw.get("duration_minutes"))
            except (TypeError, ValueError):
                minutes = None
            drill = {
                "title": str(drill_raw.get("title") or "").strip() or "Practice drill",
                "detail": drill_detail,
                "duration_minutes": minutes,
            }

    metrics = {
        "score_grid": score_grid,
        "practice_drill": drill,
        "sources": [t["name"] for t in techniques],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    report = CoachingReport(
        conversation_id=conversation_id,
        user_id=conv.user_id,
        summary=summary,
        strengths=json.dumps(went_well),
        areas_for_growth=json.dumps(improve),
        metrics=json.dumps(metrics),
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report
