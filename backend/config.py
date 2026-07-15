from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)

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

    hf_token: str = ""

    llm_api_key: str = ""          # Token Factory key

    # Kokoro TTS settings
    kokoro_base_url: str = "http://kokoro:8880/v1"  # Internal Docker network
    kokoro_voice: str = "af_bella"  # Warm American female voice
    kokoro_response_format: str = "mp3"  # MP3 for small file size, browser compatible
    kokoro_timeout_seconds: int = 30

    # Auto-start the Kokoro TTS server (as a Docker container) with the backend.
    kokoro_autostart: bool = False
    kokoro_docker_image: str = "ghcr.io/remsky/kokoro-fastapi-cpu:latest"
    kokoro_container_name: str = "coach-kokoro"

    # Whisper (faster-whisper) transcription model.
    #  - CPU sweet spot for accuracy+speed: "small" (multilingual) or "small.en" (English-only)
    #  - Faster but less accurate: "base", "tiny"
    #  - More accurate but slow on CPU: "medium", "distil-large-v3"
    #  - With an NVIDIA GPU: set device="cuda", compute_type="float16", model="large-v3-turbo"
    whisper_model: str = "base"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"

    frontend_url: str = "http://localhost:5173"
    backend_url: str = "http://localhost:8000"

settings = Settings()