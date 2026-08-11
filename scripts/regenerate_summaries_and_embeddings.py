"""One-time script to regenerate context_summary and embeddings for all existing journal entries.

Uses the current (post-step-1) prompt which prioritizes emotional/psychological signal over events.

Usage:
    # Dry run / preview mode (shows diffs without updating DB):
    python scripts/regenerate_summaries_and_embeddings.py --dry-run

    # Execute mode (updates context_summary and embedding in DB for all entries):
    python scripts/regenerate_summaries_and_embeddings.py --run
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Ensure backend directory is in sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR / "backend"))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.ai.client import OpenAIJournalAI  # noqa: E402
from app.ai.prompts import build_system_prompt, build_user_prompt  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.models import JournalEntry, MissionStatement  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Regenerate context_summary and embeddings for all existing entries."
    )
    parser.add_argument(
        "--run",
        action="store_true",
        help="Execute updates to database (without this flag, defaults to dry-run preview).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview diffs without committing changes to DB.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit processing to first N entries (useful for testing).",
    )

    args = parser.parse_args()
    is_dry_run = not args.run or args.dry_run

    settings = get_settings()
    if not settings.openai_api_key:
        print("Error: MYJOURN_OPENAI_API_KEY environment variable is not set.", file=sys.stderr)
        sys.exit(1)

    ai = OpenAIJournalAI(api_key=settings.openai_api_key, model=settings.openai_model)

    print(f"=== REGENERATE CONTEXT SUMMARIES AND EMBEDDINGS ===")
    print(f"Mode: {'DRY RUN (Preview)' if is_dry_run else 'EXECUTE (Updating Database)'}")
    print(f"Model: {settings.openai_model}\n")

    # Fetch initial user ID
    with Session(engine) as tmp_session:
        first_entry = tmp_session.scalars(select(JournalEntry)).first()
        user_id = first_entry.user_id if first_entry else None

    if user_id:
        from app.rls import set_rls_user_id
        set_rls_user_id(user_id)

    with Session(engine) as session:
        user_mission = session.scalar(select(MissionStatement.statement_text))
        entries_stmt = select(JournalEntry).order_by(JournalEntry.date)
        if args.limit:
            entries_stmt = entries_stmt.limit(args.limit)

        entries = session.scalars(entries_stmt).all()
        total = len(entries)
        print(f"Found {total} journal entries to process.\n")

        updated_count = 0
        for idx, entry in enumerate(entries, start=1):
            print(f"[{idx}/{total}] Processing entry date: {entry.date} (ID: {entry.id})...", flush=True)

            sys_prompt = build_system_prompt(user_mission, [], [], is_import=False)
            user_prompt = build_user_prompt(entry.raw_transcript)

            ai_result = ai.process(system_prompt=sys_prompt, user_prompt=user_prompt)
            new_summary = ai_result.context_summary
            old_summary = entry.context_summary

            print(f"  Old context_summary:\n    {old_summary}", flush=True)
            print(f"  New context_summary:\n    {new_summary}\n", flush=True)

            if not is_dry_run:
                new_embedding = ai.generate_embedding(new_summary)
                entry.context_summary = new_summary
                entry.embedding = new_embedding
                updated_count += 1

        if not is_dry_run:
            session.commit()
            print(f"\nSuccessfully regenerated context_summary and embeddings for {updated_count} entries!")
        else:
            print("\nDry run complete. No database changes were saved. Run with `--run` to execute.")


if __name__ == "__main__":
    main()
