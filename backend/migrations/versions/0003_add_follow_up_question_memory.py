"""Add canonical follow-up question memory.

Revision ID: 0003_add_follow_up_question_memory
Revises: 0002_add_context_summary
Create Date: 2026-07-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_add_follow_up_question_memory"
down_revision: str | None = "0002_add_context_summary"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

question_dimension = sa.Enum(
    "physical",
    "mental",
    "social",
    "spiritual",
    name="question_dimension",
    native_enum=False,
    create_constraint=True,
)


def upgrade() -> None:
    op.create_table(
        "follow_up_questions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("journal_entry_id", sa.String(length=36), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("dimension", question_dimension, nullable=False),
        sa.Column(
            "asked_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "answered",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["journal_entry_id"], ["journal_entries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_follow_up_questions_user_asked",
        "follow_up_questions",
        ["user_id", "asked_at"],
    )
    op.create_index(
        "ix_follow_up_questions_user_answered",
        "follow_up_questions",
        ["user_id", "answered"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_follow_up_questions_user_answered",
        table_name="follow_up_questions",
    )
    op.drop_index(
        "ix_follow_up_questions_user_asked",
        table_name="follow_up_questions",
    )
    op.drop_table("follow_up_questions")
