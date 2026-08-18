"""Add weekly reflection fields to weekly_planning_sessions.

Revision ID: 0013_add_weekly_reflection
Revises: 0012_update_app_effective_user_id
Create Date: 2026-08-12
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_add_weekly_reflection"
down_revision: str | None = "0012_update_app_effective_user_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "weekly_planning_sessions",
        sa.Column("reflection_data", sa.JSON(), nullable=True),
    )
    op.add_column(
        "weekly_planning_sessions",
        sa.Column("reflection_start_date", sa.Date(), nullable=True),
    )
    op.add_column(
        "weekly_planning_sessions",
        sa.Column("reflection_end_date", sa.Date(), nullable=True),
    )
    op.add_column(
        "weekly_planning_sessions",
        sa.Column("reflection_generated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("weekly_planning_sessions", "reflection_generated_at")
    op.drop_column("weekly_planning_sessions", "reflection_end_date")
    op.drop_column("weekly_planning_sessions", "reflection_start_date")
    op.drop_column("weekly_planning_sessions", "reflection_data")
