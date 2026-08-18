"""Add saved_percy_advice table for bookmarking Percy chat advice.

Revision ID: 0015_add_saved_percy_advice
Revises: 0014_add_daily_plans
Create Date: 2026-08-17
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_add_saved_percy_advice"
down_revision: str | None = "0014_add_daily_plans"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "saved_percy_advice",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("advice_text", sa.Text(), nullable=False),
        sa.Column("context_question", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_saved_percy_advice_user_created",
        "saved_percy_advice",
        ["user_id", "created_at"],
    )

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON saved_percy_advice TO myjourn_app;")
        op.execute("ALTER TABLE saved_percy_advice ENABLE ROW LEVEL SECURITY;")
        op.execute("ALTER TABLE saved_percy_advice FORCE ROW LEVEL SECURITY;")
        op.execute("DROP POLICY IF EXISTS saved_percy_advice_tenant_isolation ON saved_percy_advice;")
        op.execute(
            """
            CREATE POLICY saved_percy_advice_tenant_isolation ON saved_percy_advice
            FOR ALL
            TO PUBLIC
            USING (user_id = app_effective_user_id())
            WITH CHECK (user_id = app_effective_user_id());
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS saved_percy_advice_tenant_isolation ON saved_percy_advice;")
        op.execute("ALTER TABLE saved_percy_advice NO FORCE ROW LEVEL SECURITY;")
        op.execute("ALTER TABLE saved_percy_advice DISABLE ROW LEVEL SECURITY;")

    op.drop_index("ix_saved_percy_advice_user_created", table_name="saved_percy_advice")
    op.drop_table("saved_percy_advice")
