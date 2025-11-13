# backend/routes/google_common.py
from datetime import datetime, timezone
from typing import Tuple, Optional, Dict, Any

from fastapi import Request, HTTPException
from google.oauth2.credentials import Credentials

from ..models import User  # must define User with google_* columns
from ..db import SessionLocal  # use direct session here, not get_db

SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]

def _now_utc():
    return datetime.now(timezone.utc)

def _get_user_from_request(request: Request, db) -> User:
    """
    Basic auth shim: mirror whatever you're using elsewhere.
    Here we look for X-User-Id header or 'uid' cookie.
    """
    uid = request.headers.get("X-User-Id") or request.cookies.get("uid")
    if not uid:
        raise HTTPException(status_code=401, detail="No user id provided")

    try:
        uid_int = int(uid)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid uid")

    user: Optional[User] = db.query(User).filter(User.id == uid_int).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

def _creds_from_user(user: User) -> Credentials:
    if not user.google_access_token or not user.google_refresh_token:
        raise HTTPException(status_code=409, detail="Google not connected")
    return Credentials(
        token=user.google_access_token,
        refresh_token=user.google_refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=getattr(user, "google_client_id", None),
        client_secret=getattr(user, "google_client_secret", None),
        scopes=SCOPES,
    )

def ensure_fresh_creds(user: User, creds: Credentials) -> Credentials:
    """
    Refresh access token if needed and persist updated token/expiry on the user.
    """
    if creds.valid:
        return creds

    from google.auth.transport.requests import Request as GoogleRequest
    creds.refresh(GoogleRequest())

    db = SessionLocal()
    try:
        user.google_access_token = creds.token
        if getattr(creds, "expiry", None):
            user.google_token_expiry = creds.expiry
        db.add(user)
        db.commit()
    finally:
        db.close()

    return creds

def get_user_and_creds(request: Request, by_channel_id: str | None = None) -> Tuple[User, Credentials]:
    """
    If by_channel_id is provided, look up a user by stored Drive channel_id.
    Otherwise, load from request (header/cookie).
    """
    db = SessionLocal()
    try:
        if by_channel_id:
            user: Optional[User] = db.query(User).filter(User.drive_channel_id == by_channel_id).first()
            if not user:
                raise HTTPException(status_code=404, detail="Channel not found")
        else:
            user = _get_user_from_request(request, db)

        creds = _creds_from_user(user)
        return user, creds
    finally:
        db.close()

def save_tokens(request: Request, creds: Credentials):
    """
    Persist tokens from a freshly-authenticated Google Credentials object.
    """
    db = SessionLocal()
    try:
        user = _get_user_from_request(request, db)
        user.google_access_token = creds.token
        if creds.refresh_token:
            user.google_refresh_token = creds.refresh_token
        if getattr(creds, "expiry", None):
            user.google_token_expiry = creds.expiry
        db.add(user)
        db.commit()
    finally:
        db.close()

def update_user_fields(user: User, fields: Dict[str, Any]):
    """
    Small helper used by google_drive_webhook to update channel ids,
    start_page_token, expiry, etc.
    """
    db = SessionLocal()
    try:
        for key, value in fields.items():
            setattr(user, key, value)
        db.add(user)
        db.commit()
    finally:
        db.close()
