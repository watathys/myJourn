"""Connect Supabase auth.users to public.users via trigger.

Revision ID: 0011_supabase_auth_users_trigger
Revises: 0010_row_level_security
Create Date: 2026-07-22
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0011_supabase_auth_users_trigger"
down_revision: str | None = "0010_row_level_security"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    # Trigger to auto-create public.users when a user registers via Supabase Auth
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.handle_new_user()
        RETURNS trigger AS $$
        BEGIN
          INSERT INTO public.users (id, created_at)
          VALUES (new.id::text, new.created_at)
          ON CONFLICT (id) DO NOTHING;
          RETURN new;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;
        """
    )

    op.execute(
        """
        DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
        CREATE TRIGGER on_auth_user_created
          AFTER INSERT ON auth.users
          FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
        """
    )

    # Function to reassign legacy client UUID data to a newly signed up user ID
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.migrate_legacy_user_data(old_id text, new_id text)
        RETURNS void AS $$
        BEGIN
          IF old_id = new_id THEN
            RETURN;
          END IF;

          INSERT INTO public.users (id, created_at)
          VALUES (new_id, NOW())
          ON CONFLICT (id) DO NOTHING;

          UPDATE public.mission_statements SET user_id = new_id WHERE user_id = old_id;
          UPDATE public.journal_entries SET user_id = new_id WHERE user_id = old_id;
          UPDATE public.follow_up_questions SET user_id = new_id WHERE user_id = old_id;
          UPDATE public.open_loops_and_goals SET user_id = new_id WHERE user_id = old_id;
          UPDATE public.percy_reminders SET user_id = new_id WHERE user_id = old_id;
          UPDATE public.life_insights SET user_id = new_id WHERE user_id = old_id;
          UPDATE public.weekly_planning_sessions SET user_id = new_id WHERE user_id = old_id;
          UPDATE public.spelling_corrections SET user_id = new_id WHERE user_id = old_id;

          DELETE FROM public.users WHERE id = old_id;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;")
    op.execute("DROP FUNCTION IF EXISTS public.handle_new_user();")
    op.execute("DROP FUNCTION IF EXISTS public.migrate_legacy_user_data(text, text);")
