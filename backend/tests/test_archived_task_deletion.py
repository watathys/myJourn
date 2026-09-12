from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import GoalStatus, OpenLoopAndGoal, User
from app.services.goal_helpers import cleanup_archived_tasks


def test_cleanup_archived_tasks_deletes_only_expired_abandoned_tasks(session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    now = datetime.now(timezone.utc)
    six_days_ago = now - timedelta(days=6)
    eight_days_ago = now - timedelta(days=8)

    # 1. Recently archived task (<7 days ago) -> keep
    recent_archived = OpenLoopAndGoal(
        user_id=user.id,
        goal_text="Recent archived task",
        status=GoalStatus.ABANDONED,
        archived_at=six_days_ago,
    )
    # 2. Old archived task (>7 days ago) -> delete
    old_archived = OpenLoopAndGoal(
        user_id=user.id,
        goal_text="Old archived task",
        status=GoalStatus.ABANDONED,
        archived_at=eight_days_ago,
    )
    # 3. Legacy archived task (archived_at is None, created_at >7 days ago) -> delete
    legacy_old_archived = OpenLoopAndGoal(
        user_id=user.id,
        goal_text="Legacy old archived task",
        status=GoalStatus.ABANDONED,
        created_at=eight_days_ago,
        archived_at=None,
    )
    # 4. Old completed task (>7 days ago) -> keep
    old_completed = OpenLoopAndGoal(
        user_id=user.id,
        goal_text="Old completed task",
        status=GoalStatus.COMPLETED,
        created_at=eight_days_ago,
    )
    # 5. Old pending task (>7 days ago) -> keep
    old_pending = OpenLoopAndGoal(
        user_id=user.id,
        goal_text="Old pending task",
        status=GoalStatus.PENDING,
        created_at=eight_days_ago,
    )

    session.add_all([recent_archived, old_archived, legacy_old_archived, old_completed, old_pending])
    session.commit()

    deleted_count = cleanup_archived_tasks(session, user.id, now=now)
    session.commit()

    assert deleted_count == 2

    remaining = session.query(OpenLoopAndGoal).filter_by(user_id=user.id).all()
    remaining_texts = {item.goal_text for item in remaining}

    assert "Recent archived task" in remaining_texts
    assert "Old completed task" in remaining_texts
    assert "Old pending task" in remaining_texts
    assert "Old archived task" not in remaining_texts
    assert "Legacy old archived task" not in remaining_texts


def test_patch_task_archive_sets_and_clears_archived_at(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    task = OpenLoopAndGoal(user_id=user.id, goal_text="Task to archive", status=GoalStatus.COMPLETED)
    session.add(task)
    session.commit()

    # Archive task
    resp = client.patch(
        f"/api/tasks/{task.id}",
        json={"user_id": user.id, "status": "abandoned"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "abandoned"
    assert resp.json()["archived_at"] is not None

    session.refresh(task)
    assert task.status == GoalStatus.ABANDONED
    assert task.archived_at is not None

    # Un-archive task back to pending
    resp2 = client.patch(
        f"/api/tasks/{task.id}",
        json={"user_id": user.id, "status": "pending"},
    )
    assert resp2.status_code == 200
    assert resp2.json()["status"] == "pending"
    assert resp2.json()["archived_at"] is None

    session.refresh(task)
    assert task.status == GoalStatus.PENDING
    assert task.archived_at is None


def test_list_tasks_triggers_cleanup(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    eight_days_ago = datetime.now(timezone.utc) - timedelta(days=8)
    expired_task = OpenLoopAndGoal(
        user_id=user.id,
        goal_text="Expired archived task",
        status=GoalStatus.ABANDONED,
        archived_at=eight_days_ago,
    )
    session.add(expired_task)
    session.commit()

    # GET /api/users/{user_id}/tasks should run cleanup
    resp = client.get(f"/api/users/{user.id}/tasks")
    assert resp.status_code == 200

    # Task should be gone from the database completely
    in_db = session.get(OpenLoopAndGoal, expired_task.id)
    assert in_db is None
