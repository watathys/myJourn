from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

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


    _, kwargs = mock_service.events().insert.call_args
    body = kwargs["body"]
    assert body["start"]["dateTime"] == "2026-07-25T09:00:00"
    assert body["start"]["timeZone"] == "America/Denver"


def test_google_callback_catches_unexpected_errors_and_redirects(client: TestClient) -> None:
    # Patch session.get in routes to raise an OperationalError / database error
    with patch("app.api.routes.bind_user_rls"), \
         patch("sqlalchemy.orm.Session.get", side_effect=RuntimeError("Database connection failed")):
        response = client.get(
            "/api/auth/google/callback",
            params={"code": "test-code", "state": "test-user-id"},
            follow_redirects=False,
        )
        assert response.status_code == 307
        assert "google_error=server_error" in response.headers["location"]


def test_google_callback_redirects_on_missing_refresh_token(client: TestClient, session: Session) -> None:
    from app.services.google_calendar import ExchangedTokens
    from google.oauth2.credentials import Credentials

    user = User(id="test-user-no-refresh")
    session.add(user)
    session.commit()

    mock_creds = Credentials(token="access-token-only")
    exchanged = ExchangedTokens(credentials=mock_creds, email="test@example.com")

    with patch.object(google_calendar, "exchange_code_for_tokens", return_value=exchanged):
        response = client.get(
            "/api/auth/google/callback",
            params={"code": "test-code", "state": user.id},
            follow_redirects=False,
        )
        assert response.status_code == 307
        assert "google_error=no_refresh_token" in response.headers["location"]


def test_google_callback_success(client: TestClient, session: Session) -> None:
    from app.services.google_calendar import ExchangedTokens
    from google.oauth2.credentials import Credentials

    user = User(id="test-user-success")
    session.add(user)
    session.commit()

    mock_creds = Credentials(token="access-token", refresh_token="refresh-token")
    exchanged = ExchangedTokens(credentials=mock_creds, email="user@example.com")

    with patch.object(google_calendar, "exchange_code_for_tokens", return_value=exchanged), \
         patch("app.api.routes._sync_pending_tasks_after_connect"):
        response = client.get(
            "/api/auth/google/callback",
            params={"code": "test-code", "state": user.id},
            follow_redirects=False,
        )
        assert response.status_code == 307
        assert "google=connected" in response.headers["location"]

        updated_user = session.get(User, user.id)
        assert updated_user.google_connected is True
        assert updated_user.google_email == "user@example.com"
