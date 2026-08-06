import os
import tempfile
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from faster_whisper import WhisperModel

from services.schemas import TranscribeOut
from routers.auth import get_current_user
from config import settings

router = APIRouter(prefix="/transcribe", tags=["transcribe"])

_model: WhisperModel | None = None
ALLOWED_TYPES = {
    "audio/webm",
    "audio/wav",
    "audio/ogg",
    "audio/mp4",
    "audio/mpeg",
}


def _get_model() -> WhisperModel:
    global _model
    if _model is None:
        _model = WhisperModel(
            settings.whisper_model,
            device=settings.whisper_device,
            compute_type=settings.whisper_compute_type,
        )
    return _model


def warmup() -> None:
    """Load Whisper at boot so the first spoken turn doesn't pay for it."""
    _get_model()


@router.post("/", response_model=TranscribeOut)
async def transcribe_audio(
    audio: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    if audio.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format: {audio.content_type}",
        )

    suffix = ".webm"
    if audio.filename and "." in audio.filename:
        suffix = "." + audio.filename.rsplit(".", 1)[-1]

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await audio.read())
        tmp_path = tmp.name

    try:
        model = _get_model()
        segments, _ = model.transcribe(tmp_path, beam_size=5)
        transcript = " ".join(seg.text.strip() for seg in segments)
    finally:
        os.unlink(tmp_path)

    return {"transcript": transcript}
