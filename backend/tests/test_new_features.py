"""Tests for new features: goal target counts, manual task creation, and Percy chat."""

from __future__ import annotations

from typing import Any

from app.api.dependencies import get_journal_ai
from app.main import app
from app.models import User
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session


class DummyAI:
    def process(self, *, system_prompt: str, user_prompt: str, **kwargs: Any) -> Any:
        raise NotImplementedError

    def chat(self, *, system_prompt: str, messages: list[dict[str, str]], **kwargs: Any) -> str:
        return "Hello! I noticed you enjoy running on weekends."

    def extract_json(self, *, system_prompt: str, user_prompt: str, schema_class: type[Any], **kwargs: Any) -> Any:
        from app.ai.schemas import ParsedScheduleItem, PercyGoalExtracted, WeeklyReflectionAIResult
        if schema_class is PercyGoalExtracted:
            return PercyGoalExtracted(
                goal_text="Go to the gym",
                target_count=7,
                remind_time_str="9am-10am",
                is_daily_recurring=True,
                reply="I've created your goal 'Go to the gym' with 7 checkable targets and daily 9:00 AM reminders!",
            )
        if schema_class is ParsedScheduleItem:
            return ParsedScheduleItem(
                clean_text=user_prompt,
                has_schedule=False,
                schedule_phrase=None,
                remind_time_str=None,
                target_count=1,
                is_daily_recurring=False,
            )
        if schema_class is WeeklyReflectionAIResult:
            return WeeklyReflectionAIResult(
                summary_narrative="It was a steady week balancing project work with personal rest.",
                what_went_well=["Finished key tasks", "Stayed consistent with journal entries"],
                what_was_hard=["Felt sluggish on Tuesday afternoon"],
                patterns_worth_noticing=["Noticed higher energy after morning walks"],
                suggested_focuses=["Keep morning walks consistent"],
            )
        raise NotImplementedError


def test_goal_target_count_and_checkmarks(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    # 1. Create a goal with 10x target count automatically parsed or passed
    resp = client.post(
        f"/api/users/{user.id}/goals",
        json={"goal_text": "Do pushups 10x", "week_start_date": "2026-07-20"},
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["target_count"] == 10
    assert data["current_count"] == 0
    assert data["status"] == "pending"
    goal_id = data["id"]

    # 2. Update current_count to 5
    resp = client.patch(
        f"/api/goals/{goal_id}",
        json={"user_id": user.id, "current_count": 5},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["current_count"] == 5
    assert data["status"] == "pending"

    # 3. Update current_count to 10 -> status becomes completed
    resp = client.patch(
        f"/api/goals/{goal_id}",
        json={"user_id": user.id, "current_count": 10},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["current_count"] == 10
    assert data["status"] == "completed"


def test_manually_add_task(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    resp = client.post(
        f"/api/users/{user.id}/tasks",
        json={"goal_text": "Finish reading the report"},
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["goal_text"] == "Finish reading the report"
    assert data["status"] == "pending"
    assert data["target_count"] == 1


def test_percy_chat_endpoint(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    app.dependency_overrides[get_journal_ai] = lambda: DummyAI()
    resp = client.post(
        f"/api/users/{user.id}/percy/chat",
        json={
            "message": "Tell me about my habits",
            "history": [],
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "reply" in data
    assert "running" in data["reply"]


def test_goal_reordering_and_scheduling(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    # Create two goals
    resp1 = client.post(
        f"/api/users/{user.id}/goals",
        json={"goal_text": "First goal", "week_start_date": "2026-07-20"},
    )
    g1 = resp1.json()

    resp2 = client.post(
        f"/api/users/{user.id}/goals",
        json={"goal_text": "Second goal", "week_start_date": "2026-07-20"},
    )
    g2 = resp2.json()

    # Reorder goals so second is first
    resp_reorder = client.patch(
        f"/api/users/{user.id}/goals/reorder",
        json={"user_id": user.id, "week_start_date": "2026-07-20", "ordered_ids": [g2["id"], g1["id"]]},
    )
    assert resp_reorder.status_code == 200
    reordered = resp_reorder.json()
    assert reordered[0]["id"] == g2["id"]
    assert reordered[1]["id"] == g1["id"]

    # Schedule reminder for a goal
    resp_sched = client.patch(
        f"/api/goals/{g1['id']}",
        json={"user_id": user.id, "remind_at": "2026-07-22T09:00:00Z"},
    )
    assert resp_sched.status_code == 200
    assert resp_sched.json()["remind_at"] is not None


def test_percy_create_goal_endpoint(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    app.dependency_overrides[get_journal_ai] = lambda: DummyAI()
    resp = client.post(
        f"/api/users/{user.id}/percy/create-goal",
        json={
            "user_query": "I want to go to the gym every day this week. Remind me at 9am-10am every day.",
            "week_start_date": "2026-07-20",
        },
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert "goal" in data
    assert "reply" in data
    assert data["goal"]["target_count"] == 7
    assert data["goal"]["goal_text"] == "Go to the gym"
    assert "gym" in data["reply"].lower()


def test_finish_weekly_planning_and_reopen(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    # 1. Start weekly planning
    resp_start = client.post(
        f"/api/users/{user.id}/weekly-planning/sessions",
        json={"week_start_date": "2026-07-20"},
    )
    assert resp_start.status_code == 201
    data = resp_start.json()
    assert data["completed_at"] is None

    # 2. Finish weekly planning
    resp_finish = client.post(
        f"/api/users/{user.id}/weekly-planning/sessions/2026-07-20/finish"
    )
    assert resp_finish.status_code == 200
    data_finish = resp_finish.json()
    assert data_finish["completed_at"] is not None

    # 3. Re-open (start) weekly planning clears completed_at
    resp_reopen = client.post(
        f"/api/users/{user.id}/weekly-planning/sessions",
        json={"week_start_date": "2026-07-20"},
    )
    assert resp_reopen.status_code in (200, 201)
    data_reopen = resp_reopen.json()
    assert data_reopen["completed_at"] is None


def test_percy_reminders_crud(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    # Create reminder
    resp_create = client.post(
        f"/api/users/{user.id}/percy-reminders",
        json={"reminder_text": "Remember to buy milk for next week"},
    )
    assert resp_create.status_code == 201
    reminder = resp_create.json()
    assert reminder["reminder_text"] == "Remember to buy milk for next week"

    # Get reminders
    resp_get = client.get(f"/api/users/{user.id}/percy-reminders")
    assert resp_get.status_code == 200
    reminders = resp_get.json()
    assert len(reminders) == 1
    assert reminders[0]["id"] == reminder["id"]

    # Delete reminder
    resp_del = client.request(
        "DELETE",
        f"/api/percy-reminders/{reminder['id']}",
        json={"user_id": str(user.id)},
    )
    assert resp_del.status_code == 204

    # Verify deleted
    resp_get_after = client.get(f"/api/users/{user.id}/percy-reminders")
    assert len(resp_get_after.json()) == 0


def test_natural_language_schedule_parsing() -> None:
    from datetime import date

    from app.services.schedule_parsing import parse_natural_language_item

    base = date(2026, 7, 22)  # Wednesday

    # 1. Plain task
    text, dt, cnt, rec, r_cnt = parse_natural_language_item(
        "drink a protein shake",
        base_date=base,
    )
    assert text == "drink a protein shake"
    assert dt is None
    assert cnt == 1
    assert rec is False

    # 2. Task with Thursday 9am schedule
    text, dt, cnt, rec, r_cnt = parse_natural_language_item(
        "remind me on thursday at 9am to drink a protein shake",
        base_date=base,
    )
    assert text == "drink a protein shake"
    assert dt is not None
    assert dt.hour == 9
    assert cnt == 1

    # 3. Recurring goal
    text, dt, cnt, rec, r_cnt = parse_natural_language_item(
        "remind me every day at 3pm to fill up my water bottle",
        base_date=base,
        item_type="goal",
    )
    assert text == "fill up my water bottle"
    assert dt is not None
    assert dt.hour == 15
    assert cnt == 7
    assert rec is True


def test_weekly_reflection_feature(client: TestClient, session: Session) -> None:
    from datetime import date
    from app.models import JournalEntry, LifeInsight, User, WeeklyPlanningSession

    app.dependency_overrides[get_journal_ai] = lambda: DummyAI()

    user = User()
    session.add(user)
    session.commit()

    # Add a journal entry in the past week
    entry = JournalEntry(
        user_id=user.id,
        date=date(2026, 8, 5),
        raw_transcript="Felt great today, finished key tasks and went for a walk.",
        formatted_narrative="Felt great today, finished key tasks and went for a walk.",
        alignment_summary="Aligned with goals.",
        context_summary="Felt rejuvenated after a morning walk and key task progress.",
    )
    session.add(entry)

    # Add a life insight
    insight = LifeInsight(
        user_id=user.id,
        journal_entry_id=entry.id,
        insight_text="Morning walks boost focus and energy.",
    )
    session.add(insight)
    session.commit()

    # 1. Start weekly planning session for 2026-08-10 (Monday)
    resp = client.post(
        f"/api/users/{user.id}/weekly-planning/sessions",
        json={"week_start_date": "2026-08-10"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["week_start_date"] == "2026-08-10"
    assert data["reflection_data"] is not None
    assert "summary_narrative" in data["reflection_data"]
    assert len(data["reflection_data"]["what_went_well"]) > 0

    # 2. Trigger explicit reflection endpoint
    resp2 = client.post(
        f"/api/users/{user.id}/weekly-planning/sessions/2026-08-10/reflection",
    )
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["reflection_data"]["summary_narrative"] == "It was a steady week balancing project work with personal rest."



