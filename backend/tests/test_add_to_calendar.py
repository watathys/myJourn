from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.ai.schemas import ParsedCalendarBatch, ParsedCalendarEventItem
from app.models import OpenLoopAndGoal, User
from app.services.schedule_parsing import (
    _fallback_batch_schedule_parse,
    parse_natural_language_calendar_batch,
)


def test_fallback_batch_schedule_parse_creatine_example() -> None:
    prompt = "remind me friday, saturday, sunday, and monday, at 8am, 12pm, 4pm, and 8pm to take creatine"
    # Base date: Thursday, Sep 3, 2026
    base_d = date(2026, 9, 3)

    items, summary = _fallback_batch_schedule_parse(prompt, base_date=base_d)

    # 4 days (Friday 2026-09-04, Saturday 2026-09-05, Sunday 2026-09-06, Monday 2026-09-07)
    # x 4 times (08:00, 12:00, 16:00, 20:00) = 16 total items
    assert len(items) == 16
    for title, remind_at, dur in items:
        assert title == "Take creatine"
        assert remind_at.tzinfo == timezone.utc
        assert remind_at.hour in (8, 12, 16, 20)
        assert remind_at.date() in (
            date(2026, 9, 4),
            date(2026, 9, 5),
            date(2026, 9, 6),
            date(2026, 9, 7),
        )


def test_parse_natural_language_calendar_batch_with_ai() -> None:
    prompt = "remind me friday and saturday at 9am to meditate"
    base_d = date(2026, 9, 3)

    fake_extracted = ParsedCalendarBatch(
        items=[
            ParsedCalendarEventItem(
                title="Meditate",
                event_date="2026-09-04",
                start_time="09:00",
                duration_minutes=15,
            ),
            ParsedCalendarEventItem(
                title="Meditate",
                event_date="2026-09-05",
                start_time="09:00",
                duration_minutes=15,
            ),
        ],
        summary_message="Added 2 reminders to meditate on Friday and Saturday at 9:00 AM.",
    )

    fake_ai = MagicMock()
    fake_ai.extract_json.return_value = fake_extracted
    fake_settings = MagicMock()
    fake_settings.openai_fast_model = "gpt-4o-mini"

    items, summary = parse_natural_language_calendar_batch(
        prompt,
        base_date=base_d,
        ai=fake_ai,
        settings=fake_settings,
    )

    assert len(items) == 2
    assert summary == "Added 2 reminders to meditate on Friday and Saturday at 9:00 AM."
    assert items[0][0] == "Meditate"
    assert items[0][1] == datetime(2026, 9, 4, 9, 0, tzinfo=timezone.utc)
    assert items[1][1] == datetime(2026, 9, 5, 9, 0, tzinfo=timezone.utc)


def test_add_to_calendar_route_creates_tasks_and_syncs_google(
    client: TestClient, session: Session
) -> None:
    user = User(
        google_access_token="fake-token",
        google_refresh_token="fake-refresh",
        google_email="user@example.com",
    )
    session.add(user)
    session.commit()

    prompt = "remind me friday, saturday, sunday, and monday, at 8am, 12pm, 4pm, and 8pm to take creatine"

    with patch("app.services.google_calendar.sync_task_event") as mock_sync:
        res = client.post(
            f"/api/users/{user.id}/calendar/add-natural-language",
            json={"user_id": user.id, "prompt": prompt},
        )

    assert res.status_code == 201
    body = res.json()
    assert len(body["created_tasks"]) == 16
    assert body["google_connected"] is True
    assert "creatine" in body["summary_message"].lower() or "added" in body["summary_message"].lower()

    # Check tasks created in DB
    db_tasks = session.query(OpenLoopAndGoal).filter_by(user_id=user.id).all()
    assert len(db_tasks) == 16
    for t in db_tasks:
        assert "creatine" in t.goal_text.lower()
        assert t.remind_at is not None

    # Sync was called for each task
    assert mock_sync.call_count == 16
