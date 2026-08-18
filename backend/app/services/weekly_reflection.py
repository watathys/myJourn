"""Service for generating structured AI weekly reflections for weekly planning."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.ai.client import JournalAI
from app.ai.prompts import (
    PromptWeeklyEntry,
    build_weekly_reflection_system_prompt,
    build_weekly_reflection_user_prompt,
)
from app.ai.schemas import WeeklyReflectionAIResult
from app.models import JournalEntry, LifeInsight, MissionStatement, WeeklyPlanningSession

logger = logging.getLogger(__name__)


class WeeklyReflectionService:
    def __init__(self, *, session: Session, ai: JournalAI) -> None:
        self._session = session
        self._ai = ai

    def generate(
        self,
        *,
        user_id: str,
        week_start_date: date,
    ) -> WeeklyPlanningSession:
        """Pull past 7 days of journal data, call AI, and save reflection to WeeklyPlanningSession."""

        start_date = week_start_date - timedelta(days=7)
        end_date = week_start_date - timedelta(days=1)

        # 1. Fetch entries in the 7-day window
        entries = list(
            self._session.scalars(
                select(JournalEntry)
                .options(selectinload(JournalEntry.completed_goals))
                .where(
                    JournalEntry.user_id == user_id,
                    JournalEntry.date >= start_date,
                    JournalEntry.date <= week_start_date,
                )
                .order_by(JournalEntry.date.asc(), JournalEntry.created_at.asc())
            )
        )

        actual_end_date = max([e.date for e in entries], default=end_date)
        if actual_end_date < end_date:
            actual_end_date = end_date

        # 2. Fetch life insights saved during that window
        window_start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
        insights = list(
            self._session.scalars(
                select(LifeInsight.insight_text)
                .where(
                    LifeInsight.user_id == user_id,
                    LifeInsight.created_at >= window_start_dt,
                    LifeInsight.is_dismissed.is_(False),
                )
                .order_by(LifeInsight.created_at.asc())
            )
        )

        # 3. Fetch mission statement
        mission = self._session.scalar(
            select(MissionStatement.statement_text).where(MissionStatement.user_id == user_id)
        )

        # Build prompt inputs
        prompt_entries = [
            PromptWeeklyEntry(
                date=entry.date.isoformat(),
                context_summary=entry.context_summary,
                praise_message=entry.praise_message,
                completed_goals=[goal.goal_text for goal in entry.completed_goals],
            )
            for entry in entries
        ]

        system_prompt = build_weekly_reflection_system_prompt(mission_statement=mission)
        user_prompt = build_weekly_reflection_user_prompt(
            start_date=start_date.isoformat(),
            end_date=actual_end_date.isoformat(),
            entries=prompt_entries,
            life_insights=insights,
        )

        ai_result: WeeklyReflectionAIResult = self._ai.extract_json(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            schema_class=WeeklyReflectionAIResult,
        )

        # Fetch or create weekly planning session
        weekly_session = self._session.scalar(
            select(WeeklyPlanningSession).where(
                WeeklyPlanningSession.user_id == user_id,
                WeeklyPlanningSession.week_start_date == week_start_date,
            )
        )
        if weekly_session is None:
            weekly_session = WeeklyPlanningSession(
                user_id=user_id,
                week_start_date=week_start_date,
            )
            self._session.add(weekly_session)

        weekly_session.reflection_data = ai_result.model_dump()
        weekly_session.reflection_start_date = start_date
        weekly_session.reflection_end_date = actual_end_date
        weekly_session.reflection_generated_at = datetime.now(timezone.utc)

        self._session.commit()
        self._session.refresh(weekly_session)

        return weekly_session
