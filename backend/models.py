# backend/models.py
from sqlalchemy import Column, Integer, String, Text, DateTime
from datetime import datetime
from .db import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    google_sub = Column(String(255), unique=True, index=True, nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=True)
    name = Column(String(255), nullable=True)
    picture = Column(Text, nullable=True)
    password_hash = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime, default=datetime.utcnow)

# backend/models.py
class LoginEvent(Base):
    __tablename__ = "login_events"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, index=True, nullable=False)
    ts = Column(DateTime, default=datetime.utcnow)
    provider = Column(String(50), default="google")
