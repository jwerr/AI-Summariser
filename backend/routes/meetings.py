# backend/routes/meetings.py
from __future__ import annotations

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional
import os, json, re

from ..db import get_db
from ..models import Meeting
from ..schemas import MeetingCreate, MeetingOut
from ..services.summarize import summarize_text_dict_ui  # ← use your existing service


router = APIRouter(prefix="/meetings", tags=["meetings"])

# ---------- Config ----------
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads")).resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ---------- Helpers ----------
def _summary_path(meeting_id: int) -> Path:
    # e.g., ./uploads/meeting_12_summary.json
    return UPLOAD_DIR / f"meeting_{meeting_id}_summary.json"

def _transcripts_index_path(meeting_id: int) -> Path:
    # e.g., ./uploads/meeting_12_transcripts.json (metadata index)
    return UPLOAD_DIR / f"meeting_{meeting_id}_transcripts.json"

def _normalize_summary_payload(payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Convert stored summary JSON into a flat shape friendly for the frontend.
    Ensures consistent keys even if file is missing/processing.
    """
    if not payload:
        return {
            "status": "empty",
            "summary_text": "",
            "key_points": [],
            "decisions": [],
            "action_items": [],
        }

    # new schema preferred
    if "status" in payload and "summary_text" in payload:
        return {
            "status": payload.get("status", "ready"),
            "summary_text": payload.get("summary_text") or "",
            "key_points": payload.get("key_points") or [],
            "decisions": payload.get("decisions") or [],
            "action_items": payload.get("action_items") or [],
        }

    # backwards-compat with old nested shape
    s = payload.get("summary", {})
    return {
        "status": payload.get("status", "ready"),
        "summary_text": s.get("one_liner", ""),
        "key_points": s.get("key_points", []),
        "decisions": s.get("decisions", []),
        "action_items": s.get("action_items", []),
    }

def _read_json(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None

def _write_json(path: Path, data: Dict[str, Any]) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def _append_transcript_index(meeting_id: int, item: Dict[str, Any]) -> None:
    idx_path = _transcripts_index_path(meeting_id)
    data = _read_json(idx_path) or {"meeting_id": meeting_id, "files": []}
    data["files"].append(item)
    _write_json(idx_path, data)

def _load_transcript_text(path_str: str) -> str:
    try:
        p = Path(path_str)
        # naive text read; you can branch on suffix to handle .vtt/.srt/.docx
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""

# ---------- Routes ----------
@router.post("/", response_model=MeetingOut)
def create_meeting(meeting: MeetingCreate, db: Session = Depends(get_db)):
    m = Meeting(
        user_id=meeting.user_id,
        title=meeting.title,
        platform=meeting.platform,
        transcript_path=meeting.transcript_path,
    )
    db.add(m); db.commit(); db.refresh(m)
    return m

@router.get("/user/{user_id}", response_model=list[MeetingOut])
def get_meetings_for_user(user_id: int, db: Session = Depends(get_db)):
    return db.query(Meeting).filter(Meeting.user_id == user_id).all()

@router.post("/{meeting_id}/upload_transcript")
async def upload_transcript(
    meeting_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    m = db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(404, "Meeting not found")

    # Save the upload
    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    safe_name = f"meeting_{meeting_id}_{timestamp}_{file.filename}"
    dest = UPLOAD_DIR / safe_name
    dest.write_bytes(await file.read())

    # Track latest transcript on the Meeting row (for convenience)
    m.transcript_path = str(dest)
    db.add(m); db.commit(); db.refresh(m)

    # Append to transcripts index for this meeting (list/history)
    _append_transcript_index(meeting_id, {
        "filename": file.filename,
        "stored_as": safe_name,
        "path": str(dest),
        "size": dest.stat().st_size,
        "uploaded_at": timestamp,
    })

    return {"ok": True, "meeting_id": m.id, "transcript_path": m.transcript_path}

@router.get("/{meeting_id}/transcripts")
def list_transcripts(meeting_id: int, db: Session = Depends(get_db)):
    # Return the indexed list; if none, return empty shape
    m = db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(404, "Meeting not found")

    idx = _read_json(_transcripts_index_path(meeting_id)) or {"meeting_id": meeting_id, "files": []}
    return idx

@router.post("/{meeting_id}/summarize")
def summarize_meeting(
    meeting_id: int,
    bg: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Writes a JSON summary file and normalizes the response for the UI.
    We first write a 'processing' placeholder then complete in background.
    """
    m = db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(404, "Meeting not found")
    if not m.transcript_path:
        raise HTTPException(400, "Upload a transcript first")

    now = datetime.utcnow().isoformat() + "Z"
    outpath = _summary_path(m.id)

    # (A) write a processing placeholder so UI can show immediate state
    processing = {
        "meeting_id": m.id,
        "title": m.title,
        "user_id": m.user_id,
        "platform": m.platform,
        "transcript_path": m.transcript_path,
        "generated_at": now,
        "status": "processing",
        "summary_text": "",
        "key_points": [],
        "decisions": [],
        "action_items": [],
    }
    _write_json(outpath, processing)

    # (B) optional: small DB breadcrumb
    m.description = f"Summary processing started; file: {outpath.name} at {now}"
    db.add(m); db.commit(); db.refresh(m)

    # (C) kick background summarization (replace stub with your real LLM)
    bg.add_task(_do_summarize_and_update, meeting_id, str(outpath))

    return {
        "ok": True,
        "summary_path": str(outpath),
        "data": processing,
        "normalized": _normalize_summary_payload(processing),
    }

from ..services.summarize import summarize_text_dict_ui

def _do_summarize_and_update(meeting_id: int, outpath_str: str):
    """
    Background worker: read latest transcript, build short one-liner summary
    (for the big box), and preserve bullets for the 3 cards.
    """
    try:
        outpath = Path(outpath_str)
        current = _read_json(outpath) or {}
        transcript_path = current.get("transcript_path", "")

        # 1) Extract transcript text (txt/vtt/srt/docx/pdf)
        text = _load_transcript_text(transcript_path)
        if not (text or "").strip():
            _write_json(outpath, {
                **current,
                "status": "error",
                "error": "No readable text in transcript (possibly image-only PDF or corrupted file).",
                "summary_text": "",
                "key_points": [],
                "decisions": [],
                "action_items": [],
                "completed_at": datetime.utcnow().isoformat() + "Z",
            })
            return

        # 2) Run summarizer; if it fails for any reason, fall back to a local one-liner
        model = os.getenv("MODEL_NAME") or "gpt-4o-mini"
        try:
            flat = summarize_text_dict_ui(
                text,
                max_tokens=800,
                temperature=0.2,
                model=model,
            ) or {}
        except Exception as e:
            flat = {}

        # Extract bullets (unchanged)
        key_points = flat.get("key_points")   or []
        decisions  = flat.get("decisions")    or []
        action_itm = flat.get("action_items") or []

        # 3) Force the main box to be a SHORT one-liner only (no bullet concatenation)
        one_liner = (flat.get("one_liner") or "").strip()
        if not one_liner:
            # crude local one-liner: first non-trivial sentence from text
            first = re.split(r"(?<=[.!?])\s+", text.strip())
            one_liner = next((s for s in first if len(s.strip()) >= 12), text.strip())[:300]

        short = re.sub(r"\s+", " ", one_liner).strip()
        if len(short) > 240:
            short = short[:240].rsplit(" ", 1)[0].rstrip(",;:.") + "…"

        done = {
            **current,
            "status": "ready",
            "summary_text": short,        # <- one-liner only for the big box
            "key_points": key_points,     # bullets unchanged
            "decisions": decisions,
            "action_items": action_itm,
            "completed_at": datetime.utcnow().isoformat() + "Z",
        }
        _write_json(outpath, done)

    except Exception as e:
        failed = {
            "status": "error",
            "error": str(e),
            "summary_text": "",
            "key_points": [],
            "decisions": [],
            "action_items": [],
        }
        try:
            _write_json(Path(outpath_str), failed)
        except Exception:
            pass


@router.get("/{meeting_id}/summary")
def get_summary(meeting_id: int, db: Session = Depends(get_db)):
    m = db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(404, "Meeting not found")

    path = _summary_path(meeting_id)
    if not path.exists():
        # no summary yet
        return {
            "summary_path": None,
            "data": None,
            "normalized": _normalize_summary_payload(None)
        }

    data = _read_json(path)
    if data is None:
        raise HTTPException(500, "Summary file is unreadable")

    return {
        "summary_path": str(path),
        "data": data,
        "normalized": _normalize_summary_payload(data),
    }

def _ocr_pdf_to_text(pdf_path: Path) -> str:
    """
    OCR fallback for image-only PDFs.
    Requires: Tesseract installed on the system, and Python packages:
      pip install pdf2image pillow pytesseract
    On macOS: brew install tesseract
    On Ubuntu: sudo apt-get install tesseract-ocr
    """
    try:
        from pdf2image import convert_from_path
        import pytesseract
        pages = convert_from_path(str(pdf_path), dpi=200)
        out = []
        for img in pages:
            out.append(pytesseract.image_to_string(img))
        return "\n".join(out).strip()
    except Exception:
        return ""


def _load_transcript_text(path_str: str) -> str:
    """
    Best-effort text extraction by file type.
    """
    try:
        p = Path(path_str)
        suffix = p.suffix.lower()

        # Plain text
        if suffix in {".txt"}:
            return p.read_text(encoding="utf-8", errors="ignore")

        # WebVTT (.vtt) → strip headers & timestamps
        if suffix == ".vtt":
            raw = p.read_text(encoding="utf-8", errors="ignore")
            lines = []
            for line in raw.splitlines():
                s = line.strip()
                if s.startswith(("WEBVTT", "Kind:", "Language:")): 
                    continue
                if "-->" in s:   # timestamp cue
                    continue
                if s.isdigit():  # cue number
                    continue
                lines.append(line)
            return "\n".join(lines)

        # SubRip (.srt) → drop timestamps & indices
        if suffix == ".srt":
            raw = p.read_text(encoding="utf-8", errors="ignore")
            lines = []
            for line in raw.splitlines():
                s = line.strip()
                if s.isdigit():
                    continue
                if "-->" in s:
                    continue
                lines.append(line)
            return "\n".join(lines)

        # DOCX
        if suffix == ".docx":
            try:
                from docx import Document  # pip install python-docx
                doc = Document(str(p))
                return "\n".join(para.text for para in doc.paragraphs)
            except Exception:
                pass  # fall through to generic read

        # PDF
         # PDF
        if suffix == ".pdf":
            # Try PyPDF first
            try:
                from pypdf import PdfReader
                reader = PdfReader(str(p))
                chunks = []
                for page in reader.pages:
                    chunks.append(page.extract_text() or "")
                text = "\n".join(chunks).strip()
                if text:
                    return text
            except Exception:
                pass

            # pdfminer fallback
            try:
                from io import StringIO
                from pdfminer.high_level import extract_text_to_fp
                output = StringIO()
                with open(str(p), "rb") as fh:
                    extract_text_to_fp(fh, output)
                text = output.getvalue().strip()
                if text:
                    return text
            except Exception:
                pass

            # OCR fallback (image-only PDF)
            try:
                ocr_text = _ocr_pdf_to_text(p)
                if (ocr_text or "").strip():
                    return ocr_text
            except Exception:
                pass

            # Still nothing
            return ""


        # Fallback: attempt text read
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""
