"""The auth dependency must reject any token it cannot cryptographically verify.

These exercise the real ``get_current_user_id``; the shared ``client`` fixture
overrides that dependency, so it never covered token handling.
"""

import time
from collections.abc import Generator

import jwt
import pytest
from app.api.dependencies import clear_test_user_id, get_current_user_id
from app.config import Settings, get_settings
from app.db import Base, get_db
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

HS256_SECRET = "correct-horse-battery-staple"
VICTIM_ID = "11fd649d-b068-4c37-8e40-f487e5691236"


@pytest.fixture
def auth_client() -> Generator[TestClient, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    with Session(engine, expire_on_commit=False) as session:

        def override_get_db() -> Generator[Session, None, None]:
            yield session

        app.dependency_overrides[get_db] = override_get_db
        # Settings fields use validation_alias, so they must be set by alias.
        app.dependency_overrides[get_settings] = lambda: Settings(
            SUPABASE_JWT_SECRET=HS256_SECRET,
        )
        clear_test_user_id()
        assert get_current_user_id not in app.dependency_overrides
        with TestClient(app) as client:
            yield client
        app.dependency_overrides.clear()

    Base.metadata.drop_all(engine)


def _get_tasks(client: TestClient, token: str):
    return client.get(
        f"/api/users/{VICTIM_ID}/tasks",
        headers={"Authorization": f"Bearer {token}"},
    )


def test_accepts_correctly_signed_token(auth_client: TestClient) -> None:
    valid = jwt.encode({"sub": VICTIM_ID}, HS256_SECRET, algorithm="HS256")
    assert _get_tasks(auth_client, valid).status_code == 200


def test_rejects_token_signed_with_wrong_secret(auth_client: TestClient) -> None:
    """Previously this was decoded unverified, handing over the victim's data."""

    forged = jwt.encode({"sub": VICTIM_ID}, "attacker-secret", algorithm="HS256")
    assert _get_tasks(auth_client, forged).status_code == 401


def test_rejects_unsigned_token(auth_client: TestClient) -> None:
    unsigned = jwt.encode({"sub": VICTIM_ID}, key="", algorithm="none")
    assert _get_tasks(auth_client, unsigned).status_code == 401


def test_rejects_expired_token(auth_client: TestClient) -> None:
    expired = jwt.encode(
        {"sub": VICTIM_ID, "exp": int(time.time()) - 60},
        HS256_SECRET,
        algorithm="HS256",
    )
    assert _get_tasks(auth_client, expired).status_code == 401


def test_rejects_garbage_token(auth_client: TestClient) -> None:
    assert _get_tasks(auth_client, "not-a-jwt").status_code == 401


def test_api_key_is_not_accepted_as_a_signing_secret() -> None:
    """An `sb_secret_…` value is an API key, not an HS256 signing secret."""

    assert Settings(SUPABASE_JWT_SECRET="sb_secret_EcOGZ7W").supabase_hs256_secret is None
    assert Settings(SUPABASE_JWT_SECRET=HS256_SECRET).supabase_hs256_secret == HS256_SECRET


def test_hs256_token_rejected_when_no_secret_configured() -> None:
    """With only an API key configured, HS256 tokens must not be trusted."""

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    with Session(engine, expire_on_commit=False) as session:

        def override_get_db() -> Generator[Session, None, None]:
            yield session

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_settings] = lambda: Settings(
            SUPABASE_JWT_SECRET="sb_secret_EcOGZ7W",
        )
        clear_test_user_id()
        with TestClient(app) as client:
            token = jwt.encode({"sub": VICTIM_ID}, HS256_SECRET, algorithm="HS256")
            assert _get_tasks(client, token).status_code == 401
        app.dependency_overrides.clear()

    Base.metadata.drop_all(engine)
