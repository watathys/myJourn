"""Database engine, session lifecycle, and declarative base."""

import socket
from collections.abc import Generator
from typing import Any, Optional

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings
from app.rls import apply_rls_settings, register_rls_listeners


def _preferred_hostaddr(host: str) -> Optional[str]:
    """Resolve ``host`` to a literal address, preferring IPv4.

    ``socket.gethostbyname`` was used here previously, which is IPv4-only and
    raises for AAAA-only hosts. ``getaddrinfo`` handles both, and preferring an
    A record matters because hosts without an outbound IPv6 route cannot reach
    an IPv6 literal even when one resolves.
    """

    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except OSError:
        return None

    for family in (socket.AF_INET, socket.AF_INET6):
        for info in infos:
            if info[0] == family:
                return str(info[4][0])
    return None


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
    """Pin the Postgres host to a literal address; macOS libpq DNS is flaky."""

    host = cparams.get("host")
    if host and not cparams.get("hostaddr") and not host.startswith("/") and host != "localhost":
        # Leave hostaddr unset when resolution fails so libpq can retry itself,
        # rather than pinning a hardcoded address that may since have moved.
        resolved = _preferred_hostaddr(host)
        if resolved:
            cparams["hostaddr"] = resolved


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
