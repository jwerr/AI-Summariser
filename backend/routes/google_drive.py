# backend/routes/google_drive.py
from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User
from .google_calendar import _user_from_cookie_or_header
from .google_oauth import refresh_access_token

# NOTE: prefix = "/api/google/drive" so the full path becomes:
# POST /api/google/drive/backfill  ✅
router = APIRouter(prefix="/api/google/drive", tags=["google-drive"])


@router.post("/backfill")
async def backfill_drive_transcripts(
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Fetch transcript-like files from Google Drive for this user.
    (For now: just return the list; you can later also create Meeting/Transcript
    rows from these files.)
    """
    user: User = _user_from_cookie_or_header(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # make sure we have a fresh access token
    access_token = user.google_access_token 

    # Filter to "transcript-ish" files – tweak this query for your naming scheme
    q = (
        "trashed = false and ("
        "mimeType = 'text/plain' or "
        "mimeType = 'application/vnd.google-apps.document' or "
        "mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' or "
        "name contains '.vtt' or "
        "name contains '.srt' or "
        "name contains '.txt'"
        ") and "
        "name contains 'transcript'"
    )

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            "https://www.googleapis.com/drive/v3/files",
            headers={"Authorization": f"Bearer {access_token}"},
            params={
                "q": q,
                "pageSize": 50,
                "orderBy": "modifiedTime desc",
                "fields": "files(id,name,mimeType,modifiedTime,webViewLink,size)",
            },
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    data = resp.json()
    files = data.get("files", [])
    return {"files": files}
