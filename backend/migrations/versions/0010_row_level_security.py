"""Enable row-level security on user-owned tables (Postgres / Supabase).

Revision ID: 0010_row_level_security
Revises: 0009_add_journal_entry_embedding
Create Date: 2026-07-22
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0010_row_level_security"
down_revision: str | None = "0009_add_journal_entry_embedding"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Tables with a direct user_id column (tenant-owned rows).
_TENANT_TABLES = (
    "mission_statements",
    "journal_entries",
    "follow_up_questions",
    "open_loops_and_goals",
    "percy_reminders",
    "life_insights",
    "weekly_planning_sessions",
    "spelling_corrections",
)


def _effective_user_expr() -> str:
    """Session variable today; Supabase JWT when auth.uid() is wired up."""
    return """COALESCE(
        NULLIF(current_setting('app.current_user_id', true), ''),
        NULLIF(
            (SELECT auth.uid()::text FROM pg_catalog.pg_proc WHERE proname = 'uid' LIMIT 0),
            ''
        )
    )"""


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    # Portable policies: app.current_user_id set by the FastAPI backend per request.
    # When you add Supabase Auth, extend app_effective_user_id() to COALESCE with auth.uid()::text
    # once users.id matches auth.users.id (see project docs / PR description).
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

    op.execute(
        """
        DO $$
        BEGIN
          CREATE ROLE myjourn_app NOINHERIT NOBYPASSRLS;
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END
        $$;
        """
    )

    op.execute("GRANT USAGE ON SCHEMA public TO myjourn_app;")
    for table in _TENANT_TABLES:
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO myjourn_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON users TO myjourn_app;")
    op.execute("GRANT myjourn_app TO postgres;")

    for table in _TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
        op.execute(f"DROP POLICY IF EXISTS {table}_tenant_isolation ON {table};")
        op.execute(
            f"""
            CREATE POLICY {table}_tenant_isolation ON {table}
            FOR ALL
            TO PUBLIC
            USING (user_id = app_effective_user_id())
            WITH CHECK (user_id = app_effective_user_id());
            """
        )

    op.execute("ALTER TABLE users ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE users FORCE ROW LEVEL SECURITY;")
    op.execute("DROP POLICY IF EXISTS users_self_isolation ON users;")
    op.execute(
        """
        CREATE POLICY users_self_isolation ON users
        FOR ALL
        TO PUBLIC
        USING (id = app_effective_user_id())
        WITH CHECK (id = app_effective_user_id());
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("DROP POLICY IF EXISTS users_self_isolation ON users;")
    op.execute("ALTER TABLE users NO FORCE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE users DISABLE ROW LEVEL SECURITY;")

    for table in reversed(_TENANT_TABLES):
        op.execute(f"DROP POLICY IF EXISTS {table}_tenant_isolation ON {table};")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")

    op.execute("DROP FUNCTION IF EXISTS app_effective_user_id();")
    op.execute(
        """
        DO $$
        BEGIN
          DROP ROLE myjourn_app;
        EXCEPTION
          WHEN dependent_objects_still_exist THEN NULL;
          WHEN undefined_object THEN NULL;
        END
        $$;
        """
    )
