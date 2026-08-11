from __future__ import annotations

from datetime import date

import pytest
from app.ai.schemas import DailyAIResult, GeneratedFollowUpQuestion
from app.config import Settings
from app.models import User
from app.services.daily_processing import DailyProcessingService
from app.services.spelling import (
    apply_spelling_corrections,
    extract_spelling_corrections,
    get_user_spelling_corrections,
    learn_spelling_corrections,
)
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session


@pytest.fixture
def settings() -> Settings:
    return Settings(
        database_url="sqlite://",
        openai_api_key="test-key",
        google_client_id="",
        google_client_secret="",
        google_redirect_uri="http://localhost/callback",
    )


class FakeJournalAI:
    def __init__(self, formatted_narrative: str = "Today was a good day.") -> None:
        self.last_system_prompt: str | None = None
        self.last_user_prompt: str | None = None
        self.call_count = 0
        self.formatted_narrative = formatted_narrative

    def process(self, *, system_prompt: str, user_prompt: str) -> DailyAIResult:
        self.last_system_prompt = system_prompt
        self.last_user_prompt = user_prompt
        self.call_count += 1
        return DailyAIResult(
            formatted_narrative=self.formatted_narrative,
            alignment_summary="Aligned with goals.",
            context_summary="Did some work.",
            completed_goal_ids=[],
            praise_message=None,
            new_goals=[],
            follow_up_questions=[
                GeneratedFollowUpQuestion(
                    question_text=f"How was your walk today on run {self.call_count}?",
                    dimension="physical",
                ),
                GeneratedFollowUpQuestion(
                    question_text=f"What are you working on next on run {self.call_count}?",
                    dimension="mental",
                ),
            ],
            answered_follow_up_question_ids=[],
            percy_reminders=[],
            percy_scheduled_reminders=[],
            percy_goal_requests=[],
            life_insights=[],
        )

    def generate_embedding(self, text: str) -> list[float]:
        return [0.1] * 1536


def test_apply_spelling_corrections() -> None:
    corrections = [("Tyce", "Thys"), ("teh", "the")]

    # Exact word match
    result = apply_spelling_corrections("I met Tyce yesterday.", corrections)
    assert result == "I met Thys yesterday."

    # Case-insensitive matching with title case target
    result_lower = apply_spelling_corrections("i met tyce yesterday.", corrections)
    assert result_lower == "i met Thys yesterday."

    # Lowercase correction
    result_teh = apply_spelling_corrections("Teh book is good.", corrections)
    assert result_teh == "The book is good."

    # Word boundary check - should not replace inside words
    result_inside = apply_spelling_corrections("Polytyce is not Tyce.", corrections)
    assert result_inside == "Polytyce is not Thys."


def test_extract_spelling_corrections() -> None:
    old_text = "I went to the store with Tyce yesterday."
    new_text = "I went to the store with Thys yesterday."

    extracted = extract_spelling_corrections(old_text, new_text)
    assert extracted == [("Tyce", "Thys")]


def test_learn_spelling_corrections(session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    old_text = "I talked to Tyce and Tyce was happy."
    new_text = "I talked to Thys and Thys was happy."

    saved = learn_spelling_corrections(session, user.id, old_text, new_text)
    session.commit()

    assert len(saved) == 1
    assert saved[0].incorrect_word == "Tyce"
    assert saved[0].correct_word == "Thys"

    all_corrections = get_user_spelling_corrections(session, user.id)
    assert len(all_corrections) == 1
    assert all_corrections[0].incorrect_word == "Tyce"
    assert all_corrections[0].correct_word == "Thys"


def test_spelling_correction_routes(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    # List empty
    res = client.get(f"/api/users/{user.id}/spelling-corrections")
    assert res.status_code == 200
    assert res.json() == []

    # Create correction
    res = client.post(
        f"/api/users/{user.id}/spelling-corrections",
        json={"incorrect_word": "Tyce", "correct_word": "Thys"},
    )
    assert res.status_code == 201
    created = res.json()
    assert created["incorrect_word"] == "Tyce"
    assert created["correct_word"] == "Thys"

    # List again
    res = client.get(f"/api/users/{user.id}/spelling-corrections")
    assert res.status_code == 200
    assert len(res.json()) == 1

    # Delete correction
    res = client.request(
        "DELETE",
        f"/api/spelling-corrections/{created['id']}",
        json={"user_id": user.id},
    )
    assert res.status_code == 204

    res = client.get(f"/api/users/{user.id}/spelling-corrections")
    assert res.status_code == 200
    assert res.json() == []


def test_auto_learning_on_journal_edit_and_subsequent_processing(
    client: TestClient, session: Session, settings: Settings
) -> None:
    user = User()
    session.add(user)
    session.commit()

    ai = FakeJournalAI(formatted_narrative="Today Tyce went to the store.")
    service = DailyProcessingService(session=session, ai=ai, settings=settings)

    # 1. First journal entry with speech-to-text typo "Tyce"
    res1 = service.process(
        user_id=user.id,
        entry_date=date(2026, 7, 21),
        raw_transcript="Today Tyce went to the store.",
    )
    assert ai.call_count == 1
    assert "Tyce" in res1.journal_entry.formatted_narrative

    # 2. User edits reflection in UI changing "Tyce" to "Thys"
    patch_res = client.patch(
        f"/api/journal-entries/{res1.journal_entry.id}",
        json={
            "user_id": user.id,
            "formatted_narrative": "Today Thys went to the store.",
        },
    )
    assert patch_res.status_code == 200

    # Verify spelling correction was automatically learned and stored in DB
    corrections = get_user_spelling_corrections(session, user.id)
    assert len(corrections) == 1
    assert corrections[0].incorrect_word == "Tyce"
    assert corrections[0].correct_word == "Thys"

    # 3. Next day, user submits another entry with speech-to-text typo "Tyce ran 5 miles."
    res2 = service.process(
        user_id=user.id,
        entry_date=date(2026, 7, 22),
        raw_transcript="Tyce ran 5 miles.",
    )

    # Verify that raw_transcript was automatically corrected BEFORE sending to AI
    assert "Thys ran 5 miles." in ai.last_user_prompt
    assert res2.journal_entry.raw_transcript == "Thys ran 5 miles."
    # AI was called only once for processing the new entry (0 extra API calls for spelling)
    assert ai.call_count == 2
