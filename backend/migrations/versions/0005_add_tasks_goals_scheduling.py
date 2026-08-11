"""Split tasks ("What I'm Working On") from weekly-planning goals, add scheduling,
Google Calendar sync, weekly planning sessions, and insight dismissal.

Revision ID: 0005_add_tasks_goals_scheduling
Revises: 0004_add_percy_and_insights
Create Date: 2026-07-21
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date, datetime, timedelta

import sqlalchemy as sa
from alembic import op

revision: str = "0005_add_tasks_goals_scheduling"
down_revision: str | None = "0004_add_percy_and_insights"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

goal_kind_enum = sa.Enum(
    "task",
    "goal",
    name="goal_kind",
    native_enum=False,
    create_constraint=True,
)


def _week_start(value: date) -> date:
    return value - timedelta(days=value.weekday())


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("google_email", sa.String(length=320), nullable=True))
        batch_op.add_column(sa.Column("google_access_token", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("google_refresh_token", sa.Text(), nullable=True))
        batch_op.add_column(
            sa.Column("google_token_expiry", sa.DateTime(timezone=True), nullable=True)
        )

    with op.batch_alter_table("life_insights") as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_dismissed", sa.Boolean(), server_default=sa.false(), nullable=False
            )
        )

    with op.batch_alter_table("open_loops_and_goals") as batch_op:
        batch_op.add_column(
            sa.Column(
                "kind", goal_kind_enum, server_default="task", nullable=False
            )
        )
        batch_op.add_column(
            sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False)
        )
        batch_op.add_column(sa.Column("week_start_date", sa.Date(), nullable=True))
        batch_op.add_column(
            sa.Column("remind_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(sa.Column("snoozed_until", sa.Date(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "snooze_seen", sa.Boolean(), server_default=sa.true(), nullable=False
            )
        )
        batch_op.add_column(
            sa.Column("calendar_event_id", sa.String(length=255), nullable=True)
        )

    op.create_index(
        "ix_goals_user_kind_week",
        "open_loops_and_goals",
        ["user_id", "kind", "week_start_date"],
    )

    op.create_table(
        "weekly_planning_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("week_start_date", sa.Date(), nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "week_start_date", name="uq_weekly_session_user_week"),
    )
    op.create_index(
        "ix_weekly_planning_sessions_week", "weekly_planning_sessions", ["week_start_date"]
    )

    _backfill_goal_kinds()


def _backfill_goal_kinds() -> None:
    """Historically, manually-added rows (no journal_entry_id) were weekly goals;
    entry-linked rows were "What I'm Working On" tasks. Preserve that split explicitly
    and give legacy manual goals a best-guess week (the Monday of their created_at)."""

    bind = op.get_bind()
    metadata = sa.MetaData()
    goals = sa.Table("open_loops_and_goals", metadata, autoload_with=bind)

    bind.execute(
        goals.update()
        .where(goals.c.journal_entry_id.is_not(None))
        .values(kind="task")
    )

    legacy_manual_rows = bind.execute(
        sa.select(goals.c.id, goals.c.created_at).where(goals.c.journal_entry_id.is_(None))
    ).fetchall()
    for row_id, created_at in legacy_manual_rows:
        created_date = created_at.date() if isinstance(created_at, datetime) else created_at
        bind.execute(
            goals.update()
            .where(goals.c.id == row_id)
            .values(kind="goal", week_start_date=_week_start(created_date))
        )

    task_rows = bind.execute(
        sa.select(goals.c.id, goals.c.user_id, goals.c.created_at)
        .where(goals.c.kind == "task")
        .order_by(goals.c.user_id, goals.c.created_at)
    ).fetchall()
    counters: dict[str, int] = {}
    for row_id, user_id, _created_at in task_rows:
        counters[user_id] = counters.get(user_id, 0) + 1
        bind.execute(
            goals.update().where(goals.c.id == row_id).values(sort_order=counters[user_id])
        )


def downgrade() -> None:
    op.drop_index("ix_weekly_planning_sessions_week", table_name="weekly_planning_sessions")
    op.drop_table("weekly_planning_sessions")

    op.drop_index("ix_goals_user_kind_week", table_name="open_loops_and_goals")
    with op.batch_alter_table("open_loops_and_goals") as batch_op:
        batch_op.drop_column("calendar_event_id")
        batch_op.drop_column("snooze_seen")
        batch_op.drop_column("snoozed_until")
        batch_op.drop_column("remind_at")
        batch_op.drop_column("week_start_date")
        batch_op.drop_column("sort_order")
        batch_op.drop_column("kind")

    with op.batch_alter_table("life_insights") as batch_op:
        batch_op.drop_column("is_dismissed")

    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("google_token_expiry")
        batch_op.drop_column("google_refresh_token")
        batch_op.drop_column("google_access_token")
        batch_op.drop_column("google_email")
