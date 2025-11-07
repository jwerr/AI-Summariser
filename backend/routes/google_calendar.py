# backend/routes/google_calendar.py
from __future__ import annotations
import os, time, datetime as dt, json
from typing import Optional, Dict, Any, List
import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User
from ..auth import get_current_user  # your existing auth dependency, or adjust

router = APIRouter(prefix="/api", tags=["google-calendar"])

GOOGLE_OAUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_API = "https://www.googleapis.com/calendar/v3"

CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI")
SCOPES = os.getenv("GOOGLE_SCOPES", "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly")

from urllib.parse import urlencode

@router.get("/google/auth-url")
def get_google_auth_url(state: Optional[str] = None):
    if not CLIENT_ID:
        raise HTTPException(500, detail="GOOGLE_CLIENT_ID not set")
    if not CLIENT_SECRET:
        raise HTTPException(500, detail="GOOGLE_CLIENT_SECRET not set")
    if not REDIRECT_URI:
        raise HTTPException(500, detail="GOOGLE_REDIRECT_URI not set")
    if not SCOPES:
        raise HTTPException(500, detail="GOOGLE_SCOPES not set")

    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,  # must match Google Console exactly
        "response_type": "code",
        "access_type": "offline",
        "prompt": "consent",
        "scope": SCOPES,
        "include_granted_scopes": "true",
    }
    if state:
        params["state"] = state

    url = f"{GOOGLE_OAUTH_URL}?{urlencode(params)}"
    # Optional: log to verify at runtime
    print("Google OAuth URL:", url)
    return {"url": url}


def _oauth_headers(token: str) -> Dict[str,str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

def _ensure_fresh_token(user: User, db: Session) -> str:
    """Refresh token if expired; return access token."""
    if not user.google_access_token or not user.google_refresh_token:
        raise HTTPException(status_code=400, detail="Google not connected.")
    # if expires within 60s, refresh
    now = dt.datetime.utcnow()
    if not user.google_token_expiry or user.google_token_expiry <= now + dt.timedelta(seconds=60):
        data = {
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "refresh_token": user.google_refresh_token,
            "grant_type": "refresh_token",
        }
        r = requests.post(GOOGLE_TOKEN_URL, data=data, timeout=20)
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail=f"Failed to refresh token: {r.text}")
        payload = r.json()
        user.google_access_token = payload["access_token"]
        # google may omit expires_in sometimes; default +3600
        expires_in = int(payload.get("expires_in", 3600))
        user.google_token_expiry = dt.datetime.utcnow() + dt.timedelta(seconds=expires_in)
        db.add(user); db.commit()
    return user.google_access_token

@router.get("/google/auth-url")
def get_google_auth_url(state: Optional[str] = None):
    from urllib.parse import urlencode
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "access_type": "offline",            # ensures refresh_token on first consent
        "prompt": "consent",                 # force refresh_token if needed
        "scope": SCOPES,
        "include_granted_scopes": "true",
    }
    if state:
        params["state"] = state
    return {"url": f"{GOOGLE_OAUTH_URL}?{urlencode(params)}"}

@router.get("/google/oauth/callback")
def google_oauth_callback(code: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    data = {
        "code": code,
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code",
    }
    r = requests.post(GOOGLE_TOKEN_URL, data=data, timeout=20)
    if r.status_code != 200:
        raise HTTPException(status_code=400, detail=f"OAuth exchange failed: {r.text}")
    tok = r.json()
    user.google_access_token = tok["access_token"]
    user.google_refresh_token = tok.get("refresh_token", user.google_refresh_token)  # may be absent on re-consent
    user.google_scope = tok.get("scope", SCOPES)
    expires_in = int(tok.get("expires_in", 3600))
    user.google_token_expiry = dt.datetime.utcnow() + dt.timedelta(seconds=expires_in)
    db.add(user); db.commit()
    return JSONResponse({"ok": True})

@router.get("/calendar/events")
def list_events(
    time_min: Optional[str] = Query(None, description="ISO8601, defaults to now-7d"),
    time_max: Optional[str] = Query(None, description="ISO8601, defaults to now+30d"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    token = _ensure_fresh_token(user, db)
    now = dt.datetime.utcnow()
    if not time_min:
        time_min = (now - dt.timedelta(days=7)).isoformat() + "Z"
    if not time_max:
        time_max = (now + dt.timedelta(days=30)).isoformat() + "Z"

    params = {"timeMin": time_min, "timeMax": time_max, "singleEvents": True, "orderBy": "startTime"}
    r = requests.get(f"{GOOGLE_API}/calendars/primary/events", headers=_oauth_headers(token), params=params, timeout=20)
    if r.status_code != 200:
        raise HTTPException(status_code=400, detail=r.text)
    return r.json().get("items", [])

@router.post("/calendar/events")
def create_event(
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    payload example:
    {
      "summary": "Follow-up: Sprint Review",
      "description": "From AI Summariser decisions",
      "start": {"dateTime": "2025-10-30T10:00:00-04:00"},
      "end":   {"dateTime": "2025-10-30T10:30:00-04:00"},
      "attendees": [{"email":"alice@example.com"}]
    }
    """
    token = _ensure_fresh_token(user, db)
    r = requests.post(f"{GOOGLE_API}/calendars/primary/events", headers=_oauth_headers(token), data=json.dumps(payload), timeout=20)
    if r.status_code not in (200, 201):
        raise HTTPException(status_code=400, detail=r.text)
    return r.json()

@router.patch("/calendar/events/{event_id}")
def update_event(event_id: str, payload: Dict[str, Any], db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    token = _ensure_fresh_token(user, db)
    r = requests.patch(f"{GOOGLE_API}/calendars/primary/events/{event_id}", headers=_oauth_headers(token), data=json.dumps(payload), timeout=20)
    if r.status_code != 200:
        raise HTTPException(status_code=400, detail=r.text)
    return r.json()

@router.delete("/calendar/events/{event_id}")
def delete_event(event_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    token = _ensure_fresh_token(user, db)
    r = requests.delete(f"{GOOGLE_API}/calendars/primary/events/{event_id}", headers=_oauth_headers(token), timeout=20)
    if r.status_code not in (200, 204):
        raise HTTPException(status_code=400, detail=r.text)
    return {"ok": True}
