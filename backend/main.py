from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from jose import jwt, JWTError
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import os

from dotenv import load_dotenv
from google.oauth2 import id_token
from google.auth.transport import requests as grequests

from .db import Base, engine, get_db      # ← relative
from .models import User                   # ← relative
from sqlalchemy.orm import Session

load_dotenv()

# --- settings ---
JWT_SECRET = os.getenv("JWT_SECRET", "dev_secret_change_me")
ALGO = "HS256"
JWT_EXPIRE_MINUTES = 60 * 24 * 30
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS","http://localhost:3000,http://127.0.0.1:3000").split(",")]

# --- app & db ---
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS, allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)
Base.metadata.create_all(bind=engine)

# --- helpers ---
def make_jwt(payload: Dict[str, Any]) -> str:
    exp = datetime.utcnow() + timedelta(minutes=JWT_EXPIRE_MINUTES)
    return jwt.encode({**payload, "exp": exp}, JWT_SECRET, algorithm=ALGO)

def decode_cookie(req: Request) -> Dict[str, Any]:
    token = req.cookies.get("session")
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[ALGO])
    except JWTError:
        raise HTTPException(401, "Invalid or expired token")

def require_user(req: Request):
    return decode_cookie(req)

# --- routes ---
@app.get("/api/health")
def health(): return {"status": "ok"}

class GoogleAuthIn(BaseModel):
    credential: str

@app.post("/api/auth/google")
def auth_google(body: GoogleAuthIn, db: Session = Depends(get_db)):
    try:
        info = id_token.verify_oauth2_token(body.credential, grequests.Request(), GOOGLE_CLIENT_ID)
    except Exception:
        raise HTTPException(400, "Invalid Google ID token")

    sub = info["sub"]; email = info.get("email"); name = info.get("name"); picture = info.get("picture")

    # upsert user
    user = db.query(User).filter(User.google_sub == sub).first()
    if not user:
        user = User(google_sub=sub, email=email, name=name, picture=picture)
        db.add(user)
    else:
        user.email = email or user.email
        user.name = name or user.name
        user.picture = picture or user.picture
        user.last_login = datetime.utcnow()
    db.commit(); db.refresh(user)

    token = make_jwt({"uid": user.id, "sub": sub, "email": email, "name": name, "picture": picture})
    resp = JSONResponse({"ok": True})
    resp.set_cookie("session", token, httponly=True, secure=False, samesite="Lax", path="/", max_age=60*60*24*30)
    return resp

@app.post("/api/logout")
def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("session", path="/")
    return resp

@app.get("/api/me")
def me(req: Request, db: Session = Depends(get_db)):
    payload = decode_cookie(req)
    uid = payload.get("uid")
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(401, "User not found")
    return {"id": user.id, "email": user.email, "name": user.name, "picture": user.picture}
