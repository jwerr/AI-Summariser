# backend/models.py
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from datetime import datetime
from .db import Base

# ---------- Users ----------
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    google_sub = Column(String(255), unique=True, index=True, nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=True)
    name = Column(String(255), nullable=True)
    picture = Column(Text, nullable=True)
    password_hash = Column(String(255), nullable=True)
    title = Column(String(255), nullable=True)
    bio = Column(Text, nullable=True)
    timezone = Column(String(128), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime, default=datetime.utcnow)
        # ---- Google OAuth tokens ----
    google_access_token = Column(String, nullable=True)
    google_refresh_token = Column(String, nullable=True)
    google_token_expiry = Column(DateTime, nullable=True)
    google_scope = Column(String, nullable=True)


# ---------- Login audit ----------
class LoginEvent(Base):
    __tablename__ = "login_events"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, index=True, nullable=False)
    ts = Column(DateTime, default=datetime.utcnow)
    provider = Column(String(50), default="google")

# ---------- Meetings ----------
class Meeting(Base):
    __tablename__ = "meetings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, default="Auto-generated after transcript upload")
    transcript_path = Column(Text, nullable=True)
    platform = Column(String(50), nullable=True)  # e.g., 'Zoom', 'Manual'
    created_at = Column(DateTime, default=datetime.utcnow)

    # Transcripts that belong to this meeting
    transcripts = relationship(
        "Transcript",
        back_populates="meeting",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    # (Optional) Direct access to summaries bound to this meeting
    summaries = relationship(
        "Summary",
        back_populates="meeting",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

# ---------- Transcripts ----------
class Transcript(Base):
    __tablename__ = "transcripts"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    # Link each transcript to its meeting (nullable for back-compat)
    meeting_id = Column(Integer, ForeignKey("meetings.id", ondelete="SET NULL"), nullable=True, index=True)

    filename = Column(String(512), nullable=False)
    mime = Column(String(128), nullable=False)
    size = Column(Integer, nullable=False)
    storage_path = Column(Text, nullable=False)

    # Optional: extracted text
    text = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    # relationships
    meeting = relationship("Meeting", back_populates="transcripts")

    summaries = relationship(
        "Summary",
        back_populates="transcript",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

# ---------- Summaries ----------
class Summary(Base):
    __tablename__ = "summaries"

    id = Column(Integer, primary_key=True)

    # NEW: bind summaries directly to a meeting (what your routes expect)
    meeting_id = Column(Integer, ForeignKey("meetings.id", ondelete="SET NULL"), nullable=True, index=True)

    transcript_id = Column(Integer, ForeignKey("transcripts.id"), index=True, nullable=False)

    # Structured fields
    key_points   = Column(JSONB, nullable=False, default=list)
    decisions    = Column(JSONB, nullable=False, default=list)
    action_items = Column(JSONB, nullable=False, default=list)

    # Text fields
    one_liner    = Column(Text, nullable=True)
    markdown     = Column(Text, nullable=True)
    summary_text = Column(Text, nullable=True)

    # Metadata
    model_used = Column(String(128), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    transcript = relationship("Transcript", back_populates="summaries")
    meeting    = relationship("Meeting", back_populates="summaries")
