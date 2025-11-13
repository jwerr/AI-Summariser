# backend/routes/qa_bot.py
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Meeting
from .meetings import _load_transcript_text  # 👈 reuse your existing helper
from openai import OpenAI

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is not set")

client = OpenAI(api_key=OPENAI_API_KEY)

router = APIRouter()


class QARequest(BaseModel):
    question: str
    meeting_id: int   # we only need meeting_id now


class QAResponse(BaseModel):
    answer: str
    meeting_id: int
    used_chars: int
    source_path: str


@router.post("/api/qa", response_model=QAResponse)
def qa_over_file_transcript(
    payload: QARequest,
    db: Session = Depends(get_db),
) -> QAResponse:
    """
    Q/A over a meeting transcript loaded DIRECTLY from the uploads folder.

    - Looks up Meeting by meeting_id
    - Uses meeting.transcript_path
    - Reads & extracts text via _load_transcript_text
    - Calls OpenAI using that text as context
    """

    # 1) Get meeting
    meeting = db.get(Meeting, payload.meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    if not meeting.transcript_path:
        raise HTTPException(
            status_code=404,
            detail="This meeting has no transcript_path set. Upload a transcript first.",
        )

    # 2) Load text from file in uploads folder
    text = _load_transcript_text(meeting.transcript_path)
    if not (text or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Transcript file exists but could not be read as plain text.",
        )

    MAX_CHARS = 15000
    used_text = text[-MAX_CHARS:] if len(text) > MAX_CHARS else text

    system_msg = (
        "You are a helpful assistant that answers questions ONLY using the given meeting transcript. "
        "If the answer is not clearly in the transcript, say you don't know based on this meeting."
    )

    user_msg = (
        f"Meeting transcript:\n\n{used_text}\n\n"
        f"Question: {payload.question}\n\n"
        "Answer clearly and concisely."
    )

    completion = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.2,
    )

    answer = completion.choices[0].message.content.strip()

    return QAResponse(
        answer=answer,
        meeting_id=meeting.id,
        used_chars=len(used_text),
        source_path=meeting.transcript_path,
    )
