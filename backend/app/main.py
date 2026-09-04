"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import get_settings
from app.db import engine
from app.rls import clear_rls_user_id

logger = logging.getLogger(__name__)


def _check_token_verification_configured() -> None:
    """Warn at boot when no key is available to verify access tokens.

    Without one, every authenticated request fails closed with a 401, so this
    surfaces the misconfiguration in the logs instead of as mystery logouts.
    """

    settings = get_settings()
    if not settings.supabase_url and not settings.supabase_hs256_secret:
        logger.error(
            "No access-token verification key is configured. Set SUPABASE_URL (for "
            "JWKS-signed ES256/RS256 tokens) or a genuine HS256 SUPABASE_JWT_SECRET. "
            "All authenticated requests will be rejected with 401 until this is fixed."
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    engine.dispose()
    _check_token_verification_configured()
    yield


app = FastAPI(title="MyJourn API", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def rls_context_cleanup_middleware(request, call_next):
    """Ensure RLS context contextvar is cleared between requests."""

    clear_rls_user_id()
    try:
        return await call_next(request)
    finally:
        clear_rls_user_id()


app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router, prefix="/api")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
