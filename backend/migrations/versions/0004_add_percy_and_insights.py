"""Add Percy reminders, life insights, and manually-created goals.

Revision ID: 0004_add_percy_and_insights
Revises: 0003_add_follow_up_question_memory
Create Date: 2026-07-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_add_percy_and_insights"
down_revision: str | None = "0003_add_follow_up_question_memory"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "percy_reminders",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("journal_entry_id", sa.String(length=36), nullable=True),
        sa.Column("reminder_text", sa.Text(), nullable=False),
        sa.Column("is_dismissed", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["journal_entry_id"], ["journal_entries.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_percy_reminders_user_dismissed",
        "percy_reminders",
        ["user_id", "is_dismissed"],
    )

    op.create_table(
        "life_insights",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("journal_entry_id", sa.String(length=36), nullable=True),
        sa.Column("insight_text", sa.Text(), nullable=False),
        sa.Column("is_read", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["journal_entry_id"], ["journal_entries.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_life_insights_user_read",
        "life_insights",
        ["user_id", "is_read"],
    )

    with op.batch_alter_table("open_loops_and_goals") as batch_op:
        batch_op.alter_column(
            "journal_entry_id", existing_type=sa.String(length=36), nullable=True
        )


def downgrade() -> None:
    with op.batch_alter_table("open_loops_and_goals") as batch_op:
        batch_op.alter_column(
            "journal_entry_id", existing_type=sa.String(length=36), nullable=False
        )

    op.drop_index("ix_life_insights_user_read", table_name="life_insights")
    op.drop_table("life_insights")
    op.drop_index("ix_percy_reminders_user_dismissed", table_name="percy_reminders")
    op.drop_table("percy_reminders")
