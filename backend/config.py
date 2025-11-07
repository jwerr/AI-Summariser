# backend/config.py
import os

class Settings:
    USE_OPENAI: bool = os.getenv("USE_OPENAI", "0") == "1"
    MODEL_NAME: str | None = os.getenv("MODEL_NAME") or None
    MAX_TOKENS: int = int(os.getenv("MAX_TOKENS", "512"))
    TEMPERATURE: float = float(os.getenv("TEMPERATURE", "0.2"))
    SUM_RETRIES: int = int(os.getenv("SUM_RETRIES", "3"))
    SUM_TIMEOUT_S: int = int(os.getenv("SUM_TIMEOUT_S", "30"))  # per request budget

    OPENAI_API_KEY: str | None = os.getenv("OPENAI_API_KEY")
    # If you use Azure/OpenAI variants later, add those here.

settings = Settings()
