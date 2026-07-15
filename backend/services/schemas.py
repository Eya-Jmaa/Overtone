from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, Field


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


# ── Conversation / Message schemas ──────────────────

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
    id: int
    conversation_id: int
    summary: str
    strengths: Optional[str] = None
    areas_for_growth: Optional[str] = None
    metrics: Optional[str] = None
    created_at: datetime

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
