from datetime import datetime, timedelta, timezone
from passlib.context import CryptContext
from jose import jwt, JWTError
from config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    return pwd_context.verify(plain, hashed)

def make_access_token(user_id: str) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    return jwt.encode(
        {"sub": user_id, "type": "access", "exp": expires},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )

def make_refresh_token(user_id: str) -> str:
    expires = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_days)
    return jwt.encode(
        {"sub": user_id, "type": "refresh", "exp": expires},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )

def decode_token(token: str, expected_type: str) -> str | None:
    """Returns user_id if valid, None otherwise."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        if payload.get("type") != expected_type:
            return None
        return payload.get("sub")
    except JWTError:
        return None