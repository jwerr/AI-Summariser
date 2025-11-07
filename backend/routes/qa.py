# backend/routes/qa.py
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..db import get_db
from ..models import Summary, Transcript
from ..services.embeddings import embed_texts, rough_chunk
from ..repos.qa import insert_chunks, top_k_by_similarity
from openai import OpenAI
import os

router = APIRouter(prefix="/qa", tags=["qa"])
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL_ANSWER = os.getenv("ANSWER_MODEL", "gpt-4o-mini")

class IndexIn(BaseModel):
    meeting_id: int
    include_transcript: bool = True
    include_summary: bool = True

class AskIn(BaseModel):
    meeting_id: int
    question: str
    top_k: int = 6

@router.post("/ask")
def ask(body: AskIn, db: Session = Depends(get_db)):
    if not body.question.strip():
        raise HTTPException(400, "Empty question")
    q_emb = embed_texts([body.question])[0]
    hits = top_k_by_similarity(db, body.meeting_id, q_emb, body.top_k)

    context_snippets = "\n\n".join(
        f"[{i+1} | {src} | score={score:.2f}]\n{txt}"
        for i, (src, txt, score) in enumerate(hits)
    )

    system = ("You are a helpful meeting Q&A assistant. Answer ONLY from the context. "
              "If unknown, say you don't know. Include bracketed citations like [1], [2].")
    user = f"Question: {body.question}\n\nContext:\n{context_snippets}"

    resp = client.chat.completions.create(
        model=MODEL_ANSWER,
        messages=[{"role":"system","content":system},{"role":"user","content":user}],
        temperature=0.2,
    )
    answer = resp.choices[0].message.content
    return {
        "answer": answer,
        "contexts": [
            {"idx": i+1, "source": src, "score": score, "text": txt[:500]}
            for i, (src, txt, score) in enumerate(hits)
        ]
    }

@router.post("/index")
def index_meeting(body: IndexIn, db: Session = Depends(get_db)):
    m = body.meeting_id
    # fetch data
    summary = db.query(Summary).filter_by(meeting_id=m).order_by(Summary.id.desc()).first()
    transcript = db.query(Transcript).filter_by(meeting_id=m).order_by(Transcript.id.desc()).first()

    if not summary and not transcript:
        raise HTTPException(404, "No summary/transcript found for meeting")

    # build chunks
    all_chunks = []
    sources = []
    if body.include_summary and summary:
        # include full summary text + structured lists if you store them
        s_blocks = [summary.summary_text or ""]
        s_blocks += ["\n".join(summary.key_points or [])] if hasattr(summary, "key_points") else []
        s_blocks += ["\n".join(summary.decisions or [])]  if hasattr(summary, "decisions")  else []
        s_blocks += ["\n".join(summary.action_items or [])] if hasattr(summary, "action_items") else []
        for b in s_blocks:
            for c in rough_chunk(b, 250):
                if c.strip():
                    all_chunks.append(c)
                    sources.append("summary")
    if body.include_transcript and transcript:
        for c in rough_chunk(transcript.text or transcript.transcript_text or "", 300):
            if c.strip():
                all_chunks.append(c)
                sources.append("transcript")

    if not all_chunks:
        raise HTTPException(400, "Nothing to index")

    embeds = embed_texts(all_chunks)
    insert_chunks(db, m, None, [], [])  # no-op placeholder to ensure module import (optional)
    # Insert in batches so we can pass the proper source per row
    # (simple loop version to keep it readable)
    for src in set(sources): pass  # just to quiet linters
    from sqlalchemy.orm import Session as _S  # quiet import tools

    # straightforward per-row insert using repos.insert_chunks
    # We’ll group by source for fewer commits:
    group = {}
    for s, t, e in zip(sources, all_chunks, embeds):
        group.setdefault(s, {"chunks": [], "embeds": []})
        group[s]["chunks"].append(t)
        group[s]["embeds"].append(e)
    for s, obj in group.items():
        insert_chunks(db, m, s, obj["chunks"], obj["embeds"])

    return {"ok": True, "meeting_id": m, "chunks_indexed": len(all_chunks)}
