# backend/routes/google_calendar.py
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User  # must have: id, and nullable google_* columns
from .google_oauth import (
    SCOPES,
    build_auth_url,
    exchange_code_for_tokens,
    refresh_access_token,
    parse_expiry_from_token_response,
)

FRONTEND_AFTER_AUTH = os.getenv("FRONTEND_AFTER_AUTH", "http://localhost:3000/dashboard")

router = APIRouter(tags=["google-calendar"])

# ------------------------------------------------------------------
# Minimal "current user" shim
# ------------------------------------------------------------------
def _now_utc() -> datetime:
    return datetime.now(timezone.utc)

def _user_from_cookie_or_header(request: Request, db: Session) -> User:
    """
    Replace with your real auth dependency when ready.
    Looks for X-User-Id header, or httpOnly 'uid' cookie, or ?uid=<id>.
    """
    uid: Optional[int] = None

    hdr = request.headers.get("X-User-Id")
    if hdr and str(hdr).isdigit():
        uid = int(hdr)

    if not uid:
        try:
            uid_cookie = request.cookies.get("uid")
            if uid_cookie and str(uid_cookie).isdigit():
                uid = int(uid_cookie)
        except Exception:
            pass

    if not uid:
        q = request.query_params.get("uid")
        if q and str(q).isdigit():
            uid = int(q)

    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")

    u = db.get(User, uid)
    if not u:
        raise HTTPException(status_code=401, detail="User not found")
    return u

def _ensure_google_fields(u: User):
    """
    The User model must have:
      google_access_token TEXT
      google_refresh_token TEXT
      google_token_expiry  TIMESTAMP(timezone=True)
    """
    for attr in ("google_access_token", "google_refresh_token", "google_token_expiry"):
        if not hasattr(u, attr):
            raise HTTPException(
                status_code=500,
                detail=f"User model missing '{attr}' column. Add it to your DB schema.",
            )

def _ensure_fresh_token(user: User, db: Session) -> str:
    """
    Return a valid access token, refreshing if needed.
    """
    _ensure_google_fields(user)

    if not user.google_refresh_token:
        raise HTTPException(status_code=409, detail="Google not connected")

    # If we have a still-fresh access token, reuse
    try:
        exp = user.google_token_expiry
        if exp and isinstance(exp, datetime) and user.google_access_token:
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp > _now_utc() + timedelta(minutes=2):
                return user.google_access_token
    except Exception:
        pass

    # Refresh
    try:
        payload = refresh_access_token(user.google_refresh_token)
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))

    access_token = payload.get("access_token")
    if not access_token:
        raise HTTPException(status_code=401, detail="No access_token in refresh response")

    user.google_access_token = access_token
    user.google_token_expiry = parse_expiry_from_token_response(payload)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user.google_access_token

# ------------------------------------------------------------------
# OAuth endpoints
# ------------------------------------------------------------------

@router.get("/google/auth-url")
def get_google_auth_url(request: Request, db: Session = Depends(get_db)):
    """
    Returns a Google OAuth URL with a state=uid:<id> so the callback can
    identify which local user to attach tokens to.
    """
    u = _user_from_cookie_or_header(request, db)
    state = f"uid:{u.id}"
    url = build_auth_url(state)
    # Debug line you may keep during setup:
    # print("[auth-url] state:", state, "url:", url)
    return {"url": url}


@router.get("/auth/google/callback")
def google_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    request: Request = None,
    db: Session = Depends(get_db),
):
    """
    Handles Google redirect, saves tokens on the correct user, then redirects
    back to the app.
    """
    if not code:
        raise HTTPException(status_code=400, detail="Missing code")

    # Prefer uid from state (uid:<id>), fall back to the shim if absent.
    uid: Optional[int] = None
    if state and state.startswith("uid:"):
        try:
            uid = int(state.split("uid:", 1)[1])
        except Exception:
            uid = None

    user = db.get(User, uid) if uid is not None else _user_from_cookie_or_header(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    _ensure_google_fields(user)

    # Exchange code → tokens
    try:
        payload = exchange_code_for_tokens(code)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    access_token = payload.get("access_token")
    refresh_token = payload.get("refresh_token")  # Returned on first-time consent
    if not access_token:
        raise HTTPException(status_code=400, detail="No access_token in token response")

    user.google_access_token = access_token
    if refresh_token:
        user.google_refresh_token = refresh_token
    user.google_token_expiry = parse_expiry_from_token_response(payload)

    db.add(user)
    db.commit()

    return RedirectResponse(FRONTEND_AFTER_AUTH)

# ------------------------------------------------------------------
# Calendar: list & create
# ------------------------------------------------------------------

@router.get("/calendar/events")
def list_events(request: Request, db: Session = Depends(get_db)):
    """
    List the next ~10 upcoming events from the user's primary calendar.
    """
    user = _user_from_cookie_or_header(request, db)
    token = _ensure_fresh_token(user, db)

    params = {
        "singleEvents": "true",
        "orderBy": "startTime",
        "maxResults": 10,
        "timeMin": _now_utc().isoformat().replace("+00:00", "Z"),
    }
    headers = {"Authorization": f"Bearer {token}"}
    with httpx.Client(timeout=20) as client:
        r = client.get(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            params=params,
            headers=headers,
        )
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.text)

    return JSONResponse(r.json())


@router.post("/calendar/create")
async def create_event(request: Request, db: Session = Depends(get_db)):
    user = _user_from_cookie_or_header(request, db)
    token = _ensure_fresh_token(user, db)

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    title = (payload.get("title") or "Untitled").strip()
    desc = payload.get("description") or ""
    start_iso = (payload.get("start_iso") or "").strip()
    end_iso = (payload.get("end_iso") or "").strip()

    if not start_iso:
        raise HTTPException(status_code=400, detail="start_iso is required")

    # --- Parse incoming times ---
    # Accept either:
    #  - naive local-like ("2025-11-18T16:00:00")
    #  - offset/Z aware ("2025-11-18T16:00:00-05:00" or "...Z")
    def _parse(dt: str) -> datetime:
        try:
            if "Z" in dt:
                return datetime.fromisoformat(dt.replace("Z", "+00:00"))
            return datetime.fromisoformat(dt)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid ISO datetime: {dt}")

    start_dt = _parse(start_iso)
    end_dt = _parse(end_iso) if end_iso else None

    # If naive, assume local tz; then normalize everything to UTC.
    local_tz = datetime.now().astimezone().tzinfo
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=local_tz)
    if end_dt is None:
        end_dt = start_dt + timedelta(minutes=60)
    elif end_dt.tzinfo is None:
        end_dt = end_dt.replace(tzinfo=local_tz)

    start_utc = start_dt.astimezone(timezone.utc)
    end_utc = end_dt.astimezone(timezone.utc)

    # RFC3339 + explicit timeZone (Google likes both to be present)
    start_obj = {
        "dateTime": start_utc.isoformat().replace("+00:00", "Z"),
        "timeZone": "UTC",
    }
    end_obj = {
        "dateTime": end_utc.isoformat().replace("+00:00", "Z"),
        "timeZone": "UTC",
    }

    g_event = {
        "summary": title,
        "description": desc,
        "start": start_obj,
        "end":   end_obj,
    }

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    with httpx.Client(timeout=20) as client:
        r = client.post(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            headers=headers,
            json=g_event,
        )
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.text)

    return JSONResponse(r.json(), status_code=201)
