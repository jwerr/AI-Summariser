# backend/main.py
from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List

import bcrypt
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Depends, UploadFile, File, APIRouter, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.encoders import jsonable_encoder
from jose import jwt, JWTError
from sqlalchemy import text
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from .routes import qa_bot


# --- load envs early ---
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))
load_dotenv()

# --- DB / Models / Schemas / Services ---
from .db import Base, engine, get_db
from .models import User, LoginEvent, Meeting, Transcript, Summary

from .schemas import UserMeOut, TranscriptOut, SummaryOut, SummaryCreate
from .services.summarize import summarize_text, summarize_text_dict_ui

# --- Routers / modules ---
from .routes.meetings import router as meetings_router

from .routes import qa as qa_routes
from .routes.qa import router as qa_router

# Google helper module (used by other routes)
from .routes import google_oauth
from .routes import google_drive

# If your google_calendar.py was refactored to expose multiple routers:
#   google_router  -> /api/google/... (auth-url, status)
#   auth_router    -> /api/auth/google/callback
#   calendar_router -> /api/calendar/events, /api/calendar/create
from .routes.google_calendar import google_router, auth_router, calendar_router

# Drive webhook router
from .routes.google_drive_webhook import router as drive_router

# ========= Config =========
JWT_SECRET = os.getenv("JWT_SECRET", "dev_secret_change_me")
ALGO = "HS256"
JWT_EXPIRE_MINUTES = 60 * 24 * 30
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
DEBUG = os.getenv("DEBUG", "1").lower() not in ("0", "false")

CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
]

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
from .routes import google_status



# ========= App =========
app = FastAPI(title="AI Summariser API", version="0.3.4")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(meetings_router, prefix="/api")
app.include_router(qa_routes.router)
app.include_router(qa_router, prefix="/api")

# Google / Calendar / Drive
app.include_router(google_router)     # /api/google/...
app.include_router(auth_router)       # /api/auth/google/...
app.include_router(calendar_router)   # /api/calendar/...
app.include_router(drive_router)      # /api/google/drive/...
app.include_router(google_status.router)
app.include_router(qa_bot.router)
app.include_router(google_drive.router)
# Create tables (dev). In prod, use Alembic.
Base.metadata.create_all(bind=engine)


# ========= small idempotent DDLs =========
def ensure_profile_columns():
    ddl = """
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS title    varchar(255);
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bio      text;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS timezone varchar(128);
    """
    with engine.begin() as conn:
        conn.execute(text(ddl))

def ensure_summary_columns():
    ddl = """
    ALTER TABLE public.summaries
      ADD COLUMN IF NOT EXISTS one_liner     text,
      ADD COLUMN IF NOT EXISTS markdown      text,
      ADD COLUMN IF NOT EXISTS summary_text  text,
      ADD COLUMN IF NOT EXISTS model_used    varchar(255),
      ADD COLUMN IF NOT EXISTS created_at    timestamptz DEFAULT now();
    """
    with engine.begin() as conn:
        conn.execute(text(ddl))

def ensure_meeting_binding_columns():
    ddl = """
    -- Bind transcripts & summaries to a meeting (handles legacy DBs)
    ALTER TABLE public.transcripts
      ADD COLUMN IF NOT EXISTS meeting_id integer;

    CREATE INDEX IF NOT EXISTS idx_transcripts_meeting_id
      ON public.transcripts(meeting_id);

    ALTER TABLE public.summaries
      ADD COLUMN IF NOT EXISTS meeting_id integer;

    CREATE INDEX IF NOT EXISTS idx_summaries_meeting_id
      ON public.summaries(meeting_id);
    """
    with engine.begin() as conn:
        conn.execute(text(ddl))

ensure_profile_columns()
ensure_summary_columns()
ensure_meeting_binding_columns()

# ========= debug =========
_debug = APIRouter()
@_debug.get("/__routes")
def routes_dump():
    return sorted([f"{r.methods} {getattr(r, 'path', getattr(r, 'path_format', ''))}" for r in app.router.routes])
app.include_router(_debug)

def _strip_nuls(obj):
    if obj is None:
        return None
    if isinstance(obj, str):
        return obj.replace("\x00", "")
    if isinstance(obj, list):
        return [_strip_nuls(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _strip_nuls(v) for k, v in obj.items()}
    return obj

# ========= helpers (auth/jwt) =========
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
        "picture": user.picture,
    })
    payload = {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "picture": user.picture,
        "title": getattr(user, "title", None),
        "bio": getattr(user, "bio", None),
        "timezone": getattr(user, "timezone", None),
        "created_at": user.created_at,
        "last_login": user.last_login,
    }
    resp = JSONResponse(jsonable_encoder(payload))
    resp.set_cookie("session", token, httponly=True, secure=False, samesite="Lax", path="/", max_age=60*60*24*30)
    return resp

def get_current_user(req: Request, db: Session = Depends(get_db)) -> User:
    payload = decode_cookie(req)
    uid = payload.get("uid")
    user = db.get(User, uid)
    if not user:
        raise HTTPException(401, "User not found")
    return user

# ========= Auth input schemas =========
class GoogleAuthIn(BaseModel):
    credential: Optional[str] = None
    access_token: Optional[str] = None

class SignupIn(BaseModel):
    first_name: str
    last_name: Optional[str] = ""
    email: EmailStr
    password: str

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class UserMeIn(BaseModel):
    name: Optional[str] = None
    title: Optional[str] = None
    bio: Optional[str] = None
    timezone: Optional[str] = None
    picture: Optional[str] = None

# ========= health =========
@app.get("/api/health")
def health():
    return {"ok": True, "time": datetime.utcnow().isoformat() + "Z"}

@app.get("/api/ping")
def ping():
    return {"ok": True}

# ========= session / me =========
@app.get("/api/me")
def me(current: User = Depends(get_current_user)):
    
    return {
        "id": current.id,
        "email": current.email,
        "name": current.name,
        "picture": current.picture,
        "title": getattr(current, "title", None),
        "bio": getattr(current, "bio", None),
        "timezone": getattr(current, "timezone", None),
        "created_at": current.created_at,
        "last_login": current.last_login,
    }

@app.put("/api/me")
def update_me(body: UserMeIn, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    if body.name is not None: current.name = body.name.strip()
    if body.title is not None: current.title = body.title.strip()
    if body.bio is not None: current.bio = body.bio.strip()
    if body.timezone is not None: current.timezone = body.timezone.strip()
    if body.picture is not None: current.picture = body.picture
    db.add(current); db.commit(); db.refresh(current)
    return {
        "id": current.id,
        "email": current.email,
        "name": current.name,
        "picture": current.picture,
        "title": getattr(current, "title", None),
        "bio": getattr(current, "bio", None),
        "timezone": getattr(current, "timezone", None),
        "created_at": current.created_at,
        "last_login": current.last_login,
    }

@app.post("/api/auth/logout")
def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("session", path="/")
    return resp

# ========= Google OAuth =========
from google.oauth2 import id_token
from google.auth.transport import requests as grequests
import requests as pyrequests

@app.post("/api/auth/google")
def auth_google(body: GoogleAuthIn, db: Session = Depends(get_db)):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(500, "Missing GOOGLE_CLIENT_ID on server")

    sub = email = name = picture = None
    try:
        if body.credential:
            info = id_token.verify_oauth2_token(body.credential, grequests.Request(), GOOGLE_CLIENT_ID)
            sub, email, name, picture = info["sub"], info.get("email"), info.get("name"), info.get("picture")
        elif body.access_token:
            r = pyrequests.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {body.access_token}"},
                timeout=10,
            )
            if r.status_code != 200:
                raise HTTPException(400, f"Google userinfo failed: {r.text}")
            info = r.json()
            sub, email, name, picture = info.get("sub"), info.get("email"), info.get("name"), info.get("picture")
        else:
            raise HTTPException(400, "Missing Google token")
    except Exception as e:
        if DEBUG:
            print("Google verify failed:", repr(e))
            raise HTTPException(status_code=400, detail=f"google_verify_error: {e}")
        raise HTTPException(400, "Invalid Google token")

    if not sub:
        raise HTTPException(400, "Missing Google sub")

    user = db.query(User).filter(User.google_sub == sub).first()
    if not user:
        user = User(google_sub=sub, email=email, name=name, picture=picture,
                    created_at=datetime.utcnow(), last_login=datetime.utcnow())
        db.add(user); db.commit(); db.refresh(user)
    else:
        user.email = email or user.email
        user.name = name or user.name
        user.picture = picture or user.picture
        user.last_login = datetime.utcnow()
        db.commit()

    db.add(LoginEvent(user_id=user.id, provider="google")); db.commit()
    return set_session_and_return_user(user)

# ========= local signup/login =========
@app.post("/api/auth/signup", response_model=UserMeOut)
def signup(body: SignupIn, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    first_name = body.first_name.strip()
    last_name = (body.last_name or "").strip()
    full_name = f"{first_name} {last_name}".strip()

    exists = db.query(User).filter(User.email == email).first()
    if exists:
        raise HTTPException(409, "Email already registered")

    pw_hash = bcrypt.hashpw(body.password.encode("utf-8"), bcrypt.gensalt()).decode()

    user = User(
        google_sub=f"local-{email}",
        email=email,
        name=full_name,
        picture=None,
        password_hash=pw_hash,
        created_at=datetime.utcnow(),
        last_login=datetime.utcnow(),
    )
    db.add(user); db.commit(); db.refresh(user)
    db.add(LoginEvent(user_id=user.id, provider="local")); db.commit()
    return set_session_and_return_user(user)

@app.post("/api/signup", response_model=UserMeOut)
def signup_alias(body: SignupIn, db: Session = Depends(get_db)):
    return signup(body, db)

@app.post("/api/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if not user or not user.password_hash:
        raise HTTPException(401, "Invalid credentials")

    ok = bcrypt.checkpw(body.password.encode("utf-8"), user.password_hash.encode("utf-8"))
    if not ok:
        raise HTTPException(401, "Invalid credentials")

    user.last_login = datetime.utcnow(); db.commit()
    db.add(LoginEvent(user_id=user.id, provider="local")); db.commit()
    return set_session_and_return_user(user)

# ========= Transcripts / Summaries =========
# Broadened allowlists
ALLOWED_TYPES = {
    "text/plain",
    "text/vtt",
    "application/x-subrip",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/octet-stream",  # browsers sometimes send this
    "",                          # some browsers leave type blank
}
ALLOWED_EXTS = {".txt", ".vtt", ".srt", ".pdf", ".doc", ".docx"}

def _ext_of(name: Optional[str]) -> str:
    if not name:
        return ""
    import os as _os
    return _os.path.splitext(name.strip().lower())[1]

def _should_parse_as_text(mime: str, ext: str) -> bool:
    if mime in ("text/plain", "text/vtt", "application/x-subrip"):
        return True
    if ext in (".txt", ".vtt", ".srt"):
        return True
    return False

def _mk_markdown(one_liner: str, key_points: List[str], decisions: List[str], action_items: List[str]) -> str:
    lines: List[str] = []
    if one_liner: lines += [f"**Summary:** {one_liner}", ""]
    if key_points: lines += ["### Key Points"] + [f"- {p}" for p in key_points] + [""]
    if decisions: lines += ["### Decisions"] + [f"- {d}" for d in decisions] + [""]
    if action_items: lines += ["### Action Items"] + [f"- {a}" for a in action_items] + [""]
    return "\n".join(lines).strip()

# PDF text helper
def _extract_pdf_text(path: str) -> str:
    try:
        from pypdf import PdfReader
        reader = PdfReader(path)
        out = []
        for page in reader.pages:
            txt = page.extract_text() or ""
            out.append(txt)
        return "\n".join(out)
    except Exception:
        return ""

@app.post("/api/transcripts/upload", response_model=TranscriptOut)
async def upload_transcript(
    f: UploadFile = File(...),
    meeting_id: Optional[int] = Query(default=None, description="Bind this upload to a meeting"),
    db: Session = Depends(get_db),
):
    orig_name = f.filename or "upload"
    ext = _ext_of(orig_name)
    mime = (f.content_type or "").strip().lower()

    # ---- validate meeting + capture ids ----
    mtg = None
    meeting_user_id: Optional[int] = None
    meeting_pk: Optional[int] = None
    if meeting_id is not None:
        try:
            meeting_pk = int(meeting_id)
        except Exception:
            raise HTTPException(400, f"Invalid meeting_id: {meeting_id!r}")
        mtg = db.get(Meeting, meeting_pk)
        if not mtg:
            raise HTTPException(404, f"Meeting {meeting_id} not found")
        meeting_user_id = mtg.user_id

    # ---- type allowlist ----
    if (mime not in ALLOWED_TYPES) and (ext not in ALLOWED_EXTS):
        raise HTTPException(
            400,
            f"Unsupported type: mime={mime or '(empty)'} ext={ext or '(none)'}; "
            f"allowed: {sorted(ALLOWED_EXTS)}"
        )

    # ---- write file ----
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    safe_name = f"{ts}_{orig_name.replace(' ', '_')}"
    dest_path = os.path.join(UPLOAD_DIR, safe_name)

    size = 0
    with open(dest_path, "wb") as out:
        while True:
            chunk = await f.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            out.write(chunk)

    if size > 50 * 1024 * 1024:
        try: os.remove(dest_path)
        except Exception: pass
        raise HTTPException(400, "File too large (>50MB)")

    # ---- extract text (best-effort) ----
    text = None
    try:
        if _should_parse_as_text(mime, ext):
            with open(dest_path, "r", encoding="utf-8", errors="ignore") as rf:
                text = rf.read()
        elif mime == "application/pdf" or ext == ".pdf":
            text = _extract_pdf_text(dest_path)
    except Exception:
        text = None

    # ---- persist row (bind meeting_id + user_id explicitly) ----
    rec = Transcript(
        user_id=meeting_user_id,
        filename=orig_name,
        mime=mime or "application/octet-stream",
        size=size,
        storage_path=dest_path,
        text=_strip_nuls(text) if isinstance(text, str) else text,
        meeting_id=meeting_pk,   # <<<< set directly, no hasattr/setattr dance
    )
    db.add(rec); db.commit(); db.refresh(rec)

    # quick server-side proof in logs
    print(f"[upload_transcript] saved t.id={rec.id} meeting_id={rec.meeting_id} user_id={rec.user_id} file={rec.filename}")

    return jsonable_encoder({
        "id": rec.id,
        "user_id": rec.user_id,
        "filename": rec.filename,
        "mime": rec.mime,
        "size": rec.size,
        "storage_path": rec.storage_path,
        "text": rec.text,
        "meeting_id": rec.meeting_id,
        "upload_ts": getattr(rec, "created_at", datetime.utcnow()),
    })

# Default changed: ONLY uploads unless ?auto=1 is passed.
@app.post("/api/transcripts/upload_and_summarize.txt", response_class=PlainTextResponse)
async def upload_and_summarize_text(
    f: UploadFile = File(...),
    meeting_id: Optional[int] = Query(default=None),
    auto: int = Query(default=0, description="Set to 1 to summarize after upload"),
    model: Optional[str] = Query(default=None),
    max_tokens: Optional[int] = Query(default=800),
    temperature: Optional[float] = Query(default=0.2),
    db: Session = Depends(get_db),
):
    # Always upload
    resp = await upload_transcript(f=f, meeting_id=meeting_id, db=db)
    if not auto:
        return PlainTextResponse("Uploaded. Summarization is disabled by default for this endpoint.", status_code=202)

    # Only summarize if explicitly requested
    t = db.get(Transcript, resp["id"])
    if not t:
        return PlainTextResponse("Upload failed.", status_code=500)

    text_content = (t.text or "")
    if not text_content:
        if (t.mime or "").lower() == "application/pdf":
            text_content = _extract_pdf_text(t.storage_path)
        else:
            try:
                with open(t.storage_path, "r", encoding="utf-8", errors="ignore") as rf:
                    text_content = rf.read()
            except Exception:
                text_content = ""
    text_content = _strip_nuls(text_content)
    if not text_content:
        return PlainTextResponse("Uploaded, but no readable text found.", status_code=200)

    flat = summarize_text_dict_ui(text_content, max_tokens=max_tokens, temperature=temperature, model=model)
    flat = _strip_nuls(flat)

    s = Summary(
        transcript_id=t.id,
        key_points=flat["key_points"],
        decisions=flat["decisions"],
        action_items=flat["action_items"],
        model_used=model or os.getenv("MODEL_NAME"),
        created_at=datetime.utcnow(),
    )
    if hasattr(Summary, "one_liner"):    s.one_liner = flat["one_liner"]
    if hasattr(Summary, "markdown"):     s.markdown = flat["markdown"]
    if hasattr(Summary, "summary_text"): s.summary_text = flat["summary_text"]
    if hasattr(Summary, "meeting_id"):   s.meeting_id = getattr(t, "meeting_id", meeting_id)

    db.add(s); db.commit(); db.refresh(s)
    return flat["markdown"] or flat["summary_text"]

# ---------- Summarize existing transcript -> return PLAIN TEXT (Markdown) ----------
@app.post("/api/summarize/{transcript_id}.txt", response_class=PlainTextResponse)
def do_summarize_text(
    transcript_id: int,
    params: SummaryCreate = Body(...),
    db: Session = Depends(get_db),
):
    t = db.get(Transcript, transcript_id)
    if not t:
        raise HTTPException(404, "Transcript not found")

    text_content = (t.text or "")
    if not text_content:
        try:
            with open(t.storage_path, "r", encoding="utf-8", errors="ignore") as rf:
                text_content = rf.read()
        except Exception:
            text_content = ""
    if not text_content:
        return PlainTextResponse("No transcript content found.", status_code=200)

    flat = summarize_text_dict_ui(
        text_content,
        max_tokens=params.max_tokens,
        temperature=params.temperature,
        model=params.model,
    )
    flat = _strip_nuls(flat)

    s = Summary(
        transcript_id=t.id,
        key_points=flat["key_points"],
        decisions=flat["decisions"],
        action_items=flat["action_items"],
        model_used=params.model or os.getenv("MODEL_NAME"),
        created_at=datetime.utcnow(),
    )
    if hasattr(Summary, "one_liner"):    s.one_liner = flat["one_liner"]
    if hasattr(Summary, "markdown"):     s.markdown = flat["markdown"]
    if hasattr(Summary, "summary_text"): s.summary_text = flat["summary_text"]
    if hasattr(Summary, "meeting_id"):   s.meeting_id = getattr(t, "meeting_id", None)

    db.add(s); db.commit(); db.refresh(s)
    return flat["markdown"] or flat["summary_text"]

# ---------- JSON summary by transcript id ----------
@app.post("/api/summarize/{transcript_id}", response_model=SummaryOut)
def do_summarize(
    transcript_id: int,
    params: SummaryCreate,
    db: Session = Depends(get_db),
):
    t = db.get(Transcript, transcript_id)
    if not t:
        raise HTTPException(404, "Transcript not found")

    text_content = (t.text or "")
    if not text_content:
        try:
            with open(t.storage_path, "r", encoding="utf-8", errors="ignore") as rf:
                text_content = rf.read()
        except Exception:
            text_content = ""

    data = summarize_text(text_content, max_tokens=params.max_tokens, temperature=params.temperature, model=params.model)

    s = Summary(
        transcript_id=t.id,
        key_points=data.get("key_points", []),
        decisions=data.get("decisions", []),
        action_items=data.get("action_items", []),
        model_used=params.model or os.getenv("MODEL_NAME"),
        created_at=datetime.utcnow(),
    )
    if hasattr(Summary, "one_liner"):
        one = (data.get("key_points") or data.get("decisions") or data.get("action_items") or [""])[0]
        s.one_liner = one
    if hasattr(Summary, "markdown"):
        s.markdown = _mk_markdown(
            getattr(s, "one_liner", "") or "",
            data.get("key_points", []) or [],
            data.get("decisions", []) or [],
            data.get("action_items", []) or [],
        )
    if hasattr(Summary, "summary_text"):
        s.summary_text = "\n".join(data.get("key_points", []) or [])

    if hasattr(Summary, "meeting_id"):
        s.meeting_id = getattr(t, "meeting_id", None)

    db.add(s); db.commit(); db.refresh(s)
    return s

@app.get("/api/transcripts/{id}", response_model=TranscriptOut)
def get_transcript(id: int, db: Session = Depends(get_db)):
    t = db.get(Transcript, id)
    if not t:
        raise HTTPException(404, "Not found")
    return jsonable_encoder({
        "id": t.id,
        "user_id": t.user_id,
        "filename": t.filename,
        "mime": t.mime,
        "size": t.size,
        "storage_path": t.storage_path,
        "text": t.text,
        "meeting_id": getattr(t, "meeting_id", None),
        "upload_ts": getattr(t, "created_at", datetime.utcnow()),
    })

@app.get("/api/summaries/{id}", response_model=SummaryOut)
def get_summary(id: int, db: Session = Depends(get_db)):
    s = db.get(Summary, id)
    if not s:
        raise HTTPException(404, "Not found")
    return s

@app.get("/api/summaries/by-transcript/{transcript_id}", response_model=List[SummaryOut])
def get_summaries_by_transcript(transcript_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(Summary)
        .filter(Summary.transcript_id == transcript_id)
        .order_by(
            *( [text("created_at DESC NULLS LAST")] if hasattr(Summary, "created_at") else [] ),
            Summary.id.desc()
        )
        .all()
    )
    return rows

# ---------- Meeting-aware summarize/list endpoints ----------
@app.post("/api/meetings/{meeting_id}/summaries.txt", response_class=PlainTextResponse)
def summarize_meeting_text(
    meeting_id: int,
    params: SummaryCreate = Body(default=SummaryCreate()),
    db: Session = Depends(get_db),
):
    # choose most recent transcript for this meeting
    q = db.query(Transcript).filter(getattr(Transcript, "meeting_id") == meeting_id)
    order_cols = []
    if hasattr(Transcript, "created_at"):
        order_cols.append(text("created_at DESC NULLS LAST"))
    order_cols.append(Transcript.id.desc())
    t = q.order_by(*order_cols).first()
    if not t:
        raise HTTPException(400, "No transcript found for this meeting")

    text_content = t.text or ""
    if not text_content:
        try:
            with open(t.storage_path, "r", encoding="utf-8", errors="ignore") as rf:
                text_content = rf.read()
        except Exception:
            text_content = ""
    if not text_content:
        return PlainTextResponse("No transcript content found.", status_code=200)

    flat = summarize_text_dict_ui(
        text_content,
        max_tokens=params.max_tokens,
        temperature=params.temperature,
        model=params.model,
    )
    flat = _strip_nuls(flat)

    s = Summary(
        transcript_id=t.id,
        key_points=flat["key_points"],
        decisions=flat["decisions"],
        action_items=flat["action_items"],
        model_used=params.model or os.getenv("MODEL_NAME"),
        created_at=datetime.utcnow(),
    )
    if hasattr(Summary, "one_liner"):    s.one_liner = flat["one_liner"]
    if hasattr(Summary, "markdown"):     s.markdown = flat["markdown"]
    if hasattr(Summary, "summary_text"): s.summary_text = flat["summary_text"]
    if hasattr(Summary, "meeting_id"):   s.meeting_id = meeting_id

    db.add(s); db.commit(); db.refresh(s)
    return flat["markdown"] or flat["summary_text"]

@app.post("/api/meetings/{meeting_id}/summaries", response_model=SummaryOut)
def summarize_meeting_json(
    meeting_id: int,
    params: SummaryCreate = Body(default=SummaryCreate()),
    db: Session = Depends(get_db),
):
    q = db.query(Transcript).filter(getattr(Transcript, "meeting_id") == meeting_id)
    order_cols = []
    if hasattr(Transcript, "created_at"):
        order_cols.append(text("created_at DESC NULLS LAST"))
    order_cols.append(Transcript.id.desc())
    t = q.order_by(*order_cols).first()
    if not t:
        raise HTTPException(400, "No transcript found for this meeting")

    text_content = t.text or ""
    if not text_content:
        try:
            with open(t.storage_path, "r", encoding="utf-8", errors="ignore") as rf:
                text_content = rf.read()
        except Exception:
            text_content = ""

    data = summarize_text(text_content, max_tokens=params.max_tokens, temperature=params.temperature, model=params.model)

    s = Summary(
        transcript_id=t.id,
        key_points=data.get("key_points", []),
        decisions=data.get("decisions", []),
        action_items=data.get("action_items", []),
        model_used=params.model or os.getenv("MODEL_NAME"),
        created_at=datetime.utcnow(),
    )
    if hasattr(Summary, "one_liner"):
        one = (data.get("key_points") or data.get("decisions") or data.get("action_items") or [""])[0]
        s.one_liner = one
    if hasattr(Summary, "markdown"):
        s.markdown = _mk_markdown(
            getattr(s, "one_liner", "") or "",
            data.get("key_points", []) or [],
            data.get("decisions", []) or [],
            data.get("action_items", []) or [],
        )
    if hasattr(Summary, "summary_text"):
        s.summary_text = "\n".join(data.get("key_points", []) or [])
    if hasattr(Summary, "meeting_id"):
        s.meeting_id = meeting_id

    db.add(s); db.commit(); db.refresh(s)
    return s

@app.get("/api/meetings/{meeting_id}/summaries", response_model=List[SummaryOut])
def list_meeting_summaries(meeting_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(Summary)
        .filter(getattr(Summary, "meeting_id") == meeting_id)
        .order_by(
            *( [text("created_at DESC NULLS LAST")] if hasattr(Summary, "created_at") else [] ),
            Summary.id.desc()
        )
        .all()
    )
    return rows
@app.get("/api/meetings/{meeting_id}/transcripts")
def list_meeting_transcripts(meeting_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(Transcript)
        .filter(getattr(Transcript, "meeting_id") == meeting_id)
        .order_by(
            *( [text("created_at DESC NULLS LAST")] if hasattr(Transcript, "created_at") else [] ),
            Transcript.id.desc()
        )
        .all()
    )
    # normalize into the same shape your frontend expects
    out = []
    for t in rows:
        out.append({
            "id": t.id,
            "meeting_id": getattr(t, "meeting_id", None),
            "user_id": t.user_id,
            "filename": t.filename,
            "mime": t.mime,
            "size": t.size,
            "storage_path": t.storage_path,
            "text": t.text,
            "upload_ts": getattr(t, "created_at", None),
            "created_at": getattr(t, "created_at", None),
        })
    return out

# Fallback: list meetings for a user (public/simple version)
@app.get("/api/meetings/user/{user_id}")
def list_meetings_for_user(user_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(Meeting)
        .filter(Meeting.user_id == user_id)
        .order_by(
            *( [text("started_at DESC NULLS LAST")] if hasattr(Meeting, "started_at") else [] ),
            Meeting.id.desc()
        )
        .all()
    )
    out = []
    for m in rows:
        out.append({
            "id": m.id,
            "user_id": m.user_id,
            "title": getattr(m, "title", None),
            "platform": getattr(m, "platform", None),
            "started_at": getattr(m, "started_at", None),
            "created_at": getattr(m, "created_at", None),
        })
    return out

