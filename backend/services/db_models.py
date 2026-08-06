from sqlalchemy import Column, String, Boolean, DateTime, Float, Integer, Text, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from database import Base
import uuid


def make_uuid():
    return f"u_{uuid.uuid4().hex[:24]}"


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=make_uuid)
    email = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    password_hash = Column(String, nullable=True)
    is_verified = Column(Boolean, default=True, nullable=False)
    google_id = Column(String, unique=True, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    last_login_at = Column(DateTime(timezone=True), nullable=True)
    login_count = Column(Integer, nullable=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)

    conversations = relationship(
        "Conversation", back_populates="user", cascade="all, delete-orphan"
    )


class PendingVerification(Base):
    """Holds an email + verification code BEFORE the user account is created."""
    __tablename__ = "pending_verifications"

    email = Column(String, primary_key=True)
    code_hash = Column(String, nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    verified = Column(Boolean, default=False, nullable=False)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    mode = Column(String, nullable=False)
    title = Column(String, nullable=True)
    video_enabled = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="conversations")
    messages = relationship(
        "Message",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.created_at",
    )


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(
        Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    audio_url = Column(String, nullable=True)
    audio_duration = Column(Integer, nullable=True)

    emotion = Column(String, nullable=True)
    pitch = Column(String, nullable=True)
    energy = Column(String, nullable=True)
    filler_count = Column(Integer, nullable=True)
    assertiveness = Column(String, nullable=True)

    text_emotion = Column(String, nullable=True)
    text_emotion_confidence = Column(Float, nullable=True)
    text_emotion_evidence = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    conversation = relationship("Conversation", back_populates="messages")


class CoachingReport(Base):
    __tablename__ = "coaching_reports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(
        Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True, unique=True
    )
    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    summary = Column(Text, nullable=False)
    strengths = Column(Text, nullable=True)
    areas_for_growth = Column(Text, nullable=True)
    metrics = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    conversation = relationship("Conversation")
