# backend/main.py
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from jose import jwt, JWTError
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import os
import bcrypt

from dotenv import load_dotenv
from google.oauth2 import id_token
from google.auth.transport import requests as grequests

from .db import Base, engine, get_db
from .models import User, LoginEvent
from sqlalchemy.orm import Session

load_dotenv()

JWT_SECRET = os.getenv("JWT_SECRET", "dev_secret_change_me")
ALGO = "HS256"
JWT_EXPIRE_MINUTES = 60 * 24 * 30  # 30 days
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
]


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create tables if they don't exist
Base.metadata.create_all(bind=engine)

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

def set_session_and_return_user(user: User) -> JSONResponse:
    token = make_jwt({
        "uid": user.id,
        "sub": user.google_sub,
        "email": user.email,
        "name": user.name,
        "picture": user.picture
    })
    resp = JSONResponse({
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "picture": user.picture
    })
    # dev settings; tighten for prod
    resp.set_cookie(
        "session",
        token,
        httponly=True,
        secure=False,
        samesite="Lax",
        path="/",
        max_age=60 * 60 * 24 * 30,
    )
    return resp

class GoogleAuthIn(BaseModel):
    credential: str

class SignupIn(BaseModel):
    email: str
    password: str
    name: Optional[str] = None

class LoginIn(BaseModel):
    email: str
    password: str
@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.get("/api/ping")
def ping():
    return {"ok": True}

@app.get("/api/me")
def me(req: Request, db: Session = Depends(get_db)):
    payload = decode_cookie(req)
    uid = payload.get("uid")
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(401, "User not found")
    return {"id": user.id, "email": user.email, "name": user.name, "picture": user.picture}

@app.post("/api/logout")
def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("session", path="/")
    return resp

class GoogleAuthIn(BaseModel):
    credential: Optional[str] = None       
    access_token: Optional[str] = None    

DEBUG = os.getenv("DEBUG", "1") not in ("0", "false", "False")

@app.post("/api/auth/google")
def auth_google(body: GoogleAuthIn, db: Session = Depends(get_db)):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(500, "Missing GOOGLE_CLIENT_ID on server")

    sub = email = name = picture = None

    try:
        if body.credential:

            info = id_token.verify_oauth2_token(body.credential, grequests.Request(), GOOGLE_CLIENT_ID)
            sub = info["sub"]
            email = info.get("email")
            name = info.get("name")
            picture = info.get("picture")
        elif body.access_token:
            import requests as pyrequests
            r = pyrequests.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {body.access_token}"},
                timeout=10,
            )
            if r.status_code != 200:
                raise HTTPException(400, f"Google userinfo failed: {r.text}")
            info = r.json()
            sub = info.get("sub")
            email = info.get("email")
            name = info.get("name")
            picture = info.get("picture")
        else:
            raise HTTPException(400, "Missing Google token")
    except Exception as e:
        if DEBUG:
            print("Google verify failed:", repr(e))
            raise HTTPException(status_code=400, detail=f"google_verify_error: {e}")
        raise HTTPException(400, "Invalid Google token")

    if not sub:
        raise HTTPException(400, "Missing Google sub")

    # Upsert user
    user = db.query(User).filter(User.google_sub == sub).first()
    if not user:
        user = User(
            google_sub=sub,
            email=email,
            name=name,
            picture=picture,
            created_at=datetime.utcnow(),
            last_login=datetime.utcnow(),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        user.email = email or user.email
        user.name = name or user.name
        user.picture = picture or user.picture
        user.last_login = datetime.utcnow()
        db.commit()

    # Audit
    db.add(LoginEvent(user_id=user.id, provider="google"))
    db.commit()

    return set_session_and_return_user(user)

# ---------- Email/Password Signup ----------
@app.post("/api/signup")
def signup(body: SignupIn, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    name = (body.name or "").strip() or email.split("@")[0]

    # unique email
    exists = db.query(User).filter(User.email == email).first()
    if exists:
        raise HTTPException(409, "Email already registered")

    pw_hash = bcrypt.hashpw(body.password.encode("utf-8"), bcrypt.gensalt()).decode()

    user = User(
        google_sub=f"local-{email}",
        email=email,
        name=name,
        picture=None,
        password_hash=pw_hash,
        created_at=datetime.utcnow(),
        last_login=datetime.utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.add(LoginEvent(user_id=user.id, provider="local"))
    db.commit()

    return set_session_and_return_user(user)

# ---------- Email/Password Login ----------
@app.post("/api/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if not user or not user.password_hash:
        raise HTTPException(401, "Invalid credentials")

    ok = bcrypt.checkpw(body.password.encode("utf-8"), user.password_hash.encode("utf-8"))
    if not ok:
        raise HTTPException(401, "Invalid credentials")

    user.last_login = datetime.utcnow()
    db.commit()

    # Audit
    db.add(LoginEvent(user_id=user.id, provider="local"))
    db.commit()

    return set_session_and_return_user(user)
