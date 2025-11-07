# backend/services/embeddings.py
import os
import tiktoken
from typing import List
from openai import OpenAI

MODEL_EMBED = os.getenv("EMBED_MODEL", "text-embedding-3-small")
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def embed_texts(texts: List[str]) -> List[List[float]]:
    resp = client.embeddings.create(model=MODEL_EMBED, input=texts)
    return [d.embedding for d in resp.data]

def rough_chunk(text: str, target_tokens: int = 250) -> List[str]:
    enc = tiktoken.get_encoding("cl100k_base")
    toks = enc.encode(text or "")
    out, step = [], target_tokens
    for i in range(0, len(toks), step):
        out.append(enc.decode(toks[i:i+step]))
    return out
