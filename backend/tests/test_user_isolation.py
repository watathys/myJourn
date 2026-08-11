"""Cross-user isolation: application checks, verified JWT tokens, and Postgres RLS."""

from __future__ import annotations

import os
from collections.abc import Generator
from datetime import date

import pytest
from app.ai.client import JournalAI
from app.api.dependencies import get_current_user_id
from app.db import get_db
from app.main import app
from app.models import JournalEntry, LifeInsight, User
from app.rls import bind_user_rls
from app.services.retrieval import retrieve_similar_entries
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session


@pytest.fixture
def client(session: Session) -> Generator[TestClient, None, None]:
    def override_get_db() -> Generator[Session, None, None]:
        yield session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


class _FixedEmbeddingAI(JournalAI):
    def __init__(self, vector: list[float]) -> None:
        self._vector = vector

    def generate_embedding(self, text: str) -> list[float]:  # noqa: ARG002
        return self._vector


def _journal_entry(user: User, entry_date: date, marker: str) -> JournalEntry:
    return JournalEntry(
        user_id=user.id,
        date=entry_date,
        raw_transcript=marker,
        formatted_narrative=marker,
        alignment_summary="summary",
        context_summary=f"context {marker}",
        embedding=[0.1] * 1536,
    )


def test_list_journal_entries_excludes_other_users(client: TestClient, session: Session) -> None:
    owner = User()
    other = User()
    session.add_all([owner, other])
    session.flush()
    session.add_all(
        [
            _journal_entry(owner, date(2026, 7, 20), "owner-only"),
            _journal_entry(other, date(2026, 7, 21), "other-only"),
        ]
    )
    session.commit()

    app.dependency_overrides[get_current_user_id] = lambda: owner.id
    response = client.get(f"/api/users/{owner.id}/journal-entries")
    assert response.status_code == 200
    narratives = [item["formatted_narrative"] for item in response.json()]
    assert narratives == ["owner-only"]
    assert "other-only" not in narratives


def test_retrieval_does_not_return_other_users_entries(session: Session) -> None:
    owner = User()
    other = User()
    session.add_all([owner, other])
    session.flush()
    owner_entry = _journal_entry(owner, date(2026, 7, 19), "private owner journal")
    other_entry = _journal_entry(other, date(2026, 7, 18), "private other journal")
    session.add_all([owner_entry, other_entry])
    session.commit()

    ai = _FixedEmbeddingAI([0.2] * 1536)
    as_owner = retrieve_similar_entries(
        session=session,
        ai=ai,
        user_id=owner.id,
        query="private journal",
        top_n=5,
    )
    as_other = retrieve_similar_entries(
        session=session,
        ai=ai,
        user_id=other.id,
        query="private journal",
        top_n=5,
    )

    assert {item.entry.id for item in as_owner} == {owner_entry.id}
    assert {item.entry.id for item in as_other} == {other_entry.id}


def test_life_insights_list_is_scoped_to_user(client: TestClient, session: Session) -> None:
    owner = User()
    other = User()
    session.add_all([owner, other])
    session.flush()
    session.add_all(
        [
            LifeInsight(user_id=owner.id, insight_text="Owner insight"),
            LifeInsight(user_id=other.id, insight_text="Other insight"),
        ]
    )
    session.commit()

    app.dependency_overrides[get_current_user_id] = lambda: owner.id
    response = client.get(f"/api/users/{owner.id}/life-insights")
    assert response.status_code == 200
    texts = [row["insight_text"] for row in response.json()]
    assert texts == ["Owner insight"]


def test_cross_user_insight_patch_returns_not_found(client: TestClient, session: Session) -> None:
    owner = User()
    other = User()
    session.add_all([owner, other])
    session.flush()
    insight = LifeInsight(user_id=owner.id, insight_text="Sensitive pattern")
    session.add(insight)
    session.commit()

    app.dependency_overrides[get_current_user_id] = lambda: other.id
    response = client.patch(
        f"/api/life-insights/{insight.id}/read",
        json={"user_id": other.id},
    )
    assert response.status_code == 404
    session.refresh(insight)
    assert insight.is_read is False


def test_impersonation_attempt_with_other_user_id_in_url_or_body(
    client: TestClient, session: Session
) -> None:
    """Confirms that passing someone else's user_id in URL or body is ignored/rejected."""

    owner = User()
    attacker = User()
    session.add_all([owner, attacker])
    session.flush()

    owner_entry = _journal_entry(owner, date(2026, 7, 22), "Secret owner entry")
    session.add(owner_entry)
    session.commit()

    # The caller is authenticated as 'attacker' via token
    app.dependency_overrides[get_current_user_id] = lambda: attacker.id

    # Attacker tries to view owner's entries by specifying owner.id in URL
    listed = client.get(f"/api/users/{owner.id}/journal-entries")
    assert listed.status_code == 200
    # Because token identity is attacker.id, owner's entry is not returned
    assert listed.json() == []

    # Attacker tries to modify owner's entry by passing owner.id in body
    patch = client.patch(
        f"/api/journal-entries/{owner_entry.id}",
        json={"user_id": owner.id, "formatted_narrative": "Stolen"},
    )
    assert patch.status_code == 404

    session.refresh(owner_entry)
    assert owner_entry.formatted_narrative == "Secret owner entry"


@pytest.fixture
def postgres_rls_engine():
    database_url = os.environ.get("MYJOURN_TEST_DATABASE_URL", "")
    if not database_url.startswith("postgres"):
        pytest.skip("Set MYJOURN_TEST_DATABASE_URL to a Postgres database with migrations applied")
    engine = create_engine(database_url, pool_pre_ping=True)
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT app_effective_user_id()"))
    except Exception as exc:  # noqa: BLE001
        engine.dispose()
        pytest.skip(f"RLS migration not applied: {exc}")
    yield engine
    engine.dispose()


def test_postgres_rls_hides_other_users_journal_rows(postgres_rls_engine) -> None:
    """Database-level isolation when using the myjourn_app role and app.current_user_id."""

    owner = User()
    other = User()
    with Session(bind=postgres_rls_engine) as init_session:
        init_session.add_all([owner, other])
        init_session.commit()
        owner_id = owner.id
        other_id = other.id

    with postgres_rls_engine.connect() as conn:
        conn.execute(text("SET ROLE myjourn_app"))
        session = Session(bind=conn, expire_on_commit=False)

        bind_user_rls(session, owner_id)
        owner_entry = JournalEntry(
            user_id=owner_id,
            date=date(2026, 7, 10),
            raw_transcript="RLS owner row",
            formatted_narrative="RLS owner row",
            alignment_summary="summary",
            context_summary="context RLS owner row",
            embedding=[0.1] * 1536,
        )
        session.add(owner_entry)
        session.commit()

        owner_entry_id = owner_entry.id
        bind_user_rls(session, other_id)
        session.expire_all()
        visible_to_other = session.scalars(select(JournalEntry)).all()
        assert visible_to_other == []

        by_id = session.scalar(select(JournalEntry).where(JournalEntry.id == owner_entry_id))
        assert by_id is None

        bind_user_rls(session, owner_id)
        visible_to_owner = session.scalars(select(JournalEntry)).all()
        assert len(visible_to_owner) == 1
        assert visible_to_owner[0].id == owner_entry.id

        session.close()
        conn.execute(text("RESET ROLE"))
