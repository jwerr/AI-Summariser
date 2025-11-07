import json
from datetime import datetime
from zoneinfo import ZoneInfo
# from your llm client import call_llm  # adapt to your project

def extract_schedule_items(transcript: str, meeting_start: datetime, timezone: str = "America/New_York"):
    """
    Returns list[dict] with keys: title, description, start_iso, end_iso, location, raw_quote, confidence
    """
    tz = ZoneInfo(timezone)
    meeting_start = meeting_start.replace(tzinfo=tz) if meeting_start.tzinfo is None else meeting_start

    from .summarize_prompts import SCHEDULE_EXTRACTOR_SYSTEM, SCHEDULE_EXTRACTOR_USER
    user_msg = SCHEDULE_EXTRACTOR_USER.format(
        transcript=transcript[:180000],  # avoid overrun
        meeting_start_iso=meeting_start.isoformat(),
        timezone=timezone,
    )

    # --- call your LLM (pseudo) ---
    # resp = call_llm(system=SCHEDULE_EXTRACTOR_SYSTEM, user=user_msg, model="gpt-4o-mini")  # adapt
    # text = resp.content
    text = "{}"  # <-- replace with actual LLM response text

    try:
        data = json.loads(text)
        items = data.get("items", [])
    except Exception:
        items = []

    # Light validation / defaults
    out = []
    for it in items:
        title = (it.get("title") or "").strip()
        if not title:
            continue
        start_iso = (it.get("start_iso") or "").strip()
        end_iso = (it.get("end_iso") or None)
        desc = (it.get("description") or "").strip() or None
        loc = (it.get("location") or None)
        raw = (it.get("raw_quote") or "").strip() or None
        conf = float(it.get("confidence") or 0.6)

        # Fallback: if start_iso is missing (shouldn't), skip
        if not start_iso:
            continue

        out.append({
            "title": title[:120],
            "description": desc,
            "start_iso": start_iso,
            "end_iso": end_iso,
            "location": loc,
            "raw_quote": raw,
            "confidence": max(0.0, min(1.0, conf)),
        })
    return out
