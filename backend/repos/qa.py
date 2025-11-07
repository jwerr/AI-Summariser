# backend/repos/qa.py
from typing import List, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import text, bindparam, Integer
import numpy as np

def _cos(a, b):
    a = np.array(a, dtype=float); b = np.array(b, dtype=float)
    na = np.linalg.norm(a); nb = np.linalg.norm(b)
    return 0.0 if na == 0 or nb == 0 else float(np.dot(a, b) / (na * nb))

def _pgvector_available(db: Session) -> bool:
    try:
        # extension loaded?
        row = db.execute(text("SELECT 1 FROM pg_extension WHERE extname='vector'")).first()
        return row is not None
    except Exception:
        db.rollback()
        return False

def _column_is_vector(db: Session) -> bool:
    try:
        # check the column type of qa_chunks.embedding
        row = db.execute(text("""
            SELECT data_type
            FROM information_schema.columns
            WHERE table_name='qa_chunks' AND column_name='embedding'
        """)).first()
        return bool(row and "vector" in (row[0] or "").lower())
    except Exception:
        db.rollback()
        return False

def top_k_by_similarity(db: Session, meeting_id: int, q_emb: List[float], k: int = 6) -> List[Tuple[str, str, float]]:
    use_pgvector = _pgvector_available(db) and _column_is_vector(db)

    if use_pgvector:
        try:
            stmt = text("""
                SELECT source, text, 1 - (embedding <=> :q) AS score
                FROM qa_chunks
                WHERE meeting_id = :m
                ORDER BY embedding <=> :q
                LIMIT :k
            """).bindparams(
                bindparam("m", type_=Integer),
                bindparam("k", type_=Integer),
                bindparam("q")
            )
            rows = db.execute(stmt, {"m": meeting_id, "k": k, "q": q_emb}).all()
            return [(r[0], r[1], float(r[2])) for r in rows]
        except Exception:
            # IMPORTANT: clear aborted transaction so we can run fallback
            db.rollback()

    # ---- Fallback: rank in Python over FLOAT8[] (or any storable type) ----
    stmt2 = text("""
        SELECT source, text, embedding
        FROM qa_chunks
        WHERE meeting_id = :m
    """).bindparams(bindparam("m", type_=Integer))
    rows = db.execute(stmt2, {"m": meeting_id}).all()
    scored = []
    for src, txt, emb in rows:
        try:
            score = _cos(q_emb, emb)
        except Exception:
            score = 0.0
        scored.append((score, src, txt))
    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:k]
    return [(src, txt, float(score)) for score, src, txt in top]

def insert_chunks(db: Session, meeting_id: int, source: str, chunks: List[str], embeds: List[List[float]]):
    from sqlalchemy import text
    assert len(chunks) == len(embeds)
    stmt = text("""
        INSERT INTO qa_chunks (meeting_id, source, text, embedding)
        VALUES (:m, :s, :t, :e)
    """)
    try:
        for txt, emb in zip(chunks, embeds):
            db.execute(stmt, {"m": meeting_id, "s": source, "t": txt, "e": emb})
        db.commit()
    except Exception:
        db.rollback()
        raise

