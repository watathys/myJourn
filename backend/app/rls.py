"""Postgres row-level security session binding (no-op on SQLite)."""

from __future__ import annotations

from contextvars import ContextVar
from typing import Optional

from sqlalchemy import event, text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

_rls_user_id: ContextVar[Optional[str]] = ContextVar("rls_user_id", default=None)

# session.info / connection.info key for the tenant user id.
# Stored on the Session so after_begin can re-bind after commit even when the
# ContextVar is missing (FastAPI runs sync deps and endpoints in separate
# threadpool jobs, each with its own ContextVar copy).
_RLS_USER_INFO_KEY = "rls_user_id"
_RLS_BOUND_KEY = "rls_bound_user"


def get_rls_user_id() -> Optional[str]:
    return _rls_user_id.get()


def set_rls_user_id(user_id: Optional[str]) -> None:
    _rls_user_id.set(user_id)


def clear_rls_user_id() -> None:
    _rls_user_id.set(None)


def _resolve_rls_user_id(
    target: Session | Connection, user_id: Optional[str] = None
) -> str:
    if user_id:
        return user_id
    if isinstance(target, Session):
        stored = target.info.get(_RLS_USER_INFO_KEY)
        if stored:
            return str(stored)
    else:
        stored = target.info.get(_RLS_USER_INFO_KEY)
        if stored:
            return str(stored)
    return get_rls_user_id() or ""


def apply_rls_settings(
    target: Session | Connection, user_id: Optional[str] = None
) -> None:
    """Push current request user id into Postgres and switch role to myjourn_app for RLS."""

    stmt = text("SET LOCAL ROLE myjourn_app; SELECT set_config('app.current_user_id', :uid, true)")
    resolved = _resolve_rls_user_id(target, user_id)

    if isinstance(target, Session):
        bind = target.get_bind()
        if bind is None or bind.dialect.name != "postgresql":
            return
        if resolved:
            target.info[_RLS_USER_INFO_KEY] = resolved
        try:
            conn = target.connection()
            if resolved:
                conn.info[_RLS_USER_INFO_KEY] = resolved
            if conn.info.get(_RLS_BOUND_KEY) == resolved:
                return
            conn.execute(stmt, {"uid": resolved})
            conn.info[_RLS_BOUND_KEY] = resolved
        except Exception:
            pass
    else:
        conn = target
        if conn.dialect.name != "postgresql":
            return
        if resolved:
            conn.info[_RLS_USER_INFO_KEY] = resolved
        if conn.info.get(_RLS_BOUND_KEY) == resolved:
            return
        conn.execute(stmt, {"uid": resolved})
        conn.info[_RLS_BOUND_KEY] = resolved


def bind_user_rls(session: Session, user_id: str) -> None:
    """Set request user context and sync it to the active Postgres connection."""

    set_rls_user_id(user_id)
    session.info[_RLS_USER_INFO_KEY] = user_id
    apply_rls_settings(session, user_id=user_id)


def register_rls_listeners(session_factory: type[Session]) -> None:
    @event.listens_for(session_factory, "after_begin")
    def _rls_after_begin(session: Session, _transaction, connection: Connection) -> None:
        # SET LOCAL dies with the previous transaction; always re-bind.
        # Prefer session.info over ContextVar — the latter is unreliable across
        # FastAPI's threadpool boundary between auth deps and route handlers.
        user_id = session.info.get(_RLS_USER_INFO_KEY) or get_rls_user_id() or ""
        connection.info.pop(_RLS_BOUND_KEY, None)
        if user_id:
            session.info[_RLS_USER_INFO_KEY] = user_id
            connection.info[_RLS_USER_INFO_KEY] = user_id
        apply_rls_settings(connection, user_id=user_id)
