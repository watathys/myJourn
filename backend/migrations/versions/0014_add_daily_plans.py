"""Add daily_plans table for morning bookend task selection.

Revision ID: 0014_add_daily_plans
Revises: 0013_add_weekly_reflection
Create Date: 2026-08-17
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_add_daily_plans"
down_revision: str | None = "0013_add_weekly_reflection"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "daily_plans",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("selected_task_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("morning_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "date", name="uq_daily_plan_user_date"),
    )
    op.create_index("ix_daily_plans_user_date", "daily_plans", ["user_id", "date"])

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON daily_plans TO myjourn_app;")
        op.execute("ALTER TABLE daily_plans ENABLE ROW LEVEL SECURITY;")
        op.execute("ALTER TABLE daily_plans FORCE ROW LEVEL SECURITY;")
        op.execute("DROP POLICY IF EXISTS daily_plans_tenant_isolation ON daily_plans;")
        op.execute(
            """
            CREATE POLICY daily_plans_tenant_isolation ON daily_plans
            FOR ALL
            TO PUBLIC
            USING (user_id = app_effective_user_id())
            WITH CHECK (user_id = app_effective_user_id());
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS daily_plans_tenant_isolation ON daily_plans;")
        op.execute("ALTER TABLE daily_plans NO FORCE ROW LEVEL SECURITY;")
        op.execute("ALTER TABLE daily_plans DISABLE ROW LEVEL SECURITY;")

    op.drop_index("ix_daily_plans_user_date", table_name="daily_plans")
    op.drop_table("daily_plans")
