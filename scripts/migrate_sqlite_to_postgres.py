"""One-time migration script to copy all data from local SQLite (myjourn.db)
to Supabase PostgreSQL, and generate text-embedding-3-small embeddings
for all journal entries' context_summary fields.
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime
from pathlib import Path

# Ensure root directory is in sys.path so app modules import cleanly
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR / "backend"))

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app.ai.client import OpenAIJournalAI
from app.config import get_settings
from app.models import (
    FollowUpQuestion,
    JournalEntry,
    LifeInsight,
    MissionStatement,
    OpenLoopAndGoal,
    PercyReminder,
    SavedPercyAdvice,
    SpellingCorrection,
    User,
    WeeklyPlanningSession,
)


def main() -> None:
    sqlite_db_path = ROOT_DIR / "myjourn.db"
    if not sqlite_db_path.exists():
        print(f"Error: SQLite database file not found at {sqlite_db_path}")
        sys.exit(1)

    settings = get_settings()
    postgres_url = settings.database_url
    if "sqlite" in postgres_url:
        print("Error: MYJOURN_DATABASE_URL in .env points to SQLite! Set it to your Postgres URL.")
        sys.exit(1)

    print(f"Connecting to SQLite source: {sqlite_db_path}")
    sqlite_engine = create_engine(f"sqlite:///{sqlite_db_path}")

    print(
        "Connecting to Postgres target: "
        + (postgres_url.split("@")[-1] if "@" in postgres_url else postgres_url)
    )
    pg_engine = create_engine(postgres_url)

    ai = None
    if settings.openai_api_key:
        print("Initializing OpenAI client for text-embedding-3-small embeddings...")
        ai = OpenAIJournalAI(api_key=settings.openai_api_key, model=settings.openai_model)
    else:
        print("Warning: MYJOURN_OPENAI_API_KEY not found. Embeddings will not be generated.")

    with Session(sqlite_engine) as sq_session, Session(pg_engine) as pg_session:
        # 1. Users
        users = sq_session.scalars(select(User)).all()
        print(f"Migrating {len(users)} users...")
        for u in users:
            pg_session.merge(
                User(
                    id=u.id,
                    created_at=u.created_at,
                    google_email=u.google_email,
                    google_access_token=u.google_access_token,
                    google_refresh_token=u.google_refresh_token,
                    google_token_expiry=u.google_token_expiry,
                )
            )
        pg_session.commit()

        # 2. Mission Statements
        missions = sq_session.scalars(select(MissionStatement)).all()
        print(f"Migrating {len(missions)} mission statements...")
        for m in missions:
            pg_session.merge(
                MissionStatement(
                    user_id=m.user_id,
                    statement_text=m.statement_text,
                    updated_at=m.updated_at,
                )
            )
        pg_session.commit()

        # 3. Journal Entries & Embeddings
        raw_entries = sq_session.execute(
            text(
                "SELECT id, user_id, date, raw_transcript, formatted_narrative, "
                "alignment_summary, context_summary, praise_message, follow_up_questions, created_at "
                "FROM journal_entries ORDER BY created_at"
            )
        ).mappings().all()
        print(f"Migrating {len(raw_entries)} journal entries and generating embeddings...")
        for idx, row in enumerate(raw_entries, 1):
            emb = None
            context_sum = row["context_summary"]
            if ai and context_sum:
                try:
                    emb = ai.generate_embedding(context_sum)
                except Exception as exc:
                    print(f"  Warning: failed to generate embedding for entry {row['id']}: {exc}")

            fq = json.loads(row["follow_up_questions"]) if isinstance(row["follow_up_questions"], str) else (row["follow_up_questions"] or [])
            entry_dt = row["created_at"]
            if isinstance(entry_dt, str):
                entry_dt = datetime.fromisoformat(entry_dt)
            entry_d = row["date"]
            if isinstance(entry_d, str):
                entry_d = date.fromisoformat(entry_d)

            pg_session.merge(
                JournalEntry(
                    id=row["id"],
                    user_id=row["user_id"],
                    date=entry_d,
                    raw_transcript=row["raw_transcript"],
                    formatted_narrative=row["formatted_narrative"],
                    alignment_summary=row["alignment_summary"],
                    context_summary=context_sum,
                    praise_message=row["praise_message"],
                    follow_up_questions=fq,
                    created_at=entry_dt,
                    embedding=emb,
                )
            )
            if idx % 5 == 0 or idx == len(raw_entries):
                print(f"  Processed {idx}/{len(raw_entries)} entries...")
        pg_session.commit()

        # 4. Follow Up Questions
        questions = sq_session.scalars(select(FollowUpQuestion)).all()
        print(f"Migrating {len(questions)} follow-up questions...")
        for q in questions:
            pg_session.merge(
                FollowUpQuestion(
                    id=q.id,
                    user_id=q.user_id,
                    journal_entry_id=q.journal_entry_id,
                    question_text=q.question_text,
                    dimension=q.dimension,
                    asked_at=q.asked_at,
                    answered=q.answered,
                )
            )
        pg_session.commit()

        # 5. Open Loops and Goals
        goals = sq_session.scalars(select(OpenLoopAndGoal)).all()
        print(f"Migrating {len(goals)} open loops / goals...")
        for g in goals:
            pg_session.merge(
                OpenLoopAndGoal(
                    id=g.id,
                    user_id=g.user_id,
                    journal_entry_id=g.journal_entry_id,
                    completed_by_entry_id=g.completed_by_entry_id,
                    goal_text=g.goal_text,
                    status=g.status,
                    kind=g.kind,
                    sort_order=g.sort_order,
                    target_count=g.target_count,
                    current_count=g.current_count,
                    week_start_date=g.week_start_date,
                    remind_at=g.remind_at,
                    snoozed_until=g.snoozed_until,
                    snooze_seen=g.snooze_seen,
                    calendar_event_id=g.calendar_event_id,
                    created_at=g.created_at,
                )
            )
        pg_session.commit()

        # 6. Percy Reminders
        reminders = sq_session.scalars(select(PercyReminder)).all()
        print(f"Migrating {len(reminders)} percy reminders...")
        for r in reminders:
            pg_session.merge(
                PercyReminder(
                    id=r.id,
                    user_id=r.user_id,
                    journal_entry_id=r.journal_entry_id,
                    reminder_text=r.reminder_text,
                    is_dismissed=r.is_dismissed,
                    created_at=r.created_at,
                )
            )
        pg_session.commit()

        # 7. Life Insights
        insights = sq_session.scalars(select(LifeInsight)).all()
        print(f"Migrating {len(insights)} life insights...")
        for i in insights:
            pg_session.merge(
                LifeInsight(
                    id=i.id,
                    user_id=i.user_id,
                    journal_entry_id=i.journal_entry_id,
                    insight_text=i.insight_text,
                    is_read=i.is_read,
                    is_dismissed=i.is_dismissed,
                    created_at=i.created_at,
                )
            )
        pg_session.commit()

        # 8. Weekly Planning Sessions
        sessions = sq_session.scalars(select(WeeklyPlanningSession)).all()
        print(f"Migrating {len(sessions)} weekly planning sessions...")
        for s in sessions:
            pg_session.merge(
                WeeklyPlanningSession(
                    id=s.id,
                    user_id=s.user_id,
                    week_start_date=s.week_start_date,
                    started_at=s.started_at,
                    completed_at=s.completed_at,
                )
            )
        pg_session.commit()

        # 9. Spelling Corrections
        corrections = sq_session.scalars(select(SpellingCorrection)).all()
        print(f"Migrating {len(corrections)} spelling corrections...")
        for c in corrections:
            pg_session.merge(
                SpellingCorrection(
                    id=c.id,
                    user_id=c.user_id,
                    incorrect_word=c.incorrect_word,
                    correct_word=c.correct_word,
                    correction_count=c.correction_count,
                    created_at=c.created_at,
                    updated_at=c.updated_at,
                )
            )
        pg_session.commit()

    print("\n--- Data Migration Verification ---")
    with Session(pg_engine) as pg_session, Session(sqlite_engine) as sq_session:
        table_models = [
            ("users", User),
            ("mission_statements", MissionStatement),
            ("journal_entries", JournalEntry),
            ("follow_up_questions", FollowUpQuestion),
            ("open_loops_and_goals", OpenLoopAndGoal),
            ("percy_reminders", PercyReminder),
            ("life_insights", LifeInsight),
            ("saved_percy_advice", SavedPercyAdvice),
            ("weekly_planning_sessions", WeeklyPlanningSession),
            ("spelling_corrections", SpellingCorrection),
        ]
        all_matched = True
        for name, model in table_models:
            if name == "journal_entries":
                sq_cnt = sq_session.scalar(text("SELECT count(*) FROM journal_entries"))
            else:
                sq_cnt = len(sq_session.scalars(select(model)).all())
            pg_cnt = len(pg_session.scalars(select(model)).all())
            status = "MATCH" if sq_cnt == pg_cnt else "MISMATCH"
            if sq_cnt != pg_cnt:
                all_matched = False
            print(f"  {name:25s}: SQLite = {sq_cnt:3d} | Postgres = {pg_cnt:3d}  [{status}]")

        emb_cnt = len(
            [
                e
                for e in pg_session.scalars(select(JournalEntry)).all()
                if e.embedding is not None
            ]
        )
        print(f"\nJournal Entries with Vector Embeddings: {emb_cnt}/{len(raw_entries)}")

    if all_matched:
        print("\nData migration and backfill completed successfully!")
    else:
        print("\nWarning: Some table row counts did not match.")


if __name__ == "__main__":
    main()
