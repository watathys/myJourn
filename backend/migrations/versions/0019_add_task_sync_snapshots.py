"""Add task_sync_snapshots so tasks can be pushed from one device and pulled on another.

Revision ID: 0019_add_task_sync_snapshots
Revises: 0018_add_due_date_to_open_loops
Create Date: 2026-10-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_add_task_sync_snapshots"
down_revision: str | None = "0018_add_due_date_to_open_loops"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "task_sync_snapshots",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column(
            "pushed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON task_sync_snapshots TO myjourn_app;"
        )
        op.execute("ALTER TABLE task_sync_snapshots ENABLE ROW LEVEL SECURITY;")
        op.execute("ALTER TABLE task_sync_snapshots FORCE ROW LEVEL SECURITY;")
        op.execute(
            "DROP POLICY IF EXISTS task_sync_snapshots_tenant_isolation ON task_sync_snapshots;"
        )
        op.execute(
            """
            CREATE POLICY task_sync_snapshots_tenant_isolation ON task_sync_snapshots
            FOR ALL
            TO PUBLIC
            USING (user_id = app_effective_user_id())
            WITH CHECK (user_id = app_effective_user_id());
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "DROP POLICY IF EXISTS task_sync_snapshots_tenant_isolation ON task_sync_snapshots;"
        )
        op.execute("ALTER TABLE task_sync_snapshots NO FORCE ROW LEVEL SECURITY;")
        op.execute("ALTER TABLE task_sync_snapshots DISABLE ROW LEVEL SECURITY;")

    op.drop_table("task_sync_snapshots")
