"""Add spelling corrections table for learning user speech-to-text corrections.

Revision ID: 0006_add_spelling_corrections
Revises: 0005_add_tasks_goals_scheduling
Create Date: 2026-07-21
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_add_spelling_corrections"
down_revision: str | None = "0005_add_tasks_goals_scheduling"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "spelling_corrections",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("incorrect_word", sa.String(length=255), nullable=False),
        sa.Column("correct_word", sa.String(length=255), nullable=False),
        sa.Column("correction_count", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "incorrect_word", name="uq_spelling_correction_user_word"),
    )
    op.create_index("ix_spelling_corrections_user", "spelling_corrections", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_spelling_corrections_user", table_name="spelling_corrections")
    op.drop_table("spelling_corrections")
