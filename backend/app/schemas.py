"""HTTP request and response schemas."""

from __future__ import annotations

from datetime import date, datetime
from datetime import date as _date
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import GoalKind, GoalStatus


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime


class MissionStatementUpdate(BaseModel):
    statement_text: Optional[str] = None


class MissionStatementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    statement_text: Optional[str]
    updated_at: Optional[datetime] = None


class SpellingCorrectionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    incorrect_word: str
    correct_word: str
    correction_count: int
    created_at: datetime
    updated_at: datetime


class CreateSpellingCorrectionRequest(BaseModel):
    incorrect_word: str = Field(min_length=1)
    correct_word: str = Field(min_length=1)


class ProcessJournalRequest(BaseModel):
    user_id: str
    date: date
    raw_transcript: str = Field(min_length=1)
    is_import: bool = False
    verbatim: bool = True
    append_to_entry_id: Optional[str] = None


class UpdateJournalEntryRequest(BaseModel):
    user_id: str
    formatted_narrative: Optional[str] = None
    date: Optional[_date] = None

    @model_validator(mode="after")
    def _require_a_field_to_update(self) -> UpdateJournalEntryRequest:
        if self.formatted_narrative is None and self.date is None:
            raise ValueError("Provide formatted_narrative or date to update.")
        return self


class TaskResponse(BaseModel):
    """A "What I'm Working On" item."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    goal_text: str
    status: GoalStatus
    sort_order: int
    target_count: int = 1
    current_count: int = 0
    remind_at: Optional[datetime]
    snoozed_until: Optional[date]
    is_snoozed: bool
    just_resurfaced: bool
    has_calendar_reminder: bool


class CreateTaskRequest(BaseModel):
    goal_text: str = Field(min_length=1)
    remind_at: Optional[datetime] = None
    snoozed_until: Optional[date] = None


class UpdateTaskRequest(BaseModel):
    user_id: str
    status: Optional[GoalStatus] = None
    target_count: Optional[int] = None
    current_count: Optional[int] = None
    remind_at: Optional[datetime] = None
    snoozed_until: Optional[date] = None


class ReorderTasksRequest(BaseModel):
    user_id: str
    ordered_ids: list[str] = Field(min_length=1)


class AcknowledgeSnoozeRequest(BaseModel):
    user_id: str


class GoalResponse(BaseModel):
    """A weekly-planning goal."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    goal_text: str
    status: GoalStatus
    sort_order: int = 0
    target_count: int = 1
    current_count: int = 0
    week_start_date: Optional[date] = None
    remind_at: Optional[datetime] = None
    snoozed_until: Optional[date] = None
    is_snoozed: bool = False
    just_resurfaced: bool = False
    has_calendar_reminder: bool = False


class CreateGoalRequest(BaseModel):
    goal_text: str = Field(min_length=1)
    week_start_date: date
    target_count: Optional[int] = Field(default=1, ge=1)
    current_count: Optional[int] = Field(default=0, ge=0)


class UpdateGoalRequest(BaseModel):
    user_id: str
    status: Optional[GoalStatus] = None
    target_count: Optional[int] = None
    current_count: Optional[int] = None
    remind_at: Optional[datetime] = None
    snoozed_until: Optional[date] = None


class ReorderGoalsRequest(BaseModel):
    user_id: str
    ordered_ids: list[str] = Field(min_length=1)
    week_start_date: Optional[date] = None


class PercyCreateGoalRequest(BaseModel):
    user_query: str = Field(min_length=1)
    week_start_date: date


class PercyCreateGoalResponse(BaseModel):
    goal: GoalResponse
    reply: str


class UserScopedRequest(BaseModel):
    user_id: str


class WeeklyReflectionSchema(BaseModel):
    summary_narrative: str
    what_went_well: list[str]
    what_was_hard: list[str]
    patterns_worth_noticing: list[str] = Field(default_factory=list)
    suggested_focuses: list[str]


class WeeklyPlanningSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    week_start_date: date
    started_at: datetime
    completed_at: Optional[datetime] = None
    reflection_data: Optional[WeeklyReflectionSchema] = None
    reflection_start_date: Optional[date] = None
    reflection_end_date: Optional[date] = None
    reflection_generated_at: Optional[datetime] = None


class StartWeeklyPlanningRequest(BaseModel):
    week_start_date: date


class CreatePercyReminderRequest(BaseModel):
    reminder_text: str = Field(min_length=1)


class GoogleStatusResponse(BaseModel):
    connected: bool
    email: Optional[str] = None


class GoogleAuthorizeResponse(BaseModel):
    authorization_url: str


class PercyReminderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    reminder_text: str
    is_dismissed: bool
    created_at: datetime


class PercyChatMessage(BaseModel):
    role: str
    content: str


class PercyChatRequest(BaseModel):
    message: str = Field(min_length=1)
    history: list[PercyChatMessage] = Field(default_factory=list)
    insight_id: Optional[str] = None
    insight_text: Optional[str] = None


class PercyChatResponse(BaseModel):
    reply: str


class LifeInsightResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    insight_text: str
    is_read: bool
    is_dismissed: bool
    created_at: datetime


class CreateSavedPercyAdviceRequest(BaseModel):
    advice_text: str = Field(min_length=1)
    context_question: Optional[str] = None


class SavedPercyAdviceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    advice_text: str
    context_question: Optional[str] = None
    created_at: datetime


class JournalEntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    date: date
    raw_transcript: str
    formatted_narrative: str
    alignment_summary: str
    context_summary: str
    praise_message: Optional[str]
    follow_up_questions: list[str]
    created_at: datetime
    goals: list[TaskResponse]
    completed_goals: list[TaskResponse]

    @field_validator("goals", "completed_goals", mode="before")
    @classmethod
    def _tasks_only(cls, goals: object) -> object:
        return [
            goal
            for goal in goals
            if goal.status != GoalStatus.ABANDONED and goal.kind == GoalKind.TASK
        ]


class DailyPlanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    date: date
    selected_task_ids: list[str]
    morning_completed_at: Optional[datetime] = None
    created_at: datetime


class UpsertDailyPlanRequest(BaseModel):
    user_id: str
    selected_task_ids: list[str] = Field(default_factory=list)
    complete_morning: bool = True


class ProcessJournalResponse(BaseModel):
    journal_entry_id: str
    date: date
    raw_transcript: str
    formatted_narrative: str
    alignment_summary: str
    context_summary: str
    praise_message: Optional[str]
    completed_goals: list[TaskResponse]
    new_goals: list[TaskResponse]
    new_weekly_goals: list[GoalResponse]
    follow_up_questions: list[str]
    display_text: str
    percy_reminders: list[str]
    life_insights: list[str]
