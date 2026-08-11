"""Update app_effective_user_id function to fall back to auth.uid().

Revision ID: 0012_update_app_effective_user_id
Revises: 0011_supabase_auth_users_trigger
Create Date: 2026-07-22
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0012_update_app_effective_user_id"
down_revision: str | None = "0011_supabase_auth_users_trigger"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        """
        CREATE OR REPLACE FUNCTION app_effective_user_id()
        RETURNS text
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public, auth, pg_catalog
        AS $$
          SELECT COALESCE(
            NULLIF(current_setting('app.current_user_id', true), ''),
            NULLIF(
              (SELECT auth.uid()::text FROM pg_catalog.pg_proc WHERE proname = 'uid' LIMIT 1),
              ''
            )
          );
        $$;
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        """
        CREATE OR REPLACE FUNCTION app_effective_user_id()
        RETURNS text
        LANGUAGE sql
        STABLE
        AS $$
          SELECT NULLIF(current_setting('app.current_user_id', true), '');
        $$;
        """
    )
