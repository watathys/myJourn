"""Add completed_at to weekly_planning_sessions.

Revision ID: 0008_add_weekly_session_completed_at
Revises: 0007_add_goal_target_count
Create Date: 2026-07-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_add_weekly_session_completed_at"
down_revision: str | None = "0007_add_goal_target_count"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "weekly_planning_sessions",
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("weekly_planning_sessions", "completed_at")
