# backend/routes/google_oauth.py
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Dict, Any
import httpx
from urllib.parse import urlencode

SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
]

# ---- helpers ----
def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def parse_expiry_from_token_response(data: Dict[str, Any]) -> datetime:
    expires_in = int(data.get("expires_in", 3600))
    return now_utc() + timedelta(seconds=max(60, expires_in - 120))

def _cfg():
    """Fetch env at call-time to avoid import-order issues."""
    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "")
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/google/callback")
    if not client_id:
        raise RuntimeError("GOOGLE_CLIENT_ID is not set")
    if not client_secret:
        raise RuntimeError("GOOGLE_CLIENT_SECRET is not set")
    return client_id, client_secret, redirect_uri

# ---- OAuth helpers used by google_calendar.py ----
def build_auth_url(state: str) -> str:
    client_id, _, redirect_uri = _cfg()
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "scope": " ".join(SCOPES),
        "state": state,
    }
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)

def exchange_code_for_tokens(code: str) -> Dict[str, Any]:
    client_id, client_secret, redirect_uri = _cfg()
    data = {
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }
    with httpx.Client(timeout=20) as client:
        r = client.post("https://oauth2.googleapis.com/token", data=data)
    if r.status_code != 200:
        raise RuntimeError(f"Token exchange failed: {r.text}")
    return r.json()

def refresh_access_token(refresh_token: str) -> Dict[str, Any]:
    client_id, client_secret, _ = _cfg()
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    with httpx.Client(timeout=20) as client:
        r = client.post("https://oauth2.googleapis.com/token", data=data)
    if r.status_code != 200:
        raise RuntimeError(f"Token refresh failed: {r.text}")
    return r.json()
