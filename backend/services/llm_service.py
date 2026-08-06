"""Coaching LLM service — Google Gemini (via the google-genai SDK)."""
import json

from google import genai
from google.genai import types
from google.genai import errors as genai_errors

from config import settings
from services import rag_engine

client = genai.Client(api_key=settings.gemini_api_key)

CONTEXT_WINDOW = 20

_LANGUAGE_NAMES = {
    "en": "English",
    "fr": "French",
    "ar": "Arabic",
}

SYSTEM_PROMPTS = {
    "psy": """You are an empathetic psychology coach helping users develop emotional
intelligence, self-awareness, and healthier relationships. Ask reflective questions,
validate feelings, and guide users toward their own insights. Keep responses concise
(2-4 sentences) unless the user asks for more detail.""",

    "professional": """You are a sharp professional coach specializing in career growth,
workplace dynamics, negotiation, and job interviews. Be direct, practical, and
results-oriented. Give concrete advice and frameworks. Keep responses concise
(2-4 sentences) unless the user asks for more detail.""",

    "sport": """You are a sport performance coach focused on mindset, motivation,
pre-competition focus, and mental resilience. Use motivational language grounded in
sports psychology. Be energetic but structured. Keep responses concise
(2-4 sentences) unless the user asks for more detail.""",
}


class LLMError(RuntimeError):
    """Clean, message-bearing failure from the LLM provider."""


def _language_directive(language: str) -> str:
    """The reply-language line(s) appended to a persona prompt."""
    lang = (language or "en").lower()
    lang_name = _LANGUAGE_NAMES.get(lang, "English")
    if lang == "ar":
        return (
            "Reply in Arabic, using Tunisian Derja (Tunisian dialect) as the user "
            "does. It is natural and expected to mix in the occasional French or "
            "English word the way Tunisian speakers do — mirror the user's own "
            "code-switching lightly — but your base language stays Arabic/Derja. "
            "Do not switch entirely to French or English."
        )
    return f"Always reply in {lang_name}, regardless of the language the user writes in."


def _build_system_instruction(mode: str, language: str) -> str:
    """Mode-specific persona prompt + an explicit reply-language directive."""
    base = SYSTEM_PROMPTS.get(mode, SYSTEM_PROMPTS["professional"])
    return f"{base}\n\n{_language_directive(language)}"


def _grounded_system_instruction(mode: str, language: str, user_message: str) -> str:
    """System instruction + (optional) RAG grounding from the coaching KB."""
    si = _build_system_instruction(mode, language)
    try:
        context = rag_engine.context_for(user_message, mode)
    except Exception as exc:
        print(f"[rag] skipped: {exc}")
        context = ""
    return f"{si}\n\n{context}" if context else si


_LIVE_SIGNAL_GUIDANCE = (
    "If the live signal shows sustained anxiety, hesitant/filler-heavy speech, "
    "or very low eye contact, it's natural to gently name it once "
    "(e.g. \"You seem hesitant — what's making this hard to say?\") before "
    "continuing, rather than ignoring it.\n"
    "Each entry names the channel it came from and they are NOT interchangeable: "
    "'expression' is their face, 'voice'/'vocal tone' is how they sounded, and "
    "'wording' is what their words themselves convey. Only 'wording' is available "
    "in a typed conversation. A ⚠ line means two channels disagreed — that is an "
    "observation worth a gentle question, not a contradiction to correct.\n"
    "These are automatic classifier readings, not facts. Where you reflect one "
    "back, hedge it the way it is given (\"that reads as frustrated\"), and never "
    "assert you heard or saw something a channel did not report."
)


def _live_signal_directive(live_signals: str) -> str:
    """The '[live signals] ...' block appended to the system instruction."""
    if not live_signals:
        return ""
    return (
        "\n\nAutomatic signal analysis of the user's recent turn — from their "
        "camera and mic where those are on, and from their wording either way. "
        "This is measurement, not something they said to you: use it to shape "
        "tone and timing, and never quote the line back verbatim:\n"
        f"{live_signals}\n\n{_LIVE_SIGNAL_GUIDANCE}"
    )


def _to_gemini_contents(history: list[dict], user_message: str) -> list[types.Content]:
    """Convert the app's message history into Gemini's Content/parts format."""
    contents: list[types.Content] = []
    for msg in history[-CONTEXT_WINDOW:]:
        role = "model" if msg["role"] == "assistant" else "user"
        contents.append(
            types.Content(role=role, parts=[types.Part(text=msg["content"])])
        )
    contents.append(
        types.Content(role="user", parts=[types.Part(text=user_message)])
    )
    return contents


def _wrap_error(exc: Exception) -> LLMError:
    """Translate an SDK error into a clean LLMError with a readable message."""
    status = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if status == 429:
        return LLMError(
            "The coach is temporarily rate-limited (too many requests). "
            "Please wait a moment and try again."
        )
    if isinstance(exc, genai_errors.APIError):
        return LLMError(f"Coach model unavailable: {exc.message}")
    return LLMError(f"Coach model error: {exc}")


def get_coach_response(
    mode: str,
    history: list[dict],
    user_message: str,
    language: str = "en",
    live_signals: str = "",
) -> str:
    """Non-streaming coaching reply — returns the full string."""
    config = types.GenerateContentConfig(
        system_instruction=_grounded_system_instruction(mode, language, user_message)
        + _live_signal_directive(live_signals),
        temperature=settings.gemini_temperature,
        top_p=settings.gemini_top_p,
        max_output_tokens=settings.gemini_max_tokens,
    )
    try:
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=_to_gemini_contents(history, user_message),
            config=config,
        )
    except Exception as exc:
        raise _wrap_error(exc) from exc

    return response.text or ""


def get_coach_response_stream(
    mode: str,
    history: list[dict],
    user_message: str,
    language: str = "en",
    live_signals: str = "",
):
    """Streaming coaching reply for the WebSocket voice path."""
    system_instruction = _grounded_system_instruction(
        mode, language, user_message
    ) + _live_signal_directive(live_signals)
    config = types.GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=settings.gemini_temperature,
        top_p=settings.gemini_top_p,
        max_output_tokens=settings.gemini_max_tokens,
    )
    try:
        stream = client.models.generate_content_stream(
            model=settings.gemini_model,
            contents=_to_gemini_contents(history, user_message),
            config=config,
        )
        for chunk in stream:
            if chunk.text:
                yield chunk.text
    except Exception as exc:
        raise _wrap_error(exc) from exc


REPORT_SYSTEM_PROMPT = """You are an expert communication coach writing a debrief of a
practice session. You are given the session transcript and a set of evidence-based
coaching techniques retrieved from a professional knowledge base.

Rules:
- Judge ONLY what the transcript shows. Never invent events, numbers, or quotes.
- Every item you cite must reference a real moment, using the [mm:ss] marker that
  precedes the user turn you are describing.
- For each improvement, name ONE technique drawn from the provided techniques list.
  Use the technique's exact name. If none of them fit, use null for technique.
- Address the user as "you". Be specific and warm, never generic praise.
__TONE_RULE__
__TEXT_EMOTION_RULE__

Return ONLY valid JSON matching this exact shape:
{
  "summary": "2-3 sentence overview of how the session went",
  "confidence_score": 7.4,
  "confidence_rationale": "one sentence explaining the score",
  "went_well": [
    {"timestamp": "mm:ss", "title": "short label", "detail": "1-2 sentences"}
  ],
  "improve": [
    {"timestamp": "mm:ss", "title": "short label", "detail": "1-2 sentences",
     "technique": "exact technique name or null", "priority": "high|medium|low"}
  ],
  "practice_drill": {
    "title": "short name", "detail": "concrete 2-4 sentence exercise",
    "duration_minutes": 5
  }
}
went_well must have 2-3 items. improve must have 3-4 items."""


_TONE_RULE_NO_DATA = (
    "- confidence_score rates how self-assured and clear the USER's language is, judged\n"
    "  from wording alone (0-10, one decimal). You cannot hear tone — do not pretend to."
)
_TONE_RULE_WITH_DATA = (
    "- confidence_score rates how self-assured and clear the USER came across (0-10, one\n"
    "  decimal). Judge it from their wording AND from the measured vocal-tone data given\n"
    "  below the transcript.\n"
    "- That tone data comes from an automatic classifier, not from a human listening. Treat\n"
    "  it as evidence, not fact: write \"your voice read as tense\", never \"you were tense\".\n"
    "  Never claim to have heard anything the data does not list, and never assign tone to\n"
    "  a turn the data does not cover (typed turns have none)."
)


_TEXT_EMOTION_RULE = (
    "- You are also given per-turn WORDING emotion, read from the user's words by a\n"
    "  text classifier. This is a DIFFERENT channel from vocal tone: it reflects what\n"
    "  they said, not how it sounded, and it exists for typed turns as well as spoken\n"
    "  ones. Never describe it as something you heard — write \"your wording read as\n"
    "  frustrated\", never \"you sounded frustrated\".\n"
    "- Each reading carries a confidence. Hedge low-confidence readings noticeably more,\n"
    "  and do not build a whole finding on one below about 0.5.\n"
    "- If a turn has BOTH a wording reading and a vocal-tone reading and they differ,\n"
    "  that gap is worth one observation (e.g. \"your words stayed measured while your\n"
    "  voice read as tense\"). Raise it as something to notice, not as a fault."
)


def _report_system_instruction(has_tone: bool, has_text_emotion: bool = False) -> str:
    return REPORT_SYSTEM_PROMPT.replace(
        "__TONE_RULE__", _TONE_RULE_WITH_DATA if has_tone else _TONE_RULE_NO_DATA
    ).replace(
        "__TEXT_EMOTION_RULE__", _TEXT_EMOTION_RULE if has_text_emotion else ""
    )


def generate_coaching_report(
    mode: str,
    transcript: str,
    techniques: list[dict],
    language: str = "en",
    tone_summary: str = "",
    text_emotion_summary: str = "",
) -> dict:
    """Produce the structured coaching report as a parsed dict."""
    if techniques:
        tech_block = "\n".join(
            f"- {t.get('name') or 'unnamed'}: {t.get('text', '')}" for t in techniques
        )
    else:
        tech_block = "(none retrieved — use null for every technique field)"

    tone_block = f"\nMeasured vocal tone:\n{tone_summary}\n" if tone_summary else ""
    text_block = (
        f"\nMeasured wording emotion:\n{text_emotion_summary}\n"
        if text_emotion_summary
        else ""
    )
    prompt = (
        f"Coaching mode: {mode}\n\n"
        f"Available techniques:\n{tech_block}\n\n"
        f"Session transcript:\n{transcript}\n"
        f"{tone_block}"
        f"{text_block}\n"
        f"Write the report for the user. {_language_directive(language)}"
    )

    config = types.GenerateContentConfig(
        system_instruction=_report_system_instruction(
            bool(tone_summary), bool(text_emotion_summary)
        ),
        temperature=0.3,
        max_output_tokens=2048,
        response_mime_type="application/json",
    )
    try:
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=[types.Content(role="user", parts=[types.Part(text=prompt)])],
            config=config,
        )
    except Exception as exc:
        raise _wrap_error(exc) from exc

    raw = (response.text or "").strip()
    if not raw:
        raise LLMError("Coach model returned an empty report.")

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LLMError(f"Coach model returned malformed report JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise LLMError("Coach model returned a non-object report.")
    return data


_TEXT_EMOTION_SYSTEM = """You are an emotion classifier for a communication-coaching app.
You are given ONE message written (or spoken and transcribed) by the user.

Classify the emotion the user is EXPRESSING, using exactly one of these labels:
__LABELS__

Rules:
- Judge the user's own emotional state, not the topic. "My friend is furious with me"
  is the user reporting someone else's anger — label the user's feeling, not the friend's.
- You are reading TEXT ONLY. You cannot hear tone, pace, or volume. Never claim to.
- "neutral" is a real answer, not a fallback. Informational, matter-of-fact, or purely
  practical messages are neutral.
- confidence is your genuine certainty from 0.0 to 1.0. Short, bland, or ambiguous
  messages should score LOW. Do not inflate it.
- evidence must be a VERBATIM span copied from the user's message (max 12 words) that
  most drove your label. If nothing in particular drove it, use null.
- The message may be in English, French, or Tunisian Derja (Arabic, often mixed with
  French). Classify it in whatever language it is written; do not translate.

Return ONLY valid JSON: {"emotion": "<label>", "confidence": 0.0, "evidence": "<span or null>"}"""


def classify_text_emotion(text: str, labels: list[str]) -> dict:
    """Zero-shot emotion classification of one user message."""
    config = types.GenerateContentConfig(
        system_instruction=_TEXT_EMOTION_SYSTEM.replace(
            "__LABELS__", ", ".join(labels)
        ),
        temperature=0.0,
        max_output_tokens=200,
        response_mime_type="application/json",
    )
    try:
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=[types.Content(role="user", parts=[types.Part(text=text)])],
            config=config,
        )
    except Exception as exc:
        raise _wrap_error(exc) from exc

    raw = (response.text or "").strip()
    if not raw:
        raise LLMError("Emotion classifier returned an empty response.")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LLMError(f"Emotion classifier returned malformed JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise LLMError("Emotion classifier returned a non-object.")
    return data


def generate_title(user_msg: str, assistant_reply: str) -> str:
    """Short conversation title from the first exchange."""
    prompt = (
        "Give a short title (3-5 words, no quotes, no period) for this coaching conversation:\n"
        f"User: {user_msg[:300]}\n"
        f"Coach: {assistant_reply[:300]}"
    )
    config = types.GenerateContentConfig(
        temperature=0.4,
        max_output_tokens=15,
    )
    try:
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=[types.Content(role="user", parts=[types.Part(text=prompt)])],
            config=config,
        )
    except Exception as exc:
        raise _wrap_error(exc) from exc

    return (response.text or "").strip().strip("\"'")
