"""Text-to-Speech service using Kokoro-82M via Kokoro-FastAPI (en/fr), plus a local Eya-Jmaa/silma-tts-derja (F5-TTS fine-tune) path for Arabic/Derja — see synthesize_silma_local() and services/tts_router.py's SilmaEngine."""
import io
import os
import re
import asyncio
import logging
import threading
from typing import Optional, AsyncGenerator
from openai import AsyncOpenAI
from config import settings

log = logging.getLogger("coach.tts")


ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "vs", "etc", "e.g", "i.e", "vs.",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
}

MARKDOWN_PATTERN = re.compile(r'(\*\*|__|\*|_|`|#)')
HEADER_PATTERN = re.compile(r'^#{1,6}\s+', re.MULTILINE)
CODE_BLOCK_PATTERN = re.compile(r'```.*?```', re.DOTALL)
EMOJI_PATTERN = re.compile(
    "["
    "\U0001F600-\U0001F64F"
    "\U0001F300-\U0001F5FF"
    "\U0001F680-\U0001F6FF"
    "\U0001F1E0-\U0001F1FF"
    "\U00002702-\U000027B0"
    "\U000024C2-\U0001F251"
    "]+",
    flags=re.UNICODE,
)


def clean_for_tts(text: str) -> str:
    """Clean text for natural-sounding TTS playback."""
    if not text:
        return ""

    text = CODE_BLOCK_PATTERN.sub("", text)

    text = MARKDOWN_PATTERN.sub("", text)

    text = HEADER_PATTERN.sub("", text)

    text = EMOJI_PATTERN.sub("", text)

    text = re.sub(r'(\d+)-(\d+)', lambda m: f"{num_to_words(m.group(1))} to {num_to_words(m.group(2))}", text)

    text = re.sub(r'(\d{1,2}):(\d{2})(?!\s*[AP]M)', lambda m: f"{num_to_words(m.group(1))} {num_to_words(m.group(2))}", text)

    abbrev_map = {
        "e.g.": "for example",
        "i.e.": "that is",
        "etc.": "and so on",
    }
    for abbrev, expansion in abbrev_map.items():
        text = text.replace(abbrev, expansion)

    text = re.sub(r'\s+', ' ', text).strip()

    return text


def num_to_words(n: str) -> str:
    """Convert a number string to words (simple implementation for TTS)."""
    try:
        num = int(n)
        ones = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
                "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
        tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]

        if num == 0:
            return "zero"
        elif num < 20:
            return ones[num]
        elif num < 100:
            return f"{tens[num // 10]} {ones[num % 10]}".strip()
        elif num < 1000:
            return f"{ones[num // 100]} hundred"
        else:
            return str(num)
    except ValueError:
        return n


_kokoro_client: Optional[AsyncOpenAI] = None


def get_kokoro_client() -> AsyncOpenAI:
    """Get or create the Kokoro OpenAI-compatible client."""
    global _kokoro_client
    if _kokoro_client is None:
        _kokoro_client = AsyncOpenAI(
            api_key="not-used",
            base_url=settings.kokoro_base_url,
            timeout=settings.kokoro_timeout_seconds,
        )
    return _kokoro_client


_silma_model = None
_silma_load_attempted = False
_silma_load_error: Optional[str] = None
_silma_load_lock = threading.Lock()


def _load_silma_model():
    """Build an F5TTS instance from OUR config.yaml + model.pt + vocab.txt."""
    import torch
    from hydra.utils import get_class
    from omegaconf import OmegaConf
    from f5_tts.api import F5TTS
    from f5_tts.infer.utils_infer import load_model, load_vocoder

    model_dir = settings.silma_model_dir
    config_path = os.path.join(model_dir, "config.yaml")
    ckpt_path = os.path.join(model_dir, "model.pt")
    vocab_path = os.path.join(model_dir, "vocab.txt")

    for p in (config_path, ckpt_path, vocab_path):
        if not os.path.exists(p):
            raise FileNotFoundError(
                f"{p} missing — run `python backend/scripts/setup_silma_tts.py` first"
            )

    model_cfg = OmegaConf.load(config_path)
    model_cls = get_class(f"f5_tts.model.{model_cfg.model.backbone}")
    model_arc = model_cfg.model.arch
    mel_spec_type = model_cfg.model.mel_spec.mel_spec_type
    device = "cuda" if torch.cuda.is_available() else "cpu"

    tts = F5TTS.__new__(F5TTS)
    tts.mel_spec_type = mel_spec_type
    tts.target_sample_rate = model_cfg.model.mel_spec.target_sample_rate
    tts.ode_method = "euler"
    tts.use_ema = False
    tts.device = device
    tts.vocoder = load_vocoder(mel_spec_type, False, None, device, None)
    tts.ema_model = load_model(
        model_cls,
        model_arc,
        ckpt_path,
        mel_spec_type=mel_spec_type,
        vocab_file=vocab_path,
        ode_method="euler",
        use_ema=False,
        device=device,
    )
    return tts


def _ensure_silma_loaded():
    """The loaded model, or None if it isn't (yet) usable."""
    global _silma_model, _silma_load_attempted, _silma_load_error

    if _silma_model is not None:
        return _silma_model

    with _silma_load_lock:
        if _silma_model is not None:
            return _silma_model
        if _silma_load_error is not None:
            return None
        if _silma_load_attempted:
            log.warning(
                "[tts] local SILMA model is still loading (started at boot, takes "
                "minutes on CPU) — no Arabic audio for this turn; it will work "
                "once the load finishes"
            )
            return None
        _silma_load_attempted = True

    try:
        model = _load_silma_model()
        log.info("[tts] local SILMA (F5-TTS) model loaded from %s", settings.silma_model_dir)
    except Exception as e:
        with _silma_load_lock:
            _silma_load_error = str(e)
        log.error("[tts] failed to load local SILMA model: %s", e)
        return None

    _silma_model = model
    return _silma_model


def warmup_silma_local() -> None:
    """Trigger the local SILMA model load at startup, off the request path."""
    if (settings.silma_provider or "").strip().lower() != "local":
        return
    _ensure_silma_loaded()


def synthesize_silma_local(text: str) -> Optional[bytes]:
    """Blocking F5-TTS inference — the caller MUST run this via asyncio.to_thread (diffusion sampling takes real seconds on CPU and would otherwise stall the event loop for every other connection)."""
    model = _ensure_silma_loaded()
    if model is None:
        return None

    ref_audio = settings.silma_ref_audio_path
    ref_text = settings.silma_ref_text
    if not ref_audio or not ref_text:
        log.error(
            "[tts] SILMA_REF_AUDIO_PATH/SILMA_REF_TEXT not set — this is a "
            "voice-cloning model with no default speaker, see .env.example"
        )
        return None
    if not os.path.exists(ref_audio):
        log.error("[tts] SILMA_REF_AUDIO_PATH does not exist: %s", ref_audio)
        return None

    try:
        wav, sr, _spec = model.infer(
            ref_file=ref_audio,
            ref_text=ref_text,
            gen_text=text,
        )
    except Exception as e:
        log.warning("[tts] local SILMA inference failed: %s", e)
        return None

    import soundfile as sf
    buf = io.BytesIO()
    sf.write(buf, wav, sr, format="WAV")
    return buf.getvalue()


async def tts_synthesize(text: str) -> Optional[bytes]:
    """Synthesize text to speech using Kokoro service."""
    cleaned = clean_for_tts(text)
    if not cleaned:
        return None

    client = get_kokoro_client()

    try:
        response = await client.audio.speech.create(
            model="kokoro",
            voice=settings.kokoro_voice,
            input=cleaned,
            response_format=settings.kokoro_response_format,
        )
        return response.read()
    except asyncio.TimeoutError:
        print(f"TTS timeout for text: {cleaned[:50]}...")
        return None
    except Exception as e:
        print(f"TTS error: {e}")
        return None


async def sentences_from_deltas(deltas: AsyncGenerator[str, None]) -> AsyncGenerator[str, None]:
    """Aggregate LLM deltas into complete sentences."""
    buffer = ""

    async for delta in deltas:
        buffer += delta

        matches = list(re.finditer(r'[.!?]+', buffer))

        new_buffer_start = 0
        for match in matches:
            sentence_end = match.end()
            sentence = buffer[:sentence_end].strip()

            if _is_false_trigger(buffer, match):
                continue

            if sentence:
                yield sentence
                new_buffer_start = sentence_end
            else:
                break

        if new_buffer_start > 0:
            buffer = buffer[new_buffer_start:]

    if buffer.strip():
        yield buffer.strip()


# Kokoro does not stream: the first byte of a request arrives with the last, and
# cost is roughly a fixed ~0.8s plus ~0.03s per character. So time-to-first-audio
# is set almost entirely by how much text the FIRST request carries. We cut the
# opening chunk at the earliest clause boundary to get sound playing, then let
# chunks grow — by then there is buffered speech covering the longer synthesis,
# and longer chunks give better prosody and fewer round trips.
FIRST_CHUNK_MIN_CHARS = 18
FIRST_CHUNK_MAX_CHARS = 70
CHUNK_MIN_CHARS = 70
CHUNK_MAX_CHARS = 220

SENTENCE_END_PATTERN = re.compile(r'[.!?]+')
CLAUSE_BOUNDARY_PATTERN = re.compile(r'[,;:]|\s[—–-]\s')


def _find_cut(buffer: str, *, is_first: bool) -> Optional[int]:
    """Index to split `buffer` at for the next TTS chunk, or None to keep buffering."""
    min_chars, max_chars = (
        (FIRST_CHUNK_MIN_CHARS, FIRST_CHUNK_MAX_CHARS)
        if is_first
        else (CHUNK_MIN_CHARS, CHUNK_MAX_CHARS)
    )

    # A finished sentence is always the best place to break, at any length.
    for match in SENTENCE_END_PATTERN.finditer(buffer):
        if not _is_false_trigger(buffer, match):
            return match.end()

    # Otherwise break at a clause boundary, once there's enough to be worth speaking.
    for match in CLAUSE_BOUNDARY_PATTERN.finditer(buffer):
        if match.end() >= min_chars:
            return match.end()

    # Runaway clause: break on a word boundary rather than let the chunk grow.
    if len(buffer) >= max_chars:
        space = buffer.rfind(" ", min_chars, max_chars)
        if space > 0:
            return space

    return None


async def chunks_from_deltas(deltas: AsyncGenerator[str, None]) -> AsyncGenerator[str, None]:
    """Aggregate LLM deltas into speakable chunks, smallest first.

    Same contract as `sentences_from_deltas` but it does not wait for a full
    sentence before yielding the opening chunk, which is what the voice path
    needs to start speaking promptly.
    """
    buffer = ""
    emitted = 0

    async for delta in deltas:
        buffer += delta

        while True:
            cut = _find_cut(buffer, is_first=(emitted == 0))
            if cut is None:
                break
            chunk = buffer[:cut].strip()
            buffer = buffer[cut:].lstrip()
            if chunk:
                yield chunk
                emitted += 1

    if buffer.strip():
        yield buffer.strip()


def _is_false_trigger(buffer: str, match: re.Match) -> bool:
    """Check if a period match is likely a false trigger (abbreviation or decimal)."""
    pos = match.start()

    if (pos > 0 and pos < len(buffer) - 1 and
        buffer[pos - 1].isdigit() and buffer[pos + 1].isdigit()):
        return True

    for abbrev in ABBREVIATIONS:
        abbrev_pattern = f"(?:\\s|^){abbrev}\\.?$"
        if re.search(abbrev_pattern, buffer[:match.end()], re.IGNORECASE):
            return True

    return False
