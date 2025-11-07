# backend/settings.py
import os
from pathlib import Path

# load backend/.env if present (safe if python-dotenv isn't installed)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).with_name(".env"))
except Exception:
    pass

class Settings:
    # add more later if needed
    UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")

settings = Settings()
