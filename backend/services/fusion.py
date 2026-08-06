"""Cross-modal fusion: combine the live video signal with whatever voice-side signal is actually measured this turn, and flag simple incongruence."""
from typing import Optional

HESITANT_FILLER_RATE = 8.0

_ANXIOUS_EXPRESSIONS = {"Fear", "Sadness", "Anger", "Disgust"}
_CALM_EXPRESSIONS = {"Happiness", "Neutral", None}

_LOW_EYE_CONTACT = 0.35

_MIN_FLAG_CONFIDENCE = 0.5

_VALENCE = {
    "happy": "positive",
    "surprised": "positive",
    "sad": "negative",
    "angry": "negative",
    "fearful": "negative",
    "disgust": "negative",
    "neutral": "neutral",
}

_EXPRESSION_TO_VALENCE_KEY = {
    "Happiness": "happy",
    "Surprise": "surprised",
    "Sadness": "sad",
    "Anger": "angry",
    "Fear": "fearful",
    "Disgust": "disgust",
    "Contempt": "disgust",
    "Neutral": "neutral",
}


def _valence(label: Optional[str]) -> str:
    """Coarse positive/negative/neutral bucket for one emotion label."""
    return _VALENCE.get((label or "").lower(), "neutral")


def voice_signal(
    filler_count: Optional[int],
    word_count: int,
    emotion: Optional[dict] = None,
) -> Optional[dict]:
    """Measured voice-side signal for one turn, or None if nothing measurable."""
    signal: dict = {}

    if filler_count is not None and word_count > 0:
        rate = round(filler_count * 100.0 / word_count, 1)
        signal["filler_rate"] = rate
        signal["hesitant"] = rate >= HESITANT_FILLER_RATE

    if emotion and emotion.get("emotion"):
        signal["emotion"] = emotion["emotion"]
        signal["emotion_confidence"] = round(float(emotion.get("confidence") or 0.0), 2)

    return signal or None


def text_signal(emotion: Optional[dict]) -> Optional[dict]:
    """Measured text-side signal for one turn, or None if nothing measurable."""
    if not emotion or not emotion.get("emotion"):
        return None
    signal = {
        "emotion": emotion["emotion"],
        "confidence": round(float(emotion.get("confidence") or 0.0), 2),
    }
    if emotion.get("evidence"):
        signal["evidence"] = emotion["evidence"]
    return signal


def fuse(
    video: Optional[dict],
    voice: Optional[dict],
    text: Optional[dict] = None,
) -> dict:
    """Combine the latest video signal with the trailing voice and text signals."""
    incongruence: list[str] = []

    expr = ((video or {}).get("expression") or {})
    expr_label = expr.get("label")
    expr_conf = expr.get("confidence") or 0.0

    fluency_measured = voice is not None and "hesitant" in voice

    if video and fluency_measured:
        if expr_label in _ANXIOUS_EXPRESSIONS and expr_conf >= 0.5 and not voice["hesitant"]:
            incongruence.append(
                f"fluent speech but {expr_label.lower()} expression — possible masked anxiety"
            )
        elif voice["hesitant"] and expr_label in _CALM_EXPRESSIONS:
            incongruence.append("hesitant, filler-heavy speech despite a calm expression")

    eye_contact = (video or {}).get("eye_contact") or {}
    if eye_contact.get("ratio") is not None and eye_contact["ratio"] < _LOW_EYE_CONTACT:
        incongruence.append("low eye contact")

    if (video or {}).get("self_touch", {}).get("detected"):
        incongruence.append("self-touch (hand-to-face)")

    text_label = (text or {}).get("emotion")
    text_conf = (text or {}).get("confidence") or 0.0
    if text_label and text_conf >= _MIN_FLAG_CONFIDENCE:
        voice_label = (voice or {}).get("emotion")
        voice_conf = (voice or {}).get("emotion_confidence") or 0.0
        if (
            voice_label
            and voice_conf >= _MIN_FLAG_CONFIDENCE
            and _valence(voice_label) != _valence(text_label)
        ):
            incongruence.append(
                f"words read {text_label} but voice read {voice_label}"
            )

        if (
            expr_label
            and expr_conf >= _MIN_FLAG_CONFIDENCE
            and _valence(_EXPRESSION_TO_VALENCE_KEY.get(expr_label, expr_label))
            != _valence(text_label)
        ):
            incongruence.append(
                f"words read {text_label} but expression read {expr_label.lower()}"
            )

    return {"video": video, "voice": voice, "text": text, "incongruence": incongruence}


def summary_line(fused: dict) -> str:
    """Terse '[live signals] ...' line for injection into the coaching prompt."""
    video = fused.get("video")
    voice = fused.get("voice")
    text = fused.get("text")
    if not video and not voice and not text:
        return ""

    parts: list[str] = []
    if video:
        expr = video.get("expression") or {}
        if expr.get("label"):
            parts.append(f"expression: {expr['label'].lower()} ({expr.get('confidence') or 0:.2f})")
        eye = video.get("eye_contact") or {}
        if eye.get("ratio") is not None:
            parts.append(f"eye contact: {int(eye['ratio'] * 100)}%")
        if (video.get("self_touch") or {}).get("detected"):
            parts.append("self-touch: yes")
        engagement = video.get("engagement")
        if engagement and engagement.get("label"):
            parts.append(f"engagement: {engagement['label'].lower()}")
    if voice:
        if "hesitant" in voice:
            parts.append("voice: hesitant" if voice["hesitant"] else "voice: fluent")
        if voice.get("emotion"):
            parts.append(
                f"vocal tone: {voice['emotion']} ({voice.get('emotion_confidence') or 0:.2f})"
            )
    if text and text.get("emotion"):
        parts.append(f"wording: {text['emotion']} ({text.get('confidence') or 0:.2f})")

    if not parts:
        return ""

    line = "[live signals] " + " · ".join(parts)
    for flag in fused.get("incongruence") or []:
        line += f" · ⚠ {flag}"
    return line
