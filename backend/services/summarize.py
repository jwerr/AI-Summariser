# backend/services/summarize.py
from __future__ import annotations
import json
import os
import re
import time
import logging
from typing import Dict, List, Any, Optional

# ---- settings ----
try:
    from ..config import settings
except Exception:
    class _Fallback:
        USE_OPENAI = bool(int(os.getenv("USE_OPENAI", "0")))
        OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
        MODEL_NAME = os.getenv("MODEL_NAME", "gpt-4o-mini")
        MAX_TOKENS = int(os.getenv("MAX_TOKENS", "450"))
        TEMPERATURE = float(os.getenv("TEMPERATURE", "0.2"))
        SUM_RETRIES = int(os.getenv("SUM_RETRIES", "2"))
        SUM_TIMEOUT_S = int(os.getenv("SUM_TIMEOUT_S", "20"))
    settings = _Fallback()

logger = logging.getLogger("summarize")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

# -------------------- Cleaning helpers --------------------
_VTT_HEADER = re.compile(r"^\s*(WEBVTT|Kind:.*|Language:.*)\s*$", re.I)
_TIMESTAMP = re.compile(r"\b\d{2}:\d{2}:\d{2}(?:[.,]\d{1,3})?\s*-->\s*\d{2}:\d{2}:\d{2}(?:[.,]\d{1,3})?\b")
_ONLY_DIGITS = re.compile(r"^\s*\d+\s*$")
_MULTI_WS   = re.compile(r"\s{2,}")
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")

def _clean_transcript(text: str) -> str:
    if not text:
        return ""
    lines: List[str] = []
    for ln in text.splitlines():
        s = ln.replace("\x00", "").strip("\ufeff ").strip()
        if not s:
            continue
        if _VTT_HEADER.match(s):      # drop WEBVTT headers
            continue
        if _ONLY_DIGITS.match(s):     # drop cue numbers
            continue
        if _TIMESTAMP.search(s):      # drop timestamp lines
            continue
        lines.append(s)
    out = " ".join(lines)
    out = _MULTI_WS.sub(" ", out).strip()
    return out

# -------------------- Prompts (lists only; one-liner is built locally) --------------------
SYSTEM_PROMPT = (
    "You extract concise meeting outcomes from noisy transcripts.\n"
    "Return STRICT JSON with EXACTLY these keys:\n"
    "  key_points: string[]\n"
    "  decisions: string[]\n"
    "  action_items: string[]\n"
    "Rules:\n"
    "- Items must be short, scannable, de-duplicated.\n"
    "- No speaker tags, timestamps, or formatting beyond plain text."
)

def _user_prompt(text: str) -> str:
    return (
        "From the transcript below, return three concise lists:\n"
        "- key_points: core ideas/topics discussed\n"
        "- decisions: explicit decisions/approvals/agreements\n"
        "- action_items: to-dos with owners/dates if present\n\n"
        "Transcript (cleaned):\n"
        f"{text[:12000]}"
    )

# -------------------- Heuristic fallback (improved) --------------------
_DECISION_HINTS = re.compile(
    r"\b(decided|decision|approved|approve|agreed|consensus|finalize|confirmed|concluded|resolved|accepted|approved by|approved to)\b",
    re.I,
)
_ACTION_HINTS = re.compile(
    r"\b(todo|action|owner|assign|due|deadline|follow\s*up|send|review|update|implement|prepare|fix|deploy|schedule|next steps|to be done|will|shall|must)\b",
    re.I,
)
_BULLET_LINE = re.compile(r"^\s*(?:[-*•]|(?:\d+)[.)])\s+", re.I)

def _simple_split_lines(text: str) -> List[str]:
    return [ln.strip(" \t-•") for ln in (text or "").splitlines() if ln.strip()]

def _split_sentences(text: str) -> List[str]:
    # quick sentence split
    parts = re.split(r"(?<=[.!?])\s+", text or "")
    return [p.strip() for p in parts if len(p.strip()) > 0]

def _dedupe_keep_order(items: List[str], max_n: int) -> List[str]:
    seen = set(); out = []
    for it in items:
        k = it.lower()
        if k in seen: 
            continue
        seen.add(k)
        out.append(it)
        if len(out) >= max_n:
            break
    return out

def _heuristic_lists(text: str) -> Dict[str, list]:
    """
    Improved heuristic extraction:
    - Detects bullet-like lines and long informative sentences as key points.
    - Uses keyword-based rules to detect decisions and action items.
    - Always returns at least a few sentences per category if possible.
    """
    lines = _simple_split_lines(text)
    key_points, decisions, action_items = [], [], []

    for ln in lines:
        low = ln.lower()

        if _DECISION_HINTS.search(low):
            decisions.append(ln)
            continue

        if _ACTION_HINTS.search(low) or "@" in ln:
            action_items.append(ln)
            continue

        if _BULLET_LINE.match(ln) or len(ln.split()) > 6:
            key_points.append(ln)

    # fallback: use sentences if lists are too short
    sents = _split_sentences(text)

    if len(key_points) < 5:
        key_points.extend(sents[:8])

    if len(decisions) < 2:
        # take sentences with "will", "decided", "agreed", etc.
        decisions.extend([s for s in sents if _DECISION_HINTS.search(s)][:5])

    if len(action_items) < 3:
        # take sentences mentioning owners or verbs like 'will', 'to do', 'prepare', 'send'
        action_items.extend([s for s in sents if _ACTION_HINTS.search(s)][:6])

    # trim + dedupe
    key_points   = _dedupe_keep_order(key_points, max_n=8)
    decisions    = _dedupe_keep_order(decisions,   max_n=6)
    action_items = _dedupe_keep_order(action_items, max_n=6)

    return {
        "key_points": key_points,
        "decisions": decisions,
        "action_items": action_items,
    }

# -------------------- One-liner builder (≤ 220 chars) --------------------
def _first_meaningful_line(text: str) -> str:
    for ln in (text or "").splitlines():
        s = ln.strip()
        if len(s) >= 15:
            return s[:300]
    return (text or "").strip()[:300]

def _one_liner(text: str, key_points: list[str], decisions: list[str], action_items: list[str],
               *, max_chars: int = 220) -> str:
    cleaned = _clean_transcript(text) or ""
    cand = ""
    if cleaned:
        sents = _SENT_SPLIT.split(cleaned)
        cand = (sents[0] if sents else "").strip() or _first_meaningful_line(cleaned)

    if not cand:
        cand = (key_points[0] if key_points else None) or (decisions[0] if decisions else None) \
               or (action_items[0] if action_items else None) or ""

    cand = _MULTI_WS.sub(" ", cand).strip()
    if len(cand) > max_chars:
        cand = cand[:max_chars].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    return cand

# -------------------- OpenAI path (lists only) --------------------
def _openai_call(prompt: str, model: Optional[str], max_tokens: int, temperature: float) -> Dict[str, list]:
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY missing")

    try:
        from openai import OpenAI
        client = OpenAI().with_options(timeout=settings.SUM_TIMEOUT_S)
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]
        logger.info(f"[OpenAI] model={model or settings.MODEL_NAME} max_tokens={max_tokens} temp={temperature}")
        resp = client.chat.completions.create(
            model=model or settings.MODEL_NAME,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        content = resp.choices[0].message.content or "{}"
        data = json.loads(content)
        return {
            "key_points": data.get("key_points", [])[:10],
            "decisions": data.get("decisions", [])[:10],
            "action_items": data.get("action_items", [])[:10],
        }
    except Exception as e:
        logger.error(f"[OpenAI] error: {e}")
        raise RuntimeError(f"openai_error: {e}") from e

# -------------------- Public APIs --------------------
def summarize_text(
    text: str,
    max_tokens: int | None = None,
    temperature: float | None = None,
    model: str | None = None,
    retries: int | None = None,
) -> Dict[str, list]:
    """
    Returns dict with keys: key_points[], decisions[], action_items[].
    Uses OpenAI if enabled; otherwise section-aware heuristic fallback.
    """
    if not text or not text.strip():
        return {"key_points": [], "decisions": [], "action_items": []}

    cleaned = _clean_transcript(text) or text.strip()
    mtok = max_tokens or settings.MAX_TOKENS
    temp = settings.TEMPERATURE if temperature is None else float(temperature)
    attempt_max = retries if retries is not None else settings.SUM_RETRIES

    if not settings.USE_OPENAI:
        logger.info("[summarize] USE_OPENAI=0 -> heuristic path")
        return _heuristic_lists(cleaned)

    prompt = _user_prompt(cleaned)
    delay = 0.7
    last_err = None

    for attempt in range(1, attempt_max + 1):
        try:
            return _openai_call(prompt, model, mtok, temp)
        except RuntimeError as e:
            last_err = e
            logger.warning(f"[summarize] attempt {attempt}/{attempt_max} failed: {e}")
            if attempt < attempt_max:
                time.sleep(delay)
                delay = min(delay * 2, 6.0)

    logger.info("[summarize] falling back to heuristic after errors: %s", last_err)
    return _heuristic_lists(cleaned)

# -------------------- UI adapter (returns one-liner + lists) --------------------
def _mk_markdown(one_liner_text: str, key_points: list[str], decisions: list[str], action_items: list[str]) -> str:
    parts: list[str] = []
    if one_liner_text:
        parts += [f"**Summary:** {one_liner_text}", ""]
    if key_points:
        parts += ["### Key Points"] + [f"- {p}" for p in key_points] + [""]
    if decisions:
        parts += ["### Decisions"] + [f"- {d}" for d in decisions] + [""]
    if action_items:
        parts += ["### Action Items"] + [f"- {a}" for a in action_items] + [""]
    return "\n".join(parts).strip()

def summarize_text_dict_ui(
    text: str,
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
    model: str | None = None,
    retries: int | None = None,
) -> dict:
    """
    UI-facing payload:
      - summary_text: ONE-LINER ONLY (≤ 220 chars)
      - markdown: optional block (one-liner + sections)
      - arrays unchanged for the cards
    """
    lists = summarize_text(
        text,
        max_tokens=max_tokens,
        temperature=temperature,
        model=model,
        retries=retries,
    ) or {"key_points": [], "decisions": [], "action_items": []}

    key_points   = lists.get("key_points", []) or []
    decisions    = lists.get("decisions", []) or []
    action_items = lists.get("action_items", []) or []

    ol = _one_liner(text, key_points, decisions, action_items, max_chars=220)
    md = _mk_markdown(ol, key_points, decisions, action_items)

    return {
        "one_liner": ol,
        "summary_text": ol,      # what the big box shows
        "markdown": md,          # available if you ever render markdown
        "key_points": key_points,
        "decisions": decisions,
        "action_items": action_items,
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
