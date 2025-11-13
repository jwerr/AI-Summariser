# backend/routes/google_status.py
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User
from .google_calendar import _user_from_cookie_or_header  # reuse your helper

router = APIRouter(prefix="/api/google", tags=["google"])


@router.get("/status")
def google_status(request: Request, db: Session = Depends(get_db)):
    """
    Simple status used by the black 'Connect Google' card.
    Treats 'connected' as: user has a stored google_refresh_token.
    (Same tokens are used for Calendar + Drive because scopes include both.)
    """
    user: User = _user_from_cookie_or_header(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    connected = bool(user.google_refresh_token)
    return {"connected": connected}
