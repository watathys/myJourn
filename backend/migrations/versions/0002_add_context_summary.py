"""Add bounded rolling-context summaries.

Revision ID: 0002_add_context_summary
Revises: 0001_initial
Create Date: 2026-07-19
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_add_context_summary"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("journal_entries") as batch_op:
        batch_op.add_column(sa.Column("context_summary", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("praise_message", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("follow_up_questions", sa.JSON(), nullable=True))

    op.execute(
        sa.text(
            "UPDATE journal_entries "
            "SET context_summary = alignment_summary, follow_up_questions = '[]' "
            "WHERE context_summary IS NULL OR follow_up_questions IS NULL"
        )
    )

    with op.batch_alter_table("journal_entries") as batch_op:
        batch_op.alter_column("context_summary", existing_type=sa.Text(), nullable=False)
        batch_op.alter_column(
            "follow_up_questions", existing_type=sa.JSON(), nullable=False
        )

    with op.batch_alter_table("open_loops_and_goals") as batch_op:
        batch_op.add_column(sa.Column("completed_by_entry_id", sa.String(36), nullable=True))
        batch_op.create_foreign_key(
            "fk_goals_completed_by_entry",
            "journal_entries",
            ["completed_by_entry_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            "ix_open_loops_and_goals_completed_by_entry_id",
            ["completed_by_entry_id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("open_loops_and_goals") as batch_op:
        batch_op.drop_index("ix_open_loops_and_goals_completed_by_entry_id")
        batch_op.drop_constraint("fk_goals_completed_by_entry", type_="foreignkey")
        batch_op.drop_column("completed_by_entry_id")

    with op.batch_alter_table("journal_entries") as batch_op:
        batch_op.drop_column("follow_up_questions")
        batch_op.drop_column("praise_message")
        batch_op.drop_column("context_summary")
