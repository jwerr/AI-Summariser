# backend/schemas.py

# backend/schemas.py
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Any
from datetime import datetime

class UserMeIn(BaseModel):
    # email is read-only on UI, but accept for completeness (we won't overwrite it)
    email: Optional[EmailStr] = None
    name: Optional[str] = None
    title: Optional[str] = None
    bio: Optional[str] = None
    timezone: Optional[str] = None
    picture: Optional[str] = None  # data URL or https url

class UserMeOut(BaseModel):
    id: int
    email: Optional[EmailStr] = None
    name: Optional[str] = None
    title: Optional[str] = None
    bio: Optional[str] = None
    timezone: Optional[str] = None
    picture: Optional[str] = None
    created_at: Optional[datetime] = None
    last_login: Optional[datetime] = None

    class Config:
        from_attributes = True  # (FastAPI >=0.110)
class TranscriptOut(BaseModel):
    id: int
    filename: str
    mime: Optional[str]
    size: Optional[int]
    storage_path: str
    upload_ts: datetime
    class Config:
        from_attributes = True

class SummaryCreate(BaseModel):
    max_tokens: Optional[int] = 512
    temperature: Optional[float] = 0.2
    model: Optional[str] = None

class SummaryOut(BaseModel):
    id: int
    transcript_id: int
    key_points: list[Any] = Field(default_factory=list)   # ✅ no mutable default
    decisions:  list[Any] = Field(default_factory=list)
    action_items: list[Any] = Field(default_factory=list)
    model_used: Optional[str]
    created_at: datetime
    class Config:
        from_attributes = True
    
class MeetingCreate(BaseModel):
    user_id: int
    title: str
    platform: str | None = None
    transcript_path: str | None = None

class MeetingOut(MeetingCreate):
    id: int
    description: str
    created_at: datetime

    class Config:
        orm_mode = True

