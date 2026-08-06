"""Real-time facial signal analysis for the video layer."""
import threading
import urllib.request
from collections import Counter, deque
from pathlib import Path
from typing import Optional

import numpy as np

from config import settings

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_MODEL_DIR = _BACKEND_DIR / "models" / "mediapipe"

_FACE_LANDMARKER_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)
_HAND_LANDMARKER_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)

_face_landmarker = None
_hand_landmarker = None
_expression_model = None
_init_lock = threading.Lock()
_init_failed = False

_detect_lock = threading.Lock()

_engagement_failed = False


def _cached_model_path(url: str, filename: str) -> str:
    _MODEL_DIR.mkdir(parents=True, exist_ok=True)
    path = _MODEL_DIR / filename
    if not path.exists():
        print(f"[face] downloading {filename}...")
        urllib.request.urlretrieve(url, str(path))
    return str(path)


def _ensure_models() -> bool:
    """Load the landmarkers + expression model once."""
    global _face_landmarker, _hand_landmarker, _expression_model, _init_failed
    if _init_failed:
        return False
    if _face_landmarker is not None:
        return True
    with _init_lock:
        if _face_landmarker is not None:
            return True
        if _init_failed:
            return False
        try:
            import mediapipe as mp
            from mediapipe.tasks.python import vision
            from mediapipe.tasks.python.core.base_options import BaseOptions

            face_path = _cached_model_path(_FACE_LANDMARKER_URL, "face_landmarker.task")
            hand_path = _cached_model_path(_HAND_LANDMARKER_URL, "hand_landmarker.task")

            _face_landmarker = vision.FaceLandmarker.create_from_options(
                vision.FaceLandmarkerOptions(
                    base_options=BaseOptions(model_asset_path=face_path),
                    running_mode=vision.RunningMode.IMAGE,
                    num_faces=1,
                    min_face_detection_confidence=0.5,
                    min_face_presence_confidence=0.5,
                    min_tracking_confidence=0.5,
                )
            )
            _hand_landmarker = vision.HandLandmarker.create_from_options(
                vision.HandLandmarkerOptions(
                    base_options=BaseOptions(model_asset_path=hand_path),
                    running_mode=vision.RunningMode.IMAGE,
                    num_hands=2,
                    min_hand_detection_confidence=0.5,
                )
            )

            from emotiefflib.facial_analysis import EmotiEffLibRecognizer

            _expression_model = EmotiEffLibRecognizer(
                engine="onnx", model_name=settings.face_expression_model
            )
            print(
                f"[face] loaded FaceLandmarker + HandLandmarker + "
                f"EmotiEffLib ({settings.face_expression_model})"
            )
            return True
        except Exception as e:
            print(f"[face] disabled — could not load face analysis models: {e}")
            _init_failed = True
            return False


def warmup() -> None:
    """Best-effort preload (e.g."""
    if not settings.video_analysis_enabled:
        return
    try:
        _ensure_models()
    except Exception as e:
        print(f"[face] warmup error: {e}")


_LEFT_EYE_CORNERS = (33, 133)
_RIGHT_EYE_CORNERS = (362, 263)
_LEFT_EYE_VERT = (159, 145)
_RIGHT_EYE_VERT = (386, 374)
_LEFT_IRIS = 468
_RIGHT_IRIS = 473
_NOSE_TIP = 1

_FACE_CROP_MARGIN = 0.2
_HAND_TOUCH_MARGIN = 0.12
_EYE_CONTACT_THRESHOLD = 0.65


def _bbox_from_landmarks(landmarks, w: int, h: int, margin: float) -> tuple[int, int, int, int]:
    xs = [p.x for p in landmarks]
    ys = [p.y for p in landmarks]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    mx, my = (x1 - x0) * margin, (y1 - y0) * margin
    x0, x1 = max(0.0, x0 - mx), min(1.0, x1 + mx)
    y0, y1 = max(0.0, y0 - my), min(1.0, y1 + my)
    return int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)


def _gaze_ratio(landmarks) -> float:
    """Centeredness of gaze in [0, 1] — 1.0 means looking straight at the camera (roughly where the conversation partner appears on screen)."""

    def axis_ratio(iris_idx: int, corner_a: int, corner_b: int, coord: str) -> float:
        iris = getattr(landmarks[iris_idx], coord)
        a, b = getattr(landmarks[corner_a], coord), getattr(landmarks[corner_b], coord)
        lo, hi = min(a, b), max(a, b)
        if hi - lo < 1e-6:
            return 0.5
        return (iris - lo) / (hi - lo)

    h_l = axis_ratio(_LEFT_IRIS, *_LEFT_EYE_CORNERS, "x")
    h_r = axis_ratio(_RIGHT_IRIS, *_RIGHT_EYE_CORNERS, "x")
    v_l = axis_ratio(_LEFT_IRIS, *_LEFT_EYE_VERT, "y")
    v_r = axis_ratio(_RIGHT_IRIS, *_RIGHT_EYE_VERT, "y")

    h_center = (h_l + h_r) / 2
    v_center = (v_l + v_r) / 2
    dist = ((h_center - 0.5) ** 2 + (v_center - 0.5) ** 2) ** 0.5
    return max(0.0, 1.0 - dist / 0.5)


def _hand_near_face(hands_landmarks: list, bbox: tuple[int, int, int, int], w: int, h: int) -> bool:
    x0, y0, x1, y1 = bbox
    mx, my = (x1 - x0) * _HAND_TOUCH_MARGIN, (y1 - y0) * _HAND_TOUCH_MARGIN
    x0, y0, x1, y1 = x0 - mx, y0 - my, x1 + mx, y1 + my
    for hand in hands_landmarks:
        for p in hand:
            if x0 <= p.x * w <= x1 and y0 <= p.y * h <= y1:
                return True
    return False


class FaceAnalyzer:
    """Per-session analyzer: smoothing state only, shared models underneath."""

    EXPRESSION_BUFFER_LEN = 5
    _ENGAGEMENT_WINDOW = 128
    _FEATURE_BUFFER_LEN = _ENGAGEMENT_WINDOW + 1

    def __init__(self) -> None:
        self._expr_buffer: deque = deque(maxlen=self.EXPRESSION_BUFFER_LEN)
        self._feature_window: deque = deque(maxlen=self._FEATURE_BUFFER_LEN)
        self._frame_count = 0
        self._prev_nose_y: Optional[float] = None
        self._last_engagement: Optional[dict] = None
        self._every_n = max(1, settings.face_expression_every_n)

    def analyze_frame(self, frame_rgb: np.ndarray) -> Optional[dict]:
        """frame_rgb: HxWx3 uint8 RGB."""
        if not settings.video_analysis_enabled or not _ensure_models():
            return None

        import mediapipe as mp

        h, w = frame_rgb.shape[:2]
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)

        with _detect_lock:
            face_result = _face_landmarker.detect(mp_image)
            hand_result = _hand_landmarker.detect(mp_image)

        if not face_result.face_landmarks:
            return None
        landmarks = face_result.face_landmarks[0]

        bbox = _bbox_from_landmarks(landmarks, w, h, _FACE_CROP_MARGIN)
        gaze_ratio = _gaze_ratio(landmarks)

        nose_y = landmarks[_NOSE_TIP].y
        vertical_motion = 0.0 if self._prev_nose_y is None else nose_y - self._prev_nose_y
        self._prev_nose_y = nose_y

        self_touch = bool(hand_result.hand_landmarks) and _hand_near_face(
            hand_result.hand_landmarks, bbox, w, h
        )

        self._frame_count += 1
        if self._frame_count % self._every_n == 0:
            x0, y0, x1, y1 = bbox
            crop = frame_rgb[max(0, y0):y1, max(0, x0):x1]
            if crop.size > 0:
                self._run_expression(crop)

        label, confidence = self._smoothed_expression()

        return {
            "expression": {"label": label, "confidence": confidence},
            "eye_contact": {"ratio": round(gaze_ratio, 3), "bool": gaze_ratio >= _EYE_CONTACT_THRESHOLD},
            "self_touch": {"detected": self_touch},
            "head_motion": {"vertical_motion": round(vertical_motion, 4)},
            "engagement": self._last_engagement,
        }

    def _run_expression(self, face_crop_rgb: np.ndarray) -> None:
        try:
            features = _expression_model.extract_features(face_crop_rgb)
            labels, scores = _expression_model.classify_emotions(features, logits=False)
            self._expr_buffer.append((labels[0], float(np.max(scores[0]))))
            if settings.face_engagement_enabled:
                self._feature_window.append(features[0])
                self._maybe_update_engagement()
        except Exception as e:
            print(f"[face] expression inference failed: {e}")

    def _smoothed_expression(self) -> tuple[Optional[str], Optional[float]]:
        """Majority vote over the rolling buffer — never the raw per-frame label."""
        if not self._expr_buffer:
            return None, None
        majority, _ = Counter(label for label, _ in self._expr_buffer).most_common(1)[0]
        confidences = [c for label, c in self._expr_buffer if label == majority]
        return majority, round(sum(confidences) / len(confidences), 3)

    def _maybe_update_engagement(self) -> None:
        global _engagement_failed
        if _engagement_failed or len(self._feature_window) < self._FEATURE_BUFFER_LEN:
            return
        try:
            feats = np.stack(self._feature_window)
            labels, scores = _expression_model.classify_engagement(
                feats, sliding_window_width=self._ENGAGEMENT_WINDOW
            )
            self._last_engagement = {
                "label": labels[-1],
                "confidence": float(np.max(scores[-1])),
            }
        except Exception as e:
            print(f"[face] engagement disabled: {e}")
            _engagement_failed = True
