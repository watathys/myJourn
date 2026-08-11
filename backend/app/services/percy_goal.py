"""Service for parsing natural language goal requests with Percy and creating scheduled goals."""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, time, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai.client import JournalAI
from app.ai.schemas import PercyGoalExtracted
from app.config import Settings
from app.models import GoalKind, GoalStatus, OpenLoopAndGoal, User
from app.services import google_calendar

logger = logging.getLogger(__name__)


def parse_time_string(
    time_str: Optional[str], base_date: date
) -> tuple[Optional[datetime], int]:
    """Parse time string like '9am-10am' or '9:00 AM' into (remind_at, duration_minutes)."""
    if not time_str:
        return None, 15

    time_str_clean = time_str.strip().lower()
    matches = list(
        re.finditer(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", time_str_clean)
    )
    if not matches:
        return None, 15

    def match_to_time(m: re.Match) -> tuple[int, int]:
        hour = int(m.group(1))
        minute = int(m.group(2)) if m.group(2) else 0
        ampm = m.group(3)
        if ampm == "pm" and hour < 12:
            hour += 12
        elif ampm == "am" and hour == 12:
            hour = 0
        return hour, minute

    start_h, start_m = match_to_time(matches[0])
    target_date = base_date if base_date >= date.today() else date.today()
    remind_at = datetime.combine(
        target_date, time(start_h, start_m), tzinfo=timezone.utc
    )

    duration = 15
    if len(matches) >= 2:
        end_h, end_m = match_to_time(matches[1])
        start_mins = start_h * 60 + start_m
        end_mins = end_h * 60 + end_m
        if end_mins > start_mins:
            duration = end_mins - start_mins

    return remind_at, duration


def create_goal_with_percy(
    session: Session,
    ai: JournalAI,
    settings: Settings,
    user_id: str,
    user_query: str,
    week_start_date: date,
) -> tuple[OpenLoopAndGoal, str]:
    user = session.get(User, user_id)
    if user is None:
        raise LookupError(f"User {user_id!r} does not exist")

    today_str = date.today().isoformat()
    week_start_str = week_start_date.isoformat()

    system_prompt = f"""You are Percy, a warm, thoughtful, empathetic AI companion in MyJourn helping the user set weekly goals.
The user is requesting to set a goal in natural language.
Today is {today_str}. The current week start date (Monday) is {week_start_str}.

Carefully extract the goal details from the user prompt:
1. `goal_text`: Short, clear text for the goal (e.g. 'Go to the gym', 'Read 3 chapters', 'Meditate 10 mins'). Do NOT include reminder/time instructions in this text.
2. `target_count`: Number of checkable boxes/repetitions for this week.
   - 'every day this week', 'daily', 'each day' = 7
   - '5 days a week', '5x' = 5
   - '3 times' = 3
   - If not specified, default to 1.
3. `remind_time_str`: Time string if a time of day was requested (e.g. '9am-10am', '9:00 AM', '8:30pm'), or null if no time was mentioned.
4. `is_daily_recurring`: true if the user asked to be reminded every day / daily / each day this week.
5. `reply`: A warm, friendly 1-2 sentence response from Percy confirming the goal created, target checkmarks, and any calendar reminders scheduled.
"""

    try:
        try:
            extracted: PercyGoalExtracted = ai.extract_json(
                system_prompt=system_prompt,
                user_prompt=user_query,
                schema_class=PercyGoalExtracted,
                model=settings.openai_fast_model,
            )
        except TypeError:
            extracted = ai.extract_json(
                system_prompt=system_prompt,
                user_prompt=user_query,
                schema_class=PercyGoalExtracted,
            )
    except Exception as exc:
        logger.warning("Percy goal extraction error, fallback: %s", exc, exc_info=True)
        # Fallback if AI fails or dummy AI in test
        extracted = PercyGoalExtracted(
            goal_text=user_query.strip()[:100],
            target_count=7 if "every day" in user_query.lower() or "daily" in user_query.lower() else 1,
            remind_time_str="9:00 AM" if "remind" in user_query.lower() or "am" in user_query.lower() else None,
            is_daily_recurring="every day" in user_query.lower() or "daily" in user_query.lower(),
            reply=f"I've created your goal '{user_query.strip()[:60]}' for this week!"
        )

    clean_goal_text = extracted.goal_text.strip()
    target_count = max(1, extracted.target_count)

    next_sort_order = (
        session.scalar(
            select(func.max(OpenLoopAndGoal.sort_order)).where(
                OpenLoopAndGoal.user_id == user_id,
                OpenLoopAndGoal.kind == GoalKind.GOAL,
                OpenLoopAndGoal.week_start_date == week_start_date,
            )
        )
        or 0
    ) + 1

    remind_at, duration_minutes = parse_time_string(
        extracted.remind_time_str, week_start_date
    )

    goal = OpenLoopAndGoal(
        user_id=user_id,
        goal_text=clean_goal_text,
        status=GoalStatus.PENDING,
        kind=GoalKind.GOAL,
        sort_order=next_sort_order,
        target_count=target_count,
        current_count=0,
        week_start_date=week_start_date,
        remind_at=remind_at,
    )
    session.add(goal)
    session.commit()
    session.refresh(goal)

    if remind_at and user.google_connected:
        try:
            google_calendar.sync_task_event(
                settings,
                user,
                goal,
                duration_minutes=duration_minutes,
                is_daily_recurring=extracted.is_daily_recurring or (target_count > 1 and extracted.is_daily_recurring),
            )
            session.commit()
            session.refresh(goal)
        except Exception:  # noqa: BLE001
            logger.warning("Google calendar sync failed for Percy goal %s", goal.id, exc_info=True)

    return goal, extracted.reply
