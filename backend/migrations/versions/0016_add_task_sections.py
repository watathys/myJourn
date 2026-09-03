"""Add task sections (color-coded, collapsible groupings for tasks).

Revision ID: 0016_add_task_sections
Revises: 0015_add_saved_percy_advice
Create Date: 2026-09-03
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016_add_task_sections"
down_revision: str | None = "0015_add_saved_percy_advice"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "task_sections",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("color", sa.String(length=32), server_default="forest", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
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
        "ix_task_sections_user_order",
        "task_sections",
        ["user_id", "sort_order"],
    )

    with op.batch_alter_table("open_loops_and_goals") as batch_op:
        batch_op.add_column(
            sa.Column("section_id", sa.String(length=36), nullable=True)
        )
        batch_op.create_foreign_key(
            "fk_open_loops_and_goals_section_id",
            "task_sections",
            ["section_id"],
            ["id"],
            ondelete="SET NULL",
        )

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON task_sections TO myjourn_app;")
        op.execute("ALTER TABLE task_sections ENABLE ROW LEVEL SECURITY;")
        op.execute("ALTER TABLE task_sections FORCE ROW LEVEL SECURITY;")
        op.execute("DROP POLICY IF EXISTS task_sections_tenant_isolation ON task_sections;")
        op.execute(
            """
            CREATE POLICY task_sections_tenant_isolation ON task_sections
            FOR ALL
            TO PUBLIC
            USING (user_id = app_effective_user_id())
            WITH CHECK (user_id = app_effective_user_id());
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS task_sections_tenant_isolation ON task_sections;")
        op.execute("ALTER TABLE task_sections NO FORCE ROW LEVEL SECURITY;")
        op.execute("ALTER TABLE task_sections DISABLE ROW LEVEL SECURITY;")

    with op.batch_alter_table("open_loops_and_goals") as batch_op:
        batch_op.drop_constraint(
            "fk_open_loops_and_goals_section_id", type_="foreignkey"
        )
        batch_op.drop_column("section_id")

    op.drop_index("ix_task_sections_user_order", table_name="task_sections")
    op.drop_table("task_sections")
