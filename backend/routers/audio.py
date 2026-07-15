import os
import uuid
import tempfile
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional

from routers.auth import get_current_user

router = APIRouter(prefix="/audio", tags=["audio"])

AUDIO_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

ALLOWED_TYPES = {
    "audio/webm",
    "audio/wav",
    "audio/ogg",
    "audio/mp4",
    "audio/mpeg",
}


class AudioUploadOut(BaseModel):
    audio_url: str
    duration: Optional[float] = None


@router.post("/upload", response_model=AudioUploadOut)
async def upload_audio(
    audio: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    if audio.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format: {audio.content_type}",
        )

    # Determine extension
    ext = ".webm"
    if audio.filename and "." in audio.filename:
        orig_ext = audio.filename.rsplit(".", 1)[-1].lower()
        if orig_ext in ("webm", "wav", "ogg", "mp3", "mp4", "m4a"):
            ext = f".{orig_ext}"

    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(AUDIO_DIR, filename)

    content = await audio.read()
    with open(filepath, "wb") as f:
        f.write(content)

    # Try to get duration using ffprobe if available (optional)
    duration = None
    try:
        import subprocess
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", filepath],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            duration = round(float(result.stdout.strip()), 1)
    except Exception:
        pass

    return AudioUploadOut(
        audio_url=f"/audio/{filename}",
        duration=duration,
    )


@router.get("/{filename}")
async def serve_audio(filename: str):
    """Serve uploaded audio files."""
    # Basic security: prevent path traversal
    if ".." in filename or "/" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    filepath = os.path.join(AUDIO_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Audio file not found")

    return FileResponse(filepath, media_type="audio/webm")