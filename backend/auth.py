# backend/auth.py
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from .db import get_db
from .models import User

def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """
    Replace this with your real session/JWT logic.
    For now:
      1) Try cookie "google_sub"
      2) Else: return the first user (dev-only fallback)
    """
    google_sub = request.cookies.get("google_sub")
    if google_sub:
        user = db.query(User).filter(User.google_sub == google_sub).first()
    else:
        user = db.query(User).order_by(User.id.asc()).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not logged in")
    return user
