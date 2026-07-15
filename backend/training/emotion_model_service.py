"""
=============================================================================
emotion_model.py — Production Inference Service
=============================================================================
Drop this into backend/services/emotion_model.py

Two inference modes:
  FAST (real-time):  ONNX EfficientNet → ~50ms on CPU  → use during conversation
  ACCURATE (report): Wav2Vec2 + CNN ensemble → ~250ms   → use for post-session report

Usage:
    from services.emotion_model import EmotionPredictor
    
    predictor = EmotionPredictor(
        onnx_path="models/emotion_cnn.onnx",
        wav2vec_path="models/wav2vec2_best.pt",  # optional
    )
    
    # Real-time (during conversation)
    result = predictor.predict_fast(audio_bytes)
    # → {"emotion": "angry", "confidence": 0.87, "all_probs": {...}}
    
    # Accurate (for coaching report)
    result = predictor.predict_accurate(audio_bytes)
    # → same format, higher accuracy
=============================================================================
"""

import io
import numpy as np
import librosa
import onnxruntime as ort
from typing import Dict, Optional
from dataclasses import dataclass


EMOTION_LABELS = [
    "neutral", "calm", "happy", "sad",
    "angry", "fearful", "disgust", "surprised"
]

SAMPLE_RATE = 16000
MAX_DURATION = 4.0
MAX_SAMPLES = int(SAMPLE_RATE * MAX_DURATION)
N_MELS = 128
SPEC_SIZE = (224, 224)


@dataclass
class EmotionResult:
    emotion: str
    confidence: float
    all_probabilities: Dict[str, float]

    def to_dict(self):
        return {
            "emotion": self.emotion,
            "confidence": self.confidence,
            "all_probabilities": self.all_probabilities,
        }


def load_audio_from_bytes(audio_bytes: bytes, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Load audio from raw bytes (WAV, MP3, etc)."""
    audio, _ = librosa.load(io.BytesIO(audio_bytes), sr=sr, mono=True)
    if len(audio) < MAX_SAMPLES:
        audio = np.pad(audio, (0, MAX_SAMPLES - len(audio)))
    else:
        audio = audio[:MAX_SAMPLES]
    return audio.astype(np.float32)


def load_audio_from_array(audio_array: np.ndarray, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Normalize a raw numpy audio array."""
    if len(audio_array) < MAX_SAMPLES:
        audio_array = np.pad(audio_array, (0, MAX_SAMPLES - len(audio_array)))
    else:
        audio_array = audio_array[:MAX_SAMPLES]
    return audio_array.astype(np.float32)


def extract_spectrogram(audio: np.ndarray) -> np.ndarray:
    """Extract 3-channel spectrogram: mel + MFCC + delta-MFCC."""
    mel = librosa.feature.melspectrogram(
        y=audio, sr=SAMPLE_RATE, n_mels=N_MELS, n_fft=2048, hop_length=512
    )
    mel_db = librosa.power_to_db(mel, ref=np.max)
    mfcc = librosa.feature.mfcc(y=audio, sr=SAMPLE_RATE, n_mfcc=40, n_fft=2048, hop_length=512)
    delta_mfcc = librosa.feature.delta(mfcc)

    def normalize(x):
        x_min, x_max = x.min(), x.max()
        if x_max - x_min < 1e-6:
            return np.zeros_like(x)
        return (x - x_min) / (x_max - x_min)

    channels = []
    for feature in [mel_db, mfcc, delta_mfcc]:
        feat = normalize(feature)
        feat = librosa.util.fix_length(feat, size=SPEC_SIZE[1], axis=1)
        if feat.shape[0] != SPEC_SIZE[0]:
            from skimage.transform import resize as sk_resize
            feat = sk_resize(feat, SPEC_SIZE, anti_aliasing=True).astype(np.float32)
        channels.append(feat)

    return np.stack(channels, axis=0).astype(np.float32)


def softmax(x):
    e = np.exp(x - x.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)


class EmotionPredictor:
    """
    Production emotion predictor with two speed modes.
    
    Fast mode:  ONNX EfficientNet (~50ms CPU)  — for real-time during conversation
    Accurate:   Wav2Vec2 + CNN ensemble (~250ms) — for post-session coaching report
    """

    def __init__(
        self,
        onnx_path: str,
        wav2vec_path: Optional[str] = None,
        labels: list = EMOTION_LABELS,
        ensemble_weights: tuple = (0.4, 0.6),  # (cnn, wav2vec)
    ):
        self.labels = labels
        self.cnn_weight, self.w2v_weight = ensemble_weights

        # Always load ONNX (fast mode)
        self.onnx_session = ort.InferenceSession(
            onnx_path,
            providers=["CPUExecutionProvider"],
        )
        print(f"✓ ONNX emotion model loaded from {onnx_path}")

        # Optionally load Wav2Vec2 (accurate mode)
        self.wav2vec_model = None
        if wav2vec_path and _torch_available():
            self._load_wav2vec(wav2vec_path)

    def _load_wav2vec(self, path: str):
        """Load Wav2Vec2 model for accurate mode."""
        try:
            import torch
            from transformers import Wav2Vec2Model

            # Reconstruct model architecture
            class EmotionWav2Vec2(torch.nn.Module):
                def __init__(self, num_classes=8):
                    super().__init__()
                    self.wav2vec = Wav2Vec2Model.from_pretrained("facebook/wav2vec2-base")
                    self.wav2vec.feature_extractor._freeze_parameters()
                    hidden = self.wav2vec.config.hidden_size
                    self.head = torch.nn.Sequential(
                        torch.nn.Dropout(0.3),
                        torch.nn.Linear(hidden, 256),
                        torch.nn.ReLU(True),
                        torch.nn.BatchNorm1d(256),
                        torch.nn.Dropout(0.2),
                        torch.nn.Linear(256, num_classes),
                    )

                def forward(self, x):
                    out = self.wav2vec(x).last_hidden_state.mean(dim=1)
                    return self.head(out)

            self.wav2vec_model = EmotionWav2Vec2(len(self.labels))
            self.wav2vec_model.load_state_dict(torch.load(path, map_location="cpu"))
            self.wav2vec_model.eval()
            print(f"✓ Wav2Vec2 emotion model loaded from {path}")
        except Exception as e:
            print(f"⚠ Failed to load Wav2Vec2: {e}. Accurate mode unavailable.")
            self.wav2vec_model = None

    def predict_fast(self, audio_input) -> EmotionResult:
        """
        Fast inference using ONNX EfficientNet (~50ms CPU).
        Use this during live conversation for each audio chunk.
        
        audio_input: bytes (wav/mp3) or numpy array (float32, 16kHz)
        """
        if isinstance(audio_input, bytes):
            audio = load_audio_from_bytes(audio_input)
        else:
            audio = load_audio_from_array(audio_input)

        spec = extract_spectrogram(audio)
        spec = np.expand_dims(spec, axis=0)  # (1, 3, 224, 224)

        logits = self.onnx_session.run(None, {"spectrogram": spec})[0]
        probs = softmax(logits)[0]

        idx = int(probs.argmax())
        return EmotionResult(
            emotion=self.labels[idx],
            confidence=float(probs[idx]),
            all_probabilities={self.labels[i]: float(probs[i]) for i in range(len(self.labels))},
        )

    def predict_accurate(self, audio_input) -> EmotionResult:
        """
        Accurate inference using CNN + Wav2Vec2 ensemble (~250ms CPU).
        Use this for post-session coaching report generation.
        Falls back to fast mode if Wav2Vec2 not loaded.
        
        audio_input: bytes (wav/mp3) or numpy array (float32, 16kHz)
        """
        if self.wav2vec_model is None:
            return self.predict_fast(audio_input)

        import torch

        if isinstance(audio_input, bytes):
            audio = load_audio_from_bytes(audio_input)
        else:
            audio = load_audio_from_array(audio_input)

        # CNN prediction
        spec = extract_spectrogram(audio)
        spec_batch = np.expand_dims(spec, axis=0)
        cnn_logits = self.onnx_session.run(None, {"spectrogram": spec_batch})[0]
        cnn_probs = softmax(cnn_logits)[0]

        # Wav2Vec2 prediction
        with torch.no_grad():
            waveform = torch.tensor(audio).unsqueeze(0)  # (1, samples)
            w2v_logits = self.wav2vec_model(waveform).numpy()
            w2v_probs = softmax(w2v_logits)[0]

        # Weighted ensemble
        combined = self.cnn_weight * cnn_probs + self.w2v_weight * w2v_probs
        idx = int(combined.argmax())

        return EmotionResult(
            emotion=self.labels[idx],
            confidence=float(combined[idx]),
            all_probabilities={self.labels[i]: float(combined[i]) for i in range(len(self.labels))},
        )

    def predict_with_tta(self, audio_input, n_augments: int = 5) -> EmotionResult:
        """
        Test-time augmentation: run N slightly different versions, average predictions.
        Adds ~3% accuracy boost. Use for coaching report only (slow: ~250ms × n_augments).
        """
        if isinstance(audio_input, bytes):
            audio = load_audio_from_bytes(audio_input)
        else:
            audio = load_audio_from_array(audio_input)

        all_probs = []

        # Original
        result = self.predict_accurate(audio)
        all_probs.append(list(result.all_probabilities.values()))

        # Augmented versions
        for i in range(n_augments - 1):
            aug_audio = audio.copy()
            # Small random pitch shift
            shift = np.random.uniform(-1, 1)
            aug_audio = librosa.effects.pitch_shift(aug_audio, sr=SAMPLE_RATE, n_steps=shift)
            # Small random gain
            gain = np.random.uniform(0.85, 1.15)
            aug_audio = (aug_audio * gain).astype(np.float32)
            # Small random noise
            noise = np.random.randn(len(aug_audio)) * 0.005
            aug_audio = (aug_audio + noise).astype(np.float32)

            if len(aug_audio) < MAX_SAMPLES:
                aug_audio = np.pad(aug_audio, (0, MAX_SAMPLES - len(aug_audio)))
            else:
                aug_audio = aug_audio[:MAX_SAMPLES]

            r = self.predict_accurate(aug_audio)
            all_probs.append(list(r.all_probabilities.values()))

        # Average all predictions
        avg_probs = np.mean(all_probs, axis=0)
        idx = int(avg_probs.argmax())

        return EmotionResult(
            emotion=self.labels[idx],
            confidence=float(avg_probs[idx]),
            all_probabilities={self.labels[i]: float(avg_probs[i]) for i in range(len(self.labels))},
        )


def _torch_available():
    try:
        import torch
        return True
    except ImportError:
        return False


# ── Quick self-test ──
if __name__ == "__main__":
    import time

    # Generate a test tone
    t = np.linspace(0, MAX_DURATION, MAX_SAMPLES, dtype=np.float32)
    test_audio = 0.5 * np.sin(2 * np.pi * 440 * t)

    predictor = EmotionPredictor(onnx_path="models/emotion_cnn.onnx")

    start = time.time()
    result = predictor.predict_fast(test_audio)
    elapsed = (time.time() - start) * 1000

    print(f"Prediction: {result.emotion} ({result.confidence:.2%})")
    print(f"Inference time: {elapsed:.1f}ms")
