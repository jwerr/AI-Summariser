# backend/utils/io.py
from pathlib import Path

def read_transcript_text(storage_path: str | None) -> str:
    if not storage_path:
        return ""
    p = Path(storage_path)
    if not p.is_absolute():
        # Resolve relative to project root (backend/..)
        base = Path(__file__).resolve().parents[1]  # points at project root next to backend/
        p = (base / storage_path).resolve()
    if not p.exists():
        raise FileNotFoundError(f"Transcript file not found: {p}")
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception as e:
        # last-ditch: binary read then decode
        data = p.read_bytes()
        try:
            return data.decode("utf-8", errors="ignore")
        except Exception:
            return ""
