# backend/routes/google_drive_webhook.py
from datetime import datetime, timezone, timedelta
import os
import uuid

from fastapi import APIRouter, Request, HTTPException
from googleapiclient.discovery import build

from .google_common import get_user_and_creds, update_user_fields, ensure_fresh_creds

router = APIRouter(prefix="/api/google/drive", tags=["google-drive"])

# Public HTTPS base for callbacks (ngrok or prod)
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
WEBHOOK_ENDPOINT = "/api/google/drive/webhook"  # final path this router serves

def _drive(creds):
    return build("drive", "v3", credentials=creds, cache_discovery=False)

def _now_utc():
    return datetime.now(timezone.utc)

def ensure_drive_watch(request: Request):
    """
    Create/refresh a channel watching the user's Drive changes feed.
    NOTE: Google requires a public HTTPS address for webhooks.
    """
    if not PUBLIC_BASE_URL.startswith("https://"):
        raise HTTPException(status_code=500, detail="PUBLIC_BASE_URL must be an https URL (ngrok/prod)")

    user, creds = get_user_and_creds(request)
    svc = _drive(ensure_fresh_creds(user, creds))

    # get start page token if first-time
    start_token = user.drive_start_page_token
    if not start_token:
        start_token = svc.changes().getStartPageToken().execute().get("startPageToken")

    channel_id = f"drive-{uuid.uuid4()}"
    address = f"{PUBLIC_BASE_URL}{WEBHOOK_ENDPOINT}"  # <- PUBLIC address, not localhost

    body = {
        "id": channel_id,
        "type": "web_hook",
        "address": address,
        # "params": {"payload": "true"},  # optional
    }
    watch = svc.changes().watch(pageToken=start_token, body=body).execute()
    # Persist channel + resource + expiry
    update_user_fields(user, {
        "drive_channel_id": watch.get("id"),
        "drive_resource_id": watch.get("resourceId"),
        "drive_start_page_token": start_token,
        # Google channels usually have ~1 day TTL; refresh ahead of time
        "drive_channel_expires_at": _now_utc() + timedelta(hours=23),
    })
    return {"ok": True, "address": address}

@router.post("/webhook", name="drive_webhook")
async def drive_webhook(request: Request):
    # Validate headers Google sends
    ch_id = request.headers.get("X-Goog-Channel-Id")
    res_id = request.headers.get("X-Goog-Resource-Id")
    if not ch_id or not res_id:
        raise HTTPException(status_code=400, detail="Missing channel headers")

    # Lookup user by channel id (your get_user_and_creds must support this)
    user, creds = get_user_and_creds(request, by_channel_id=ch_id)
    if not user or user.drive_resource_id != res_id:
        raise HTTPException(status_code=404, detail="Unknown channel")

    svc = _drive(ensure_fresh_creds(user, creds))
    start_token = user.drive_start_page_token
    next_token = start_token

    while True:
        resp = svc.changes().list(
            pageToken=next_token,
            fields="changes(file,name,fileId,file,mimeType),newStartPageToken,nextPageToken"
        ).execute()

        for ch in resp.get("changes", []):
            f = ch.get("file") or {}
            if not f or f.get("trashed"):
                continue
            name = f.get("name", "")
            mime = f.get("mimeType", "")
            # Heuristic: Meet transcript in a Google Doc named "*Transcript*"
            if ("Transcript" in name or "transcript" in name) and mime == "application/vnd.google-apps.document":
                _ingest_meet_transcript(svc, f["id"], name, user.id)

        next_token = resp.get("nextPageToken")
        if not next_token:
            # Save the new start token for next tick
            new_start = resp.get("newStartPageToken")
            if new_start:
                update_user_fields(user, {"drive_start_page_token": new_start})
            break

    return {"ok": True}

def _ingest_meet_transcript(drive_svc, file_id: str, name: str, user_id: int):
    # Export Google Doc -> plain text
    txt_bytes = drive_svc.files().export(fileId=file_id, mimeType="text/plain").execute()
    txt = txt_bytes.decode("utf-8", errors="ignore") if isinstance(txt_bytes, (bytes, bytearray)) else str(txt_bytes)

    # Optional: fuzzy match to a calendar event (implement this function to suit your DB)
    try:
        from .google_calendar import match_event_for_transcript  # you implement it
        event = match_event_for_transcript(name, user_id)
    except Exception:
        event = None

    # Persist a meeting row and run your summariser (stubs — replace with your real functions)
    meeting_id = _ensure_meeting_record(event, name, user_id)
    from ..summarize import summarize_text
    summary = summarize_text(txt)
    _store_summary_and_raw(meeting_id, txt, summary, source="google_meet_drive")
