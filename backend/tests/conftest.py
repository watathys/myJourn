from collections.abc import Generator

import pytest
from app.api.dependencies import _test_user_context, clear_test_user_id, get_current_user_id
from app.db import Base, get_db
from app.main import app
from app.models import User
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool


@pytest.fixture
def session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db_session:
        yield db_session
    Base.metadata.drop_all(engine)


@pytest.fixture
def client(session: Session) -> Generator[TestClient, None, None]:
    def override_get_db() -> Generator[Session, None, None]:
        yield session

    def _dynamic_get_current_user_id() -> str:
        ctx_user = _test_user_context.get()
        if ctx_user:
            return ctx_user
        latest_user = session.scalars(select(User).order_by(User.created_at.desc())).first()
        if latest_user:
            return latest_user.id
        user = User()
        session.add(user)
        session.commit()
        return user.id

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user_id] = _dynamic_get_current_user_id
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    clear_test_user_id()
