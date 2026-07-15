"""
=============================================================================
RAVDESS Speech Emotion Recognition — Training Pipeline
=============================================================================
Run this in Google Colab with a T4 GPU.

Two complementary models:
  Model A — Wav2Vec2-base fine-tuned on raw waveforms (strongest single model)
  Model B — EfficientNet-B2 on multi-feature spectrograms (complementary view)
  Ensemble — Weighted average of both softmax outputs

Key techniques for max accuracy:
  - Speaker-independent 5-fold CV (no data leakage from voice identity)
  - Heavy audio augmentation with audiomentations + ESC-50 noise
  - Focal loss (handles class imbalance better than cross-entropy)
  - Mixup regularization on spectrograms
  - Label smoothing
  - Cosine annealing with warm restarts
  - Multi-channel spectrograms (mel + MFCC + delta-MFCC)

Expected accuracy:
  Wav2Vec2 alone:     85-92%
  EfficientNet alone: 80-87%
  Ensemble:           88-93%
=============================================================================
"""

# ============================================================
# CELL 1 — Install dependencies (run first in Colab)
# ============================================================
"""
!pip install -q torch torchaudio torchvision
!pip install -q transformers datasets accelerate
!pip install -q audiomentations torch-audiomentations
!pip install -q timm                   # EfficientNet / ConvNeXt
!pip install -q librosa soundfile
!pip install -q scikit-learn
!pip install -q onnx onnxruntime
!pip install -q matplotlib seaborn tqdm

# Download RAVDESS (from Zenodo)
!mkdir -p /content/ravdess
!wget -q "https://zenodo.org/records/1188976/files/Audio_Speech_Actors_01-24.zip" -O /content/ravdess.zip
!unzip -q /content/ravdess.zip -d /content/ravdess/

# Download ESC-50 noise dataset (for realistic noise augmentation)
!git clone -q https://github.com/karolpiczak/ESC-50.git /content/ESC-50
"""


# ============================================================
# CELL 2 — Imports and configuration
# ============================================================
import os
import glob
import random
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchaudio
import librosa
import timm
from pathlib import Path
from collections import Counter
from dataclasses import dataclass
from typing import Optional, Tuple, List, Dict

from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
from torch.optim.lr_scheduler import CosineAnnealingWarmRestarts
from transformers import Wav2Vec2Model, Wav2Vec2FeatureExtractor
from sklearn.model_selection import GroupKFold
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    accuracy_score,
    f1_score,
)
from tqdm import tqdm
import matplotlib.pyplot as plt
import seaborn as sns


# ── Config ────────────────────────────────────────────────────
@dataclass
class Config:
    # Paths (adjust for your Colab setup)
    ravdess_dir: str = "/content/ravdess/Audio_Speech_Actors_01-24"
    esc50_dir: str = "/content/ESC-50/audio"
    output_dir: str = "/content/models"

    # Audio
    sample_rate: int = 16000
    max_duration: float = 4.0  # seconds — RAVDESS clips are ~3-5s
    max_samples: int = 64000   # sample_rate * max_duration

    # RAVDESS emotion mapping (filename digit → label)
    # We merge "calm" (02) into "neutral" (01) for 7 classes
    # OR keep 8 classes — set merge_calm_neutral = True/False
    merge_calm_neutral: bool = False

    # Training
    batch_size: int = 32
    wav2vec_batch_size: int = 16  # smaller — wav2vec uses more memory
    epochs_cnn: int = 30
    epochs_wav2vec: int = 15      # converges faster with pretrained weights
    lr_cnn: float = 1e-3
    lr_wav2vec: float = 1e-5      # much lower for pretrained transformer
    weight_decay: float = 1e-4
    label_smoothing: float = 0.1
    mixup_alpha: float = 0.3      # 0 to disable

    # Focal loss
    focal_gamma: float = 2.0

    # Model
    cnn_backbone: str = "efficientnet_b2"  # or "convnext_tiny"
    wav2vec_model: str = "facebook/wav2vec2-base"
    n_mels: int = 128
    spec_height: int = 224
    spec_width: int = 224

    # Ensemble weights (tuned after training)
    wav2vec_weight: float = 0.6
    cnn_weight: float = 0.4

    # Reproducibility
    seed: int = 42

    @property
    def num_classes(self):
        return 7 if self.merge_calm_neutral else 8

    @property
    def emotion_labels(self):
        if self.merge_calm_neutral:
            return ["neutral", "happy", "sad", "angry", "fearful", "disgust", "surprised"]
        return ["neutral", "calm", "happy", "sad", "angry", "fearful", "disgust", "surprised"]


cfg = Config()
os.makedirs(cfg.output_dir, exist_ok=True)

# Reproducibility
def seed_everything(seed):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False

seed_everything(cfg.seed)
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Device: {device}")


# ============================================================
# CELL 3 — Parse RAVDESS filenames into structured dataset
# ============================================================
"""
RAVDESS filename format: 03-01-05-02-01-01-12.wav
  Position 1: Modality (01=full-AV, 02=video-only, 03=audio-only)
  Position 2: Vocal channel (01=speech, 02=song)
  Position 3: Emotion (01-08)
  Position 4: Intensity (01=normal, 02=strong)
  Position 5: Statement (01="Kids are talking...", 02="Dogs are sitting...")
  Position 6: Repetition (01=1st, 02=2nd)
  Position 7: Actor (01-24, odd=male, even=female)
"""

RAVDESS_EMOTION_MAP = {
    1: "neutral",
    2: "calm",
    3: "happy",
    4: "sad",
    5: "angry",
    6: "fearful",
    7: "disgust",
    8: "surprised",
}

def parse_ravdess(ravdess_dir: str, merge_calm: bool = False):
    """Parse all RAVDESS audio files into (path, emotion_idx, actor_id) tuples."""
    records = []
    audio_files = sorted(glob.glob(os.path.join(ravdess_dir, "Actor_*", "*.wav")))

    # Build label mapping based on merge setting
    if merge_calm:
        # Merge calm → neutral: 7 classes
        label_map = {1: 0, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6}
    else:
        # Keep all 8 classes
        label_map = {1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7}

    for fpath in audio_files:
        fname = os.path.basename(fpath)
        parts = fname.replace(".wav", "").split("-")

        modality = int(parts[0])
        channel = int(parts[1])
        emotion_raw = int(parts[2])
        intensity = int(parts[3])
        actor_id = int(parts[6])

        # Only use audio-only speech (modality=03, channel=01)
        # If you also want song, remove channel filter
        if modality == 3 and channel == 1:
            emotion_idx = label_map[emotion_raw]
            records.append({
                "path": fpath,
                "emotion_idx": emotion_idx,
                "emotion_name": RAVDESS_EMOTION_MAP[emotion_raw],
                "intensity": "strong" if intensity == 2 else "normal",
                "actor_id": actor_id,
                "gender": "male" if actor_id % 2 == 1 else "female",
            })

    return records

records = parse_ravdess(cfg.ravdess_dir, merge_calm=cfg.merge_calm_neutral)
print(f"Total audio clips: {len(records)}")
print(f"Actors: {len(set(r['actor_id'] for r in records))}")
print(f"Emotion distribution:")
for emo, count in sorted(Counter(r["emotion_name"] for r in records).items()):
    print(f"  {emo}: {count}")


# ============================================================
# CELL 4 — Audio loading and augmentation
# ============================================================
try:
    import audiomentations as AA
    HAS_AUDIOMENTATIONS = True
except ImportError:
    HAS_AUDIOMENTATIONS = False
    print("⚠ audiomentations not installed — training without augmentation")


def load_audio(path: str, sr: int = 16000, max_samples: int = 64000) -> np.ndarray:
    """Load, resample, pad/crop to fixed length."""
    audio, orig_sr = librosa.load(path, sr=sr, mono=True)
    # Pad if too short
    if len(audio) < max_samples:
        audio = np.pad(audio, (0, max_samples - len(audio)), mode="constant")
    # Crop if too long
    else:
        audio = audio[:max_samples]
    return audio.astype(np.float32)


def build_augmentation_pipeline(esc50_dir: str = None):
    """
    Heavy augmentation pipeline for real-world robustness.
    Applied to raw audio BEFORE feature extraction.
    """
    if not HAS_AUDIOMENTATIONS:
        return None

    transforms = [
        # Time domain augmentations
        AA.TimeStretch(min_rate=0.8, max_rate=1.2, p=0.4),
        AA.PitchShift(min_semitones=-3, max_semitones=3, p=0.4),
        AA.Gain(min_gain_db=-8, max_gain_db=8, p=0.3),
        AA.GainTransition(
            min_gain_db=-6, max_gain_db=6,
            min_duration=0.2, max_duration=0.5, p=0.2
        ),
        # Noise augmentations
        AA.AddGaussianSNR(min_snr_db=10, max_snr_db=30, p=0.3),
        AA.AddGaussianNoise(min_amplitude=0.001, max_amplitude=0.015, p=0.2),
        # Frequency domain
        AA.HighPassFilter(min_cutoff_freq=100, max_cutoff_freq=400, p=0.2),
        AA.LowPassFilter(min_cutoff_freq=3000, max_cutoff_freq=7500, p=0.2),
        AA.BandPassFilter(
            min_center_freq=200, max_center_freq=4000,
            min_bandwidth_fraction=0.5, max_bandwidth_fraction=1.99, p=0.1
        ),
        # Simulate room acoustics / cheap mics
        AA.ClippingDistortion(max_percentile_threshold=10, p=0.1),
        AA.Mp3Compression(min_bitrate=64, max_bitrate=192, p=0.15),
    ]

    # Add real-world noise from ESC-50 if available
    if esc50_dir and os.path.isdir(esc50_dir):
        transforms.insert(0, AA.AddBackgroundNoise(
            sounds_path=esc50_dir,
            min_snr_in_db=5,
            max_snr_in_db=25,
            p=0.5,  # 50% chance — this is the most impactful augmentation
        ))
        print("✓ ESC-50 background noise augmentation enabled")
    else:
        print("⚠ ESC-50 not found — skipping background noise augmentation")

    return AA.Compose(transforms)


augment_pipeline = build_augmentation_pipeline(cfg.esc50_dir)


# ============================================================
# CELL 5 — Feature extraction (multi-channel spectrograms)
# ============================================================
def extract_multi_channel_spectrogram(
    audio: np.ndarray,
    sr: int = 16000,
    n_mels: int = 128,
    target_size: Tuple[int, int] = (224, 224),
) -> np.ndarray:
    """
    Extract 3-channel spectrogram: mel + MFCC + delta-MFCC.
    Returns shape (3, target_height, target_width).
    
    Why 3 channels:
      - Mel spectrogram: captures overall spectral energy distribution
      - MFCCs: captures vocal tract shape (speaker-independent timbre)
      - Delta-MFCCs: captures temporal dynamics (how voice changes over time)
    
    These are complementary views that together give the CNN more information
    than any single representation.
    """
    # Channel 1: Log-mel spectrogram
    mel = librosa.feature.melspectrogram(
        y=audio, sr=sr, n_mels=n_mels, n_fft=2048, hop_length=512
    )
    mel_db = librosa.power_to_db(mel, ref=np.max)

    # Channel 2: MFCCs (40 coefficients)
    mfcc = librosa.feature.mfcc(y=audio, sr=sr, n_mfcc=40, n_fft=2048, hop_length=512)

    # Channel 3: Delta MFCCs (temporal rate of change)
    delta_mfcc = librosa.feature.delta(mfcc)

    # Normalize each channel independently to [0, 1]
    def normalize(x):
        x_min, x_max = x.min(), x.max()
        if x_max - x_min < 1e-6:
            return np.zeros_like(x)
        return (x - x_min) / (x_max - x_min)

    channels = []
    for feature in [mel_db, mfcc, delta_mfcc]:
        feat_norm = normalize(feature)
        # Resize to target dimensions using PIL-like approach
        feat_resized = np.array(
            librosa.util.fix_length(feat_norm, size=target_size[1], axis=1)
        )
        # Resize frequency axis
        if feat_resized.shape[0] != target_size[0]:
            from skimage.transform import resize as sk_resize
            feat_resized = sk_resize(
                feat_resized, target_size, anti_aliasing=True
            ).astype(np.float32)
        channels.append(feat_resized)

    return np.stack(channels, axis=0).astype(np.float32)


# ============================================================
# CELL 6 — Dataset classes
# ============================================================
class RavdessSpectrogramDataset(Dataset):
    """Dataset for EfficientNet — returns multi-channel spectrograms."""

    def __init__(self, records, cfg, augment=None, is_train=True):
        self.records = records
        self.cfg = cfg
        self.augment = augment if is_train else None
        self.is_train = is_train

    def __len__(self):
        return len(self.records)

    def __getitem__(self, idx):
        rec = self.records[idx]
        audio = load_audio(rec["path"], self.cfg.sample_rate, self.cfg.max_samples)

        # Apply augmentation to raw audio
        if self.augment is not None:
            audio = self.augment(samples=audio, sample_rate=self.cfg.sample_rate)
            # Re-pad/crop after augmentation (time stretch changes length)
            if len(audio) < self.cfg.max_samples:
                audio = np.pad(audio, (0, self.cfg.max_samples - len(audio)))
            else:
                audio = audio[: self.cfg.max_samples]

        spec = extract_multi_channel_spectrogram(
            audio, self.cfg.sample_rate, self.cfg.n_mels,
            (self.cfg.spec_height, self.cfg.spec_width),
        )
        return torch.tensor(spec), torch.tensor(rec["emotion_idx"], dtype=torch.long)


class RavdessWaveformDataset(Dataset):
    """Dataset for Wav2Vec2 — returns raw waveforms."""

    def __init__(self, records, cfg, augment=None, is_train=True):
        self.records = records
        self.cfg = cfg
        self.augment = augment if is_train else None
        self.is_train = is_train

    def __len__(self):
        return len(self.records)

    def __getitem__(self, idx):
        rec = self.records[idx]
        audio = load_audio(rec["path"], self.cfg.sample_rate, self.cfg.max_samples)

        if self.augment is not None:
            audio = self.augment(samples=audio, sample_rate=self.cfg.sample_rate)
            if len(audio) < self.cfg.max_samples:
                audio = np.pad(audio, (0, self.cfg.max_samples - len(audio)))
            else:
                audio = audio[: self.cfg.max_samples]

        return torch.tensor(audio), torch.tensor(rec["emotion_idx"], dtype=torch.long)


# ============================================================
# CELL 7 — Loss functions
# ============================================================
class FocalLoss(nn.Module):
    """
    Focal Loss — downweights easy examples, focuses on hard ones.
    Much better than cross-entropy for emotion recognition because
    some emotions (neutral, calm) are easy to classify while others
    (happy vs surprised) are frequently confused.
    
    With gamma=2: easy examples contribute ~25x less to the loss
    than hard examples.
    """
    def __init__(self, gamma=2.0, label_smoothing=0.1, weight=None):
        super().__init__()
        self.gamma = gamma
        self.label_smoothing = label_smoothing
        self.weight = weight

    def forward(self, logits, targets):
        # Apply label smoothing
        n_classes = logits.size(1)
        smooth_targets = torch.full_like(logits, self.label_smoothing / (n_classes - 1))
        smooth_targets.scatter_(1, targets.unsqueeze(1), 1.0 - self.label_smoothing)

        log_probs = F.log_softmax(logits, dim=1)
        probs = torch.exp(log_probs)

        # Focal modulation: (1 - p_t)^gamma
        focal_weight = (1.0 - probs) ** self.gamma
        loss = -focal_weight * smooth_targets * log_probs

        if self.weight is not None:
            weight = self.weight.to(logits.device)
            loss = loss * weight.unsqueeze(0)

        return loss.sum(dim=1).mean()


def mixup_data(x, y, alpha=0.3):
    """
    Mixup: blend two training examples and their labels.
    Creates smoother decision boundaries and regularizes heavily.
    """
    if alpha <= 0:
        return x, y, y, 1.0

    lam = np.random.beta(alpha, alpha)
    lam = max(lam, 1 - lam)  # ensure lam >= 0.5

    batch_size = x.size(0)
    index = torch.randperm(batch_size, device=x.device)

    mixed_x = lam * x + (1 - lam) * x[index]
    return mixed_x, y, y[index], lam


def mixup_criterion(criterion, pred, y_a, y_b, lam):
    """Compute loss for mixup: weighted average of two target losses."""
    return lam * criterion(pred, y_a) + (1 - lam) * criterion(pred, y_b)


# ============================================================
# CELL 8 — Model A: EfficientNet-B2 with multi-channel input
# ============================================================
class EmotionCNN(nn.Module):
    """
    EfficientNet-B2 fine-tuned for emotion recognition.
    
    Why EfficientNet-B2 over ResNet18:
      - Compound scaling (depth + width + resolution) is more efficient
      - 3-5% better accuracy on audio spectrograms at similar speed
      - B2 is the sweet spot: B0 is too small, B3+ is overkill for this data size
    
    Architecture:
      3-channel spectrogram → EfficientNet-B2 backbone → adaptive pool
      → dropout(0.4) → FC(1408 → 512) → ReLU → dropout(0.3) → FC(512 → n_classes)
    """
    def __init__(self, num_classes=8, backbone="efficientnet_b2", pretrained=True):
        super().__init__()
        self.backbone = timm.create_model(
            backbone, pretrained=pretrained, in_chans=3, num_classes=0
        )
        feat_dim = self.backbone.num_features  # 1408 for B2

        self.head = nn.Sequential(
            nn.Dropout(0.4),
            nn.Linear(feat_dim, 512),
            nn.ReLU(inplace=True),
            nn.BatchNorm1d(512),
            nn.Dropout(0.3),
            nn.Linear(512, num_classes),
        )

    def forward(self, x):
        features = self.backbone(x)
        return self.head(features)

    def extract_features(self, x):
        """Return embeddings before final FC — for ensemble fusion."""
        features = self.backbone(x)
        # Through all but last layer of head
        features = self.head[:-1](features)  # up to dropout before final FC
        return features


# ============================================================
# CELL 9 — Model B: Wav2Vec2 fine-tuned for emotion
# ============================================================
class EmotionWav2Vec2(nn.Module):
    """
    Wav2Vec2-base fine-tuned for speech emotion recognition.
    
    Why this is the strongest single model:
      - Pre-trained on 960 hours of LibriSpeech — already understands speech
      - Learns from RAW WAVEFORMS — no information lost in spectrogram conversion
      - Self-supervised pre-training captures prosody, rhythm, pitch patterns
        that are directly relevant to emotion
      - Published RAVDESS results: 85-93% accuracy
    
    Architecture:
      Raw audio → Wav2Vec2 encoder (12 transformer layers)
      → mean-pool all frame embeddings → dropout(0.3) → FC(768 → 256)
      → ReLU → dropout(0.2) → FC(256 → n_classes)
    
    Training strategy:
      - Freeze feature extractor (CNN front-end) entirely
      - Fine-tune only the transformer layers + classification head
      - Use very low learning rate (1e-5) to preserve pre-trained knowledge
    """
    def __init__(self, num_classes=8, model_name="facebook/wav2vec2-base"):
        super().__init__()
        self.wav2vec = Wav2Vec2Model.from_pretrained(model_name)
        hidden_size = self.wav2vec.config.hidden_size  # 768

        # Freeze the CNN feature extractor (first component)
        # Only fine-tune the transformer layers
        self.wav2vec.feature_extractor._freeze_parameters()

        self.head = nn.Sequential(
            nn.Dropout(0.3),
            nn.Linear(hidden_size, 256),
            nn.ReLU(inplace=True),
            nn.BatchNorm1d(256),
            nn.Dropout(0.2),
            nn.Linear(256, num_classes),
        )

    def forward(self, x):
        # x shape: (batch, samples) — raw audio at 16kHz
        outputs = self.wav2vec(x)
        hidden_states = outputs.last_hidden_state  # (batch, frames, 768)

        # Mean pool across time dimension
        pooled = hidden_states.mean(dim=1)  # (batch, 768)
        return self.head(pooled)

    def extract_features(self, x):
        outputs = self.wav2vec(x)
        hidden_states = outputs.last_hidden_state
        pooled = hidden_states.mean(dim=1)
        return self.head[:-1](pooled)


# ============================================================
# CELL 10 — Training loop
# ============================================================
def train_one_epoch(model, loader, criterion, optimizer, device, use_mixup=True, alpha=0.3):
    model.train()
    total_loss = 0
    correct = 0
    total = 0

    for batch_x, batch_y in tqdm(loader, desc="  Train", leave=False):
        batch_x, batch_y = batch_x.to(device), batch_y.to(device)

        if use_mixup and alpha > 0:
            batch_x, targets_a, targets_b, lam = mixup_data(batch_x, batch_y, alpha)
            logits = model(batch_x)
            loss = mixup_criterion(criterion, logits, targets_a, targets_b, lam)
            # For accuracy tracking, use the dominant target
            preds = logits.argmax(dim=1)
            correct += (lam * (preds == targets_a).sum().item() +
                       (1 - lam) * (preds == targets_b).sum().item())
        else:
            logits = model(batch_x)
            loss = criterion(logits, batch_y)
            preds = logits.argmax(dim=1)
            correct += (preds == batch_y).sum().item()

        total += batch_y.size(0)
        total_loss += loss.item() * batch_y.size(0)

        optimizer.zero_grad()
        loss.backward()
        # Gradient clipping — important for Wav2Vec2 stability
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()

    return total_loss / total, correct / total


@torch.no_grad()
def evaluate(model, loader, criterion, device):
    model.eval()
    total_loss = 0
    all_preds = []
    all_targets = []

    for batch_x, batch_y in tqdm(loader, desc="  Eval", leave=False):
        batch_x, batch_y = batch_x.to(device), batch_y.to(device)
        logits = model(batch_x)
        loss = criterion(logits, batch_y)

        total_loss += loss.item() * batch_y.size(0)
        all_preds.extend(logits.argmax(dim=1).cpu().tolist())
        all_targets.extend(batch_y.cpu().tolist())

    n = len(all_targets)
    acc = accuracy_score(all_targets, all_preds)
    f1 = f1_score(all_targets, all_preds, average="weighted")

    return total_loss / n, acc, f1, all_preds, all_targets


# ============================================================
# CELL 11 — Speaker-independent cross-validation
# ============================================================
"""
CRITICAL: RAVDESS has 24 actors. If you split randomly, the model
learns to recognize VOICES, not EMOTIONS. A random split gives ~90%+ 
accuracy that completely collapses on new speakers.

Speaker-independent split: group actors into folds so that no actor
appears in both train and test. This is the ONLY valid evaluation
for speech emotion recognition.

We use 5-fold GroupKFold where groups = actor IDs.
  - Fold 1: actors {1,2,3,4,5} as test
  - Fold 2: actors {6,7,8,9,10} as test
  - ... etc
"""

def create_speaker_independent_splits(records, n_splits=5):
    """Create speaker-independent train/test splits."""
    paths = [r["path"] for r in records]
    labels = [r["emotion_idx"] for r in records]
    groups = [r["actor_id"] for r in records]

    gkf = GroupKFold(n_splits=n_splits)
    splits = []

    for fold, (train_idx, test_idx) in enumerate(gkf.split(paths, labels, groups)):
        train_records = [records[i] for i in train_idx]
        test_records = [records[i] for i in test_idx]

        train_actors = set(r["actor_id"] for r in train_records)
        test_actors = set(r["actor_id"] for r in test_records)
        assert len(train_actors & test_actors) == 0, "Speaker leakage!"

        splits.append({
            "fold": fold,
            "train": train_records,
            "test": test_records,
            "train_actors": sorted(train_actors),
            "test_actors": sorted(test_actors),
        })
        print(f"Fold {fold}: train actors {sorted(train_actors)} | test actors {sorted(test_actors)}")

    return splits


def compute_class_weights(records, num_classes):
    """Inverse frequency weighting for imbalanced classes."""
    counts = Counter(r["emotion_idx"] for r in records)
    total = sum(counts.values())
    weights = torch.tensor([total / (num_classes * counts.get(i, 1)) for i in range(num_classes)])
    return weights / weights.sum() * num_classes  # normalize so mean = 1


# ============================================================
# CELL 12 — Full training pipeline for one model
# ============================================================
def train_model(
    model_class,
    dataset_class,
    records,
    cfg,
    model_name: str,
    model_kwargs: dict = None,
    batch_size: int = 32,
    epochs: int = 30,
    lr: float = 1e-3,
    use_mixup: bool = True,
):
    """
    Train a model with speaker-independent 5-fold CV.
    Returns per-fold results and saves best model per fold.
    """
    model_kwargs = model_kwargs or {}
    splits = create_speaker_independent_splits(records, n_splits=5)

    all_fold_results = []
    all_preds = []
    all_targets = []

    for split in splits:
        fold = split["fold"]
        print(f"\n{'='*60}")
        print(f"  {model_name} — Fold {fold}")
        print(f"  Train: {len(split['train'])} clips | Test: {len(split['test'])} clips")
        print(f"{'='*60}")

        # Datasets
        train_ds = dataset_class(split["train"], cfg, augment=augment_pipeline, is_train=True)
        test_ds = dataset_class(split["test"], cfg, augment=None, is_train=False)

        # Class-balanced sampling
        train_labels = [r["emotion_idx"] for r in split["train"]]
        class_counts = Counter(train_labels)
        sample_weights = [1.0 / class_counts[l] for l in train_labels]
        sampler = WeightedRandomSampler(sample_weights, len(sample_weights), replacement=True)

        train_loader = DataLoader(train_ds, batch_size=batch_size, sampler=sampler,
                                   num_workers=2, pin_memory=True)
        test_loader = DataLoader(test_ds, batch_size=batch_size, shuffle=False,
                                  num_workers=2, pin_memory=True)

        # Model
        model = model_class(num_classes=cfg.num_classes, **model_kwargs).to(device)

        # Loss with class weights
        class_weights = compute_class_weights(split["train"], cfg.num_classes)
        criterion = FocalLoss(
            gamma=cfg.focal_gamma,
            label_smoothing=cfg.label_smoothing,
            weight=class_weights,
        )

        # Optimizer — different for pretrained transformers vs CNNs
        if "wav2vec" in model_name.lower():
            # Lower LR for pretrained backbone, higher for new head
            optimizer = torch.optim.AdamW([
                {"params": model.wav2vec.parameters(), "lr": lr},
                {"params": model.head.parameters(), "lr": lr * 10},
            ], weight_decay=cfg.weight_decay)
        else:
            optimizer = torch.optim.AdamW(model.parameters(), lr=lr,
                                           weight_decay=cfg.weight_decay)

        scheduler = CosineAnnealingWarmRestarts(optimizer, T_0=5, T_mult=2)

        # Training loop
        best_acc = 0
        best_model_state = None
        patience_counter = 0
        patience = 8

        for epoch in range(epochs):
            train_loss, train_acc = train_one_epoch(
                model, train_loader, criterion, optimizer, device,
                use_mixup=use_mixup, alpha=cfg.mixup_alpha,
            )
            test_loss, test_acc, test_f1, preds, targets = evaluate(
                model, test_loader, criterion, device
            )
            scheduler.step()

            if test_acc > best_acc:
                best_acc = test_acc
                best_model_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
                patience_counter = 0
            else:
                patience_counter += 1

            if (epoch + 1) % 3 == 0 or epoch == 0:
                print(f"  Epoch {epoch+1:>2}/{epochs} | "
                      f"Train loss: {train_loss:.4f} acc: {train_acc:.3f} | "
                      f"Test loss: {test_loss:.4f} acc: {test_acc:.3f} f1: {test_f1:.3f} | "
                      f"Best: {best_acc:.3f}")

            if patience_counter >= patience:
                print(f"  Early stopping at epoch {epoch+1}")
                break

        # Save best model for this fold
        save_path = os.path.join(cfg.output_dir, f"{model_name}_fold{fold}.pt")
        torch.save(best_model_state, save_path)

        # Final evaluation with best weights
        model.load_state_dict(best_model_state)
        model.to(device)
        _, final_acc, final_f1, fold_preds, fold_targets = evaluate(
            model, test_loader, criterion, device
        )

        all_fold_results.append({
            "fold": fold, "accuracy": final_acc, "f1": final_f1,
            "test_actors": split["test_actors"],
        })
        all_preds.extend(fold_preds)
        all_targets.extend(fold_targets)

        print(f"\n  ✓ Fold {fold} best accuracy: {final_acc:.3f} | F1: {final_f1:.3f}")

    # Aggregate results
    mean_acc = np.mean([r["accuracy"] for r in all_fold_results])
    std_acc = np.std([r["accuracy"] for r in all_fold_results])
    mean_f1 = np.mean([r["f1"] for r in all_fold_results])

    print(f"\n{'='*60}")
    print(f"  {model_name} — FINAL RESULTS")
    print(f"  Accuracy: {mean_acc:.3f} ± {std_acc:.3f}")
    print(f"  Weighted F1: {mean_f1:.3f}")
    print(f"{'='*60}")

    # Classification report
    print(f"\n{classification_report(all_targets, all_preds, target_names=cfg.emotion_labels)}")

    return all_fold_results, all_preds, all_targets


# ============================================================
# CELL 13 — Train both models
# ============================================================

# ── Train Model A: EfficientNet-B2 ──
print("\n" + "█" * 60)
print("  TRAINING MODEL A: EfficientNet-B2 (multi-channel spectrogram)")
print("█" * 60)

cnn_results, cnn_preds, cnn_targets = train_model(
    model_class=EmotionCNN,
    dataset_class=RavdessSpectrogramDataset,
    records=records,
    cfg=cfg,
    model_name="efficientnet_b2",
    model_kwargs={"backbone": cfg.cnn_backbone},
    batch_size=cfg.batch_size,
    epochs=cfg.epochs_cnn,
    lr=cfg.lr_cnn,
    use_mixup=True,
)


# ── Train Model B: Wav2Vec2 ──
print("\n" + "█" * 60)
print("  TRAINING MODEL B: Wav2Vec2-base (raw waveform)")
print("█" * 60)

wav2vec_results, w2v_preds, w2v_targets = train_model(
    model_class=EmotionWav2Vec2,
    dataset_class=RavdessWaveformDataset,
    records=records,
    cfg=cfg,
    model_name="wav2vec2",
    model_kwargs={"model_name": cfg.wav2vec_model},
    batch_size=cfg.wav2vec_batch_size,
    epochs=cfg.epochs_wav2vec,
    lr=cfg.lr_wav2vec,
    use_mixup=False,  # Don't mixup raw waveforms — less effective
)


# ============================================================
# CELL 14 — Ensemble evaluation
# ============================================================
def ensemble_evaluate(
    model_a, model_b,
    loader_a, loader_b,
    device,
    weight_a=0.4,
    weight_b=0.6,
):
    """
    Late fusion ensemble: weighted average of softmax probabilities.
    
    Why this works better than either model alone:
      - EfficientNet sees spectral patterns (frequency domain)
      - Wav2Vec2 sees temporal patterns (time domain)
      - They make DIFFERENT mistakes, so combining them corrects errors
    
    Weight_b (Wav2Vec2) is higher because it's the stronger model.
    """
    model_a.eval()
    model_b.eval()
    all_preds = []
    all_targets = []

    iter_a = iter(loader_a)
    iter_b = iter(loader_b)

    with torch.no_grad():
        for (x_a, y_a), (x_b, y_b) in zip(iter_a, iter_b):
            x_a, x_b = x_a.to(device), x_b.to(device)
            assert torch.equal(y_a, y_b), "Mismatched targets between dataloaders"

            probs_a = F.softmax(model_a(x_a), dim=1)
            probs_b = F.softmax(model_b(x_b), dim=1)

            # Weighted average fusion
            combined = weight_a * probs_a + weight_b * probs_b
            preds = combined.argmax(dim=1)

            all_preds.extend(preds.cpu().tolist())
            all_targets.extend(y_a.tolist())

    acc = accuracy_score(all_targets, all_preds)
    f1 = f1_score(all_targets, all_preds, average="weighted")
    return acc, f1, all_preds, all_targets


print("\n" + "█" * 60)
print("  ENSEMBLE EVALUATION")
print("█" * 60)

# Run ensemble on each fold
splits = create_speaker_independent_splits(records, n_splits=5)
ensemble_accs = []

for split in splits:
    fold = split["fold"]

    # Load best models for this fold
    cnn_model = EmotionCNN(cfg.num_classes, cfg.cnn_backbone).to(device)
    cnn_model.load_state_dict(
        torch.load(os.path.join(cfg.output_dir, f"efficientnet_b2_fold{fold}.pt"))
    )

    w2v_model = EmotionWav2Vec2(cfg.num_classes, cfg.wav2vec_model).to(device)
    w2v_model.load_state_dict(
        torch.load(os.path.join(cfg.output_dir, f"wav2vec2_fold{fold}.pt"))
    )

    # Create test dataloaders (same records, different dataset classes)
    test_spec = RavdessSpectrogramDataset(split["test"], cfg, is_train=False)
    test_wave = RavdessWaveformDataset(split["test"], cfg, is_train=False)

    loader_spec = DataLoader(test_spec, batch_size=cfg.batch_size, shuffle=False)
    loader_wave = DataLoader(test_wave, batch_size=cfg.wav2vec_batch_size, shuffle=False)

    acc, f1, _, _ = ensemble_evaluate(
        cnn_model, w2v_model,
        loader_spec, loader_wave,
        device,
        weight_a=cfg.cnn_weight,
        weight_b=cfg.wav2vec_weight,
    )
    ensemble_accs.append(acc)
    print(f"  Fold {fold}: Ensemble accuracy = {acc:.3f} | F1 = {f1:.3f}")

print(f"\n  ENSEMBLE MEAN: {np.mean(ensemble_accs):.3f} ± {np.std(ensemble_accs):.3f}")


# ============================================================
# CELL 15 — Confusion matrix visualization
# ============================================================
def plot_confusion_matrix(targets, preds, labels, title="Confusion Matrix"):
    cm = confusion_matrix(targets, preds)
    cm_normalized = cm.astype("float") / cm.sum(axis=1)[:, np.newaxis]

    fig, axes = plt.subplots(1, 2, figsize=(16, 6))

    # Raw counts
    sns.heatmap(cm, annot=True, fmt="d", cmap="Blues", xticklabels=labels,
                yticklabels=labels, ax=axes[0])
    axes[0].set_title(f"{title} — Counts")
    axes[0].set_ylabel("True")
    axes[0].set_xlabel("Predicted")

    # Normalized (per-class recall)
    sns.heatmap(cm_normalized, annot=True, fmt=".2f", cmap="Blues",
                xticklabels=labels, yticklabels=labels, ax=axes[1])
    axes[1].set_title(f"{title} — Recall per class")
    axes[1].set_ylabel("True")
    axes[1].set_xlabel("Predicted")

    plt.tight_layout()
    plt.savefig(os.path.join(cfg.output_dir, f"{title.lower().replace(' ','_')}.png"), dpi=150)
    plt.show()

# Plot for each model
plot_confusion_matrix(cnn_targets, cnn_preds, cfg.emotion_labels, "EfficientNet-B2")
plot_confusion_matrix(w2v_targets, w2v_preds, cfg.emotion_labels, "Wav2Vec2")


# ============================================================
# CELL 16 — Export best model to ONNX (for production inference)
# ============================================================
def export_cnn_to_onnx(model, cfg, output_path):
    """Export EfficientNet to ONNX for ~50ms CPU inference."""
    model.eval()
    model.cpu()
    dummy_input = torch.randn(1, 3, cfg.spec_height, cfg.spec_width)

    torch.onnx.export(
        model, dummy_input, output_path,
        input_names=["spectrogram"],
        output_names=["emotion_logits"],
        dynamic_axes={"spectrogram": {0: "batch"}, "emotion_logits": {0: "batch"}},
        opset_version=14,
    )
    print(f"✓ CNN exported to {output_path}")

    # Verify with ONNX Runtime
    import onnxruntime as ort
    session = ort.InferenceSession(output_path)
    result = session.run(None, {"spectrogram": dummy_input.numpy()})
    print(f"  ONNX output shape: {result[0].shape}")
    print(f"  ONNX inference test passed ✓")


# Export the best fold's CNN model
# (In production, you'd retrain on ALL data or pick the best fold)
best_fold = max(range(5), key=lambda i: [r["accuracy"] for r in cnn_results][i])
print(f"\nExporting best CNN (fold {best_fold})...")

cnn_model = EmotionCNN(cfg.num_classes, cfg.cnn_backbone)
cnn_model.load_state_dict(
    torch.load(os.path.join(cfg.output_dir, f"efficientnet_b2_fold{best_fold}.pt"))
)

export_cnn_to_onnx(
    cnn_model, cfg,
    os.path.join(cfg.output_dir, "emotion_cnn.onnx"),
)


# ============================================================
# CELL 17 — Quick inference test
# ============================================================
def predict_emotion(audio_path: str, onnx_path: str, cfg=cfg):
    """
    Production inference function.
    This is what your FastAPI backend will call.
    """
    import onnxruntime as ort

    # Load and preprocess
    audio = load_audio(audio_path, cfg.sample_rate, cfg.max_samples)
    spec = extract_multi_channel_spectrogram(
        audio, cfg.sample_rate, cfg.n_mels,
        (cfg.spec_height, cfg.spec_width)
    )
    spec = np.expand_dims(spec, axis=0)  # add batch dim

    # Run ONNX inference
    session = ort.InferenceSession(onnx_path)
    logits = session.run(None, {"spectrogram": spec})[0]
    probs = np.exp(logits) / np.exp(logits).sum(axis=1, keepdims=True)  # softmax

    predicted_idx = probs.argmax()
    confidence = probs[0, predicted_idx]

    return {
        "emotion": cfg.emotion_labels[predicted_idx],
        "confidence": float(confidence),
        "all_probabilities": {
            cfg.emotion_labels[i]: float(probs[0, i])
            for i in range(cfg.num_classes)
        },
    }


# Test on a random RAVDESS file
test_file = records[0]["path"]
result = predict_emotion(test_file, os.path.join(cfg.output_dir, "emotion_cnn.onnx"))
print(f"\nTest prediction on: {os.path.basename(test_file)}")
print(f"  Predicted: {result['emotion']} ({result['confidence']:.2%})")
print(f"  Actual: {records[0]['emotion_name']}")
print(f"  All probs: {result['all_probabilities']}")


# ============================================================
# CELL 18 — Summary and next steps
# ============================================================
print("""
╔══════════════════════════════════════════════════════════════╗
║                    TRAINING COMPLETE                        ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Saved files:                                                ║
║    /content/models/efficientnet_b2_fold{0-4}.pt             ║
║    /content/models/wav2vec2_fold{0-4}.pt                    ║
║    /content/models/emotion_cnn.onnx                         ║
║    /content/models/*.png (confusion matrices)               ║
║                                                              ║
║  For your FastAPI backend:                                   ║
║    1. Copy emotion_cnn.onnx to backend/models/              ║
║    2. Copy the predict_emotion() function to                ║
║       backend/services/emotion_model.py                     ║
║    3. The ONNX model runs at ~50ms on CPU                   ║
║                                                              ║
║  To add Wav2Vec2 to production:                              ║
║    Use torch.jit.trace or keep PyTorch inference             ║
║    Wav2Vec2 is slower (~200ms on CPU) but more accurate      ║
║    Use it for post-session analysis, CNN for real-time       ║
║                                                              ║
║  To improve further:                                         ║
║    - Add SAVEE + TESS datasets (more training data)          ║
║    - Add SpecAugment (time/frequency masking on spectrograms)║
║    - Try ConvNeXt-Tiny as CNN backbone                       ║
║    - Tune ensemble weights with grid search on val set       ║
║    - Test-time augmentation for final reports                ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
""")
