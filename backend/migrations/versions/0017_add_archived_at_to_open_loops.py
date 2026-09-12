"""Add archived_at to open_loops_and_goals table for expiring archived tasks after 7 days.

Revision ID: 0017_add_archived_at_to_open_loops
Revises: 0016_add_task_sections
Create Date: 2026-09-09
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_add_archived_at_to_open_loops"
down_revision: str | None = "0016_add_task_sections"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("open_loops_and_goals") as batch_op:
        batch_op.add_column(
            sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.create_index(
            "ix_goals_archived_at",
            ["archived_at"],
        )

    op.execute(
        """
        UPDATE open_loops_and_goals
        SET archived_at = created_at
        WHERE status = 'abandoned' AND archived_at IS NULL;
        """
    )


def downgrade() -> None:
    with op.batch_alter_table("open_loops_and_goals") as batch_op:
        batch_op.drop_index("ix_goals_archived_at")
        batch_op.drop_column("archived_at")
