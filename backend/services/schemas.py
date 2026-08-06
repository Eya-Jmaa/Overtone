import json
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, Field, field_validator


class SendCodeIn(BaseModel):
    email: EmailStr


class VerifyCodeIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)


class CompleteSignupIn(BaseModel):
    signup_token: str
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=6, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    is_verified: bool


class AuthOut(BaseModel):
    user: UserOut
    accessToken: str


class RefreshOut(BaseModel):
    accessToken: str
    user: UserOut


class MessageOut(BaseModel):
    message: str


class VerifyCodeOut(BaseModel):
    signup_token: str
    message: str


class ConversationCreate(BaseModel):
    mode: str
    title: Optional[str] = None
    video_enabled: bool = False


class ConversationOut(BaseModel):
    id: int
    user_id: str
    mode: str
    title: Optional[str]
    video_enabled: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class MessageItemOut(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    audio_url: Optional[str] = None
    audio_duration: Optional[int] = None
    created_at: datetime

    emotion: Optional[str] = None
    filler_count: Optional[int] = None
    text_emotion: Optional[str] = None
    text_emotion_confidence: Optional[float] = None
    text_emotion_evidence: Optional[str] = None

    class Config:
        from_attributes = True


class ConversationOutWithPreview(ConversationOut):
    """Includes message_count and last_message_preview for sidebar display."""
    message_count: int = 0
    last_message_preview: Optional[str] = None


class ConversationDetail(ConversationOut):
    messages: list[MessageItemOut] = []


class MessageCreate(BaseModel):
    content: str
    audio_url: Optional[str] = None
    audio_duration: Optional[int] = None


class MessageOutLabeled(MessageItemOut):
    """Message with vocal metrics — used after voice pipeline is wired."""
    emotion: Optional[str] = None
    pitch: Optional[str] = None
    energy: Optional[str] = None
    filler_count: Optional[int] = None
    assertiveness: Optional[str] = None

    class Config:
        from_attributes = True


class CoachingReportOut(BaseModel):
    """Coaching report, with the JSON-blob columns decoded for the client."""
    id: int
    conversation_id: int
    summary: str
    strengths: list[dict] = []
    areas_for_growth: list[dict] = []
    metrics: dict = {}
    created_at: datetime

    @field_validator("strengths", "areas_for_growth", mode="before")
    @classmethod
    def _parse_list(cls, v):
        if isinstance(v, str):
            try:
                v = json.loads(v)
            except json.JSONDecodeError:
                return []
        return v if isinstance(v, list) else []

    @field_validator("metrics", mode="before")
    @classmethod
    def _parse_dict(cls, v):
        if isinstance(v, str):
            try:
                v = json.loads(v)
            except json.JSONDecodeError:
                return {}
        return v if isinstance(v, dict) else {}

    class Config:
        from_attributes = True


class EndSessionOut(BaseModel):
    message: str
    coaching_report: Optional[CoachingReportOut] = None


class ScenarioOut(BaseModel):
    id: str
    title: str
    description: str
    mode: str
    difficulty: int
    languages: list[str]
    coaching_focus: list[str]
    opening_line: dict


class TranscribeOut(BaseModel):
    transcript: str
