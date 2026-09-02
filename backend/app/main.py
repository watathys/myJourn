"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.db import engine
from app.rls import clear_rls_user_id


@asynccontextmanager
async def lifespan(app: FastAPI):
    engine.dispose()
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
