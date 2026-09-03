"""Turn a natural-language schedule phrase into a concrete reminder datetime.

MyJourn has no per-user timezone yet, so parsed times are naive-local: the
server's own clock is treated as the user's clock. Document this assumption
for deployments in the README rather than pretending to solve timezones here.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

import dateparser

from app.ai.client import JournalAI
from app.ai.schemas import ParsedCalendarBatch, ParsedScheduleItem
from app.config import Settings
from app.services.goal_helpers import parse_target_count_from_text

logger = logging.getLogger(__name__)

DEFAULT_REMINDER_HOUR = 9
DEFAULT_DURATION_MINUTES = 15


def parse_time_string(
    time_str: Optional[str], base_date: date
) -> tuple[Optional[datetime], int]:
    """Parse a time string like '9am-10am', '6-7pm', or '9:00 AM' into (remind_at, duration_minutes)."""
    if not time_str:
        return None, DEFAULT_DURATION_MINUTES

    time_str_clean = time_str.strip().lower()

    # Prefer explicit ranges so "6-7pm" becomes 18:00–19:00 (not 7pm alone).
    range_match = re.search(
        r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b",
        time_str_clean,
    )
    if range_match:
        start_h = int(range_match.group(1))
        start_m = int(range_match.group(2) or 0)
        start_ampm = range_match.group(3)
        end_h = int(range_match.group(4))
        end_m = int(range_match.group(5) or 0)
        end_ampm = range_match.group(6)
        if start_ampm is None and end_ampm is not None:
            start_ampm = end_ampm

        def apply_ampm(hour: int, ampm: Optional[str]) -> int:
            if ampm == "pm" and hour < 12:
                return hour + 12
            if ampm == "am" and hour == 12:
                return 0
            return hour

        start_h = apply_ampm(start_h, start_ampm)
        end_h = apply_ampm(end_h, end_ampm)
        target_date = base_date if base_date >= date.today() else date.today()
        remind_at = datetime.combine(
            target_date, time(start_h, start_m), tzinfo=timezone.utc
        )
        start_mins = start_h * 60 + start_m
        end_mins = end_h * 60 + end_m
        duration = end_mins - start_mins if end_mins > start_mins else DEFAULT_DURATION_MINUTES
        return remind_at, duration

    matches = list(
        re.finditer(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", time_str_clean)
    )
    if not matches:
        return None, DEFAULT_DURATION_MINUTES

    def match_to_time(m: re.Match[str]) -> tuple[int, int]:
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

    duration = DEFAULT_DURATION_MINUTES
    if len(matches) >= 2:
        end_h, end_m = match_to_time(matches[1])
        start_mins = start_h * 60 + start_m
        end_mins = end_h * 60 + end_m
        if end_mins > start_mins:
            duration = end_mins - start_mins

    return remind_at, duration


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
        return "", None, 1, False, DEFAULT_DURATION_MINUTES

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
                return clean_text, None, max(1, extracted.target_count), False, DEFAULT_DURATION_MINUTES

            phrase_to_parse = extracted.schedule_phrase or extracted.remind_time_str or clean_input
            ranged_remind, duration = parse_time_string(
                extracted.remind_time_str or extracted.schedule_phrase or clean_input,
                base_date,
            )
            remind_at = None
            if ranged_remind is not None and duration != DEFAULT_DURATION_MINUTES:
                remind_at = ranged_remind
            if remind_at is None:
                remind_at = parse_schedule_phrase(phrase_to_parse, base_date=base_date)
            if remind_at is None and extracted.remind_time_str:
                remind_at = parse_schedule_phrase(extracted.remind_time_str, base_date=base_date)
            if remind_at is None and ranged_remind is not None:
                remind_at = ranged_remind

            is_daily = extracted.is_daily_recurring or "every day" in clean_input.lower() or "daily" in clean_input.lower()
            target_cnt = max(1, extracted.target_count)
            if is_daily and target_cnt < 7 and item_type == "goal":
                target_cnt = 7

            return clean_text, remind_at, target_cnt, is_daily, duration
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
    duration = DEFAULT_DURATION_MINUTES
    if has_remind_keyword:
        range_from_text, range_duration = parse_time_string(clean_input, base_date)
        match = re.search(
            r"\b((?:(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today))\s*(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?|\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*[-–]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?|\d{1,2}(?::\d{2})?\s*[-–]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)|every\s+day\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b",
            lower,
        )
        if match:
            phrase = match.group(1).replace("every day at", "today at")
            ranged_remind, ranged_dur = parse_time_string(phrase, base_date)
            if ranged_remind is not None and "-" in phrase.replace("–", "-"):
                remind_at = ranged_remind
                duration = ranged_dur
            else:
                remind_at = parse_schedule_phrase(phrase, base_date=base_date)
                _, duration = parse_time_string(phrase, base_date)
        if remind_at is None and range_from_text is not None and range_duration != DEFAULT_DURATION_MINUTES:
            remind_at = range_from_text
            duration = range_duration
        if remind_at is None:
            remind_at = parse_schedule_phrase(clean_input, base_date=base_date)
            if range_from_text is not None:
                duration = range_duration

    return clean_text, remind_at, target_cnt, is_daily, duration


def parse_natural_language_calendar_batch(
    user_input: str,
    *,
    base_date: date,
    ai: Optional[JournalAI] = None,
    settings: Optional[Settings] = None,
) -> tuple[list[tuple[str, datetime, int]], str]:
    """Parse a complex natural-language schedule request into a batch of (title, remind_at, duration_minutes) items.

    Handles multi-day and multi-time prompts like:
    "remind me friday, saturday, sunday, and monday, at 8am, 12pm, 4pm, and 8pm to take creatine"
    """
    clean_input = user_input.strip()
    if not clean_input:
        return [], "No schedule prompt provided."

    if ai is not None and settings is not None:
        try:
            today_str = base_date.isoformat()
            day_name = base_date.strftime("%A")
            tomorrow_str = (base_date + timedelta(days=1)).isoformat()

            system_prompt = f"""You are a precise assistant extracting calendar events and reminders for MyJourn.
Today is {day_name}, {today_str}. Tomorrow is {tomorrow_str}.

Extract all requested calendar events/reminders from the user's prompt.

CRITICAL INSTRUCTIONS:
1. If the user lists MULTIPLE days (e.g. 'friday, saturday, sunday, and monday') AND MULTIPLE times (e.g. '8am, 12pm, 4pm, and 8pm'), generate a separate `ParsedCalendarEventItem` for EVERY combination of day and time (Cartesian product). E.g. 4 days x 4 times = 16 distinct event items.
2. For days of the week (e.g. Friday, Saturday, Sunday, Monday):
   - 'today' = {today_str}
   - 'tomorrow' = {tomorrow_str}
   - Day names refer to the upcoming occurrences of those days starting from today ({today_str}).
   - Output `event_date` as exact YYYY-MM-DD string.
3. Output `start_time` in 24-hour HH:MM format (e.g. '08:00', '12:00', '16:00', '20:00').
4. Output `title` as a clean, concise task/action name without time or day words (e.g. 'Take creatine', 'Call mom'). Capitalize the first letter nicely.
5. Provide a warm, clear `summary_message` summarizing what was scheduled (e.g. 'Added 16 reminders to take creatine across Friday, Saturday, Sunday, and Monday.').
"""
            try:
                extracted: ParsedCalendarBatch = ai.extract_json(
                    system_prompt=system_prompt,
                    user_prompt=clean_input,
                    schema_class=ParsedCalendarBatch,
                    model=settings.openai_fast_model,
                )
            except TypeError:
                extracted = ai.extract_json(
                    system_prompt=system_prompt,
                    user_prompt=clean_input,
                    schema_class=ParsedCalendarBatch,
                )

            results: list[tuple[str, datetime, int]] = []
            for item in extracted.items:
                try:
                    event_d = date.fromisoformat(item.event_date)
                    time_parts = [int(p) for p in item.start_time.split(":")]
                    event_t = time(time_parts[0], time_parts[1] if len(time_parts) > 1 else 0)
                    remind_dt = datetime.combine(event_d, event_t, tzinfo=timezone.utc)
                    results.append((item.title, remind_dt, item.duration_minutes))
                except Exception as parse_err:
                    logger.warning("Could not parse extracted item %s: %s", item, parse_err)

            if results:
                return results, extracted.summary_message
        except Exception as exc:
            logger.warning("AI batch calendar parsing failed, falling back: %s", exc, exc_info=True)

    # Fallback parser for multi-day / multi-time requests
    return _fallback_batch_schedule_parse(clean_input, base_date=base_date)


def _fallback_batch_schedule_parse(
    clean_input: str, *, base_date: date
) -> tuple[list[tuple[str, datetime, int]], str]:
    lower = clean_input.lower()

    # 1. Detect day names
    day_map = {
        "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
        "friday": 4, "saturday": 5, "sunday": 6,
    }

    found_dates: list[date] = []
    if "today" in lower:
        found_dates.append(base_date)
    if "tomorrow" in lower:
        found_dates.append(base_date + timedelta(days=1))

    for day_name, day_num in day_map.items():
        if day_name in lower:
            days_ahead = (day_num - base_date.weekday()) % 7
            target_d = base_date + timedelta(days=days_ahead)
            if target_d not in found_dates:
                found_dates.append(target_d)

    if not found_dates:
        found_dates = [base_date]

    found_dates.sort()

    # 2. Detect times
    time_matches = list(re.finditer(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", lower))
    found_times: list[tuple[int, int]] = []

    for m in time_matches:
        hour = int(m.group(1))
        minute = int(m.group(2)) if m.group(2) else 0
        ampm = m.group(3)
        if ampm == "pm" and hour < 12:
            hour += 12
        elif ampm == "am" and hour == 12:
            hour = 0
        elif ampm is None and hour < 7:
            hour += 12
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            time_tuple = (hour, minute)
            if time_tuple not in found_times:
                found_times.append(time_tuple)

    if not found_times:
        found_times = [(DEFAULT_REMINDER_HOUR, 0)]

    found_times.sort()

    # 3. Clean title
    clean_title = re.sub(
        r"\b(?:remind\s+me|at|and|on|every|day|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b",
        "",
        clean_input,
        flags=re.IGNORECASE,
    )
    clean_title = re.sub(r"[,;:\.]+", " ", clean_title)
    clean_title = re.sub(r"\s+", " ", clean_title).strip()
    clean_title = re.sub(r"^(?:to|for)\s+", "", clean_title, flags=re.IGNORECASE).strip()
    if not clean_title:
        clean_title = clean_input.strip()
    clean_title = clean_title.capitalize()

    # 4. Cartesian product
    results: list[tuple[str, datetime, int]] = []
    for d in found_dates:
        for h, m in found_times:
            remind_dt = datetime.combine(d, time(h, m), tzinfo=timezone.utc)
            results.append((clean_title, remind_dt, DEFAULT_DURATION_MINUTES))

    summary = f"Added {len(results)} reminder{'s' if len(results) != 1 else ''} for '{clean_title}' to your calendar."
    return results, summary

