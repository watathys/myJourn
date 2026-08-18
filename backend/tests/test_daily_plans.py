from datetime import date

from app.api.dependencies import set_test_user_id
from app.models import DailyPlan, GoalKind, GoalStatus, OpenLoopAndGoal, User
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session


def test_get_daily_plan_returns_404_when_missing(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    response = client.get(f"/api/users/{user.id}/daily-plans/2026-08-17")

    assert response.status_code == 404


def test_upsert_daily_plan_creates_and_updates(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.flush()
    task_a = OpenLoopAndGoal(
        user_id=user.id,
        goal_text="Write the proposal",
        status=GoalStatus.PENDING,
        kind=GoalKind.TASK,
    )
    task_b = OpenLoopAndGoal(
        user_id=user.id,
        goal_text="Call the dentist",
        status=GoalStatus.PENDING,
        kind=GoalKind.TASK,
    )
    session.add_all([task_a, task_b])
    session.commit()

    create_response = client.put(
        f"/api/users/{user.id}/daily-plans/2026-08-17",
        json={
            "user_id": user.id,
            "selected_task_ids": [task_a.id],
            "complete_morning": True,
        },
    )

    assert create_response.status_code == 200
    created = create_response.json()
    assert created["selected_task_ids"] == [task_a.id]
    assert created["morning_completed_at"] is not None

    update_response = client.put(
        f"/api/users/{user.id}/daily-plans/2026-08-17",
        json={
            "user_id": user.id,
            "selected_task_ids": [task_b.id, task_a.id],
            "complete_morning": False,
        },
    )

    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["selected_task_ids"] == [task_b.id, task_a.id]

    get_response = client.get(f"/api/users/{user.id}/daily-plans/2026-08-17")
    assert get_response.status_code == 200
    assert get_response.json()["id"] == created["id"]


def test_upsert_daily_plan_rejects_invalid_task_ids(
    client: TestClient, session: Session
) -> None:
    user = User()
    session.add(user)
    session.commit()

    response = client.put(
        f"/api/users/{user.id}/daily-plans/2026-08-17",
        json={
            "user_id": user.id,
            "selected_task_ids": ["not-a-real-task"],
            "complete_morning": True,
        },
    )

    assert response.status_code == 422


def test_daily_plan_is_isolated_by_user(client: TestClient, session: Session) -> None:
    owner = User()
    other = User()
    session.add_all([owner, other])
    session.flush()
    task = OpenLoopAndGoal(
        user_id=owner.id,
        goal_text="Owner task",
        status=GoalStatus.PENDING,
        kind=GoalKind.TASK,
    )
    session.add(task)
    session.commit()

    client.put(
        f"/api/users/{owner.id}/daily-plans/2026-08-17",
        json={
            "user_id": owner.id,
            "selected_task_ids": [task.id],
            "complete_morning": True,
        },
    )

    set_test_user_id(other.id)
    response = client.get(f"/api/users/{other.id}/daily-plans/2026-08-17")
    assert response.status_code == 404

    blocked = client.put(
        f"/api/users/{other.id}/daily-plans/2026-08-17",
        json={
            "user_id": other.id,
            "selected_task_ids": [task.id],
            "complete_morning": True,
        },
    )
    assert blocked.status_code == 422


def test_skip_morning_creates_empty_completed_plan(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    response = client.put(
        f"/api/users/{user.id}/daily-plans/2026-08-17",
        json={
            "user_id": user.id,
            "selected_task_ids": [],
            "complete_morning": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["selected_task_ids"] == []
    assert payload["morning_completed_at"] is not None

    plan = session.get(DailyPlan, payload["id"])
    assert plan is not None
    assert plan.date == date(2026, 8, 17)
