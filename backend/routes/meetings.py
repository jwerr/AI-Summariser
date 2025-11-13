# 
# backend/routes/meetings.py
from __future__ import annotations

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, BackgroundTasks, Response
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional
import os, json, re

from ..db import get_db
from ..models import Meeting
from ..schemas import MeetingCreate, MeetingOut
from ..services.summarize import summarize_text_dict_ui  # your existing service

router = APIRouter(prefix="/meetings", tags=["meetings"])

# ---------- Config ----------
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads")).resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ---------- Helpers ----------
def _summary_path(meeting_id: int) -> Path:
    return UPLOAD_DIR / f"meeting_{meeting_id}_summary.json"

def _transcripts_index_path(meeting_id: int) -> Path:
    return UPLOAD_DIR / f"meeting_{meeting_id}_transcripts.json"

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

def _normalize_summary_payload(payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not payload:
        return {
            "status": "empty",
            "summary_text": "",
            "key_points": [],
            "decisions": [],
            "action_items": [],
        }
    if "status" in payload and "summary_text" in payload:
        return {
            "status": payload.get("status", "ready"),
            "summary_text": payload.get("summary_text") or "",
            "key_points": payload.get("key_points") or [],
            "decisions": payload.get("decisions") or [],
            "action_items": payload.get("action_items") or [],
        }
    # backward-compat
    s = payload.get("summary", {})
    return {
        "status": payload.get("status", "ready"),
        "summary_text": s.get("one_liner", ""),
        "key_points": s.get("key_points", []),
        "decisions": s.get("decisions", []),
        "action_items": s.get("action_items", []),
    }

def _ocr_pdf_to_text(pdf_path: Path) -> str:
    """
    OCR fallback for image-only PDFs.
    Requires: Tesseract + pdf2image + pillow + pytesseract
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
        if suffix == ".txt":
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
                pass  # fall through

        # PDF
        if suffix == ".pdf":
            # pypdf
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

            # pdfminer
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

            # OCR fallback
            try:
                ocr_text = _ocr_pdf_to_text(p)
                if (ocr_text or "").strip():
                    return ocr_text
            except Exception:
                pass

            return ""  # still nothing

        # Fallback generic read
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

@router.get("/{meeting_id}")
def get_meeting(meeting_id: int, db: Session = Depends(get_db)):
    meeting = (
        db.query(Meeting)
        .filter(Meeting.id == meeting_id)
        .first()
    )

    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    return meeting

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

    # Append to transcripts index (list/history)
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
    m = db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(404, "Meeting not found")
    idx = _read_json(_transcripts_index_path(meeting_id)) or {"meeting_id": meeting_id, "files": []}
    return idx

# ---------- NEW: Get transcript (text view / download) ----------
@router.get("/{meeting_id}/transcript")
def get_transcript(
    meeting_id: int,
    raw: bool = False,  # ?raw=true → download original file; default → text view
    db: Session = Depends(get_db),
):
    m = db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(404, "Meeting not found")

    if not m.transcript_path:
        raise HTTPException(404, "No transcript for this meeting")

    p = Path(m.transcript_path)

    if not p.exists():
        raise HTTPException(404, "Transcript file not found")

    # If you want the original file (for download)
    if raw:
        return FileResponse(p, filename=p.name)

    # Default: return best-effort text
    text = _load_transcript_text(str(p))

    # Even if text extraction fails, return a friendly message instead of 500
    if not (text or "").strip():
        text = (
            "Transcript file exists but could not be read as plain text.\n\n"
            "It might be an image-only PDF or an unsupported format.\n"
            "Try using the Download button to open it directly."
        )

    return Response(
        content=text,
        media_type="text/plain; charset=utf-8",
    )

@router.post("/{meeting_id}/summarize")
def summarize_meeting(
    meeting_id: int,
    bg: BackgroundTasks,
    db: Session = Depends(get_db)
):
    m = db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(404, "Meeting not found")
    if not m.transcript_path:
        raise HTTPException(400, "Upload a transcript first")

    now = datetime.utcnow().isoformat() + "Z"
    outpath = _summary_path(m.id)

    # (A) write a processing placeholder
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

    # (B) breadcrumb
    m.description = f"Summary processing started; file: {outpath.name} at {now}"
    db.add(m); db.commit(); db.refresh(m)

    # (C) background summarization
    bg.add_task(_do_summarize_and_update, meeting_id, str(outpath))
    return {
        "ok": True,
        "summary_path": str(outpath),
        "data": processing,
        "normalized": _normalize_summary_payload(processing),
    }

def _do_summarize_and_update(meeting_id: int, outpath_str: str):
    try:
        outpath = Path(outpath_str)
        current = _read_json(outpath) or {}
        transcript_path = current.get("transcript_path", "")

        # 1) Extract text
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

        # 2) Summarize
        model = os.getenv("MODEL_NAME") or "gpt-4o-mini"
        try:
            flat = summarize_text_dict_ui(
                text,
                max_tokens=800,
                temperature=0.2,
                model=model,
            ) or {}
        except Exception:
            flat = {}

        key_points = flat.get("key_points")   or []
        decisions  = flat.get("decisions")    or []
        action_itm = flat.get("action_items") or []

        one_liner = (flat.get("one_liner") or "").strip()
        if not one_liner:
            first = re.split(r"(?<=[.!?])\s+", text.strip())
            one_liner = next((s for s in first if len(s.strip()) >= 12), text.strip())[:300]

        short = re.sub(r"\s+", " ", one_liner).strip()
        if len(short) > 240:
            short = short[:240].rsplit(" ", 1)[0].rstrip(",;:.") + "…"

        done = {
            **current,
            "status": "ready",
            "summary_text": short,
            "key_points": key_points,
            "decisions": decisions,
            "action_items": action_itm,
            "completed_at": datetime.utcnow().isoformat() + "Z",
        }
        _write_json(outpath, done)

    except Exception as e:
        try:
            _write_json(Path(outpath_str), {
                "status": "error",
                "error": str(e),
                "summary_text": "",
                "key_points": [],
                "decisions": [],
                "action_items": [],
            })
        except Exception:
            pass

@router.get("/{meeting_id}/summary")
def get_summary(meeting_id: int, db: Session = Depends(get_db)):
    m = db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(404, "Meeting not found")

    path = _summary_path(meeting_id)
    if not path.exists():
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

# ---------- DELETE transcript only ----------
@router.delete("/{meeting_id}/transcript", status_code=204)
def delete_transcript(
    meeting_id: int,
    db: Session = Depends(get_db),
):
    m = db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # remove files from transcripts index
    try:
        idx_path = _transcripts_index_path(meeting_id)
        idx = _read_json(idx_path) or {}
        for f in (idx.get("files") or []):
            fpath = f.get("path")
            if fpath and os.path.exists(fpath):
                try:
                    os.remove(fpath)
                except Exception:
                    pass
        if idx_path.exists():
            idx_path.unlink(missing_ok=True)
    except Exception:
        pass

    # remove Meeting.transcript_path (latest convenience path) if still present
    try:
        if m.transcript_path and os.path.exists(m.transcript_path):
            os.remove(m.transcript_path)
    except Exception:
        pass

    # clear reference on Meeting
    m.transcript_path = None
    db.add(m)
    db.commit()
    return Response(status_code=204)

# ---------- DELETE meeting ----------
@router.delete("/{meeting_id}", status_code=204)
def delete_meeting(
    meeting_id: int,
    db: Session = Depends(get_db),
):
    """
    Deletes:
    - Meeting row
    - Summary JSON file
    - Transcript index JSON file
    - Transcript files referenced by the index and Meeting.transcript_path
    """
    m = db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # remove summary JSON
    try:
        sp = _summary_path(meeting_id)
        if sp.exists():
            sp.unlink(missing_ok=True)
    except Exception:
        pass

    # remove files from transcripts index
    try:
        idx_path = _transcripts_index_path(meeting_id)
        idx = _read_json(idx_path) or {}
        for f in (idx.get("files") or []):
            fpath = f.get("path")
            if fpath and os.path.exists(fpath):
                try:
                    os.remove(fpath)
                except Exception:
                    pass
        if idx_path.exists():
            idx_path.unlink(missing_ok=True)
    except Exception:
        pass

    # remove Meeting.transcript_path (latest convenience path) if still present
    try:
        if m.transcript_path and os.path.exists(m.transcript_path):
            os.remove(m.transcript_path)
    except Exception:
        pass

    # delete DB row
    db.delete(m)
    db.commit()
    return Response(status_code=204)
