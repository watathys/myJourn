"""Portable SQLAlchemy models for SQLite locally and Postgres in production."""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from typing import Optional

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def new_id() -> str:
    return str(uuid.uuid4())


class GoalStatus(str, enum.Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    ABANDONED = "abandoned"


goal_status_type = Enum(
    GoalStatus,
    values_callable=lambda members: [member.value for member in members],
    native_enum=False,
    create_constraint=True,
    name="goal_status",
)


class GoalKind(str, enum.Enum):
    """Distinguishes "What I'm Working On" tasks from weekly-planning goals.

    TASK: an open loop/commitment surfaced from journaling or Percy, shown under
    "What I'm Working On" and reorderable/schedulable by the user.
    GOAL: an intention set for a specific week during weekly planning (or from the
    journal/Percy), reviewed the following week regardless of completion.
    """

    TASK = "task"
    GOAL = "goal"


goal_kind_type = Enum(
    GoalKind,
    values_callable=lambda members: [member.value for member in members],
    native_enum=False,
    create_constraint=True,
    name="goal_kind",
)


class QuestionDimension(str, enum.Enum):
    PHYSICAL = "physical"
    MENTAL = "mental"
    SOCIAL = "social"
    SPIRITUAL = "spiritual"


question_dimension_type = Enum(
    QuestionDimension,
    values_callable=lambda members: [member.value for member in members],
    native_enum=False,
    create_constraint=True,
    name="question_dimension",
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    google_email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)
    google_access_token: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    google_refresh_token: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    google_token_expiry: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    mission_statement: Mapped[Optional[MissionStatement]] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )
    journal_entries: Mapped[list[JournalEntry]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    goals: Mapped[list[OpenLoopAndGoal]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    follow_up_questions: Mapped[list[FollowUpQuestion]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    percy_reminders: Mapped[list[PercyReminder]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    life_insights: Mapped[list[LifeInsight]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    weekly_planning_sessions: Mapped[list[WeeklyPlanningSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    spelling_corrections: Mapped[list[SpellingCorrection]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def google_connected(self) -> bool:
        return bool(self.google_refresh_token)


class MissionStatement(Base):
    __tablename__ = "mission_statements"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    statement_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user: Mapped[User] = relationship(back_populates="mission_statement")


class JournalEntry(Base):
    __tablename__ = "journal_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    raw_transcript: Mapped[str] = mapped_column(Text, nullable=False)
    formatted_narrative: Mapped[str] = mapped_column(Text, nullable=False)
    alignment_summary: Mapped[str] = mapped_column(Text, nullable=False)
    context_summary: Mapped[str] = mapped_column(Text, nullable=False)
    praise_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    follow_up_questions: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    embedding: Mapped[Optional[list[float]]] = mapped_column(Vector(1536), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="journal_entries")
    goals: Mapped[list[OpenLoopAndGoal]] = relationship(
        back_populates="journal_entry",
        cascade="all, delete-orphan",
        foreign_keys="OpenLoopAndGoal.journal_entry_id",
    )
    completed_goals: Mapped[list[OpenLoopAndGoal]] = relationship(
        back_populates="completed_by_entry",
        foreign_keys="OpenLoopAndGoal.completed_by_entry_id",
    )
    canonical_follow_up_questions: Mapped[list[FollowUpQuestion]] = relationship(
        back_populates="journal_entry", cascade="all, delete-orphan"
    )


class FollowUpQuestion(Base):
    __tablename__ = "follow_up_questions"
    __table_args__ = (
        Index("ix_follow_up_questions_user_asked", "user_id", "asked_at"),
        Index("ix_follow_up_questions_user_answered", "user_id", "answered"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    journal_entry_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("journal_entries.id", ondelete="CASCADE"),
        nullable=False,
    )
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    dimension: Mapped[QuestionDimension] = mapped_column(
        question_dimension_type, nullable=False
    )
    asked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    answered: Mapped[bool] = mapped_column(
        Boolean, server_default="0", default=False, nullable=False
    )

    user: Mapped[User] = relationship(back_populates="follow_up_questions")
    journal_entry: Mapped[JournalEntry] = relationship(
        back_populates="canonical_follow_up_questions"
    )


class OpenLoopAndGoal(Base):
    """A "What I'm Working On" task or a weekly-planning goal (see GoalKind)."""

    __tablename__ = "open_loops_and_goals"
    __table_args__ = (
        Index("ix_goals_user_status_created", "user_id", "status", "created_at"),
        Index("ix_goals_user_kind_week", "user_id", "kind", "week_start_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    journal_entry_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("journal_entries.id", ondelete="CASCADE"),
        nullable=True,
    )
    completed_by_entry_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("journal_entries.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    goal_text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[GoalStatus] = mapped_column(
        goal_status_type, default=GoalStatus.PENDING, nullable=False
    )
    kind: Mapped[GoalKind] = mapped_column(
        goal_kind_type, default=GoalKind.TASK, nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    target_count: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )
    current_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    week_start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    remind_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    snoozed_until: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    snooze_seen: Mapped[bool] = mapped_column(
        Boolean, server_default="1", default=True, nullable=False
    )
    calendar_event_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="goals")
    journal_entry: Mapped[Optional[JournalEntry]] = relationship(
        back_populates="goals", foreign_keys=[journal_entry_id]
    )
    completed_by_entry: Mapped[Optional[JournalEntry]] = relationship(
        back_populates="completed_goals", foreign_keys=[completed_by_entry_id]
    )

    @property
    def is_snoozed(self) -> bool:
        return self.snoozed_until is not None and self.snoozed_until > date.today()

    @property
    def just_resurfaced(self) -> bool:
        return (
            self.snoozed_until is not None
            and self.snoozed_until <= date.today()
            and not self.snooze_seen
        )

    @property
    def has_calendar_reminder(self) -> bool:
        return bool(self.calendar_event_id)


class PercyReminder(Base):
    """A note the user addressed to their AI ('Percy') to surface during weekly planning."""

    __tablename__ = "percy_reminders"
    __table_args__ = (
        Index("ix_percy_reminders_user_dismissed", "user_id", "is_dismissed"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    journal_entry_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("journal_entries.id", ondelete="SET NULL"),
        nullable=True,
    )
    reminder_text: Mapped[str] = mapped_column(Text, nullable=False)
    is_dismissed: Mapped[bool] = mapped_column(
        Boolean, server_default="0", default=False, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="percy_reminders")


class LifeInsight(Base):
    """An AI-noticed trend or suggestion surfaced on the North Star page."""

    __tablename__ = "life_insights"
    __table_args__ = (Index("ix_life_insights_user_read", "user_id", "is_read"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    journal_entry_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("journal_entries.id", ondelete="SET NULL"),
        nullable=True,
    )
    insight_text: Mapped[str] = mapped_column(Text, nullable=False)
    is_read: Mapped[bool] = mapped_column(
        Boolean, server_default="0", default=False, nullable=False
    )
    is_dismissed: Mapped[bool] = mapped_column(
        Boolean, server_default="0", default=False, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="life_insights")


class WeeklyPlanningSession(Base):
    """Marks that the user has pressed "Start" on weekly planning for a given week."""

    __tablename__ = "weekly_planning_sessions"
    __table_args__ = (
        UniqueConstraint("user_id", "week_start_date", name="uq_weekly_session_user_week"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    week_start_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user: Mapped[User] = relationship(back_populates="weekly_planning_sessions")


class SpellingCorrection(Base):
    """Learned spelling correction (e.g. speech-to-text typo -> correct spelling)."""

    __tablename__ = "spelling_corrections"
    __table_args__ = (
        UniqueConstraint("user_id", "incorrect_word", name="uq_spelling_correction_user_word"),
        Index("ix_spelling_corrections_user", "user_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    incorrect_word: Mapped[str] = mapped_column(String(255), nullable=False)
    correct_word: Mapped[str] = mapped_column(String(255), nullable=False)
    correction_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user: Mapped[User] = relationship(back_populates="spelling_corrections")

