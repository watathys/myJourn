"""Unit tests for the standalone journal entry retrieval service."""

from __future__ import annotations

from datetime import date, timedelta
from unittest.mock import MagicMock

import pytest
from app.models import JournalEntry, User
from app.services.percy_chat import chat_with_percy
from app.services.retrieval import RetrievedEntry, retrieve_similar_entries
from sqlalchemy.orm import Session


class MockAI:
    def __init__(self, embeddings_map: dict[str, list[float]]) -> None:
        self.embeddings_map = embeddings_map
        self.default_embedding = [0.1] * 1536

    def generate_embedding(self, text: str) -> list[float]:
        return self.embeddings_map.get(text, self.default_embedding)


def test_retrieves_entries_ordered_by_similarity(session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    # Create 3 vectors with known dot products against query [1, 0, 0, ...]
    v_high = [1.0] + [0.0] * 1535  # sim = 1.0
    v_mid = [0.70710678, 0.70710678] + [0.0] * 1534  # sim ~ 0.707
    v_low = [0.0, 1.0] + [0.0] * 1534  # sim = 0.0

    entry1 = JournalEntry(
        user_id=user.id,
        date=date(2026, 7, 10),
        raw_transcript="Felt tired",
        formatted_narrative="Felt tired",
        alignment_summary="Align",
        context_summary="Low energy day",
        embedding=v_mid,
    )
    entry2 = JournalEntry(
        user_id=user.id,
        date=date(2026, 7, 11),
        raw_transcript="Slept terribly",
        formatted_narrative="Slept terribly",
        alignment_summary="Align",
        context_summary="Slept terribly and exhausted",
        embedding=v_high,
    )
    entry3 = JournalEntry(
        user_id=user.id,
        date=date(2026, 7, 12),
        raw_transcript="Great workout",
        formatted_narrative="Great workout",
        alignment_summary="Align",
        context_summary="Ran 5k and energetic",
        embedding=v_low,
    )
    session.add_all([entry1, entry2, entry3])
    session.commit()

    ai = MockAI({"why tired": [1.0] + [0.0] * 1535})

    results = retrieve_similar_entries(session, ai, user.id, "why tired", top_n=5)

    assert len(results) == 3
    assert results[0].entry.id == entry2.id
    assert pytest.approx(results[0].similarity, abs=1e-4) == 1.0
    assert results[1].entry.id == entry1.id
    assert pytest.approx(results[1].similarity, abs=1e-4) == 0.7071
    assert results[2].entry.id == entry3.id
    assert pytest.approx(results[2].similarity, abs=1e-4) == 0.0


def test_respects_top_n_parameter(session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    for i in range(5):
        vec = [float(i + 1) / 5.0] * 1536
        session.add(
            JournalEntry(
                user_id=user.id,
                date=date(2026, 7, 10 + i),
                raw_transcript=f"Entry {i}",
                formatted_narrative=f"Entry {i}",
                alignment_summary="Align",
                context_summary=f"Summary {i}",
                embedding=vec,
            )
        )
    session.commit()

    ai = MockAI({"query": [0.5] * 1536})

    results = retrieve_similar_entries(session, ai, user.id, "query", top_n=2)
    assert len(results) == 2


def test_respects_similarity_threshold(session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    v_high = [1.0] + [0.0] * 1535  # sim = 1.0
    v_mid = [0.6] + [0.8] + [0.0] * 1534  # sim = 0.6
    v_low = [0.2] + [0.979795897] + [0.0] * 1534  # sim = 0.2

    entry_high = JournalEntry(
        user_id=user.id,
        date=date(2026, 7, 10),
        raw_transcript="High",
        formatted_narrative="High",
        alignment_summary="Align",
        context_summary="High match",
        embedding=v_high,
    )
    entry_mid = JournalEntry(
        user_id=user.id,
        date=date(2026, 7, 11),
        raw_transcript="Mid",
        formatted_narrative="Mid",
        alignment_summary="Align",
        context_summary="Mid match",
        embedding=v_mid,
    )
    entry_low = JournalEntry(
        user_id=user.id,
        date=date(2026, 7, 12),
        raw_transcript="Low",
        formatted_narrative="Low",
        alignment_summary="Align",
        context_summary="Low match",
        embedding=v_low,
    )
    session.add_all([entry_high, entry_mid, entry_low])
    session.commit()

    ai = MockAI({"query": [1.0] + [0.0] * 1535})

    # With threshold 0.5, only high and mid should be returned
    results = retrieve_similar_entries(
        session, ai, user.id, "query", top_n=5, similarity_threshold=0.5
    )
    assert len(results) == 2
    assert [r.entry.id for r in results] == [entry_high.id, entry_mid.id]


def test_returns_empty_on_blank_query_or_no_embeddings(session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    session.add(
        JournalEntry(
            user_id=user.id,
            date=date(2026, 7, 10),
            raw_transcript="No embedding",
            formatted_narrative="No embedding",
            alignment_summary="Align",
            context_summary="No embedding summary",
            embedding=None,
        )
    )
    session.commit()

    ai = MockAI({})

    assert retrieve_similar_entries(session, ai, user.id, "   ", top_n=5) == []
    assert retrieve_similar_entries(session, ai, user.id, "query", top_n=5) == []


def test_postgres_dialect_branch(session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    v1 = [1.0] + [0.0] * 1535
    entry = JournalEntry(
        user_id=user.id,
        date=date(2026, 7, 10),
        raw_transcript="PG test",
        formatted_narrative="PG test",
        alignment_summary="Align",
        context_summary="PG summary",
        embedding=v1,
    )
    session.add(entry)
    session.commit()

    # Mock postgres dialect and session execution result
    mock_bind = MagicMock()
    mock_bind.dialect.name = "postgresql"

    mock_session = MagicMock(spec=Session)
    mock_session.get_bind.return_value = mock_bind
    mock_session.execute.return_value.all.return_value = [(entry, 0.95)]

    ai = MockAI({"query": v1})
    results = retrieve_similar_entries(
        mock_session, ai, user.id, "query", top_n=3, similarity_threshold=0.5
    )

    assert len(results) == 1
    assert isinstance(results[0], RetrievedEntry)
    assert results[0].entry == entry
    assert results[0].similarity == 0.95


def test_percy_chat_includes_retrieved_older_entries(session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    # Add 30 recent entries to fill the recent entries window
    start_date = date(2026, 6, 1)
    for i in range(30):
        session.add(
            JournalEntry(
                user_id=user.id,
                date=start_date + timedelta(days=i),
                raw_transcript=f"Recent entry {i}",
                formatted_narrative=f"Recent entry {i}",
                alignment_summary="Align",
                context_summary=f"Recent summary {i}",
                embedding=[0.01] * 1536,
            )
        )

    v1 = [1.0] + [0.0] * 1535
    old_entry = JournalEntry(
        user_id=user.id,
        date=date(2025, 1, 1),
        raw_transcript="Old transcript about burnout",
        formatted_narrative="Old transcript about burnout",
        alignment_summary="Align",
        context_summary="Felt exhausted and burnt out",
        embedding=v1,
    )
    session.add(old_entry)
    session.commit()

    class ChatAI:
        def __init__(self) -> None:
            self.last_system_prompt = ""

        def generate_embedding(self, text: str) -> list[float]:
            return [1.0] + [0.0] * 1535

        def chat(self, *, system_prompt: str, messages: list[dict[str, str]]) -> str:
            self.last_system_prompt = system_prompt
            return "Percy response"

    ai = ChatAI()
    chat_with_percy(session, ai, user.id, "why am I feeling burnt out", history=[])

    assert "Semantically Relevant Older Entries" in ai.last_system_prompt
    assert "Old transcript about burnout" in ai.last_system_prompt
    assert "ago)" in ai.last_system_prompt
