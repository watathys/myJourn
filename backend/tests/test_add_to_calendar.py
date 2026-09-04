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


def test_add_to_calendar_route_creates_events_only_no_tasks(
    client: TestClient, session: Session
) -> None:
    user = User(
        google_access_token="fake-token",
        google_refresh_token="fake-refresh",
        google_email="user@example.com",
    )
    session.add(user)
    session.commit()

    prompt = (
        "remind me friday, saturday, sunday, and monday, at 8am, 12pm, 4pm, "
        "and 8pm to take creatine"
    )
    parsed_items = [
        ("Take creatine", datetime(2026, 9, 4, 8, 0, tzinfo=timezone.utc), 15),
        ("Take creatine", datetime(2026, 9, 4, 12, 0, tzinfo=timezone.utc), 15),
    ]

    with patch(
        "app.api.routes.parse_natural_language_calendar_batch",
        return_value=(parsed_items, "Added 2 reminders to take creatine."),
    ), patch(
        "app.services.google_calendar.insert_calendar_events",
        return_value=len(parsed_items),
    ) as mock_insert:
        res = client.post(
            f"/api/users/{user.id}/calendar/add-natural-language",
            json={"user_id": user.id, "prompt": prompt},
        )

    assert res.status_code == 201
    body = res.json()
    assert body["created_count"] == 2
    assert body["google_connected"] is True
    assert "creatine" in body["summary_message"].lower()

    # The reminders went straight to Google Calendar; no task rows were created.
    assert session.query(OpenLoopAndGoal).filter_by(user_id=user.id).count() == 0
    mock_insert.assert_called_once()


def test_add_to_calendar_requires_google_connection(client: TestClient, session: Session) -> None:
    user = User()  # not connected to Google
    session.add(user)
    session.commit()

    with patch("app.api.routes.parse_natural_language_calendar_batch") as mock_parse:
        res = client.post(
            f"/api/users/{user.id}/calendar/add-natural-language",
            json={"user_id": user.id, "prompt": "remind me tomorrow at 9am to stretch"},
        )

    assert res.status_code == 400
    mock_parse.assert_not_called()
    assert session.query(OpenLoopAndGoal).filter_by(user_id=user.id).count() == 0
