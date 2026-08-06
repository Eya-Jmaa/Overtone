"""Text emotion recognition — the coaching LLM used as a zero-shot classifier."""
import logging
from typing import Optional

from config import settings
from services import llm_service
from services.emotion_model import EMOTION_LABELS

log = logging.getLogger("coach.text_emotion")

ENGINE = "llm"

MAX_CHARS = 1500


def _clean_evidence(raw, source_text: str) -> Optional[str]:
    """Keep the model's evidence span only if it is genuinely from the message."""
    if not isinstance(raw, str):
        return None
    span = raw.strip().strip('"“”\'')
    if not span:
        return None
    norm = lambda s: " ".join(s.lower().split())
    if norm(span) not in norm(source_text):
        log.debug("[text-emotion] dropped non-verbatim evidence: %r", span)
        return None
    return span[:200]


def analyze_text_emotion(text: str) -> Optional[dict]:
    """Emotion expressed in one user message, or None if not measurable."""
    if not settings.text_emotion_enabled:
        return None

    content = (text or "").strip()
    if not content:
        return None

    word_count = len(content.split())
    if word_count < settings.text_emotion_min_words:
        log.debug("[text-emotion] skipped: %d word(s) < min", word_count)
        return None

    try:
        raw = llm_service.classify_text_emotion(content[:MAX_CHARS], EMOTION_LABELS)
    except Exception as exc:
        print(f"[emotion] text -> failed: {exc}")
        return None

    label = raw.get("emotion")
    if not isinstance(label, str) or label.strip().lower() not in EMOTION_LABELS:
        print(f"[emotion] text -> discarded off-scheme label {label!r}")
        return None
    label = label.strip().lower()

    try:
        confidence = float(raw.get("confidence") or 0.0)
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    if confidence < settings.text_emotion_min_confidence:
        print(
            f"[emotion] text -> {label} ({confidence:.2f}) below threshold "
            f"{settings.text_emotion_min_confidence:.2f}, recording as unmeasured"
        )
        return None

    evidence = _clean_evidence(raw.get("evidence"), content)
    print(
        f"[emotion] text -> {label} ({confidence:.2f})"
        + (f" | evidence: {evidence!r}" if evidence else "")
    )
    return {
        "emotion": label,
        "confidence": round(confidence, 3),
        "evidence": evidence,
        "engine": ENGINE,
    }
