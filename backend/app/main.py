"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.rls import clear_rls_user_id

app = FastAPI(title="MyJourn API", version="0.1.0")


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
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router, prefix="/api")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
