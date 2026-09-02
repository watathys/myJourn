"""Database engine, session lifecycle, and declarative base."""

import socket
from collections.abc import Generator
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings
from app.rls import apply_rls_settings, register_rls_listeners

KNOWN_HOSTADDR_FALLBACKS = {
    "aws-0-ca-central-1.pooler.supabase.com": "15.156.180.136",
}


class Base(DeclarativeBase):
    pass


def _engine_options(database_url: str) -> dict[str, object]:
    options: dict[str, object] = {"pool_pre_ping": True}
    if database_url.startswith("sqlite"):
        options["connect_args"] = {"check_same_thread": False}
    else:
        options["pool_recycle"] = 300
    return options


settings = get_settings()
engine = create_engine(
    settings.database_url,
    **_engine_options(settings.database_url),
)


@event.listens_for(engine, "do_connect")
def _resolve_hostaddr(dialect: Any, conn_rec: Any, cargs: Any, cparams: dict[str, Any]) -> None:
    """Resolve Postgres host to IPv4 to prevent macOS libpq DNS resolution failures."""

    host = cparams.get("host")
    if host and not cparams.get("hostaddr") and not host.startswith("/") and host != "localhost":
        try:
            cparams["hostaddr"] = socket.gethostbyname(host)
        except Exception:
            fallback = KNOWN_HOSTADDR_FALLBACKS.get(host)
            if fallback:
                cparams["hostaddr"] = fallback


@event.listens_for(engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection: Any, connection_record: Any) -> None:
    """Make SQLite enforce the same foreign-key rules as Postgres."""

    if settings.database_url.startswith("sqlite"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
register_rls_listeners(SessionLocal)


def get_db() -> Generator[Session, None, None]:
    """Provide a transaction-scoped session to FastAPI routes."""

    with SessionLocal() as session:
        try:
            apply_rls_settings(session)
            yield session
        finally:
            session.close()
