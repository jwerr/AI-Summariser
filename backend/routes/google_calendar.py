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
from ..models import User  # must include google_* columns (see _ensure_google_fields)
from .google_oauth import (
    build_auth_url,
    exchange_code_for_tokens,
    refresh_access_token,
    parse_expiry_from_token_response,
)

FRONTEND_AFTER_AUTH = os.getenv("FRONTEND_AFTER_AUTH", "http://localhost:3000/dashboard")

# ----------------------------
# Routers
# ----------------------------
google_router   = APIRouter(prefix="/api/google", tags=["google"])
auth_router     = APIRouter(prefix="/api/auth/google", tags=["google-auth"])
calendar_router = APIRouter(prefix="/api/calendar", tags=["google-calendar"])

router = APIRouter(prefix="/api/calendar", tags=["google-calendar"])

# ----------------------------
# Helpers
# ----------------------------
def _now_utc():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)

@router.get("/status")
def calendar_status(request: Request, db: Session = Depends(get_db)):
    user = _user_from_cookie_or_header(request, db)

    connected = bool(
        user.google_refresh_token
        and user.google_access_token_expires_at
        and user.google_access_token_expires_at > _now_utc()
    )

    return {"connected": connected}
def _user_from_cookie_or_header(request: Request, db: Session) -> User:
    """
    Minimal auth shim. Looks for:
      - X-User-Id header
      - httpOnly 'uid' cookie
      - ?uid=<id> query param
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

    # If we have a fresh access token, reuse
    try:
        exp = user.google_token_expiry
        if exp and isinstance(exp, datetime) and user.google_access_token:
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp > _now_utc() + timedelta(minutes=2):
                return user.google_access_token
    except Exception:
        pass

    # Refresh using refresh_token
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

# ----------------------------
# OAuth start (aliases)
# ----------------------------
@google_router.get("/auth-url")
@google_router.get("/auth_url")
@google_router.get("/start")
def google_auth_url(request: Request, db: Session = Depends(get_db)):
    """
    Return Google OAuth URL. We include the user id inside 'state'
    so the callback can attach tokens to the correct user.
    """
    u = _user_from_cookie_or_header(request, db)
    state = f"uid:{u.id}"
    return {"url": build_auth_url(state)}

# ----------------------------
# OAuth callback
# Two paths supported:
#   /api/auth/google/callback   (matches your current .env default)
#   /api/google/callback        (optional alias)
# ----------------------------
@auth_router.get("/callback")
@google_router.get("/callback")
def google_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    request: Request = None,
    db: Session = Depends(get_db),
):
    if not code:
        raise HTTPException(status_code=400, detail="Missing code")

    # Prefer uid from state (uid:<id>)
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

    access_token  = payload.get("access_token")
    refresh_token = payload.get("refresh_token")  # Present on first consent
    if not access_token:
        raise HTTPException(status_code=400, detail="No access_token in token response")

    user.google_access_token = access_token
    if refresh_token:
        user.google_refresh_token = refresh_token
    user.google_token_expiry = parse_expiry_from_token_response(payload)

    db.add(user)
    db.commit()

    return RedirectResponse(FRONTEND_AFTER_AUTH)

# ----------------------------
# Calendar API used by frontend
#   GET  /api/calendar/events
#   POST /api/calendar/create
# ----------------------------
@calendar_router.get("/events")
def list_events(request: Request, db: Session = Depends(get_db)):
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

@calendar_router.post("/create")
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
    end_iso   = (payload.get("end_iso") or "").strip()

    if not start_iso:
        raise HTTPException(status_code=400, detail="start_iso is required")

    # parse either naive or tz-aware
    def _parse(dt: str) -> datetime:
        try:
            if "Z" in dt:
                return datetime.fromisoformat(dt.replace("Z", "+00:00"))
            return datetime.fromisoformat(dt)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid ISO datetime: {dt}")

    start_dt = _parse(start_iso)
    end_dt   = _parse(end_iso) if end_iso else None

    local_tz = datetime.now().astimezone().tzinfo
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=local_tz)
    if end_dt is None:
        end_dt = start_dt + timedelta(minutes=60)
    elif end_dt.tzinfo is None:
        end_dt = end_dt.replace(tzinfo=local_tz)

    start_utc = start_dt.astimezone(timezone.utc)
    end_utc   = end_dt.astimezone(timezone.utc)

    g_event = {
        "summary": title,
        "description": desc,
        "start": {"dateTime": start_utc.isoformat().replace("+00:00", "Z"), "timeZone": "UTC"},
        "end":   {"dateTime": end_utc.isoformat().replace("+00:00", "Z"),   "timeZone": "UTC"},
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
