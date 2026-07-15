"""
Session state management for WebSocket connections.

Single-worker in-memory implementation with Redis swap point for future multi-worker deployment.
"""
from collections import deque
from dataclasses import dataclass, field
from typing import Optional, Any
import time

# How many recent chunks to keep for windowed (partial) transcription.
# At the frontend's 250ms MediaRecorder timeslice, 16 chunks ~= 4s of trailing
# audio. Bounding this keeps each windowed transcription call roughly
# constant-time regardless of how long the current turn has been going,
# instead of re-transcribing the ever-growing full-turn buffer from scratch.
RECENT_CHUNKS_MAXLEN = 16


@dataclass
class SessionState:
    """Per-connection session state."""
    audio_buffer: bytes = field(default_factory=bytes)
    audio_chunks: list[bytes] = field(default_factory=list)
    recent_chunks: deque = field(default_factory=lambda: deque(maxlen=RECENT_CHUNKS_MAXLEN))
    header_chunk: Optional[bytes] = None  # First chunk with WebM header
    vad_state: str = "listening"  # listening | processing | speaking
    partial_transcript: str = ""
    session_start_ts: float = field(default_factory=time.monotonic)
    conversation_id: int = 0
    user_id: str = ""
    transcribing: bool = False  # guards against overlapping windowed transcriptions
    last_transcription_ms: float = 0
    # In-flight coach turn (asyncio.Task) so a new start_turn can cancel it
    # mid-reply for barge-in. Typed as Any to keep this module asyncio-free.
    turn_task: Optional[Any] = None


class SessionStore:
    """
    In-memory session state store keyed by connection ID.
    
    # REDIS SWAP POINT
    To migrate to multi-worker deployment:
    1. Replace _sessions dict with Redis client
    2. Change get/set/delete to use Redis hash operations
    3. Serialize SessionState to JSON for storage
    4. No other code changes needed
    """
    
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


# Global session store instance
_session_store = SessionStore()


def get_session_store() -> SessionStore:
    """Get the global session store instance."""
    return _session_store
