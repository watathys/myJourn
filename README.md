# MyJourn

FastAPI backend for an AI-assisted personal journal. Raw journal input is stored
unchanged alongside a separately generated narrative and reflection.

## Local setup

Requires Python 3.9 or newer.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --app-dir backend --reload
```

The API docs are available at `http://127.0.0.1:8000/docs`.

## Web app

The React frontend lives in `frontend/`. With the API running on port 8000,
start the development server in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The development server proxies `/api` requests
to FastAPI. Run frontend checks with `npm run build` and `npm run lint`.

## Configuration

- `MYJOURN_DATABASE_URL` defaults to `sqlite:///./myjourn.db`. Set it to a
  Postgres SQLAlchemy URL when moving to Supabase/Postgres.
- `MYJOURN_OPENAI_API_KEY` enables journal processing.
- `MYJOURN_OPENAI_MODEL` selects the structured-output-capable model.
- `MYJOURN_GOOGLE_CLIENT_ID` / `MYJOURN_GOOGLE_CLIENT_SECRET` enable the
  "Connect Google Calendar" flow. Without them, scheduled reminders still work
  inside the app but won't create calendar events / phone notifications.
- `MYJOURN_GOOGLE_REDIRECT_URI` must exactly match an "Authorized redirect URI"
  configured on the Google OAuth client (defaults to the local backend at
  `http://127.0.0.1:8000/api/auth/google/callback`).
- `MYJOURN_GOOGLE_POST_AUTH_REDIRECT` is where the browser is sent back to
  after the Google consent screen (defaults to the local Vite dev server).
- `MYJOURN_GOOGLE_CALENDAR_ID` selects which calendar events are created on
  (defaults to `primary`).

### Google Cloud setup (for Calendar reminders)

1. Create or pick a project in the [Google Cloud console](https://console.cloud.google.com/).
2. Under **APIs & Services → Library**, enable the **Google Calendar API**.
3. Under **APIs & Services → OAuth consent screen**, configure an external
   (or internal) consent screen and add the `calendar.events`, `openid`, and
   `email` scopes.
4. Under **APIs & Services → Credentials**, create an **OAuth client ID** of
   type "Web application". Add an authorized redirect URI matching
   `MYJOURN_GOOGLE_REDIRECT_URI` (e.g. `http://127.0.0.1:8000/api/auth/google/callback`).
5. Copy the generated client ID/secret into `MYJOURN_GOOGLE_CLIENT_ID` and
   `MYJOURN_GOOGLE_CLIENT_SECRET` in `.env`.
6. Restart the backend, then use "Connect Google Calendar" on the North Star
   page in the app to complete sign-in. Scheduled reminders (set on a task, or
   requested through Percy, e.g. "remind me Saturday at 9am to read my
   scriptures") will sync to the connected calendar with a phone notification.

## Main flow

1. `POST /api/users`
2. Optionally read or set personal context with
   `GET /api/users/{user_id}/mission-statement` and
   `PUT /api/users/{user_id}/mission-statement`.
3. Submit a daily dump to `POST /api/journal-entries/process`.

A mission statement is optional by design. The system north star is always
included, and processing works when the user has no mission row. Reading an
unset mission returns `statement_text: null`; updates accept omitted, null, or
empty text.

Run checks with:

```bash
ruff check .
pytest
```
