"""Enable pgvector extension and add embedding column to journal_entries.

Revision ID: 0009_add_journal_entry_embedding
Revises: 0008_add_weekly_session_completed_at
Create Date: 2026-07-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision: str = "0009_add_journal_entry_embedding"
down_revision: str | None = "0008_add_weekly_session_completed_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    op.add_column(
        "journal_entries",
        sa.Column("embedding", Vector(1536), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("journal_entries", "embedding")
