"""linto_stt.py — Tunisian Derja STT via linagora/linto-asr-ar-tn-0.1 (Kaldi/Vosk)."""
import io
import json
import logging
import os
from typing import Iterator, Optional

import numpy as np
import librosa

from config import settings
from services.stt_router import TranscriptionResult

log = logging.getLogger("coach.stt.linto")

ENGINE_NAME = "linto-vosk"
SAMPLE_RATE = 16000
_CHUNK_BYTES = 4000

_model = None


def _get_model():
    """Lazy-loaded, process-wide vosk.Model singleton (mirrors the WhisperModel singleton pattern in routers/transcribe.py)."""
    global _model
    if _model is None:
        import vosk

        model_path = settings.derja_stt_model_path
        if not model_path or not os.path.isdir(model_path):
            raise RuntimeError(
                f"LinTO/Vosk model not found at '{model_path}'. Run "
                "backend/scripts/setup_linto_model.py to download it, then set "
                "DERJA_STT_MODEL_PATH."
            )
        vosk.SetLogLevel(-1)
        _model = vosk.Model(model_path)
    return _model


def _decode_to_pcm16(audio_bytes: bytes) -> bytes:
    """Decode arbitrary container audio (webm/opus from the browser, wav, ...) into 16kHz mono 16-bit PCM — the only format AcceptWaveform accepts."""
    audio, _ = librosa.load(io.BytesIO(audio_bytes), sr=SAMPLE_RATE, mono=True)
    pcm16 = (np.clip(audio, -1.0, 1.0) * 32767.0).astype(np.int16)
    return pcm16.tobytes()


def _iter_chunks(data: bytes, size: int = _CHUNK_BYTES) -> Iterator[bytes]:
    for i in range(0, len(data), size):
        yield data[i : i + size]


class LintoStreamingSession:
    """One KaldiRecognizer per utterance/turn."""

    def __init__(self, model=None):
        import vosk

        self._rec = vosk.KaldiRecognizer(model or _get_model(), SAMPLE_RATE)
        self._rec.SetWords(True)

    def accept_chunk(self, pcm16_chunk: bytes) -> Optional[dict]:
        """Feed one chunk of 16kHz mono PCM16."""
        if self._rec.AcceptWaveform(pcm16_chunk):
            return json.loads(self._rec.Result())
        return None

    def partial(self) -> dict:
        return json.loads(self._rec.PartialResult())

    def final(self) -> dict:
        return json.loads(self._rec.FinalResult())


def transcribe(
    audio: bytes, *, language: Optional[str] = "ar", detect: bool = True
) -> TranscriptionResult:
    """Turn-level transcription."""
    if len(audio) < 100:
        return TranscriptionResult("", None, 0.0, ENGINE_NAME)

    try:
        pcm16 = _decode_to_pcm16(audio)
    except Exception as e:
        log.warning("[stt] linto/vosk audio decode failed: %s", e)
        return TranscriptionResult("", None, 0.0, ENGINE_NAME)

    try:
        session = LintoStreamingSession()
        text_parts = []
        for chunk in _iter_chunks(pcm16):
            result = session.accept_chunk(chunk)
            if result and result.get("text"):
                text_parts.append(result["text"])
        final = session.final()
        if final.get("text"):
            text_parts.append(final["text"])
    except Exception as e:
        log.warning("[stt] linto/vosk transcription failed: %s", e)
        return TranscriptionResult("", None, 0.0, ENGINE_NAME)

    transcript = " ".join(p for p in text_parts if p).strip()
    return TranscriptionResult(
        transcript=transcript,
        detected_language="ar",
        confidence=1.0 if transcript else 0.0,
        engine=ENGINE_NAME,
        segments=[],
    )
