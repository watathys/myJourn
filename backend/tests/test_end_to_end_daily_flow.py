import re
from collections.abc import Generator
from datetime import date

import pytest
from app.ai.schemas import DailyAIResult, GeneratedFollowUpQuestion
from app.api.dependencies import (
    _test_user_context,
    clear_test_user_id,
    get_current_user_id,
    get_journal_ai,
)
from app.constants import DEFAULT_NORTH_STAR
from app.db import get_db
from app.main import app
from app.models import QuestionDimension, User
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session


class ScenarioAI:
    def __init__(self) -> None:
        self.system_prompts: list[str] = []

    def process(self, *, system_prompt: str, user_prompt: str) -> DailyAIResult:
        self.system_prompts.append(system_prompt)
        if "I plan to run 3 miles tomorrow" in user_prompt:
            return DailyAIResult(
                praise_message=None,
                formatted_narrative="I plan to run three miles tomorrow.",
                alignment_summary="What I'm Working On\n\nRun three miles tomorrow.",
                context_summary="Plans to run three miles Tuesday morning.",
                completed_goal_ids=[],
                new_goals=["Run 3 miles"],
                follow_up_questions=[
                    GeneratedFollowUpQuestion(
                        question_text="How did the run feel?",
                        dimension=QuestionDimension.PHYSICAL,
                    ),
                    GeneratedFollowUpQuestion(
                        question_text="What will help you get started?",
                        dimension=QuestionDimension.MENTAL,
                    ),
                ],
                answered_follow_up_question_ids=[],
            )

        goal_match = re.search(r"\[([^\]]+)\] Run 3 miles", system_prompt)
        assert goal_match is not None
        return DailyAIResult(
            praise_message="You followed through and ran all three miles this morning.",
            formatted_narrative="I ran my three miles this morning.",
            alignment_summary="What I'm Working On\n\nI followed through on my run.",
            context_summary="Completed the planned three-mile morning run.",
            completed_goal_ids=[goal_match.group(1)],
            new_goals=[],
            follow_up_questions=[
                GeneratedFollowUpQuestion(
                    question_text="What felt strongest during the run?",
                    dimension=QuestionDimension.PHYSICAL,
                ),
                GeneratedFollowUpQuestion(
                    question_text="What progress do you want to carry forward?",
                    dimension=QuestionDimension.MENTAL,
                ),
            ],
            answered_follow_up_question_ids=[],
        )


@pytest.fixture
def scenario_client(
    session: Session,
) -> Generator[tuple[TestClient, ScenarioAI], None, None]:
    ai = ScenarioAI()

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
    app.dependency_overrides[get_journal_ai] = lambda: ai
    app.dependency_overrides[get_current_user_id] = _dynamic_get_current_user_id
    with TestClient(app) as client:
        yield client, ai
    app.dependency_overrides.clear()
    clear_test_user_id()


def test_goal_praise_and_no_mission_flow_end_to_end(
    scenario_client: tuple[TestClient, ScenarioAI],
) -> None:
    client, ai = scenario_client
    user_id = client.post("/api/users").json()["id"]

    monday = client.post(
        "/api/journal-entries/process",
        json={
            "user_id": user_id,
            "date": date(2026, 7, 20).isoformat(),
            "raw_transcript": "I plan to run 3 miles tomorrow. Private Monday detail: marigold.",
        },
    )

    assert monday.status_code == 201
    monday_body = monday.json()
    assert monday_body["new_goals"][0]["goal_text"] == "Run 3 miles"
    assert monday_body["new_goals"][0]["status"] == "pending"
    assert monday_body["formatted_narrative"]
    assert monday_body["alignment_summary"].startswith("What I'm Working On")
    assert monday_body["praise_message"] is None
    assert monday_body["follow_up_questions"] == [
        "How did the run feel?",
        "What will help you get started?",
    ]
    assert all(isinstance(question, str) for question in monday_body["follow_up_questions"])

    tuesday = client.post(
        "/api/journal-entries/process",
        json={
            "user_id": user_id,
            "date": date(2026, 7, 21).isoformat(),
            "raw_transcript": "Ran my 3 miles this morning.",
        },
    )

    assert tuesday.status_code == 201
    tuesday_body = tuesday.json()
    assert tuesday_body["completed_goals"][0]["status"] == "completed"
    assert "three miles this morning" in tuesday_body["praise_message"]
    assert tuesday_body["display_text"].startswith(tuesday_body["praise_message"])
    assert tuesday_body["formatted_narrative"]
    assert tuesday_body["alignment_summary"].startswith("What I'm Working On")
    assert "mission" not in tuesday_body["display_text"].casefold()

    monday_prompt, tuesday_prompt = ai.system_prompts
    assert DEFAULT_NORTH_STAR in monday_prompt
    assert DEFAULT_NORTH_STAR in tuesday_prompt
    assert "Their personal focus right now:" not in monday_prompt
    assert "Their personal focus right now:" not in tuesday_prompt
    assert "null" not in monday_prompt.casefold()
    assert "Plans to run three miles Tuesday morning." in tuesday_prompt
    assert "marigold" not in tuesday_prompt

    history = client.get(f"/api/users/{user_id}/journal-entries").json()
    monday_history = next(entry for entry in history if entry["date"] == "2026-07-20")
    assert monday_history["goals"][0]["status"] == "completed"
    assert monday_history["follow_up_questions"] == [
        "How did the run feel?",
        "What will help you get started?",
    ]
