"""Add due_date to open_loops_and_goals so tasks can carry an optional due date.

Revision ID: 0018_add_due_date_to_open_loops
Revises: 0017_add_archived_at_to_open_loops
Create Date: 2026-09-21
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018_add_due_date_to_open_loops"
down_revision: str | None = "0017_add_archived_at_to_open_loops"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("open_loops_and_goals") as batch_op:
        batch_op.add_column(
            sa.Column("due_date", sa.Date(), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("open_loops_and_goals") as batch_op:
        batch_op.drop_column("due_date")
