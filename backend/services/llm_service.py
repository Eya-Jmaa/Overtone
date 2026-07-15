"""
Coaching LLM service — Google Gemini (via the google-genai SDK).

All Gemini-specific code lives in THIS file, behind stable function signatures
(get_coach_response / get_coach_response_stream / generate_title). Callers
(turn_service.py, messages.py) never touch the SDK, so a future provider swap
is a single-file change.

Streaming contract (do NOT break — see turn_service.process_user_turn_stream):
  get_coach_response_stream is a BLOCKING SYNCHRONOUS GENERATOR that yields text
  deltas AS THEY ARRIVE. turn_service runs it on a worker thread and bridges each
  delta to the event loop. Do not buffer the whole reply, and do not convert this
  to an async generator.
"""
from google import genai
from google.genai import types
from google.genai import errors as genai_errors

from config import settings
from services import rag_engine

# One shared client for the whole app. The google-genai Client is thread-safe,
# which matters because get_coach_response_stream runs on a worker thread.
client = genai.Client(api_key=settings.gemini_api_key)

# Model name is read from config on every call so retiring/swapping a model is a
# one-line .env change (Google retires names — 2.0 Flash went away June 2026).
CONTEXT_WINDOW = 20

# Human-readable names for the reply-language directive appended to the system
# instruction. Falls back to English for anything unrecognised.
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
    """Clean, message-bearing failure from the LLM provider.

    turn_service / messages already convert exceptions into HTTP 502 / a WS error
    frame, so raising this (instead of leaking a raw SDK traceback) is enough to
    surface a readable message to the client.
    """


def _build_system_instruction(mode: str, language: str) -> str:
    """Mode-specific persona prompt + an explicit reply-language directive.

    The prompt text itself is unchanged; the language line is appended so the
    coach answers in the session's language without editing the personas.
    """
    base = SYSTEM_PROMPTS.get(mode, SYSTEM_PROMPTS["professional"])
    lang_name = _LANGUAGE_NAMES.get((language or "en").lower(), "English")
    return f"{base}\n\nAlways reply in {lang_name}, regardless of the language the user writes in."


def _grounded_system_instruction(mode: str, language: str, user_message: str) -> str:
    """System instruction + (optional) RAG grounding from the coaching KB.

    Retrieval is filtered to the session's mode and fails open: if RAG is
    disabled or errors, this is just the plain persona/language instruction.
    Runs inline here so, on the streaming path, it happens on turn_service's
    worker thread and never blocks the event loop.
    """
    si = _build_system_instruction(mode, language)
    try:
        context = rag_engine.context_for(user_message, mode)
    except Exception as exc:  # defensive — rag_engine already fails open
        print(f"[rag] skipped: {exc}")
        context = ""
    return f"{si}\n\n{context}" if context else si


def _to_gemini_contents(history: list[dict], user_message: str) -> list[types.Content]:
    """Convert the app's message history into Gemini's Content/parts format.

    Isolated and testable on purpose. Input is the app's existing shape
    (as built by turn_service):
        history: [{"role": "user"|"assistant", "content": str}, ...]
    Gemini differences handled here:
      - roles are "user" and "model" (not "assistant")
      - the system prompt is NOT a message (it goes in system_instruction)
      - each turn is a Content with a list of parts
    The new user_message is appended as the final "user" turn.
    """
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
    """Translate an SDK error into a clean LLMError with a readable message.

    Rate limiting (Gemini free tier is ~1,500 req/day, 10 RPM) gets an explicit
    message so the user knows to slow down / wait, rather than a generic 502.
    """
    # APIError (and its ClientError subclass) carries the HTTP status on .code.
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
) -> str:
    """Non-streaming coaching reply — returns the full string.

    history: list of {"role": "user"|"assistant", "content": str}
    language: session language (en/fr/ar); defaults to English.
    """
    config = types.GenerateContentConfig(
        system_instruction=_grounded_system_instruction(mode, language, user_message),
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
):
    """Streaming coaching reply for the WebSocket voice path.

    BLOCKING SYNCHRONOUS GENERATOR — yields text deltas as they arrive from
    Gemini. turn_service runs this on a worker thread and bridges each delta to
    the event loop, so the first tokens reach the client (and TTS) within a few
    hundred ms. Do NOT buffer the full response, and do NOT add silent retries
    here — a retry would stall the socket mid-turn.

    history: list of {"role": "user"|"assistant", "content": str}
    Yields: str (text chunks)
    """
    config = types.GenerateContentConfig(
        system_instruction=_grounded_system_instruction(mode, language, user_message),
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
            # chunk.text is None for non-text parts (e.g. safety-only chunks).
            if chunk.text:
                yield chunk.text
    except Exception as exc:
        raise _wrap_error(exc) from exc


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
