"""Core API routes for users, personal context, and daily processing."""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Annotated
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session, selectinload

from app.ai.client import JournalAI
from app.api.dependencies import get_current_user_id, get_journal_ai
from app.config import Settings, get_settings
from app.db import get_db
from app.models import (
    DailyPlan,
    GoalKind,
    GoalStatus,
    JournalEntry,
    LifeInsight,
    MissionStatement,
    OpenLoopAndGoal,
    PercyReminder,
    SavedPercyAdvice,
    SpellingCorrection,
    TaskSection,
    User,
    WeeklyPlanningSession,
)
from app.rls import bind_user_rls
from app.schemas import (
    AcknowledgeSnoozeRequest,
    AddToCalendarRequest,
    AddToCalendarResponse,
    CreateGoalRequest,
    CreatePercyReminderRequest,
    CreateSavedPercyAdviceRequest,
    CreateSectionRequest,
    CreateSpellingCorrectionRequest,
    CreateTaskRequest,
    DailyPlanResponse,
    GoalResponse,
    GoogleAuthorizeResponse,
    GoogleStatusResponse,
    JournalEntryResponse,
    LifeInsightResponse,
    MissionStatementResponse,
    MissionStatementUpdate,
    PercyChatRequest,
    PercyChatResponse,
    PercyCreateGoalRequest,
    PercyCreateGoalResponse,
    PercyReminderResponse,
    ProcessJournalRequest,
    ProcessJournalResponse,
    ReorderGoalsRequest,
    ReorderSectionsRequest,
    ReorderTasksRequest,
    SavedPercyAdviceResponse,
    SectionResponse,
    SpellingCorrectionResponse,
    StartWeeklyPlanningRequest,
    TaskResponse,
    UpdateGoalRequest,
    UpdateJournalEntryRequest,
    UpdateSectionRequest,
    UpdateTaskRequest,
    UpsertDailyPlanRequest,
    UserResponse,
    UserScopedRequest,
    WeeklyPlanningSessionResponse,
)
from app.services import google_calendar
from app.services.daily_processing import DailyProcessingService
from app.services.percy_chat import chat_with_percy
from app.services.percy_goal import create_goal_with_percy
from app.services.schedule_parsing import (
    parse_natural_language_calendar_batch,
    parse_natural_language_item,
)
from app.services.spelling import (
    delete_spelling_correction,
    get_user_spelling_corrections,
    learn_spelling_corrections,
    save_spelling_correction,
)
from app.services.weekly_reflection import WeeklyReflectionService

logger = logging.getLogger(__name__)

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]
AIClient = Annotated[JournalAI, Depends(get_journal_ai)]
AppSettings = Annotated[Settings, Depends(get_settings)]
CurrentUserId = Annotated[str, Depends(get_current_user_id)]


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(current_user_id: CurrentUserId, session: DbSession) -> User:
    user = session.get(User, current_user_id)
    if user is None:
        user = User(id=current_user_id)
        session.add(user)
        session.commit()
        session.refresh(user)
    return user


@router.get(
    "/users/{user_id}/mission-statement",
    response_model=MissionStatementResponse,
)
def get_mission_statement(
    user_id: str,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> MissionStatementResponse:
    if session.get(User, user_id) is None:
        raise HTTPException(status_code=404, detail="User not found")
    mission = session.get(MissionStatement, current_user_id)
    if mission is None:
        return MissionStatementResponse(user_id=current_user_id, statement_text=None)
    return MissionStatementResponse.model_validate(mission)


@router.put(
    "/users/{user_id}/mission-statement",
    response_model=MissionStatementResponse,
)
def set_mission_statement(
    user_id: str,
    payload: MissionStatementUpdate,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> MissionStatement:
    if session.get(User, user_id) is None:
        raise HTTPException(status_code=404, detail="User not found")
    mission = session.get(MissionStatement, current_user_id)
    if mission is None:
        mission = MissionStatement(user_id=current_user_id, statement_text=payload.statement_text)
        session.add(mission)
    else:
        mission.statement_text = payload.statement_text
    session.commit()
    session.refresh(mission)
    return mission


@router.delete("/users/{user_id}/mission-statement", status_code=status.HTTP_204_NO_CONTENT)
def delete_mission_statement(
    user_id: str,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> Response:
    mission = session.get(MissionStatement, current_user_id)
    if mission is not None:
        session.delete(mission)
        session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/users/{user_id}/journal-entries",
    response_model=list[JournalEntryResponse],
)
def list_journal_entries(
    user_id: str,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> list[JournalEntry]:
    if session.get(User, user_id) is None:
        raise HTTPException(status_code=404, detail="User not found")
    return list(
        session.scalars(
            select(JournalEntry)
            .options(
                selectinload(JournalEntry.goals),
                selectinload(JournalEntry.completed_goals),
            )
            .where(JournalEntry.user_id == current_user_id)
            .order_by(JournalEntry.date.desc(), JournalEntry.created_at.desc())
        )
    )


@router.post(
    "/journal-entries/process",
    response_model=ProcessJournalResponse,
    status_code=status.HTTP_201_CREATED,
)
def process_journal_entry(
    payload: ProcessJournalRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
    ai: AIClient,
    settings: AppSettings,
) -> ProcessJournalResponse:
    try:
        result = DailyProcessingService(session=session, ai=ai, settings=settings).process(
            user_id=current_user_id,
            entry_date=payload.date,
            raw_transcript=payload.raw_transcript,
            is_import=payload.is_import,
            verbatim=payload.verbatim,
            append_to_entry_id=payload.append_to_entry_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    entry = result.journal_entry
    return ProcessJournalResponse(
        journal_entry_id=entry.id,
        date=entry.date,
        raw_transcript=entry.raw_transcript,
        formatted_narrative=entry.formatted_narrative,
        alignment_summary=entry.alignment_summary,
        context_summary=entry.context_summary,
        praise_message=result.praise_message,
        completed_goals=list(result.completed_goals),
        new_goals=list(result.new_goals),
        new_weekly_goals=list(result.new_weekly_goals),
        follow_up_questions=list(result.follow_up_questions),
        display_text=result.display_text,
        percy_reminders=list(result.percy_reminders),
        life_insights=list(result.life_insights),
    )


@router.patch(
    "/journal-entries/{entry_id}",
    response_model=JournalEntryResponse,
)
def update_journal_entry(
    entry_id: str,
    payload: UpdateJournalEntryRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> JournalEntry:
    entry = session.scalar(
        select(JournalEntry)
        .options(
            selectinload(JournalEntry.goals),
            selectinload(JournalEntry.completed_goals),
        )
        .where(JournalEntry.id == entry_id, JournalEntry.user_id == current_user_id)
    )
    if entry is None:
        raise HTTPException(status_code=404, detail="Journal entry not found")

    if payload.formatted_narrative is not None:
        clean_narrative = payload.formatted_narrative.strip()
        if not clean_narrative:
            raise HTTPException(status_code=422, detail="formatted_narrative must not be empty")
        old_narrative = entry.formatted_narrative
        entry.formatted_narrative = clean_narrative
        learn_spelling_corrections(session, current_user_id, old_narrative, clean_narrative)

    if payload.date is not None:
        entry.date = payload.date

    session.commit()
    updated_entry = session.scalar(
        select(JournalEntry)
        .options(
            selectinload(JournalEntry.goals),
            selectinload(JournalEntry.completed_goals),
        )
        .where(JournalEntry.id == entry_id, JournalEntry.user_id == current_user_id)
    )
    if updated_entry is None:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    return updated_entry


@router.delete("/journal-entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_journal_entry(
    entry_id: str,
    payload: UserScopedRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> Response:
    entry = session.get(JournalEntry, entry_id)
    if entry is None or entry.user_id != current_user_id:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    session.delete(entry)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Tasks ("What I'm Working On")
# ---------------------------------------------------------------------------


def _list_tasks(session: Session, user_id: str) -> list[OpenLoopAndGoal]:
    return list(
        session.scalars(
            select(OpenLoopAndGoal)
            .where(
                OpenLoopAndGoal.user_id == user_id,
                OpenLoopAndGoal.kind == GoalKind.TASK,
                OpenLoopAndGoal.status != GoalStatus.ABANDONED,
            )
            .order_by(
                case((OpenLoopAndGoal.status == GoalStatus.COMPLETED, 1), else_=0),
                OpenLoopAndGoal.sort_order,
                OpenLoopAndGoal.created_at,
            )
        )
    )


def _get_owned_task(session: Session, task_id: str, user_id: str) -> OpenLoopAndGoal:
    task = session.get(OpenLoopAndGoal, task_id)
    if task is None or task.user_id != user_id or task.kind != GoalKind.TASK:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _list_sections(session: Session, user_id: str) -> list[TaskSection]:
    return list(
        session.scalars(
            select(TaskSection)
            .where(TaskSection.user_id == user_id)
            .order_by(TaskSection.sort_order, TaskSection.created_at)
        )
    )


def _get_owned_section(session: Session, section_id: str, user_id: str) -> TaskSection:
    section = session.get(TaskSection, section_id)
    if section is None or section.user_id != user_id:
        raise HTTPException(status_code=404, detail="Section not found")
    return section


def _resolve_section_id(
    session: Session, user_id: str, section_id: str | None
) -> str | None:
    """Validate a client-supplied section id, returning None for the unsectioned state."""

    if section_id is None:
        return None
    section = session.get(TaskSection, section_id)
    if section is None or section.user_id != user_id:
        raise HTTPException(status_code=422, detail="Invalid section id")
    return section_id


def _sync_or_clear_calendar(
    session: Session,
    settings: Settings,
    user_id: str,
    task: OpenLoopAndGoal,
    *,
    duration_minutes: int | None = None,
) -> None:
    user = session.get(User, user_id)
    if user is None or not user.google_connected:
        return
    try:
        kwargs: dict = {}
        if duration_minutes is not None:
            kwargs["duration_minutes"] = duration_minutes
        google_calendar.sync_task_event(settings, user, task, **kwargs)
    except Exception:  # noqa: BLE001 - calendar sync is always best-effort
        logger.warning("Could not sync calendar event for task %s", task.id, exc_info=True)


def _clear_calendar(
    session: Session, settings: Settings, user_id: str, task: OpenLoopAndGoal
) -> None:
    user = session.get(User, user_id)
    if user is None:
        return
    try:
        google_calendar.delete_task_event(settings, user, task)
    except Exception:  # noqa: BLE001
        logger.warning("Could not delete calendar event for task %s", task.id, exc_info=True)


@router.get("/users/{user_id}/tasks", response_model=list[TaskResponse])
def list_tasks(
    user_id: str,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> list[OpenLoopAndGoal]:
    return _list_tasks(session, current_user_id)


@router.post(
    "/users/{user_id}/tasks",
    response_model=TaskResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_task(
    user_id: str,
    payload: CreateTaskRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
    settings: AppSettings,
) -> OpenLoopAndGoal:
    """Add a task verbatim.

    Tasks are never sent through AI natural-language parsing: the title is
    stored exactly as typed. A calendar event is only created when the client
    explicitly supplies a ``remind_at`` (e.g. the Start/End time pickers).
    """
    clean_text = payload.goal_text.strip()
    if not clean_text:
        raise HTTPException(status_code=422, detail="goal_text must not be empty")

    section_id = _resolve_section_id(session, current_user_id, payload.section_id)

    duration = payload.duration_minutes or google_calendar.EVENT_DURATION_MINUTES

    next_sort_order = (
        session.scalar(
            select(func.max(OpenLoopAndGoal.sort_order)).where(
                OpenLoopAndGoal.user_id == current_user_id, OpenLoopAndGoal.kind == GoalKind.TASK
            )
        )
        or 0
    ) + 1

    task = OpenLoopAndGoal(
        user_id=current_user_id,
        goal_text=clean_text,
        status=GoalStatus.PENDING,
        kind=GoalKind.TASK,
        sort_order=next_sort_order,
        target_count=1,
        current_count=0,
        remind_at=payload.remind_at,
        snoozed_until=payload.snoozed_until,
        section_id=section_id,
    )
    session.add(task)
    session.commit()
    session.refresh(task)

    if task.remind_at is not None:
        user = session.get(User, current_user_id)
        if user and user.google_connected:
            try:
                google_calendar.sync_task_event(
                    settings,
                    user,
                    task,
                    duration_minutes=duration,
                )
                session.commit()
                session.refresh(task)
            except Exception:  # noqa: BLE001 - calendar sync is always best-effort
                logger.warning("Could not sync calendar event for task %s", task.id, exc_info=True)

    return task


@router.patch("/tasks/{task_id}", response_model=TaskResponse)
def update_task(
    task_id: str,
    payload: UpdateTaskRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
    settings: AppSettings,
) -> OpenLoopAndGoal:
    task = _get_owned_task(session, task_id, current_user_id)
    fields_set = payload.model_fields_set

    if "target_count" in fields_set and payload.target_count is not None:
        task.target_count = max(1, payload.target_count)
    if "current_count" in fields_set and payload.current_count is not None:
        task.current_count = max(0, min(task.target_count, payload.current_count))
        if task.current_count >= task.target_count:
            task.status = GoalStatus.COMPLETED
        elif "status" not in fields_set or payload.status is None:
            task.status = GoalStatus.PENDING

    if "status" in fields_set and payload.status is not None:
        task.status = payload.status
        if payload.status == GoalStatus.COMPLETED:
            task.current_count = task.target_count
        elif payload.status == GoalStatus.PENDING and task.current_count >= task.target_count:
            task.current_count = max(0, task.target_count - 1)
        if payload.status != GoalStatus.COMPLETED:
            task.completed_by_entry_id = None
        if payload.status in (GoalStatus.COMPLETED, GoalStatus.ABANDONED):
            _clear_calendar(session, settings, current_user_id, task)

    schedule_changed = "remind_at" in fields_set or "snoozed_until" in fields_set
    if "remind_at" in fields_set:
        task.remind_at = payload.remind_at
    if "snoozed_until" in fields_set:
        task.snoozed_until = payload.snoozed_until
        task.snooze_seen = False

    if "section_id" in fields_set:
        task.section_id = _resolve_section_id(session, current_user_id, payload.section_id)

    if schedule_changed and task.status == GoalStatus.PENDING:
        _sync_or_clear_calendar(
            session,
            settings,
            current_user_id,
            task,
            duration_minutes=payload.duration_minutes,
        )

    session.commit()
    session.refresh(task)
    return task


@router.patch("/tasks/{task_id}/acknowledge-snooze", response_model=TaskResponse)
def acknowledge_task_snooze(
    task_id: str,
    payload: AcknowledgeSnoozeRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> OpenLoopAndGoal:
    task = _get_owned_task(session, task_id, current_user_id)
    task.snooze_seen = True
    session.commit()
    session.refresh(task)
    return task


@router.patch("/users/{user_id}/tasks/reorder", response_model=list[TaskResponse])
def reorder_tasks(
    user_id: str,
    payload: ReorderTasksRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> list[OpenLoopAndGoal]:
    ordered_ids = list(dict.fromkeys(payload.ordered_ids))
    tasks = session.scalars(
        select(OpenLoopAndGoal).where(
            OpenLoopAndGoal.user_id == current_user_id,
            OpenLoopAndGoal.kind == GoalKind.TASK,
            OpenLoopAndGoal.id.in_(ordered_ids),
        )
    )
    by_id = {task.id: task for task in tasks}
    for index, task_id in enumerate(ordered_ids):
        if task_id in by_id:
            by_id[task_id].sort_order = index + 1
    session.commit()
    return _list_tasks(session, current_user_id)


# ---------------------------------------------------------------------------
# Task sections (color-coded groupings, e.g. classes)
# ---------------------------------------------------------------------------


@router.get("/users/{user_id}/sections", response_model=list[SectionResponse])
def list_sections(
    user_id: str,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> list[TaskSection]:
    return _list_sections(session, current_user_id)


@router.post(
    "/users/{user_id}/sections",
    response_model=SectionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_section(
    user_id: str,
    payload: CreateSectionRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> TaskSection:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name must not be empty")

    next_sort_order = (
        session.scalar(
            select(func.max(TaskSection.sort_order)).where(
                TaskSection.user_id == current_user_id
            )
        )
        or 0
    ) + 1

    section = TaskSection(
        user_id=current_user_id,
        name=name,
        color=payload.color or "forest",
        sort_order=next_sort_order,
    )
    session.add(section)
    session.commit()
    session.refresh(section)
    return section


@router.patch("/sections/{section_id}", response_model=SectionResponse)
def update_section(
    section_id: str,
    payload: UpdateSectionRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> TaskSection:
    section = _get_owned_section(session, section_id, current_user_id)

    if "name" in payload.model_fields_set and payload.name is not None:
        clean_name = payload.name.strip()
        if not clean_name:
            raise HTTPException(status_code=422, detail="name must not be empty")
        section.name = clean_name
    if "color" in payload.model_fields_set and payload.color is not None:
        section.color = payload.color

    session.commit()
    session.refresh(section)
    return section


@router.delete("/sections/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_section(
    section_id: str,
    payload: UserScopedRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> Response:
    section = _get_owned_section(session, section_id, current_user_id)
    # Detach tasks from the section (they fall back to the unsectioned group).
    for task in session.scalars(
        select(OpenLoopAndGoal).where(
            OpenLoopAndGoal.user_id == current_user_id,
            OpenLoopAndGoal.kind == GoalKind.TASK,
            OpenLoopAndGoal.section_id == section_id,
        )
    ):
        task.section_id = None
    session.delete(section)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/users/{user_id}/sections/reorder", response_model=list[SectionResponse])
def reorder_sections(
    user_id: str,
    payload: ReorderSectionsRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> list[TaskSection]:
    ordered_ids = list(dict.fromkeys(payload.ordered_ids))
    sections = list(
        session.scalars(
            select(TaskSection).where(
                TaskSection.user_id == current_user_id,
                TaskSection.id.in_(ordered_ids),
            )
        )
    )
    by_id = {section.id: section for section in sections}
    for index, section_id in enumerate(ordered_ids):
        if section_id in by_id:
            by_id[section_id].sort_order = index + 1
    session.commit()
    return _list_sections(session, current_user_id)


# ---------------------------------------------------------------------------
# Daily plans (morning bookend)
# ---------------------------------------------------------------------------


def _get_daily_plan(
    session: Session, user_id: str, plan_date: date
) -> DailyPlan | None:
    return session.scalar(
        select(DailyPlan).where(
            DailyPlan.user_id == user_id,
            DailyPlan.date == plan_date,
        )
    )


@router.get(
    "/users/{user_id}/daily-plans/{plan_date}",
    response_model=DailyPlanResponse,
)
def get_daily_plan(
    user_id: str,
    plan_date: date,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> DailyPlan:
    plan = _get_daily_plan(session, current_user_id, plan_date)
    if plan is None:
        raise HTTPException(status_code=404, detail="Daily plan not found")
    return plan


@router.put(
    "/users/{user_id}/daily-plans/{plan_date}",
    response_model=DailyPlanResponse,
)
def upsert_daily_plan(
    user_id: str,
    plan_date: date,
    payload: UpsertDailyPlanRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> DailyPlan:
    if session.get(User, current_user_id) is None:
        raise HTTPException(status_code=404, detail="User not found")

    selected_ids = list(dict.fromkeys(payload.selected_task_ids))
    if selected_ids:
        owned = session.scalars(
            select(OpenLoopAndGoal.id).where(
                OpenLoopAndGoal.user_id == current_user_id,
                OpenLoopAndGoal.status != GoalStatus.ABANDONED,
                OpenLoopAndGoal.id.in_(selected_ids),
            )
        )
        owned_ids = set(owned)
        invalid = [task_id for task_id in selected_ids if task_id not in owned_ids]
        if invalid:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid or archived task IDs: {', '.join(invalid)}",
            )

    plan = _get_daily_plan(session, current_user_id, plan_date)
    if plan is None:
        plan = DailyPlan(
            user_id=current_user_id,
            date=plan_date,
            selected_task_ids=selected_ids,
        )
        session.add(plan)
    else:
        plan.selected_task_ids = selected_ids

    if payload.complete_morning and plan.morning_completed_at is None:
        plan.morning_completed_at = datetime.now(timezone.utc)

    session.commit()
    session.refresh(plan)
    return plan


# ---------------------------------------------------------------------------
# Weekly-planning goals
# ---------------------------------------------------------------------------


@router.get("/users/{user_id}/goals", response_model=list[GoalResponse])
def list_goals(
    user_id: str,
    current_user_id: CurrentUserId,
    session: DbSession,
    week_start_date: Annotated[date, Query()],
) -> list[OpenLoopAndGoal]:
    return list(
        session.scalars(
            select(OpenLoopAndGoal)
            .where(
                OpenLoopAndGoal.user_id == current_user_id,
                OpenLoopAndGoal.kind == GoalKind.GOAL,
                OpenLoopAndGoal.week_start_date == week_start_date,
                OpenLoopAndGoal.status != GoalStatus.ABANDONED,
            )
            .order_by(OpenLoopAndGoal.sort_order, OpenLoopAndGoal.created_at)
        )
    )


@router.post(
    "/users/{user_id}/goals",
    response_model=GoalResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_goal(
    user_id: str,
    payload: CreateGoalRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
    ai: AIClient,
    settings: AppSettings,
) -> OpenLoopAndGoal:
    clean_text = payload.goal_text.strip()
    if not clean_text:
        raise HTTPException(status_code=422, detail="goal_text must not be empty")

    parsed_title, remind_at, parsed_target_cnt, is_daily, duration = parse_natural_language_item(
        clean_text,
        base_date=payload.week_start_date,
        ai=ai,
        settings=settings,
        item_type="goal",
    )

    clean_text = parsed_title
    target_count = (
        payload.target_count
        if payload.target_count is not None and payload.target_count > 1
        else parsed_target_cnt
    )
    current_count = payload.current_count if payload.current_count is not None else 0

    next_sort_order = (
        session.scalar(
            select(func.max(OpenLoopAndGoal.sort_order)).where(
                OpenLoopAndGoal.user_id == current_user_id,
                OpenLoopAndGoal.kind == GoalKind.GOAL,
                OpenLoopAndGoal.week_start_date == payload.week_start_date,
            )
        )
        or 0
    ) + 1

    goal = OpenLoopAndGoal(
        user_id=current_user_id,
        goal_text=clean_text,
        status=GoalStatus.COMPLETED if current_count >= target_count else GoalStatus.PENDING,
        kind=GoalKind.GOAL,
        sort_order=next_sort_order,
        target_count=target_count,
        current_count=current_count,
        week_start_date=payload.week_start_date,
        remind_at=remind_at,
    )
    session.add(goal)
    session.commit()
    session.refresh(goal)

    if remind_at is not None:
        user = session.get(User, current_user_id)
        if user and user.google_connected:
            try:
                google_calendar.sync_task_event(
                    settings, user, goal, duration_minutes=duration, is_daily_recurring=is_daily
                )
                session.commit()
                session.refresh(goal)
            except Exception:
                logger.warning("Could not sync calendar event for goal %s", goal.id, exc_info=True)

    return goal


@router.patch("/goals/{goal_id}", response_model=GoalResponse)
def update_goal(
    goal_id: str,
    payload: UpdateGoalRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
    settings: AppSettings,
) -> OpenLoopAndGoal:
    goal = session.get(OpenLoopAndGoal, goal_id)
    if goal is None or goal.user_id != current_user_id or goal.kind != GoalKind.GOAL:
        raise HTTPException(status_code=404, detail="Goal not found")

    fields_set = payload.model_fields_set

    if "goal_text" in fields_set and payload.goal_text is not None:
        clean_goal_text = payload.goal_text.strip()
        if not clean_goal_text:
            raise HTTPException(status_code=422, detail="goal_text must not be empty")
        goal.goal_text = clean_goal_text

    if "target_count" in fields_set and payload.target_count is not None:
        goal.target_count = max(1, payload.target_count)
        # Keep the goal consistent when the target is edited (e.g. 4x -> 5x).
        if "current_count" not in fields_set:
            goal.current_count = max(0, min(goal.target_count, goal.current_count))
            if goal.current_count >= goal.target_count:
                goal.status = GoalStatus.COMPLETED
            elif goal.status == GoalStatus.COMPLETED:
                goal.status = GoalStatus.PENDING
    if "current_count" in fields_set and payload.current_count is not None:
        goal.current_count = max(0, min(goal.target_count, payload.current_count))
        if goal.current_count >= goal.target_count:
            goal.status = GoalStatus.COMPLETED
        elif "status" not in fields_set or payload.status is None:
            goal.status = GoalStatus.PENDING

    if "status" in fields_set and payload.status is not None:
        goal.status = payload.status
        if payload.status == GoalStatus.COMPLETED:
            goal.current_count = goal.target_count
        elif payload.status == GoalStatus.PENDING and goal.current_count >= goal.target_count:
            goal.current_count = max(0, goal.target_count - 1)
        if payload.status != GoalStatus.COMPLETED:
            goal.completed_by_entry_id = None
        if payload.status in (GoalStatus.COMPLETED, GoalStatus.ABANDONED):
            _clear_calendar(session, settings, current_user_id, goal)

    schedule_changed = "remind_at" in fields_set or "snoozed_until" in fields_set
    if "remind_at" in fields_set:
        goal.remind_at = payload.remind_at
    if "snoozed_until" in fields_set:
        goal.snoozed_until = payload.snoozed_until
        goal.snooze_seen = False

    if schedule_changed and goal.status == GoalStatus.PENDING:
        _sync_or_clear_calendar(
            session,
            settings,
            current_user_id,
            goal,
            duration_minutes=payload.duration_minutes,
        )

    session.commit()
    session.refresh(goal)
    return goal


@router.patch("/users/{user_id}/goals/reorder", response_model=list[GoalResponse])
def reorder_goals(
    user_id: str,
    payload: ReorderGoalsRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> list[OpenLoopAndGoal]:
    ordered_ids = list(dict.fromkeys(payload.ordered_ids))
    goals = list(
        session.scalars(
            select(OpenLoopAndGoal).where(
                OpenLoopAndGoal.user_id == current_user_id,
                OpenLoopAndGoal.kind == GoalKind.GOAL,
                OpenLoopAndGoal.id.in_(ordered_ids),
            )
        )
    )
    by_id = {goal.id: goal for goal in goals}
    for index, goal_id in enumerate(ordered_ids):
        if goal_id in by_id:
            by_id[goal_id].sort_order = index + 1
    session.commit()

    week_date = payload.week_start_date or (
        goals[0].week_start_date if goals else None
    )
    if week_date:
        return list(
            session.scalars(
                select(OpenLoopAndGoal)
                .where(
                    OpenLoopAndGoal.user_id == current_user_id,
                    OpenLoopAndGoal.kind == GoalKind.GOAL,
                    OpenLoopAndGoal.week_start_date == week_date,
                    OpenLoopAndGoal.status != GoalStatus.ABANDONED,
                )
                .order_by(OpenLoopAndGoal.sort_order, OpenLoopAndGoal.created_at)
            )
        )
    return list(by_id.values())


# ---------------------------------------------------------------------------
# Weekly planning sessions (the "Start" gate)
# ---------------------------------------------------------------------------


@router.get(
    "/users/{user_id}/weekly-planning/sessions/{week_start_date}",
    response_model=WeeklyPlanningSessionResponse,
)
def get_weekly_planning_session(
    user_id: str,
    week_start_date: date,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> WeeklyPlanningSession:
    weekly_session = session.scalar(
        select(WeeklyPlanningSession).where(
            WeeklyPlanningSession.user_id == current_user_id,
            WeeklyPlanningSession.week_start_date == week_start_date,
        )
    )
    if weekly_session is None:
        raise HTTPException(status_code=404, detail="Weekly planning has not started")
    return weekly_session


@router.post(
    "/users/{user_id}/weekly-planning/sessions",
    response_model=WeeklyPlanningSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
def start_weekly_planning(
    user_id: str,
    payload: StartWeeklyPlanningRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
    ai: AIClient,
) -> WeeklyPlanningSession:
    existing = session.scalar(
        select(WeeklyPlanningSession).where(
            WeeklyPlanningSession.user_id == current_user_id,
            WeeklyPlanningSession.week_start_date == payload.week_start_date,
        )
    )
    if existing is not None:
        if existing.completed_at is not None:
            existing.completed_at = None
            session.commit()
            session.refresh(existing)
        if existing.reflection_data is None:
            try:
                existing = WeeklyReflectionService(session=session, ai=ai).generate(
                    user_id=current_user_id,
                    week_start_date=payload.week_start_date,
                )
            except Exception as exc:
                logger.warning("Could not auto-generate reflection on start: %s", exc)
        return existing

    try:
        return WeeklyReflectionService(session=session, ai=ai).generate(
            user_id=current_user_id,
            week_start_date=payload.week_start_date,
        )
    except Exception as exc:
        logger.warning("Could not auto-generate reflection on create session: %s", exc)
        weekly_session = WeeklyPlanningSession(
            user_id=current_user_id, week_start_date=payload.week_start_date
        )
        session.add(weekly_session)
        session.commit()
        session.refresh(weekly_session)
        return weekly_session


@router.post(
    "/users/{user_id}/weekly-planning/sessions/{week_start_date}/reflection",
    response_model=WeeklyPlanningSessionResponse,
)
def generate_weekly_reflection_route(
    user_id: str,
    week_start_date: date,
    current_user_id: CurrentUserId,
    session: DbSession,
    ai: AIClient,
) -> WeeklyPlanningSession:
    try:
        return WeeklyReflectionService(session=session, ai=ai).generate(
            user_id=current_user_id,
            week_start_date=week_start_date,
        )
    except Exception as exc:
        logger.warning("Weekly reflection generation error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate weekly reflection.") from exc


@router.post(
    "/users/{user_id}/weekly-planning/sessions/{week_start_date}/finish",
    response_model=WeeklyPlanningSessionResponse,
)
def finish_weekly_planning(
    user_id: str,
    week_start_date: date,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> WeeklyPlanningSession:
    weekly_session = session.scalar(
        select(WeeklyPlanningSession).where(
            WeeklyPlanningSession.user_id == current_user_id,
            WeeklyPlanningSession.week_start_date == week_start_date,
        )
    )
    if weekly_session is None:
        raise HTTPException(status_code=404, detail="Weekly planning has not started")
    weekly_session.completed_at = datetime.now(timezone.utc)
    session.commit()
    session.refresh(weekly_session)
    return weekly_session


# ---------------------------------------------------------------------------
# Google Calendar connection
# ---------------------------------------------------------------------------


@router.get("/auth/google/authorize", response_model=GoogleAuthorizeResponse)
def google_authorize(
    user_id: str,
    current_user_id: CurrentUserId,
    session: DbSession,
    settings: AppSettings,
) -> GoogleAuthorizeResponse:
    try:
        authorization_url = google_calendar.build_authorization_url(settings, state=current_user_id)
    except google_calendar.GoogleCalendarNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return GoogleAuthorizeResponse(authorization_url=authorization_url)


def _make_auth_redirect(redirect_base: str, param_name: str, param_val: str) -> RedirectResponse:
    parsed = urlparse(redirect_base)
    qs = parse_qs(parsed.query)
    qs[param_name] = [param_val]
    if param_name == "google":
        qs.pop("google_error", None)
    elif param_name == "google_error":
        qs.pop("google", None)
    new_query = urlencode(qs, doseq=True)
    new_url = urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, parsed.fragment))
    return RedirectResponse(new_url)


@router.get("/auth/google/callback", include_in_schema=False)
def google_callback(
    code: str,
    state: str,
    session: DbSession,
    settings: AppSettings,
) -> RedirectResponse:
    redirect_base = settings.google_post_auth_redirect
    try:
        bind_user_rls(session, state)
        user = session.get(User, state)
        if user is None:
            logger.warning("Google OAuth callback: User %s not found", state)
            return _make_auth_redirect(redirect_base, "google_error", "user_not_found")

        try:
            tokens = google_calendar.exchange_code_for_tokens(settings, code=code)
        except Exception:  # noqa: BLE001 - surface as a redirect, not a 500 page
            logger.warning("Google OAuth token exchange failed", exc_info=True)
            return _make_auth_redirect(redirect_base, "google_error", "exchange_failed")

        user.google_access_token = tokens.access_token
        if tokens.refresh_token:
            user.google_refresh_token = tokens.refresh_token
        if tokens.expiry:
            expiry = (
                tokens.expiry
                if tokens.expiry.tzinfo
                else tokens.expiry.replace(tzinfo=timezone.utc)
            )
            user.google_token_expiry = expiry
        if tokens.email:
            user.google_email = tokens.email

        if not user.google_connected:
            logger.warning("Google OAuth callback: Missing refresh token and user not connected")
            try:
                session.commit()
            except Exception:
                session.rollback()
            return _make_auth_redirect(redirect_base, "google_error", "no_refresh_token")

        session.commit()

        _sync_pending_tasks_after_connect(session, settings, user)
        return _make_auth_redirect(redirect_base, "google", "connected")

    except Exception:
        logger.exception("Unexpected error during Google OAuth callback")
        return _make_auth_redirect(redirect_base, "google_error", "server_error")


def _sync_pending_tasks_after_connect(session: Session, settings: Settings, user: User) -> None:
    """Backfill calendar events for tasks/goals scheduled before Google was connected."""

    try:
        items = session.scalars(
            select(OpenLoopAndGoal).where(
                OpenLoopAndGoal.user_id == user.id,
                OpenLoopAndGoal.status == GoalStatus.PENDING,
                OpenLoopAndGoal.remind_at.is_not(None),
                OpenLoopAndGoal.calendar_event_id.is_(None),
            )
        )
        for item in items:
            try:
                google_calendar.sync_task_event(settings, user, item)
            except Exception:  # noqa: BLE001
                logger.warning("Could not backfill calendar event for item %s", item.id, exc_info=True)
        session.commit()
    except Exception:  # noqa: BLE001
        logger.warning("Could not complete task backfill after Google connect", exc_info=True)


@router.get("/users/{user_id}/google/status", response_model=GoogleStatusResponse)
def google_status(
    user_id: str,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> GoogleStatusResponse:
    user = session.get(User, current_user_id)
    if user is None:
        return GoogleStatusResponse(connected=False, email=None)
    return GoogleStatusResponse(connected=user.google_connected, email=user.google_email)


@router.post("/users/{user_id}/google/disconnect", response_model=GoogleStatusResponse)
def google_disconnect(
    user_id: str,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> GoogleStatusResponse:
    user = session.get(User, current_user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    google_calendar.disconnect_user(user)
    # Drop stale Google event IDs so a later reconnect can backfill fresh events.
    for item in session.scalars(
        select(OpenLoopAndGoal).where(
            OpenLoopAndGoal.user_id == current_user_id,
            OpenLoopAndGoal.calendar_event_id.is_not(None),
        )
    ):
        item.calendar_event_id = None
    session.commit()
    return GoogleStatusResponse(connected=False, email=None)


@router.post(
    "/users/{user_id}/calendar/add-natural-language",
    response_model=AddToCalendarResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_to_calendar_natural_language(
    user_id: str,
    payload: AddToCalendarRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
    ai: AIClient,
    settings: AppSettings,
) -> AddToCalendarResponse:
    """Turn plain-English scheduling into Google Calendar events only.

    Adding to the calendar never creates a task in the "What I'm Working On"
    list: the parsed reminders go straight to Google Calendar and nowhere else.
    """
    user = session.get(User, current_user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    prompt_text = payload.prompt.strip()
    if not prompt_text:
        raise HTTPException(status_code=422, detail="prompt must not be empty")

    if not user.google_connected:
        raise HTTPException(
            status_code=400,
            detail="Connect Google Calendar first — adding to the calendar creates events there.",
        )

    items, summary_message = parse_natural_language_calendar_batch(
        prompt_text,
        base_date=date.today(),
        ai=ai,
        settings=settings,
    )

    if not items:
        raise HTTPException(
            status_code=422,
            detail="Could not extract any scheduled calendar reminders from that text.",
        )

    created = google_calendar.insert_calendar_events(settings, user, items)
    if created == 0:
        raise HTTPException(
            status_code=502,
            detail=(
                "Could not add reminders to Google Calendar. "
                "Reconnect Google Calendar in Settings and try again."
            ),
        )

    return AddToCalendarResponse(
        summary_message=summary_message,
        created_count=created,
        google_connected=True,
    )


# ---------------------------------------------------------------------------
# Percy reminders (unscheduled)
# ---------------------------------------------------------------------------


@router.get(
    "/users/{user_id}/percy-reminders",
    response_model=list[PercyReminderResponse],
)
def list_percy_reminders(
    user_id: str,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> list[PercyReminder]:
    return list(
        session.scalars(
            select(PercyReminder)
            .where(PercyReminder.user_id == current_user_id, PercyReminder.is_dismissed.is_(False))
            .order_by(PercyReminder.created_at)
        )
    )


@router.post(
    "/users/{user_id}/percy-reminders",
    response_model=PercyReminderResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_percy_reminder(
    user_id: str,
    payload: CreatePercyReminderRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> PercyReminder:
    clean = payload.reminder_text.strip()
    if not clean:
        raise HTTPException(status_code=422, detail="reminder_text must not be empty")
    reminder = PercyReminder(
        user_id=current_user_id,
        reminder_text=clean,
        is_dismissed=False,
    )
    session.add(reminder)
    session.commit()
    session.refresh(reminder)
    return reminder


@router.patch(
    "/percy-reminders/{reminder_id}/dismiss",
    response_model=PercyReminderResponse,
)
def dismiss_percy_reminder(
    reminder_id: str,
    payload: UserScopedRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> PercyReminder:
    reminder = session.get(PercyReminder, reminder_id)
    if reminder is None or reminder.user_id != current_user_id:
        raise HTTPException(status_code=404, detail="Reminder not found")
    reminder.is_dismissed = True
    session.commit()
    session.refresh(reminder)
    return reminder


@router.delete(
    "/percy-reminders/{reminder_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_percy_reminder_route(
    reminder_id: str,
    payload: UserScopedRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> Response:
    reminder = session.get(PercyReminder, reminder_id)
    if reminder is None or reminder.user_id != current_user_id:
        raise HTTPException(status_code=404, detail="Reminder not found")
    session.delete(reminder)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Life insights
# ---------------------------------------------------------------------------


@router.get(
    "/users/{user_id}/life-insights",
    response_model=list[LifeInsightResponse],
)
def list_life_insights(
    user_id: str,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> list[LifeInsight]:
    return list(
        session.scalars(
            select(LifeInsight)
            .where(LifeInsight.user_id == current_user_id, LifeInsight.is_dismissed.is_(False))
            .order_by(LifeInsight.created_at.desc())
        )
    )


@router.patch(
    "/life-insights/{insight_id}/read",
    response_model=LifeInsightResponse,
)
def mark_life_insight_read(
    insight_id: str,
    payload: UserScopedRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> LifeInsight:
    insight = session.get(LifeInsight, insight_id)
    if insight is None or insight.user_id != current_user_id:
        raise HTTPException(status_code=404, detail="Insight not found")
    insight.is_read = True
    session.commit()
    session.refresh(insight)
    return insight


@router.patch(
    "/life-insights/{insight_id}/dismiss",
    response_model=LifeInsightResponse,
)
def dismiss_life_insight(
    insight_id: str,
    payload: UserScopedRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> LifeInsight:
    insight = session.get(LifeInsight, insight_id)
    if insight is None or insight.user_id != current_user_id:
        raise HTTPException(status_code=404, detail="Insight not found")
    insight.is_read = True
    insight.is_dismissed = True
    session.commit()
    session.refresh(insight)
    return insight


# ---------------------------------------------------------------------------
# Saved Percy advice
# ---------------------------------------------------------------------------


@router.get(
    "/users/{user_id}/saved-percy-advice",
    response_model=list[SavedPercyAdviceResponse],
)
def list_saved_percy_advice(
    user_id: str,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> list[SavedPercyAdvice]:
    return list(
        session.scalars(
            select(SavedPercyAdvice)
            .where(SavedPercyAdvice.user_id == current_user_id)
            .order_by(SavedPercyAdvice.created_at.desc())
        )
    )


@router.post(
    "/users/{user_id}/saved-percy-advice",
    response_model=SavedPercyAdviceResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_saved_percy_advice(
    user_id: str,
    payload: CreateSavedPercyAdviceRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> SavedPercyAdvice:
    clean = payload.advice_text.strip()
    if not clean:
        raise HTTPException(status_code=422, detail="advice_text must not be empty")
    context = payload.context_question.strip() if payload.context_question else None
    advice = SavedPercyAdvice(
        user_id=current_user_id,
        advice_text=clean,
        context_question=context,
    )
    session.add(advice)
    session.commit()
    session.refresh(advice)
    return advice


@router.delete(
    "/saved-percy-advice/{advice_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_saved_percy_advice(
    advice_id: str,
    payload: UserScopedRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> Response:
    advice = session.get(SavedPercyAdvice, advice_id)
    if advice is None or advice.user_id != current_user_id:
        raise HTTPException(status_code=404, detail="Saved advice not found")
    session.delete(advice)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/users/{user_id}/percy/chat", response_model=PercyChatResponse)
def percy_chat_route(
    user_id: str,
    payload: PercyChatRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
    ai: AIClient,
) -> PercyChatResponse:
    try:
        reply = chat_with_percy(
            session=session,
            ai=ai,
            user_id=current_user_id,
            message=payload.message,
            history=payload.history,
            insight_id=payload.insight_id,
            insight_text=payload.insight_text,
            thread_question=payload.thread_question,
        )
        return PercyChatResponse(reply=reply)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("Percy chat error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to communicate with Percy.") from exc


@router.post(
    "/users/{user_id}/percy/create-goal",
    response_model=PercyCreateGoalResponse,
    status_code=status.HTTP_201_CREATED,
)
def percy_create_goal_route(
    user_id: str,
    payload: PercyCreateGoalRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
    ai: AIClient,
    settings: AppSettings,
) -> PercyCreateGoalResponse:
    try:
        goal, reply = create_goal_with_percy(
            session=session,
            ai=ai,
            settings=settings,
            user_id=current_user_id,
            user_query=payload.user_query,
            week_start_date=payload.week_start_date,
        )
        return PercyCreateGoalResponse(
            goal=GoalResponse.model_validate(goal),
            reply=reply,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("Percy goal creation error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create goal with Percy.") from exc


# ---------------------------------------------------------------------------
# Spelling corrections
# ---------------------------------------------------------------------------


@router.get(
    "/users/{user_id}/spelling-corrections",
    response_model=list[SpellingCorrectionResponse],
)
def list_spelling_corrections(
    user_id: str,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> list[SpellingCorrection]:
    return get_user_spelling_corrections(session, current_user_id)


@router.post(
    "/users/{user_id}/spelling-corrections",
    response_model=SpellingCorrectionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_spelling_correction(
    user_id: str,
    payload: CreateSpellingCorrectionRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> SpellingCorrection:
    correction = save_spelling_correction(
        session, current_user_id, payload.incorrect_word, payload.correct_word
    )
    if correction is None:
        raise HTTPException(
            status_code=422,
            detail="incorrect_word and correct_word must be different non-empty words",
        )
    session.commit()
    session.refresh(correction)
    return correction


@router.delete(
    "/spelling-corrections/{correction_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_spelling_correction_route(
    correction_id: str,
    payload: UserScopedRequest,
    current_user_id: CurrentUserId,
    session: DbSession,
) -> Response:
    success = delete_spelling_correction(session, current_user_id, correction_id)
    if not success:
        raise HTTPException(status_code=404, detail="Spelling correction not found")
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
