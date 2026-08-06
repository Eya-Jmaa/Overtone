import os
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent


def resolve_backend_path(p: str) -> str:
    """Absolute form of a configured path, anchored on BACKEND_DIR."""
    if not p:
        return ""
    q = Path(p)
    return str(q if q.is_absolute() else BACKEND_DIR / q)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        case_sensitive=False,
        validate_default=True,
    )

    database_url: str = "sqlite:///./ai_coach.db"

    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 7

    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str

    gmail_user: str
    gmail_app_password: str
    email_from: str = ""
    email_timeout_seconds: int = 20
    # When true, a failed send is logged (with the code) and the API still
    # reports success — convenient offline, but it hides real delivery failures,
    # so it must stay off anywhere a user is waiting on a real inbox.
    email_fail_silently: bool = False

    hf_token: str = ""

    llm_api_key: str = ""

    gemini_api_key: str
    gemini_model: str = "gemini-2.5-flash"
    gemini_temperature: float = 0.7
    gemini_top_p: float = 0.9
    gemini_max_tokens: int = 512

    rag_enabled: bool = True
    rag_db_path: str = ""
    rag_collection: str = "coaching_kb"
    rag_embed_model: str = "intfloat/multilingual-e5-base"
    rag_top_k: int = 4
    rag_max_context_chars: int = 2400

    kokoro_base_url: str = "http://kokoro:8880/v1"
    kokoro_voice: str = "af_bella"
    kokoro_response_format: str = "mp3"
    kokoro_timeout_seconds: int = 30

    kokoro_autostart: bool = False
    kokoro_docker_image: str = "ghcr.io/remsky/kokoro-fastapi-cpu:latest"
    kokoro_container_name: str = "coach-kokoro"

    lang_routing_enabled: bool = True
    lang_default: str = "en"
    lang_supported: str = "en,fr,ar"

    lang_switch_confidence: float = 0.6
    # 1 = follow the language of the turn the user just spoke, as soon as the
    # detection is confident. Raise it to require that many consecutive turns in
    # the new language before switching (steadier, but the coach answers the
    # first switched turn in the old language).
    lang_switch_sustain_turns: int = 1

    lang_min_confidence: float = 0.35

    lang_arabic_aliases: str = "ar,arb,ary,arz,acm,apc,fa,ur"

    tts_voice_en: str = "af_bella"
    tts_voice_fr: str = "ff_siwis"

    silma_base_url: str = ""
    silma_voice: str = ""
    silma_timeout_seconds: int = 60

    derja_stt_backend: str = ""
    derja_stt_model_path: str = ""

    whisper_model: str = "base"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"

    frontend_url: str = "http://localhost:5173"
    backend_url: str = "http://localhost:8000"

    video_analysis_enabled: bool = True

    face_expression_model: str = "enet_b0_8_best_afew"

    face_expression_every_n: int = 3

    face_min_frame_interval_ms: int = 450

    face_engagement_enabled: bool = False

    emotion_provider: str = ""
    emotion_model_path: str = "models/emotion_xlsr/xlsr_best.pt"

    emotion_max_chunks: int = 3

    text_emotion_enabled: bool = True

    text_emotion_min_words: int = 4

    text_emotion_min_confidence: float = 0.35

    silma_provider: str = ""
    silma_model_dir: str = "models/silma-tts-derja"
    silma_ref_audio_path: str = ""
    silma_ref_text: str = ""

    ffmpeg_bin_dir: str = ""

    @field_validator(
        "rag_db_path",
        "derja_stt_model_path",
        "emotion_model_path",
        "silma_model_dir",
        "silma_ref_audio_path",
        "ffmpeg_bin_dir",
    )
    @classmethod
    def _anchor_path_on_backend_dir(cls, v: str) -> str:
        return resolve_backend_path(v)


settings = Settings()


def _register_ffmpeg_dlls() -> None:
    """Make FFmpeg's shared libraries loadable by torchcodec."""
    d = settings.ffmpeg_bin_dir
    if not d:
        return
    if not os.path.isdir(d):
        print(
            f"[config] FFMPEG_BIN_DIR is set but does not exist: {d!r} — "
            "RAG and local SILMA TTS will fail to load. Check the path in .env."
        )
        return

    if d not in os.environ.get("PATH", ""):
        os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")

    add_dll_directory = getattr(os, "add_dll_directory", None)
    if add_dll_directory is not None:
        try:
            _dll_directory_cookies.append(add_dll_directory(d))
        except OSError as e:
            print(f"[config] could not register FFmpeg DLL directory {d!r}: {e}")


_dll_directory_cookies: list = []
_register_ffmpeg_dlls()
