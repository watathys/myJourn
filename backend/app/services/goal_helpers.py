"""Helpers for goals and tasks, such as target count parsing and cleanup."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re
from typing import Optional

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models import GoalStatus, OpenLoopAndGoal

ARCHIVED_TASK_RETENTION_DAYS = 7


def parse_target_count_from_text(text: str) -> int:
    """Parse target count from goal text, e.g. 'Run 10x' -> 10, 'Do 5 pushups' -> 5."""
    match = re.search(r"\b(\d+)\s*(?:x|times)\b", text, re.IGNORECASE)
    if match:
        try:
            val = int(match.group(1))
            if 1 <= val <= 1000:
                return val
        except ValueError:
            pass
    return 1


def cleanup_archived_tasks(
    session: Session,
    user_id: Optional[str] = None,
    *,
    now: Optional[datetime] = None,
) -> int:
    """Delete tasks/goals with status GoalStatus.ABANDONED that were archived over 7 days ago.

    If ``archived_at`` is None (e.g. legacy records), fallback to checking ``created_at``.
    Returns the number of deleted records.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    cutoff = now - timedelta(days=ARCHIVED_TASK_RETENTION_DAYS)

    stmt = select(OpenLoopAndGoal).where(
        OpenLoopAndGoal.status == GoalStatus.ABANDONED,
        or_(
            OpenLoopAndGoal.archived_at <= cutoff,
            and_(
                OpenLoopAndGoal.archived_at.is_(None),
                OpenLoopAndGoal.created_at <= cutoff,
            ),
        ),
    )
    if user_id is not None:
        stmt = stmt.where(OpenLoopAndGoal.user_id == user_id)

    expired_items = list(session.scalars(stmt))
    if not expired_items:
        return 0

    for item in expired_items:
        session.delete(item)

    session.flush()
    return len(expired_items)
