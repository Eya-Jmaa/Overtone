import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, Cookie
from fastapi.responses import RedirectResponse
from jose import jwt, JWTError
from sqlalchemy.orm import Session

from database import get_db
from services.db_models import User, PendingVerification
from services.schemas import (
    SendCodeIn, VerifyCodeIn, CompleteSignupIn, LoginIn,
    AuthOut, UserOut, RefreshOut, MessageOut, VerifyCodeOut,
)
from services.security import (
    hash_password, verify_password,
    make_access_token, make_refresh_token, decode_token,
)
from services.email_service import send_code_email
from config import settings

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "refresh_token"
CODE_TTL_MINUTES = 10
SIGNUP_TOKEN_TTL_MINUTES = 5
MAX_CODE_ATTEMPTS = 5


# ── helpers ─────────────────────────────────────────

def _set_refresh_cookie(response: Response, token: str):
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=settings.refresh_token_days * 24 * 3600,
        path="/auth",
    )


def _clear_refresh_cookie(response: Response):
    response.delete_cookie(key=REFRESH_COOKIE, path="/auth")


def _user_to_out(user: User) -> UserOut:
    return UserOut(id=user.id, email=user.email, name=user.name, is_verified=user.is_verified)


def _issue_tokens(response: Response, user: User) -> AuthOut:
    access = make_access_token(user.id)
    refresh = make_refresh_token(user.id)
    _set_refresh_cookie(response, refresh)
    return AuthOut(user=_user_to_out(user), accessToken=access)


def _make_signup_token(email: str) -> str:
    """Short-lived JWT proving 'this email was just verified'."""
    expires = datetime.now(timezone.utc) + timedelta(minutes=SIGNUP_TOKEN_TTL_MINUTES)
    return jwt.encode(
        {"email": email, "type": "signup", "exp": expires},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def _decode_signup_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        if payload.get("type") != "signup":
            return None
        return payload.get("email")
    except JWTError:
        return None


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt

from fastapi import Header
from typing import Annotated
 
def get_current_user(
    authorization: Annotated[str, Header()],
    db: Session = Depends(get_db),
) -> User:
    """Extract and validate the current user from the Authorization header."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or malformed authorization header.")
    token = authorization.removeprefix("Bearer ")
    user_id = decode_token(token, expected_type="access")
    if not user_id:
        raise HTTPException(401, "Invalid or expired access token.")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(401, "User not found.")
    return user


# ── Step 1: send code ───────────────────────────────

@router.post("/send-code", response_model=MessageOut)
def send_code(body: SendCodeIn, db: Session = Depends(get_db)):
    email = body.email.lower()

    # Already a registered user?
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(409, "An account with this email already exists. Try signing in.")

    # Generate 6-digit code
    code = f"{secrets.randbelow(1_000_000):06d}"
    code_hash = hash_password(code)

    # Upsert pending verification
    pending = db.query(PendingVerification).filter(PendingVerification.email == email).first()
    if pending:
        pending.code_hash = code_hash
        pending.attempts = 0
        pending.expires_at = _now_utc() + timedelta(minutes=CODE_TTL_MINUTES)
        pending.verified = False
        pending.verified_at = None
    else:
        pending = PendingVerification(
            email=email,
            code_hash=code_hash,
            attempts=0,
            expires_at=_now_utc() + timedelta(minutes=CODE_TTL_MINUTES),
        )
        db.add(pending)
    db.commit()

    try:
        send_code_email(email, code)
    except Exception as e:
        print(f"[email] Failed to send: {e}")
        print(f"[email] DEV CODE for {email}: {code}")  # fallback so you can still test

    return MessageOut(message="Code sent. Check your inbox.")


# ── Step 2: verify code ─────────────────────────────

@router.post("/verify-code", response_model=VerifyCodeOut)
def verify_code(body: VerifyCodeIn, db: Session = Depends(get_db)):
    email = body.email.lower()
    pending = db.query(PendingVerification).filter(PendingVerification.email == email).first()

    if not pending:
        raise HTTPException(400, "No code was requested for this email. Send a new code.")

    if _aware(pending.expires_at) < _now_utc():
        raise HTTPException(400, "This code has expired. Send a new one.")

    if pending.attempts >= MAX_CODE_ATTEMPTS:
        raise HTTPException(429, "Too many attempts. Send a new code.")

    if not verify_password(body.code, pending.code_hash):
        pending.attempts += 1
        db.commit()
        remaining = MAX_CODE_ATTEMPTS - pending.attempts
        raise HTTPException(400, f"Wrong code. {remaining} attempt(s) left.")

    pending.verified = True
    pending.verified_at = _now_utc()
    db.commit()

    return VerifyCodeOut(
        signup_token=_make_signup_token(email),
        message="Email verified. Now set your name and password.",
    )


# ── Step 3: complete signup ─────────────────────────

@router.post("/complete-signup", response_model=AuthOut)
def complete_signup(body: CompleteSignupIn, response: Response, db: Session = Depends(get_db)):
    email = _decode_signup_token(body.signup_token)
    if not email:
        raise HTTPException(401, "Verification expired. Please start over.")

    # The pending row must still exist and be marked verified
    pending = db.query(PendingVerification).filter(PendingVerification.email == email).first()
    if not pending or not pending.verified:
        raise HTTPException(401, "Verification not found. Please start over.")

    if db.query(User).filter(User.email == email).first():
        raise HTTPException(409, "This email is already registered.")

    user = User(
        email=email,
        name=body.name.strip(),
        password_hash=hash_password(body.password),
        is_verified=True,
    )
    db.add(user)
    db.delete(pending)
    db.commit()
    db.refresh(user)

    return _issue_tokens(response, user)


# ── Login / refresh / logout ────────────────────────

@router.post("/login", response_model=AuthOut)
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.lower()).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password.")
    return _issue_tokens(response, user)


@router.post("/refresh", response_model=RefreshOut)
def refresh(
    response: Response,
    refresh_token: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
    db: Session = Depends(get_db),
):
    if not refresh_token:
        raise HTTPException(401, "No refresh token.")
    user_id = decode_token(refresh_token, expected_type="refresh")
    if not user_id:
        _clear_refresh_cookie(response)
        raise HTTPException(401, "Invalid refresh token.")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        _clear_refresh_cookie(response)
        raise HTTPException(401, "User not found.")
    # Rotate the refresh token for security
    new_refresh = make_refresh_token(user.id)
    _set_refresh_cookie(response, new_refresh)
    return RefreshOut(accessToken=make_access_token(user.id), user=_user_to_out(user))


@router.post("/logout", response_model=MessageOut)
def logout(response: Response):
    _clear_refresh_cookie(response)
    return MessageOut(message="Signed out.")

@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    """Return the current authenticated user's profile."""
    return _user_to_out(user)

# ── Google OAuth ────────────────────────────────────

@router.get("/google/login")
def google_login():
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account",
    }
    url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    return RedirectResponse(url)


@router.get("/google/callback")
async def google_callback(
    code: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    if error or not code:
        return RedirectResponse(f"{settings.frontend_url}/login?oauth_error={error or 'missing_code'}")

    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if token_resp.status_code != 200:
            return RedirectResponse(f"{settings.frontend_url}/login?oauth_error=token_exchange")

        access_token = token_resp.json().get("access_token")
        userinfo_resp = await client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if userinfo_resp.status_code != 200:
            return RedirectResponse(f"{settings.frontend_url}/login?oauth_error=userinfo")

        info = userinfo_resp.json()
        google_id = info.get("sub")
        email = info.get("email", "").lower()
        name = info.get("name") or email.split("@")[0]
        email_verified = info.get("email_verified", False)

    if not google_id or not email:
        return RedirectResponse(f"{settings.frontend_url}/login?oauth_error=incomplete")

    user = db.query(User).filter(User.google_id == google_id).first()
    if not user:
        user = db.query(User).filter(User.email == email).first()
        if user:
            user.google_id = google_id
            if email_verified:
                user.is_verified = True
        else:
            user = User(
                email=email,
                name=name,
                password_hash=None,
                google_id=google_id,
                is_verified=email_verified,
            )
            db.add(user)
    db.commit()
    db.refresh(user)

    access = make_access_token(user.id)
    refresh = make_refresh_token(user.id)

    response = RedirectResponse(f"{settings.frontend_url}/oauth-success#token={access}")
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=refresh,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=settings.refresh_token_days * 24 * 3600,
        path="/auth",
    )
    return response