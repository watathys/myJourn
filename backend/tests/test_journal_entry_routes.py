from datetime import date

from app.api.dependencies import set_test_user_id
from app.models import (
    GoalStatus,
    JournalEntry,
    LifeInsight,
    OpenLoopAndGoal,
    PercyReminder,
    User,
)
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session


def test_list_journal_entries_returns_newest_first_with_goals(
    client: TestClient, session: Session
) -> None:
    user = User()
    session.add(user)
    session.flush()
    older = JournalEntry(
        user_id=user.id,
        date=date(2026, 7, 18),
        raw_transcript="An older day.",
        formatted_narrative="Older narrative.",
        alignment_summary="Keep going.",
        context_summary="An older-day summary.",
    )
    newer = JournalEntry(
        user_id=user.id,
        date=date(2026, 7, 19),
        raw_transcript="Today.",
        formatted_narrative="Today's narrative.",
        alignment_summary="Be present.",
        context_summary="Today's summary.",
    )
    session.add_all([older, newer])
    session.flush()
    session.add(
        OpenLoopAndGoal(
            user_id=user.id,
            journal_entry_id=newer.id,
            goal_text="Take an evening walk",
        )
    )
    session.commit()

    response = client.get(f"/api/users/{user.id}/journal-entries")

    assert response.status_code == 200
    payload = response.json()
    assert [entry["id"] for entry in payload] == [newer.id, older.id]
    assert payload[0]["goals"][0]["goal_text"] == "Take an evening walk"

    goal = session.get(OpenLoopAndGoal, payload[0]["goals"][0]["id"])
    assert goal is not None
    goal.status = GoalStatus.ABANDONED
    session.commit()
    archived_payload = client.get(f"/api/users/{user.id}/journal-entries").json()
    assert archived_payload[0]["goals"] == []


def test_list_journal_entries_requires_existing_user(client: TestClient) -> None:
    set_test_user_id("missing-user")
    response = client.get("/api/users/missing-user/journal-entries")

    assert response.status_code == 404


def test_update_journal_entry_narrative(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.flush()
    entry = JournalEntry(
        user_id=user.id,
        date=date(2026, 7, 19),
        raw_transcript="Spoke with Sam about the hike.",
        formatted_narrative="I spoke with Sam about the hike.",
        alignment_summary="What I'm Working On\n\nStay present.",
        context_summary="Talked with Sam about hiking.",
        follow_up_questions=["How did the talk with Sam feel?"],
    )
    session.add(entry)
    session.commit()

    response = client.patch(
        f"/api/journal-entries/{entry.id}",
        json={
            "user_id": user.id,
            "formatted_narrative": "I spoke with Sam about the hike up Mount Timpanogos.",
        },
    )

    assert response.status_code == 200
    assert (
        response.json()["formatted_narrative"]
        == "I spoke with Sam about the hike up Mount Timpanogos."
    )
    session.refresh(entry)
    assert entry.formatted_narrative == "I spoke with Sam about the hike up Mount Timpanogos."


def test_update_journal_entry_date(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.flush()
    entry = JournalEntry(
        user_id=user.id,
        date=date(2026, 7, 19),
        raw_transcript="Spoke with Sam about the hike.",
        formatted_narrative="I spoke with Sam about the hike.",
        alignment_summary="What I'm Working On\n\nStay present.",
        context_summary="Talked with Sam about hiking.",
    )
    session.add(entry)
    session.commit()

    response = client.patch(
        f"/api/journal-entries/{entry.id}",
        json={"user_id": user.id, "date": "2026-07-15"},
    )

    assert response.status_code == 200
    assert response.json()["date"] == "2026-07-15"
    assert response.json()["formatted_narrative"] == "I spoke with Sam about the hike."
    session.refresh(entry)
    assert entry.date == date(2026, 7, 15)


def test_update_journal_entry_requires_a_field(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.flush()
    entry = JournalEntry(
        user_id=user.id,
        date=date(2026, 7, 19),
        raw_transcript="A quiet day.",
        formatted_narrative="A quiet day.",
        alignment_summary="What I'm Working On",
        context_summary="A quiet day.",
    )
    session.add(entry)
    session.commit()

    response = client.patch(
        f"/api/journal-entries/{entry.id}",
        json={"user_id": user.id},
    )

    assert response.status_code == 422


def test_update_journal_entry_rejects_other_users(client: TestClient, session: Session) -> None:
    owner = User()
    other = User()
    session.add_all([owner, other])
    session.flush()
    entry = JournalEntry(
        user_id=owner.id,
        date=date(2026, 7, 19),
        raw_transcript="Private day.",
        formatted_narrative="A private day.",
        alignment_summary="What I'm Working On",
        context_summary="Private summary.",
    )
    session.add(entry)
    session.commit()

    set_test_user_id(other.id)
    response = client.patch(
        f"/api/journal-entries/{entry.id}",
        json={"user_id": other.id, "formatted_narrative": "Hacked narrative."},
    )

    assert response.status_code == 404
    session.refresh(entry)
    assert entry.formatted_narrative == "A private day."


def test_create_and_list_manual_goals(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()
    week_start = "2026-07-20"

    created = client.post(
        f"/api/users/{user.id}/goals",
        json={
            "goal_text": "Weekly planning",
            "week_start_date": week_start,
        },
    )
    assert created.status_code == 201
    assert created.json()["goal_text"].lower() == "weekly planning"
    assert created.json()["status"] == "pending"
    assert created.json()["week_start_date"] == week_start

    listed = client.get(f"/api/users/{user.id}/goals", params={"week_start_date": week_start})
    assert listed.status_code == 200
    assert [goal["goal_text"].lower() for goal in listed.json()] == [
        "weekly planning"
    ]

    other_week = client.get(
        f"/api/users/{user.id}/goals", params={"week_start_date": "2026-07-27"}
    )
    assert other_week.json() == []

    goal_id = created.json()["id"]
    goal = session.get(OpenLoopAndGoal, goal_id)
    assert goal is not None
    goal.status = GoalStatus.COMPLETED
    session.commit()

    listed_after_completion = client.get(
        f"/api/users/{user.id}/goals", params={"week_start_date": week_start}
    )
    assert listed_after_completion.json()[0]["status"] == "completed"

    archived = client.patch(
        f"/api/goals/{goal_id}",
        json={"user_id": user.id, "status": "abandoned"},
    )
    assert archived.status_code == 200
    assert archived.json()["status"] == "abandoned"
    assert (
        client.get(f"/api/users/{user.id}/goals", params={"week_start_date": week_start}).json()
        == []
    )


def test_create_goal_rejects_blank_text(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    response = client.post(
        f"/api/users/{user.id}/goals",
        json={"goal_text": "   ", "week_start_date": "2026-07-20"},
    )

    assert response.status_code == 422


def test_list_update_and_reorder_tasks(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.flush()
    first = OpenLoopAndGoal(user_id=user.id, goal_text="Read scriptures", sort_order=1)
    second = OpenLoopAndGoal(user_id=user.id, goal_text="Go for a run", sort_order=2)
    session.add_all([first, second])
    session.commit()

    listed = client.get(f"/api/users/{user.id}/tasks")
    assert listed.status_code == 200
    assert [task["goal_text"] for task in listed.json()] == ["Read scriptures", "Go for a run"]

    completed = client.patch(
        f"/api/tasks/{first.id}", json={"user_id": user.id, "status": "completed"}
    )
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"

    reordered_after_completion = client.get(f"/api/users/{user.id}/tasks").json()
    assert [task["goal_text"] for task in reordered_after_completion] == [
        "Go for a run",
        "Read scriptures",
    ]

    scheduled = client.patch(
        f"/api/tasks/{second.id}",
        json={"user_id": user.id, "remind_at": "2026-08-01T09:00:00Z"},
    )
    assert scheduled.status_code == 200
    assert scheduled.json()["remind_at"] is not None

    snoozed = client.patch(
        f"/api/tasks/{second.id}",
        json={"user_id": user.id, "snoozed_until": "2026-09-01"},
    )
    assert snoozed.status_code == 200
    assert snoozed.json()["is_snoozed"] is True
    assert snoozed.json()["just_resurfaced"] is False

    reorder = client.patch(
        f"/api/users/{user.id}/tasks/reorder",
        json={"user_id": user.id, "ordered_ids": [first.id, second.id]},
    )
    assert reorder.status_code == 200


def test_weekly_planning_session_gate(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    missing = client.get(f"/api/users/{user.id}/weekly-planning/sessions/2026-07-20")
    assert missing.status_code == 404

    started = client.post(
        f"/api/users/{user.id}/weekly-planning/sessions",
        json={"week_start_date": "2026-07-20"},
    )
    assert started.status_code == 201
    assert started.json()["week_start_date"] == "2026-07-20"

    fetched = client.get(f"/api/users/{user.id}/weekly-planning/sessions/2026-07-20")
    assert fetched.status_code == 200

    idempotent = client.post(
        f"/api/users/{user.id}/weekly-planning/sessions",
        json={"week_start_date": "2026-07-20"},
    )
    assert idempotent.status_code == 201
    assert idempotent.json()["started_at"] == fetched.json()["started_at"]


def test_delete_journal_entry_requires_owner(client: TestClient, session: Session) -> None:
    owner = User()
    other = User()
    entry = JournalEntry(
        user=owner,
        date=date(2026, 7, 19),
        raw_transcript="A private day.",
        formatted_narrative="A private day.",
        alignment_summary="What I'm Working On",
        context_summary="A private day.",
    )
    session.add_all([owner, other, entry])
    session.commit()

    set_test_user_id(other.id)
    denied = client.request(
        "DELETE",
        f"/api/journal-entries/{entry.id}",
        json={"user_id": other.id},
    )
    assert denied.status_code == 404
    assert session.get(JournalEntry, entry.id) is not None

    set_test_user_id(owner.id)
    deleted = client.request(
        "DELETE",
        f"/api/journal-entries/{entry.id}",
        json={"user_id": owner.id},
    )
    assert deleted.status_code == 204
    assert session.get(JournalEntry, entry.id) is None


def test_list_and_dismiss_percy_reminders(client: TestClient, session: Session) -> None:
    owner = User()
    other = User()
    session.add_all([owner, other])
    session.flush()
    entry = JournalEntry(
        user_id=owner.id,
        date=date(2026, 7, 19),
        raw_transcript="Percy remind me on weekly planning to work on not complaining.",
        formatted_narrative="Today was fine.",
        alignment_summary="What I'm Working On",
        context_summary="A fine day.",
    )
    session.add(entry)
    session.flush()
    reminder = PercyReminder(
        user_id=owner.id,
        journal_entry_id=entry.id,
        reminder_text="Set not complaining as a goal.",
    )
    session.add(reminder)
    session.commit()

    set_test_user_id(owner.id)
    listed = client.get(f"/api/users/{owner.id}/percy-reminders")
    assert listed.status_code == 200
    assert listed.json()[0]["reminder_text"] == "Set not complaining as a goal."

    set_test_user_id(other.id)
    denied = client.patch(
        f"/api/percy-reminders/{reminder.id}/dismiss",
        json={"user_id": other.id},
    )
    assert denied.status_code == 404

    set_test_user_id(owner.id)
    dismissed = client.patch(
        f"/api/percy-reminders/{reminder.id}/dismiss",
        json={"user_id": owner.id},
    )
    assert dismissed.status_code == 200
    assert dismissed.json()["is_dismissed"] is True

    listed_after = client.get(f"/api/users/{owner.id}/percy-reminders")
    assert listed_after.json() == []


def test_list_and_mark_life_insights_read(client: TestClient, session: Session) -> None:
    owner = User()
    other = User()
    session.add_all([owner, other])
    session.flush()
    insight = LifeInsight(
        user_id=owner.id,
        insight_text="Complaining tends to spike on days with poor sleep.",
    )
    session.add(insight)
    session.commit()

    set_test_user_id(owner.id)
    listed = client.get(f"/api/users/{owner.id}/life-insights")
    assert listed.status_code == 200
    assert listed.json()[0]["is_read"] is False

    set_test_user_id(other.id)
    denied = client.patch(
        f"/api/life-insights/{insight.id}/read",
        json={"user_id": other.id},
    )
    assert denied.status_code == 404

    set_test_user_id(owner.id)
    marked = client.patch(
        f"/api/life-insights/{insight.id}/read",
        json={"user_id": owner.id},
    )
    assert marked.status_code == 200
    assert marked.json()["is_read"] is True

    dismissed = client.patch(
        f"/api/life-insights/{insight.id}/dismiss",
        json={"user_id": owner.id},
    )
    assert dismissed.status_code == 200
    assert dismissed.json()["is_dismissed"] is True

    listed_after_dismiss = client.get(f"/api/users/{owner.id}/life-insights")
    assert listed_after_dismiss.json() == []

