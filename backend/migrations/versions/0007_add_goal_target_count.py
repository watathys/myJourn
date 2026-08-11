"""Add target_count and current_count to open_loops_and_goals.

Revision ID: 0007_add_goal_target_count
Revises: 0006_add_spelling_corrections
Create Date: 2026-07-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_add_goal_target_count"
down_revision: str | None = "0006_add_spelling_corrections"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "open_loops_and_goals",
        sa.Column("target_count", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column(
        "open_loops_and_goals",
        sa.Column("current_count", sa.Integer(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("open_loops_and_goals", "current_count")
    op.drop_column("open_loops_and_goals", "target_count")
