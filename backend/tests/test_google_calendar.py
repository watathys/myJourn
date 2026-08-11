from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from app.config import Settings
from app.models import OpenLoopAndGoal, User
from app.services import google_calendar


def test_build_authorization_url_disables_pkce() -> None:
    settings = Settings(
        google_client_id="test-client-id",
        google_client_secret="test-client-secret",
    )
    url = google_calendar.build_authorization_url(settings, state="test-state")
    assert "code_challenge=" not in url
    assert "code_challenge_method=" not in url
    assert "client_id=test-client-id" in url
    assert "state=test-state" in url


def test_sync_task_event_uses_local_datetime_and_timezone() -> None:
    settings = Settings(
        google_client_id="test-client-id",
        google_client_secret="test-client-secret",
    )
    user = User(
        google_access_token="test-access-token",
        google_refresh_token="test-refresh-token",
    )
    task = OpenLoopAndGoal(
        user_id=user.id,
        goal_text="Read scriptures",
        remind_at=datetime(2026, 7, 25, 9, 0),
    )

    mock_insert = MagicMock()
    mock_insert.execute.return_value = {"id": "event-123"}
    mock_service = MagicMock()
    mock_service.events().insert.return_value = mock_insert

    with patch.object(google_calendar, "_calendar_client", return_value=mock_service), \
         patch.object(google_calendar, "_get_calendar_timezone", return_value="America/Denver"):
        google_calendar.sync_task_event(settings, user, task)

    mock_service.events().insert.assert_called_once()
    _, kwargs = mock_service.events().insert.call_args
    body = kwargs["body"]
    assert body["start"]["dateTime"] == "2026-07-25T09:00:00"
    assert body["start"]["timeZone"] == "America/Denver"
    assert body["end"]["dateTime"] == "2026-07-25T09:15:00"
    assert body["end"]["timeZone"] == "America/Denver"
    assert task.calendar_event_id == "event-123"


def test_sync_task_event_keeps_wall_clock_for_aware_utc() -> None:
    """Fake-Z local times must not be shifted when labeled UTC."""
    settings = Settings(
        google_client_id="test-client-id",
        google_client_secret="test-client-secret",
    )
    user = User(
        google_access_token="test-access-token",
        google_refresh_token="test-refresh-token",
    )
    task = OpenLoopAndGoal(
        user_id=user.id,
        goal_text="Call mom",
        remind_at=datetime(2026, 7, 25, 9, 0, tzinfo=timezone.utc),
    )

    mock_insert = MagicMock()
    mock_insert.execute.return_value = {"id": "event-456"}
    mock_service = MagicMock()
    mock_service.events().insert.return_value = mock_insert

    with patch.object(google_calendar, "_calendar_client", return_value=mock_service), \
         patch.object(google_calendar, "_get_calendar_timezone", return_value="America/Denver"):
        google_calendar.sync_task_event(settings, user, task)

    _, kwargs = mock_service.events().insert.call_args
    body = kwargs["body"]
    assert body["start"]["dateTime"] == "2026-07-25T09:00:00"
    assert body["start"]["timeZone"] == "America/Denver"
