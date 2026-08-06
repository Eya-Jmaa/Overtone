from datetime import datetime, timedelta, timezone
import bcrypt
from jose import jwt, JWTError
from config import settings

# bcrypt only reads the first 72 bytes of a secret and raises on anything
# longer, so truncate here rather than letting a long password 500 the route.
BCRYPT_MAX_BYTES = 72

def _to_bcrypt_bytes(password: str) -> bytes:
    return password.encode("utf-8")[:BCRYPT_MAX_BYTES]

def hash_password(password: str) -> str:
    return bcrypt.hashpw(_to_bcrypt_bytes(password), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(_to_bcrypt_bytes(plain), hashed.encode("utf-8"))
    except ValueError:
        # Malformed / non-bcrypt hash stored in the DB.
        return False

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