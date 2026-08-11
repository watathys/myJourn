"""Google OAuth + Calendar event sync for scheduled task/goal reminders.

Kept as a thin, dependency-injectable wrapper so routes and the daily
processing service never touch the Google SDKs directly. All calendar
failures are caught by callers and treated as non-fatal: a task's
``remind_at``/``snoozed_until`` are always the source of truth, and the
calendar event is a best-effort mirror of them.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import id_token as google_id_token
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.config import Settings
from app.models import GoalKind, OpenLoopAndGoal, User

# Google expands 'email' to 'https://www.googleapis.com/auth/userinfo.email'
# and may include extra granted scopes. Allow oauthlib to accept scope variations.
os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]

EVENT_DURATION_MINUTES = 15


class GoogleCalendarNotConfigured(RuntimeError):
    """Raised when Google OAuth credentials are missing from settings."""


class GoogleCalendarError(RuntimeError):
    """Raised when a Calendar API call fails."""


def _client_config(settings: Settings) -> dict:
    if not settings.google_oauth_configured:
        raise GoogleCalendarNotConfigured(
            "Set MYJOURN_GOOGLE_CLIENT_ID and MYJOURN_GOOGLE_CLIENT_SECRET to enable "
            "Google Calendar reminders."
        )
    return {
        "web": {
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [settings.google_redirect_uri],
        }
    }


def build_authorization_url(settings: Settings, *, state: str) -> str:
    """Return the Google consent screen URL for a user to connect their calendar."""

    flow = Flow.from_client_config(
        _client_config(settings),
        scopes=SCOPES,
        state=state,
        autogenerate_code_verifier=False,
    )
    flow.redirect_uri = settings.google_redirect_uri
    authorization_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    return authorization_url


class ExchangedTokens:
    def __init__(self, credentials: Credentials, email: Optional[str]) -> None:
        self.access_token = credentials.token
        self.refresh_token = credentials.refresh_token
        self.expiry = credentials.expiry
        self.email = email


def exchange_code_for_tokens(settings: Settings, *, code: str) -> ExchangedTokens:
    """Trade an OAuth ``code`` from the callback for stored tokens + the user's email."""

    flow = Flow.from_client_config(
        _client_config(settings),
        scopes=SCOPES,
        autogenerate_code_verifier=False,
    )
    flow.redirect_uri = settings.google_redirect_uri
    flow.fetch_token(code=code)
    credentials = flow.credentials

    email = None
    if credentials.id_token:
        try:
            claims = google_id_token.verify_oauth2_token(
                credentials.id_token, GoogleAuthRequest(), settings.google_client_id
            )
            email = claims.get("email")
        except Exception:  # noqa: BLE001 - email is a nice-to-have, never fatal
            logger.warning("Could not verify Google id_token to read email", exc_info=True)

    return ExchangedTokens(credentials, email)


def _credentials_for_user(settings: Settings, user: User) -> Credentials:
    if not user.google_refresh_token:
        raise GoogleCalendarNotConfigured("This user has not connected Google Calendar.")
    credentials = Credentials(
        token=user.google_access_token,
        refresh_token=user.google_refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        scopes=SCOPES,
    )
    expiry = user.google_token_expiry
    if expiry is not None and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    expired = expiry is None or expiry <= datetime.now(timezone.utc)
    if expired:
        credentials.refresh(GoogleAuthRequest())
        user.google_access_token = credentials.token
        if credentials.expiry:
            user.google_token_expiry = credentials.expiry.replace(tzinfo=timezone.utc)
    return credentials


def _calendar_client(settings: Settings, user: User):
    credentials = _credentials_for_user(settings, user)
    return build("calendar", "v3", credentials=credentials, cache_discovery=False)


def _get_calendar_timezone(service, settings: Settings) -> str:
    try:
        cal = service.calendars().get(calendarId=settings.google_calendar_id).execute()
        tz = cal.get("timeZone")
        if tz:
            return tz
    except Exception:
        logger.debug(
            "Could not fetch Google Calendar timezone; falling back to local system timezone"
        )
    try:
        import tzlocal
        return tzlocal.get_localzone_name()
    except Exception:
        return "UTC"


def sync_task_event(
    settings: Settings,
    user: User,
    task: OpenLoopAndGoal,
    *,
    duration_minutes: int = EVENT_DURATION_MINUTES,
    is_daily_recurring: bool = False,
) -> None:
    """Create, update, or delete the calendar event mirroring ``task.remind_at``.

    Mutates ``task.calendar_event_id`` in place; caller is responsible for committing.
    Raises ``GoogleCalendarNotConfigured``/``GoogleCalendarError`` on failure so callers
    can decide whether to surface or swallow the problem.
    """

    if not user.google_connected:
        raise GoogleCalendarNotConfigured("This user has not connected Google Calendar.")

    service = _calendar_client(settings, user)

    if task.remind_at is None:
        if task.calendar_event_id:
            _delete_event(service, settings, task.calendar_event_id)
            task.calendar_event_id = None
        return

    # remind_at is stored as a local wall-clock time labeled UTC/Z. Strip any
    # tzinfo and send the clock face with the calendar's timezone so Google
    # does not shift the hour the user picked.
    start = task.remind_at.replace(tzinfo=None) if task.remind_at.tzinfo else task.remind_at
    time_zone = _get_calendar_timezone(service, settings)
    start_str = start.strftime("%Y-%m-%dT%H:%M:%S")
    end_str = (start + timedelta(minutes=duration_minutes)).strftime("%Y-%m-%dT%H:%M:%S")

    kind_label = "Goal" if task.kind == GoalKind.GOAL else "What I'm Working On"

    body: dict = {
        "summary": task.goal_text[:250],
        "description": f"Reminder from MyJourn — {kind_label}.",
        "start": {
            "dateTime": start_str,
            "timeZone": time_zone,
        },
        "end": {
            "dateTime": end_str,
            "timeZone": time_zone,
        },
        "reminders": {
            "useDefault": False,
            "overrides": [{"method": "popup", "minutes": 0}],
        },
    }

    if is_daily_recurring:
        count = max(1, task.target_count or 1)
        body["recurrence"] = [f"RRULE:FREQ=DAILY;COUNT={count}"]

    try:
        if task.calendar_event_id:
            event = (
                service.events()
                .update(
                    calendarId=settings.google_calendar_id,
                    eventId=task.calendar_event_id,
                    body=body,
                )
                .execute()
            )
        else:
            event = (
                service.events()
                .insert(calendarId=settings.google_calendar_id, body=body)
                .execute()
            )
        task.calendar_event_id = event.get("id")
    except HttpError as exc:
        if exc.resp is not None and exc.resp.status == 404 and task.calendar_event_id:
            # The event was deleted on the Google side; recreate it fresh.
            task.calendar_event_id = None
            sync_task_event(settings, user, task)
            return
        raise GoogleCalendarError(str(exc)) from exc


def delete_task_event(settings: Settings, user: User, task: OpenLoopAndGoal) -> None:
    if not task.calendar_event_id or not user.google_connected:
        task.calendar_event_id = None
        return
    try:
        service = _calendar_client(settings, user)
        _delete_event(service, settings, task.calendar_event_id)
    except (GoogleCalendarNotConfigured, GoogleCalendarError, HttpError):
        logger.warning("Could not delete calendar event %s", task.calendar_event_id, exc_info=True)
    finally:
        task.calendar_event_id = None


def _delete_event(service, settings: Settings, event_id: str) -> None:
    try:
        service.events().delete(
            calendarId=settings.google_calendar_id, eventId=event_id
        ).execute()
    except HttpError as exc:
        if exc.resp is not None and exc.resp.status in (404, 410):
            return
        raise GoogleCalendarError(str(exc)) from exc


def disconnect_user(user: User) -> None:
    user.google_access_token = None
    user.google_refresh_token = None
    user.google_token_expiry = None
    user.google_email = None
