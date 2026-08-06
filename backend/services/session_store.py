"""Session state management for WebSocket connections."""
from dataclasses import dataclass, field
from typing import Optional, Any
import time


@dataclass
class SessionState:
    """Per-connection session state."""
    audio_buffer: bytes = field(default_factory=bytes)
    vad_state: str = "listening"
    partial_transcript: str = ""
    session_start_ts: float = field(default_factory=time.monotonic)
    conversation_id: int = 0
    user_id: str = ""
    transcribing: bool = False
    last_transcription_ms: float = 0
    turn_task: Optional[Any] = None

    # Incremental STT: transcript for the part of this turn already finalised
    # while the user was still speaking, and how many PCM samples (@16 kHz) of
    # the turn it covers. At end_turn only audio past `committed_samples` still
    # needs decoding, which is what keeps the post-speech pause short.
    committed_transcript: str = ""
    committed_samples: int = 0
    detected_language: Optional[str] = None
    detect_confidence: float = 0.0

    language_state: Optional[Any] = None

    face_analyzer: Optional[Any] = None
    latest_video_signal: Optional[dict] = None
    last_voice_signal: Optional[dict] = None
    last_text_signal: Optional[dict] = None
    last_video_frame_ms: float = 0
    video_processing: bool = False


class SessionStore:
    """In-memory session state store keyed by connection ID."""

    def __init__(self):
        self._sessions: dict[str, SessionState] = {}

    def get(self, connection_id: str) -> Optional[SessionState]:
        """Get session state for a connection."""
        return self._sessions.get(connection_id)

    def set(self, connection_id: str, state: SessionState) -> None:
        """Set session state for a connection."""
        self._sessions[connection_id] = state

    def delete(self, connection_id: str) -> None:
        """Delete session state for a connection."""
        self._sessions.pop(connection_id, None)

    def exists(self, connection_id: str) -> bool:
        """Check if session exists."""
        return connection_id in self._sessions


_session_store = SessionStore()


def get_session_store() -> SessionStore:
    """Get the global session store instance."""
    return _session_store
