"""Language resolution — decides ONE active_language per session, per turn."""
import logging
from dataclasses import dataclass, field
from typing import Optional

from config import settings

log = logging.getLogger("coach.language")

try:
    from langdetect import detect_langs, DetectorFactory
    DetectorFactory.seed = 0
except ImportError:  # pragma: no cover - keeps text chat usable if not installed
    detect_langs = None


def _csv(raw: str) -> list[str]:
    return [p.strip().lower() for p in (raw or "").split(",") if p.strip()]


def supported_languages() -> list[str]:
    return _csv(settings.lang_supported) or ["en"]


def _arabic_aliases() -> set[str]:
    return set(_csv(settings.lang_arabic_aliases))


def normalize_language(code: Optional[str]) -> Optional[str]:
    """Map a raw detector code onto one of our supported languages."""
    if not code:
        return None
    code = code.strip().lower()
    code = code.replace("_", "-").split("-")[0]

    if code in _arabic_aliases():
        code = "ar"
    return code if code in supported_languages() else None


_MIN_DETECT_CHARS = 6

# Below this length a message carries little evidence, so langdetect's guess has
# to be clearly confident before it may set the reply language. Wrong guesses are
# mostly harmless anyway — they land outside en/fr/ar and normalize_language()
# drops them — but "Bonjour" must still be answered in French.
_SHORT_TEXT_CHARS = 15
_SHORT_TEXT_CONFIDENCE = 0.55


def detect_text_language(text: str) -> tuple[Optional[str], float]:
    """Best-effort language detection for a plain-text chat message."""
    text = (text or "").strip()
    if detect_langs is None or len(text) < _MIN_DETECT_CHARS:
        return None, 0.0
    try:
        results = detect_langs(text)
    except Exception:
        return None, 0.0
    if not results:
        return None, 0.0
    top = results[0]
    return top.lang, float(top.prob)


def resolve_text_language(text: str, fallback_text: str = "") -> str:
    """Reply language for one text-chat turn — follows THIS message's language.

    Each message is judged on its own, so switching language mid-conversation
    takes effect on the very next reply. Only when this message is too short or
    too ambiguous to read does it inherit the language already in play.
    """
    detected, confidence = detect_text_language(text)
    normalized = normalize_language(detected)
    is_short = len((text or "").strip()) < _SHORT_TEXT_CHARS

    if normalized and (not is_short or confidence >= _SHORT_TEXT_CONFIDENCE):
        return normalized

    fallback_detected, _ = detect_text_language(fallback_text)
    return normalize_language(fallback_detected) or settings.lang_default


@dataclass
class LanguageDecision:
    """Outcome of one turn's resolution."""
    active_language: str
    detected_language: Optional[str]
    confidence: float
    switched: bool
    reason: str


@dataclass
class LanguageState:
    """Per-session language state."""
    active: str = ""
    candidate: Optional[str] = None
    candidate_turns: int = 0
    turns_seen: int = 0

    def __post_init__(self):
        if not self.active:
            self.active = settings.lang_default


class LanguageResolver:
    """Owns the active_language decision for one session."""

    def __init__(self, state: Optional[LanguageState] = None, session_id: str = "-"):
        self.state = state or LanguageState()
        self.session_id = session_id

    @property
    def _confidence_threshold(self) -> float:
        return settings.lang_switch_confidence

    @property
    def _sustain_turns(self) -> int:
        return max(1, settings.lang_switch_sustain_turns)

    @property
    def _min_confidence(self) -> float:
        return settings.lang_min_confidence

    def resolve(
        self,
        detected: Optional[str],
        confidence: float,
        *,
        transcript: str = "",
    ) -> LanguageDecision:
        """Fold one turn's detection into the session's active language."""
        self.state.turns_seen += 1
        active = self.state.active
        norm = normalize_language(detected)

        if not settings.lang_routing_enabled:
            return LanguageDecision(active, norm, confidence, False, "routing disabled")

        if norm is None:
            return self._hold(
                active, norm, confidence,
                f"detected {detected!r} is not a supported language",
            )

        if confidence < self._min_confidence:
            return self._hold(
                active, norm, confidence,
                f"confidence {confidence:.2f} below floor {self._min_confidence:.2f}",
            )

        if norm == active:
            if self.state.candidate is not None:
                log.debug(
                    "[lang] session=%s candidate %s abandoned (turn resolved to active %s)",
                    self.session_id, self.state.candidate, active,
                )
            self.state.candidate = None
            self.state.candidate_turns = 0
            return LanguageDecision(active, norm, confidence, False, "matches active language")

        if confidence < self._confidence_threshold:
            return self._hold(
                active, norm, confidence,
                f"{norm} detected but confidence {confidence:.2f} < "
                f"{self._confidence_threshold:.2f}",
            )

        if self.state.candidate == norm:
            self.state.candidate_turns += 1
        else:
            self.state.candidate = norm
            self.state.candidate_turns = 1

        if self.state.candidate_turns < self._sustain_turns:
            return self._hold(
                active, norm, confidence,
                f"{norm} sustained {self.state.candidate_turns}/{self._sustain_turns} turns",
            )

        self.state.active = norm
        self.state.candidate = None
        self.state.candidate_turns = 0
        reason = (
            f"{norm} dominant for {self._sustain_turns} consecutive turns "
            f"(confidence {confidence:.2f})"
        )
        log.info(
            "[lang] SWITCH session=%s %s -> %s | confidence=%.2f | %s | transcript=%r",
            self.session_id, active, norm, confidence, reason, (transcript or "")[:120],
        )
        return LanguageDecision(norm, norm, confidence, True, reason)

    def _hold(
        self, active: str, detected: Optional[str], confidence: float, reason: str
    ) -> LanguageDecision:
        log.debug(
            "[lang] hold session=%s active=%s detected=%s conf=%.2f | %s",
            self.session_id, active, detected, confidence, reason,
        )
        return LanguageDecision(active, detected, confidence, False, reason)
