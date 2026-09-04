"""FastAPI dependencies for replaceable external services and auth."""

from contextvars import ContextVar
from typing import Annotated, Optional

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from sqlalchemy.orm import Session

from app.ai.client import JournalAI, OpenAIJournalAI
from app.config import Settings, get_settings
from app.db import get_db
from app.models import User
from app.rls import bind_user_rls

security = HTTPBearer(auto_error=False)

_test_user_context: ContextVar[Optional[str]] = ContextVar("_test_user_context", default=None)
_jwks_clients: dict[str, PyJWKClient] = {}


def _get_jwks_client(jwks_url: str) -> PyJWKClient:
    if jwks_url not in _jwks_clients:
        _jwks_clients[jwks_url] = PyJWKClient(jwks_url)
    return _jwks_clients[jwks_url]


def set_test_user_id(user_id: Optional[str]) -> None:
    _test_user_context.set(user_id)


def clear_test_user_id() -> None:
    _test_user_context.set(None)


def get_journal_ai() -> JournalAI:
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI processing is not configured",
        )
    return OpenAIJournalAI(
        api_key=settings.openai_api_key,
        model=settings.openai_model,
        fast_model=settings.openai_fast_model,
    )


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _decode_access_token(token: str, settings: Settings) -> dict:
    """Verify a Supabase access token's signature and expiry.

    Every branch either returns a verified payload or raises. A token whose
    signature cannot be checked is rejected rather than decoded unverified,
    since its ``sub`` claim decides which user's journal the caller reads.
    """

    try:
        alg = str(jwt.get_unverified_header(token).get("alg") or "")
    except jwt.PyJWTError as exc:
        raise _unauthorized(f"Invalid token: {exc}") from exc

    if alg.startswith(("ES", "RS", "PS")):
        if not settings.supabase_url:
            raise _unauthorized("Server cannot verify this token: SUPABASE_URL is not configured")
        jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        try:
            signing_key = _get_jwks_client(jwks_url).get_signing_key_from_jwt(token)
            return jwt.decode(
                token,
                signing_key.key,
                algorithms=[alg],
                options={"verify_aud": False},
            )
        except Exception as exc:
            raise _unauthorized(f"Invalid token: {exc}") from exc

    if alg.startswith("HS"):
        secret = settings.supabase_hs256_secret
        if not secret:
            raise _unauthorized(
                "Server cannot verify this token: no HS256 JWT secret is configured"
            )
        try:
            return jwt.decode(
                token,
                secret,
                algorithms=["HS256", "HS384", "HS512"],
                options={"verify_aud": False},
            )
        except Exception as exc:
            raise _unauthorized(f"Invalid token: {exc}") from exc

    raise _unauthorized(f"Unsupported token algorithm: {alg or 'none'}")


def get_current_user_id(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)],
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_db)],
) -> str:
    user_id: Optional[str] = _test_user_context.get()

    if not user_id:
        if not (credentials and credentials.credentials):
            raise _unauthorized("Missing authentication token")
        user_id = _decode_access_token(credentials.credentials, settings).get("sub")

    if not user_id:
        raise _unauthorized("Missing authentication token")

    bind_user_rls(session, user_id)

    user = session.get(User, user_id)
    if user is None:
        user = User(id=user_id)
        session.add(user)
        session.commit()

    return user_id
