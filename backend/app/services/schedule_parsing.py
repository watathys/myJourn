"""Turn a natural-language schedule phrase into a concrete reminder datetime.

MyJourn has no per-user timezone yet, so parsed times are naive-local: the
server's own clock is treated as the user's clock. Document this assumption
for deployments in the README rather than pretending to solve timezones here.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, time, timezone
from typing import Optional

import dateparser

from app.ai.client import JournalAI
from app.ai.schemas import ParsedScheduleItem
from app.config import Settings
from app.services.goal_helpers import parse_target_count_from_text

logger = logging.getLogger(__name__)

DEFAULT_REMINDER_HOUR = 9


def parse_schedule_phrase(phrase: str, *, base_date: date) -> Optional[datetime]:
    """Resolve a phrase like "Saturday at 9am" relative to ``base_date``.

    Returns a timezone-aware (UTC-labeled) datetime, or None if the phrase
    could not be understood.
    """

    clean = phrase.strip()
    if not clean:
        return None

    relative_base = datetime.combine(base_date, time(DEFAULT_REMINDER_HOUR, 0))
    parsed = dateparser.parse(
        clean,
        settings={
            "RELATIVE_BASE": relative_base,
            "PREFER_DATES_FROM": "future",
            "RETURN_AS_TIMEZONE_AWARE": False,
        },
    )
    if parsed is None:
        return None
    return parsed.replace(tzinfo=timezone.utc)


def parse_natural_language_item(
    user_input: str,
    *,
    base_date: date,
    ai: Optional[JournalAI] = None,
    settings: Optional[Settings] = None,
    item_type: str = "task",
) -> tuple[str, Optional[datetime], int, bool, int]:
    """Parse natural language input for a task or goal.

    Returns:
        (clean_text, remind_at, target_count, is_daily_recurring, duration_minutes)
    """
    clean_input = user_input.strip()
    if not clean_input:
        return "", None, 1, False, 15

    if ai is not None and settings is not None:
        try:
            today_str = base_date.isoformat()
            system_prompt = f"""You are a precise assistant extracting scheduling and goal parameters for MyJourn.
Today is {today_str}. The user is creating a {item_type}.

Extract:
1. `clean_text`: The core title/action without reminder or scheduling phrases (e.g. 'drink a protein shake', 'fill up my water bottle', 'go to the gym'). Do NOT include reminder/time instructions in clean_text.
2. `has_schedule`: true ONLY if the user explicitly asked to be reminded or specified a time/day for a calendar event/reminder. E.g. 'remind me on thursday at 9am' -> true, 'drink a protein shake' -> false.
3. `schedule_phrase`: Natural language phrase for when the event/reminder should happen (e.g. 'thursday at 9am', 'every day at 3pm', 'tomorrow at 10am'), or null if no schedule was requested.
4. `remind_time_str`: Time string if time was requested (e.g. '9:00 AM', '3pm', '9am-10am'), or null.
5. `target_count`: Number of checkable repetitions/boxes. 'every day' or 'daily' = 7, '3 times' = 3. Default to 1 if not specified.
6. `is_daily_recurring`: true if daily/every day/each day recurring reminders were requested.
"""
            try:
                extracted: ParsedScheduleItem = ai.extract_json(
                    system_prompt=system_prompt,
                    user_prompt=clean_input,
                    schema_class=ParsedScheduleItem,
                    model=settings.openai_fast_model,
                )
            except TypeError:
                extracted = ai.extract_json(
                    system_prompt=system_prompt,
                    user_prompt=clean_input,
                    schema_class=ParsedScheduleItem,
                )

            clean_text = extracted.clean_text.strip() or clean_input
            if not extracted.has_schedule and not extracted.schedule_phrase and not extracted.remind_time_str:
                return clean_text, None, max(1, extracted.target_count), False, 15

            phrase_to_parse = extracted.schedule_phrase or extracted.remind_time_str or clean_input
            remind_at = parse_schedule_phrase(phrase_to_parse, base_date=base_date)
            if remind_at is None and extracted.remind_time_str:
                remind_at = parse_schedule_phrase(extracted.remind_time_str, base_date=base_date)

            is_daily = extracted.is_daily_recurring or "every day" in clean_input.lower() or "daily" in clean_input.lower()
            target_cnt = max(1, extracted.target_count)
            if is_daily and target_cnt < 7 and item_type == "goal":
                target_cnt = 7

            return clean_text, remind_at, target_cnt, is_daily, 15
        except Exception as exc:
            logger.warning("AI schedule parsing failed, using fallback: %s", exc, exc_info=True)

    # Fallback parser
    lower = clean_input.lower()
    has_remind_keyword = any(kw in lower for kw in ["remind", "calendar", " at ", "am", "pm", "every day", "daily"])

    is_daily = "every day" in lower or "daily" in lower
    target_cnt = 7 if (is_daily and item_type == "goal") else parse_target_count_from_text(clean_input)

    # Clean text fallback: remove prefixes like "remind me on thursday at 9am to "
    clean_text = re.sub(
        r"^(?:remind\s+me\s+)?(?:on\s+\w+\s+)?(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+)?(?:every\s+day\s+|daily\s+)?(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+)?to\s+",
        "",
        clean_input,
        flags=re.IGNORECASE,
    ).strip()
    if not clean_text:
        clean_text = clean_input

    remind_at = None
    if has_remind_keyword:
        match = re.search(
            r"\b((?:(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today))\s*(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?|\d{1,2}(?::\d{2})?\s*(?:am|pm)|every\s+day\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b",
            lower,
        )
        if match:
            phrase = match.group(1).replace("every day at", "today at")
            remind_at = parse_schedule_phrase(phrase, base_date=base_date)
        if remind_at is None:
            remind_at = parse_schedule_phrase(clean_input, base_date=base_date)

    return clean_text, remind_at, target_cnt, is_daily, 15

