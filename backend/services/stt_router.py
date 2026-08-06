"""STT routing — pick the speech-to-text engine for the session's language."""
import logging
import os
import tempfile
from dataclasses import dataclass
from typing import Optional, Protocol

import numpy as np

from config import settings
from services.audio_pcm import SAMPLE_RATE

log = logging.getLogger("coach.stt")


@dataclass
class TranscriptionResult:
    """One turn's transcription plus the signals the resolver needs."""
    transcript: str
    detected_language: Optional[str]
    confidence: float
    engine: str
    segments: list = None

    def __post_init__(self):
        if self.segments is None:
            self.segments = []


class STTEngine(Protocol):
    """Minimal engine interface. Implement this to add a backend."""

    name: str

    def available(self) -> bool: ...

    def transcribe(
        self, audio: bytes, *, language: Optional[str], detect: bool, beam_size: int = 5
    ) -> TranscriptionResult: ...


class WhisperEngine:
    """faster-whisper. Serves en/fr today, and ar until a Derja model exists."""

    name = "faster-whisper"

    def available(self) -> bool:
        return True

    def transcribe(
        self,
        audio: "bytes | np.ndarray",
        *,
        language: Optional[str],
        detect: bool,
        beam_size: int = 5,
    ) -> TranscriptionResult:
        """Transcribe encoded bytes, or decoded mono float32 PCM @ 16 kHz.

        The live path passes PCM so it can slice by sample and skip a tempfile
        round-trip per pass; the batch paths still pass container bytes.
        """
        from routers.transcribe import _get_model

        tmp_path = None
        try:
            if isinstance(audio, np.ndarray):
                if audio.size < SAMPLE_RATE // 20:  # under 50ms
                    return TranscriptionResult("", None, 0.0, self.name)
                source = audio
            else:
                if len(audio) < 100:
                    return TranscriptionResult("", None, 0.0, self.name)
                with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
                    tmp.write(audio)
                    tmp_path = tmp.name
                source = tmp_path

            segments, info = _get_model().transcribe(
                source,
                beam_size=beam_size,
                condition_on_previous_text=False,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 300},
                language=None if detect else language,
            )
            segs = list(segments)
            text = " ".join(s.text.strip() for s in segs)
            return TranscriptionResult(
                transcript=text,
                detected_language=getattr(info, "language", None),
                confidence=float(getattr(info, "language_probability", 0.0) or 0.0),
                engine=self.name,
                segments=segs,
            )
        except Exception as e:
            log.warning("[stt] whisper failed: %s", e)
            return TranscriptionResult("", None, 0.0, self.name)
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass


class DerjaEngine:
    """Tunisian Derja STT."""

    name = "derja"

    def available(self) -> bool:
        backend = (settings.derja_stt_backend or "").strip()
        if not backend:
            return False
        if backend == "whisper_ft":
            return bool(settings.derja_stt_model_path) and os.path.exists(
                settings.derja_stt_model_path
            )
        if backend == "vosk":
            import importlib.util
            return (
                importlib.util.find_spec("vosk") is not None
                and bool(settings.derja_stt_model_path)
                and os.path.exists(settings.derja_stt_model_path)
            )
        return False

    def transcribe(
        self, audio: bytes, *, language: Optional[str], detect: bool, beam_size: int = 5
    ) -> TranscriptionResult:
        backend = (settings.derja_stt_backend or "").strip()
        if backend == "vosk":
            from services.linto_stt import transcribe as vosk_transcribe

            return vosk_transcribe(audio, language=language, detect=detect)
        raise NotImplementedError(
            "Derja STT backend is configured but not implemented. Implement "
            "DerjaEngine.transcribe (see class docstring) or clear "
            "DERJA_STT_BACKEND to fall back to Whisper."
        )


def detect_language(wav: np.ndarray) -> tuple[Optional[str], float]:
    """Language of decoded PCM, as (code, confidence). Blocking — use to_thread.

    Kept separate from transcription so the live path can transcribe short
    fragments without each one re-guessing the language from too little audio.
    """
    from routers.transcribe import _get_model

    if wav is None or wav.size < SAMPLE_RATE:
        return None, 0.0
    try:
        language, probability, _ = _get_model().detect_language(
            audio=wav, vad_filter=True, language_detection_segments=2
        )
        return language, float(probability or 0.0)
    except Exception as e:
        log.warning("[stt] language detection failed: %s", e)
        return None, 0.0


_whisper = WhisperEngine()
_derja = DerjaEngine()


def is_derja_engine_available() -> bool:
    """True when a real Derja backend is configured AND present on disk."""
    return _derja.available()


class STTRouter:
    """Chooses the engine for a turn and reports which one served it."""

    def __init__(self):
        self.whisper = _whisper
        self.derja = _derja

    def transcribe_turn(
        self,
        audio: "bytes | np.ndarray",
        active_language: Optional[str],
        *,
        detect: bool = True,
        beam_size: int = 5,
    ) -> TranscriptionResult:
        """Transcribe ONE COMPLETE TURN (or, at a lower beam, one live window)."""
        if active_language == "ar":
            if self.derja.available():
                try:
                    return self.derja.transcribe(
                        audio, language="ar", detect=detect, beam_size=beam_size
                    )
                except NotImplementedError as e:
                    log.error("[stt] derja engine misconfigured: %s", e)
                except Exception as e:
                    log.warning("[stt] derja engine failed, falling back: %s", e)
            else:
                log.info(
                    "[stt] no Derja engine installed — using multilingual Whisper "
                    "(MSA-level quality on Derja)"
                )
            return self.whisper.transcribe(
                audio, language="ar", detect=detect, beam_size=beam_size
            )

        return self.whisper.transcribe(
            audio, language=active_language, detect=detect, beam_size=beam_size
        )


_router: Optional[STTRouter] = None


def get_stt_router() -> STTRouter:
    global _router
    if _router is None:
        _router = STTRouter()
    return _router
