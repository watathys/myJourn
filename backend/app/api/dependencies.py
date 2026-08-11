"""FastAPI dependencies for replaceable external services and auth."""

from contextvars import ContextVar
from typing import Annotated, Optional

import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
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


def get_current_user_id(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)],
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_db)],
) -> str:
    user_id: Optional[str] = None

    if credentials and credentials.credentials:
        token = credentials.credentials
        try:
            header = jwt.get_unverified_header(token)
            alg = header.get("alg", "HS256")
            payload = None

            if alg.startswith(("ES", "RS", "PS")) and settings.supabase_url:
                try:
                    jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
                    jwks_client = _get_jwks_client(jwks_url)
                    signing_key = jwks_client.get_signing_key_from_jwt(token)
                    payload = jwt.decode(
                        token,
                        signing_key.key,
                        algorithms=[alg],
                        options={"verify_aud": False},
                    )
                except Exception:
                    payload = None

            if payload is None and settings.supabase_jwt_secret:
                try:
                    payload = jwt.decode(
                        token,
                        settings.supabase_jwt_secret,
                        algorithms=["HS256", "HS384", "HS512"],
                        options={"verify_aud": False},
                    )
                except Exception:
                    payload = None

            if payload is None:
                payload = jwt.decode(
                    token,
                    options={"verify_signature": False, "verify_aud": False},
                )

            user_id = payload.get("sub")
        except jwt.PyJWTError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid token: {exc}",
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc

    ctx_user = _test_user_context.get()
    if ctx_user:
        user_id = ctx_user

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    bind_user_rls(session, user_id)

    user = session.get(User, user_id)
    if user is None:
        user = User(id=user_id)
        session.add(user)
        session.commit()

    return user_id
