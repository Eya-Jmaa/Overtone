"""Speech emotion recognition — Eya-Jmaa/emotions_speech (XLSR-53 fine-tune)."""
import io
import logging
from dataclasses import dataclass
from typing import Optional, Union

import numpy as np

from config import settings

log = logging.getLogger("coach.emotion")

BACKBONE_ID = "facebook/wav2vec2-large-xlsr-53"
NUM_HIDDEN_STATES = 25
SAMPLE_RATE = 16000
CLIP_SECONDS = 4.0
MAX_SAMPLES = int(SAMPLE_RATE * CLIP_SECONDS)

MAX_CHUNKS = 6

EMOTION_LABELS = ["neutral", "happy", "sad", "angry", "fearful", "disgust", "surprised"]


@dataclass
class EmotionResult:
    emotion: str
    confidence: float
    all_probabilities: dict
    engine: str = "xlsr"
    chunks: int = 1

    def to_dict(self) -> dict:
        return {
            "emotion": self.emotion,
            "confidence": self.confidence,
            "all_probabilities": self.all_probabilities,
            "engine": self.engine,
            "chunks": self.chunks,
        }


def _build_model():
    """Construct the (randomly-initialized) module graph, before weights load."""
    import torch
    import torch.nn as nn
    from transformers import Wav2Vec2Config, Wav2Vec2Model

    class EmotionXLSR(nn.Module):
        def __init__(self, num_classes: int = 7):
            super().__init__()
            config = Wav2Vec2Config.from_pretrained(BACKBONE_ID)
            self.w2v = Wav2Vec2Model(config)
            hidden = config.hidden_size

            self.layer_weights = nn.Parameter(torch.ones(NUM_HIDDEN_STATES))

            self.head = nn.Sequential(
                nn.LayerNorm(hidden),
                nn.Dropout(0.0),
                nn.Linear(hidden, 384),
                nn.GELU(),
                nn.LayerNorm(384),
                nn.Dropout(0.0),
                nn.Linear(384, 128),
                nn.GELU(),
                nn.LayerNorm(128),
            )
            self.proj_skip = nn.Linear(hidden, 128)
            self.classifier = nn.Linear(128, num_classes)

        def forward(self, input_values: "torch.Tensor") -> "torch.Tensor":
            outputs = self.w2v(input_values, output_hidden_states=True)
            hs = torch.stack(outputs.hidden_states, dim=0)
            weighted = (hs * self.layer_weights.view(-1, 1, 1, 1)).sum(dim=0)
            pooled = weighted.mean(dim=1)
            h = self.head(pooled)
            skip = self.proj_skip(pooled)
            logits = self.classifier(h + skip)
            return logits

    return EmotionXLSR(num_classes=len(EMOTION_LABELS))


def _softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - x.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)


def _decode_bytes_pyav(audio: bytes) -> np.ndarray:
    """Decode an encoded audio container to mono float32 @ 16kHz using PyAV."""
    import av

    with av.open(io.BytesIO(audio)) as container:
        if not container.streams.audio:
            raise ValueError("no audio stream in container")
        stream = container.streams.audio[0]
        resampler = av.audio.resampler.AudioResampler(
            format="fltp", layout="mono", rate=SAMPLE_RATE
        )
        chunks: list[np.ndarray] = []
        for frame in container.decode(stream):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
        for out in resampler.resample(None):
            chunks.append(out.to_ndarray().reshape(-1))

    if not chunks:
        raise ValueError("decoded to zero samples")
    return np.concatenate(chunks).astype(np.float32)


def _decode_full(audio: Union[bytes, np.ndarray], sr: int) -> np.ndarray:
    """Decode to mono float32 @ 16kHz at FULL length (no crop/pad)."""
    import librosa

    if isinstance(audio, (bytes, bytearray)):
        try:
            return _decode_bytes_pyav(bytes(audio))
        except Exception as av_err:
            try:
                wav, _ = librosa.load(io.BytesIO(audio), sr=SAMPLE_RATE, mono=True)
            except Exception:
                raise av_err
            return wav.astype(np.float32)

    wav = np.asarray(audio, dtype=np.float32)
    if sr != SAMPLE_RATE:
        wav = librosa.resample(wav, orig_sr=sr, target_sr=SAMPLE_RATE)
    return wav.astype(np.float32)


def _fit_window(wav: np.ndarray) -> np.ndarray:
    """Pad/crop to exactly 4.0s (MAX_SAMPLES)."""
    if len(wav) < MAX_SAMPLES:
        wav = np.pad(wav, (0, MAX_SAMPLES - len(wav)))
    else:
        wav = wav[:MAX_SAMPLES]
    return wav.astype(np.float32)


def _load_audio(audio: Union[bytes, np.ndarray], sr: int) -> np.ndarray:
    """Decode + fit to one 4.0s window (the single-window path)."""
    return _fit_window(_decode_full(audio, sr))


def _window_starts(total_samples: int, max_chunks: int = MAX_CHUNKS) -> list[int]:
    """Start offsets for up to `max_chunks` 4.0s windows spanning the clip."""
    if total_samples <= MAX_SAMPLES:
        return [0]
    n = min(max_chunks, int(np.ceil(total_samples / MAX_SAMPLES)))
    if n <= 1:
        return [0]
    last_start = total_samples - MAX_SAMPLES
    return [int(round(i * last_start / (n - 1))) for i in range(n)]


class _EmotionService:
    """Lazily-loaded singleton."""

    def __init__(self):
        self._model = None
        self._device = None
        self._load_attempted = False
        self._load_error: Optional[str] = None

    def _ensure_loaded(self) -> bool:
        if self._model is not None:
            return True
        if self._load_attempted:
            return False
        self._load_attempted = True

        if (settings.emotion_provider or "").strip().lower() != "xlsr":
            log.info("[emotion] EMOTION_PROVIDER not 'xlsr' — emotion analysis disabled")
            return False

        import os
        ckpt_path = settings.emotion_model_path
        if not ckpt_path or not os.path.exists(ckpt_path):
            self._load_error = f"checkpoint not found at {ckpt_path!r}"
            log.error(
                "[emotion] %s — run `python backend/scripts/setup_emotion_model.py` "
                "first", self._load_error,
            )
            return False

        try:
            import torch

            model = _build_model()
            state_dict = torch.load(ckpt_path, map_location="cpu", weights_only=True)
            missing, unexpected = model.load_state_dict(state_dict, strict=False)
            if missing or unexpected:
                log.warning(
                    "[emotion] state_dict mismatch — missing=%s unexpected=%s",
                    missing, unexpected,
                )
            model.eval()

            self._device = "cuda" if torch.cuda.is_available() else "cpu"
            model.to(self._device)
            self._model = model
            log.info("[emotion] xlsr model loaded on %s", self._device)
            return True
        except Exception as e:
            self._load_error = str(e)
            log.error("[emotion] failed to load xlsr model: %s", e)
            return False

    def _probs_for_window(self, wav: np.ndarray) -> Optional[np.ndarray]:
        """Run one already-fitted 4.0s window. None on failure."""
        import torch

        try:
            with torch.no_grad():
                input_values = torch.from_numpy(wav).unsqueeze(0).to(self._device)
                logits = self._model(input_values)
                return _softmax(logits.cpu().numpy())[0]
        except Exception as e:
            log.warning("[emotion] inference failed: %s", e)
            return None

    @staticmethod
    def _result(probs: np.ndarray, chunks: int) -> EmotionResult:
        idx = int(probs.argmax())
        return EmotionResult(
            emotion=EMOTION_LABELS[idx],
            confidence=float(probs[idx]),
            all_probabilities={
                EMOTION_LABELS[i]: float(probs[i]) for i in range(len(EMOTION_LABELS))
            },
            chunks=chunks,
        )

    def analyze(self, audio: Union[bytes, np.ndarray], sr: int = SAMPLE_RATE) -> Optional[EmotionResult]:
        if not self._ensure_loaded():
            return None
        try:
            wav = _load_audio(audio, sr)
        except Exception as e:
            log.warning("[emotion] could not decode audio: %s", e)
            return None
        probs = self._probs_for_window(wav)
        return self._result(probs, 1) if probs is not None else None

    def analyze_chunked(
        self,
        audio: Union[bytes, np.ndarray],
        sr: int = SAMPLE_RATE,
        max_chunks: int = MAX_CHUNKS,
    ) -> Optional[EmotionResult]:
        """Average the model's output over several windows spanning the turn."""
        if not self._ensure_loaded():
            return None
        try:
            wav = _decode_full(audio, sr)
        except Exception as e:
            log.warning("[emotion] could not decode audio: %s", e)
            return None
        if wav.size == 0:
            return None

        collected = []
        for start in _window_starts(len(wav), max_chunks):
            probs = self._probs_for_window(_fit_window(wav[start:start + MAX_SAMPLES]))
            if probs is not None:
                collected.append(probs)
        if not collected:
            return None
        return self._result(np.mean(collected, axis=0), len(collected))


_service: Optional[_EmotionService] = None


def _get_service() -> _EmotionService:
    global _service
    if _service is None:
        _service = _EmotionService()
    return _service


def warmup() -> None:
    """Trigger model load at startup rather than on the first request."""
    _get_service()._ensure_loaded()


def analyze_emotion(audio: Union[bytes, np.ndarray], sr: int = SAMPLE_RATE) -> Optional[dict]:
    """Analyze one audio clip's vocal emotion."""
    result = _get_service().analyze(audio, sr)
    return result.to_dict() if result else None


def analyze_emotion_chunked(
    audio: Union[bytes, np.ndarray],
    sr: int = SAMPLE_RATE,
    max_chunks: Optional[int] = None,
) -> Optional[dict]:
    """Whole-turn vocal emotion: average over up to `max_chunks` 4.0s windows."""
    if max_chunks is None:
        max_chunks = settings.emotion_max_chunks
    result = _get_service().analyze_chunked(audio, sr, max_chunks)
    return result.to_dict() if result else None
