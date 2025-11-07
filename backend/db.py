# backend/db.py
import os, re
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# --- Load backend/.env explicitly ---
try:
    from dotenv import load_dotenv, find_dotenv
    # Prefer backend/.env next to this file
    explicit_env = Path(__file__).with_name(".env")
    loaded_from = None
    if explicit_env.exists():
        load_dotenv(explicit_env)
        loaded_from = str(explicit_env)
    else:
        # Fallback: search upwards for any .env
        found = find_dotenv(".env", usecwd=True)
        if found:
            load_dotenv(found)
            loaded_from = found
    print(f"[env] Loaded .env from: {loaded_from}" if loaded_from else "[env] No .env found; relying on OS envs")
except Exception as e:
    print(f"[env] Skipped dotenv load: {e}")

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    # clear, actionable error
    raise RuntimeError(
        "DATABASE_URL is not set. Expected it in backend/.env or OS envs.\n"
        "Hint: ensure the key is named exactly DATABASE_URL and that backend/db.py can read backend/.env"
    )

def _mask(url: str) -> str:
    return re.sub(r"://([^:]+):([^@]+)@", r"://\1:***@", url)

print(f"[db] Using DATABASE_URL={_mask(DATABASE_URL)}")

engine = create_engine(
    DATABASE_URL,
    echo=False,
    future=True,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
