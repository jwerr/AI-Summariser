# backend/routes/google_oauth.py
import os, time, httpx, jwt
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse

router = APIRouter(prefix="/api/auth/google", tags=["auth"])

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/google/callback")
JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_AUDIENCE = "ai-summariser"
FRONTEND_SUCCESS = os.getenv("FRONTEND_SUCCESS_URL", "http://localhost:3000/dashboard")
FRONTEND_ERROR = os.getenv("FRONTEND_ERROR_URL", "http://localhost:3000/login?error=oauth")

TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

@router.get("/callback")
async def google_callback(code: str):
    async with httpx.AsyncClient(timeout=20) as client:
        tok = await client.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if tok.status_code != 200:
        return RedirectResponse(f"{FRONTEND_ERROR}&stage=token", status_code=302)

    tokens = tok.json()
    access_token = tokens.get("access_token")

    async with httpx.AsyncClient(timeout=20) as client:
        ui = await client.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
    if ui.status_code != 200:
        return RedirectResponse(f"{FRONTEND_ERROR}&stage=userinfo", status_code=302)

    userinfo = ui.json()
    # TODO: upsert user + store google tokens in DB if you need Calendar later

    # issue your own session JWT
    now = int(time.time())
    claims = {
        "sub": userinfo["email"],
        "name": userinfo.get("name"),
        "picture": userinfo.get("picture"),
        "aud": JWT_AUDIENCE,
        "iat": now,
        "exp": now + 60 * 60 * 8,  # 8 hours
    }
    app_jwt = jwt.encode(claims, JWT_SECRET, algorithm="HS256")

    resp = RedirectResponse(FRONTEND_SUCCESS, status_code=302)
    # secure cookie (for localhost keep secure=False)
    resp.set_cookie(
        key="session",
        value=app_jwt,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=60 * 60 * 8,
        path="/",
    )
    return resp
