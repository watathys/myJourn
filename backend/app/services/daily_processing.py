"""Orchestrate one daily journal pass across context, AI, and persistence."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai.client import JournalAI
from app.ai.prompts import (
    PromptDimensionCoverage,
    PromptFollowUpQuestion,
    PromptGoal,
    PromptSummary,
    build_system_prompt,
    build_user_prompt,
)
from app.ai.schemas import GeneratedFollowUpQuestion
from app.config import Settings, get_settings
from app.models import (
    FollowUpQuestion,
    GoalKind,
    GoalStatus,
    JournalEntry,
    LifeInsight,
    MissionStatement,
    OpenLoopAndGoal,
    PercyReminder,
    QuestionDimension,
    User,
)
from app.services import google_calendar
from app.services.goal_helpers import parse_target_count_from_text
from app.services.retrieval import retrieve_similar_entries
from app.services.schedule_parsing import parse_schedule_phrase
from app.services.spelling import apply_spelling_corrections, get_user_spelling_corrections

logger = logging.getLogger(__name__)

INSIGHT_COOLDOWN_DAYS = 7


def week_start_of(entry_date: date) -> date:
    """The Monday of the week containing ``entry_date``."""

    return entry_date - timedelta(days=entry_date.weekday())


@dataclass(frozen=True)
class DailyProcessingResult:
    journal_entry: JournalEntry
    praise_message: Optional[str]
    completed_goals: tuple[OpenLoopAndGoal, ...]
    new_goals: tuple[OpenLoopAndGoal, ...]
    follow_up_questions: tuple[str, ...]
    percy_reminders: tuple[str, ...]
    life_insights: tuple[str, ...]
    new_weekly_goals: tuple[OpenLoopAndGoal, ...] = field(default_factory=tuple)

    @property
    def display_text(self) -> str:
        """Render praise first while keeping persisted fields separately addressable."""

        parts = []
        if self.praise_message:
            parts.append(self.praise_message)
        parts.extend(
            [
                self.journal_entry.formatted_narrative,
                self.journal_entry.alignment_summary,
                "Questions for tomorrow:\n"
                + "\n".join(f"- {question}" for question in self.follow_up_questions),
            ]
        )
        return "\n\n".join(parts)


class DailyProcessingService:
    def __init__(
        self, *, session: Session, ai: JournalAI, settings: Optional[Settings] = None
    ) -> None:
        self._session = session
        self._ai = ai
        self._settings = settings or get_settings()

    def process(
        self,
        *,
        user_id: str,
        entry_date: date,
        raw_transcript: str,
        is_import: bool = False,
        verbatim: bool = False,
        append_to_entry_id: Optional[str] = None,
    ) -> DailyProcessingResult:
        """Process and atomically save a dump without altering its raw text."""

        if not raw_transcript.strip():
            raise ValueError("raw_transcript must contain non-whitespace text")
        if self._session.get(User, user_id) is None:
            raise LookupError(f"user {user_id!r} does not exist")

        user_corrections = get_user_spelling_corrections(self._session, user_id)
        if user_corrections:
            correction_pairs = [(c.incorrect_word, c.correct_word) for c in user_corrections]
            raw_transcript = apply_spelling_corrections(raw_transcript, correction_pairs)

        existing_entry = None
        if append_to_entry_id is not None:
            existing_entry = self._session.get(JournalEntry, append_to_entry_id)
            if existing_entry is None or existing_entry.user_id != user_id:
                raise LookupError("journal entry does not exist")
            if existing_entry.date != entry_date:
                raise ValueError("appended text must use the journal entry's date")
            if is_import:
                raise ValueError("imported entries cannot append to an existing entry")
        if is_import and verbatim:
            raise ValueError("verbatim cannot be combined with import")

        mission = self._session.scalar(
            select(MissionStatement.statement_text).where(MissionStatement.user_id == user_id)
        )
        pending_goals = self._recent_pending_goals(user_id, entry_date)
        prompt_goals = [PromptGoal(id=goal.id, text=goal.goal_text) for goal in pending_goals]
        prompt_summaries = [
            PromptSummary(entry_date=summary_date.isoformat(), text=summary)
            for summary_date, summary in self._recent_summaries(user_id, entry_date)
        ]
        retrieved_entries = (
            retrieve_similar_entries(
                session=self._session,
                ai=self._ai,
                user_id=user_id,
                query=raw_transcript,
                top_n=5,
                similarity_threshold=0.25,
            )
            if hasattr(self._ai, "generate_embedding")
            else []
        )
        recent_summary_dates = {s.entry_date for s in prompt_summaries}
        relevant_past_summaries = [
            PromptSummary(
                entry_date=item.entry.date.isoformat(), text=item.entry.context_summary
            )
            for item in retrieved_entries
            if item.entry.date.isoformat() not in recent_summary_dates
        ]
        dimension_coverage = self._dimension_coverage(user_id, entry_date)
        recent_question_texts = self._recent_question_texts(user_id)
        yesterday_questions = self._yesterday_unanswered_questions(user_id, entry_date)

        ai_result = self._ai.process(
            system_prompt=build_system_prompt(
                mission,
                prompt_goals,
                prompt_summaries,
                dimension_coverage,
                recent_question_texts,
                [
                    PromptFollowUpQuestion(id=question.id, text=question.question_text)
                    for question in yesterday_questions
                ],
                is_import=is_import,
                verbatim=verbatim,
                relevant_past_summaries=relevant_past_summaries,
            ),
            user_prompt=build_user_prompt(raw_transcript),
        )

        question_texts = self._validated_question_texts(
            ai_result.follow_up_questions, recent_question_texts
        )
        eligible_by_id = {goal.id: goal for goal in pending_goals}
        completed = tuple(
            eligible_by_id[goal_id]
            for goal_id in dict.fromkeys(ai_result.completed_goal_ids)
            if goal_id in eligible_by_id
        )

        # Imports and explicit verbatim saves keep the user's original wording instead of the
        # AI's rewrite.
        preserve_wording = is_import or verbatim
        narrative = raw_transcript if preserve_wording else ai_result.formatted_narrative
        alignment_summary = "" if verbatim else ai_result.alignment_summary

        embedding = (
            self._ai.generate_embedding(ai_result.context_summary)
            if hasattr(self._ai, "generate_embedding")
            else None
        )

        if existing_entry is None:
            entry = JournalEntry(
                user_id=user_id,
                date=entry_date,
                raw_transcript=raw_transcript,
                formatted_narrative=narrative,
                alignment_summary=alignment_summary,
                context_summary=ai_result.context_summary,
                praise_message=ai_result.praise_message if completed else None,
                follow_up_questions=question_texts,
                embedding=embedding,
            )
            self._session.add(entry)
            self._session.flush()
        else:
            entry = existing_entry
            entry.raw_transcript = f"{entry.raw_transcript.rstrip()}\n\n{raw_transcript}"
            entry.formatted_narrative = (
                f"{entry.formatted_narrative.rstrip()}\n\n{narrative}"
            )
            entry.alignment_summary = alignment_summary
            entry.context_summary = (
                f"{entry.context_summary.rstrip()} {ai_result.context_summary}".strip()
            )
            entry.praise_message = ai_result.praise_message if completed else entry.praise_message
            entry.follow_up_questions = question_texts
            entry.embedding = (
                self._ai.generate_embedding(entry.context_summary)
                if hasattr(self._ai, "generate_embedding")
                else None
            )

        percy_reminder_texts = tuple(
            clean for text in ai_result.percy_reminders if (clean := text.strip())
        )
        for reminder_text in percy_reminder_texts:
            self._session.add(
                PercyReminder(
                    user_id=user_id,
                    journal_entry_id=entry.id,
                    reminder_text=reminder_text,
                )
            )

        life_insight_texts = tuple(
            clean for text in ai_result.life_insights if (clean := text.strip())
        )
        if life_insight_texts and self._is_insight_on_cooldown(user_id, entry_date):
            life_insight_texts = ()

        for insight_text in life_insight_texts:
            self._session.add(
                LifeInsight(
                    user_id=user_id,
                    journal_entry_id=entry.id,
                    insight_text=insight_text,
                )
            )

        eligible_questions_by_id = {
            question.id: question for question in yesterday_questions
        }
        for question_id in dict.fromkeys(ai_result.answered_follow_up_question_ids):
            if question_id in eligible_questions_by_id:
                eligible_questions_by_id[question_id].answered = True

        for generated_question, clean_text in zip(
            ai_result.follow_up_questions, question_texts
        ):
            self._session.add(
                FollowUpQuestion(
                    user_id=user_id,
                    journal_entry_id=entry.id,
                    question_text=clean_text,
                    dimension=generated_question.dimension,
                )
            )

        for goal in completed:
            goal.status = GoalStatus.COMPLETED
            goal.completed_by_entry_id = entry.id

        next_sort_order = self._next_task_sort_order(user_id)
        existing_texts = {goal.goal_text.strip().casefold() for goal in pending_goals}
        new_tasks: list[OpenLoopAndGoal] = []

        for goal_text in ai_result.new_goals:
            clean_text = goal_text.strip()
            normalized = clean_text.casefold()
            if not clean_text or normalized in existing_texts:
                continue
            task = OpenLoopAndGoal(
                user_id=user_id,
                journal_entry_id=entry.id,
                goal_text=clean_text,
                status=GoalStatus.PENDING,
                kind=GoalKind.TASK,
                sort_order=next_sort_order,
                target_count=parse_target_count_from_text(clean_text),
                current_count=0,
            )
            next_sort_order += 1
            self._session.add(task)
            new_tasks.append(task)
            existing_texts.add(normalized)

        for scheduled in ai_result.percy_scheduled_reminders:
            clean_text = scheduled.reminder_text.strip()
            normalized = clean_text.casefold()
            if not clean_text or normalized in existing_texts:
                continue
            remind_at = parse_schedule_phrase(scheduled.schedule_phrase, base_date=entry_date)
            task = OpenLoopAndGoal(
                user_id=user_id,
                journal_entry_id=entry.id,
                goal_text=clean_text,
                status=GoalStatus.PENDING,
                kind=GoalKind.TASK,
                sort_order=next_sort_order,
                target_count=parse_target_count_from_text(clean_text),
                current_count=0,
                remind_at=remind_at,
            )
            next_sort_order += 1
            self._session.add(task)
            new_tasks.append(task)
            existing_texts.add(normalized)
            if remind_at is not None:
                self._sync_calendar_event(user_id, task)

        existing_goal_texts = {
            goal.goal_text.strip().casefold()
            for goal in self._current_week_goals(user_id, entry_date)
        }
        new_weekly_goals: list[OpenLoopAndGoal] = []
        for goal_text in ai_result.percy_goal_requests:
            clean_text = goal_text.strip()
            normalized = clean_text.casefold()
            if not clean_text or normalized in existing_goal_texts:
                continue
            weekly_goal = OpenLoopAndGoal(
                user_id=user_id,
                journal_entry_id=entry.id,
                goal_text=clean_text,
                status=GoalStatus.PENDING,
                kind=GoalKind.GOAL,
                target_count=parse_target_count_from_text(clean_text),
                current_count=0,
                week_start_date=week_start_of(entry_date),
            )
            self._session.add(weekly_goal)
            new_weekly_goals.append(weekly_goal)
            existing_goal_texts.add(normalized)

        try:
            self._session.commit()
        except Exception:
            self._session.rollback()
            raise

        return DailyProcessingResult(
            journal_entry=entry,
            praise_message=ai_result.praise_message if completed else None,
            completed_goals=completed,
            new_goals=tuple(new_tasks),
            follow_up_questions=tuple(question_texts),
            percy_reminders=percy_reminder_texts,
            life_insights=life_insight_texts,
            new_weekly_goals=tuple(new_weekly_goals),
        )

    def _last_insight_date(self, user_id: str) -> Optional[date]:
        last_entry_date = self._session.scalar(
            select(JournalEntry.date)
            .join(LifeInsight, LifeInsight.journal_entry_id == JournalEntry.id)
            .where(LifeInsight.user_id == user_id)
            .order_by(JournalEntry.date.desc())
            .limit(1)
        )
        if last_entry_date is not None:
            return last_entry_date

        last_created_at = self._session.scalar(
            select(func.max(LifeInsight.created_at)).where(
                LifeInsight.user_id == user_id
            )
        )
        if last_created_at is not None:
            return last_created_at.date()
        return None

    def _is_insight_on_cooldown(self, user_id: str, entry_date: date) -> bool:
        last_date = self._last_insight_date(user_id)
        if last_date is None:
            return False
        return (entry_date - last_date) < timedelta(days=INSIGHT_COOLDOWN_DAYS)

    def _next_task_sort_order(self, user_id: str) -> int:
        current_max = self._session.scalar(
            select(func.max(OpenLoopAndGoal.sort_order)).where(
                OpenLoopAndGoal.user_id == user_id, OpenLoopAndGoal.kind == GoalKind.TASK
            )
        )
        return (current_max or 0) + 1

    def _current_week_goals(self, user_id: str, entry_date: date) -> list[OpenLoopAndGoal]:
        return list(
            self._session.scalars(
                select(OpenLoopAndGoal).where(
                    OpenLoopAndGoal.user_id == user_id,
                    OpenLoopAndGoal.kind == GoalKind.GOAL,
                    OpenLoopAndGoal.week_start_date == week_start_of(entry_date),
                    OpenLoopAndGoal.status != GoalStatus.ABANDONED,
                )
            )
        )

    def _sync_calendar_event(self, user_id: str, task: OpenLoopAndGoal) -> None:
        user = self._session.get(User, user_id)
        if user is None or not user.google_connected:
            return
        try:
            google_calendar.sync_task_event(self._settings, user, task)
        except Exception:  # noqa: BLE001 - calendar sync is best-effort
            logger.warning("Could not sync calendar event for task %s", task.id, exc_info=True)

    @staticmethod
    def _normalize_question(question_text: str) -> str:
        return " ".join(question_text.split()).casefold()

    def _validated_question_texts(
        self,
        generated_questions: list[GeneratedFollowUpQuestion],
        recent_question_texts: list[str],
    ) -> list[str]:
        seen = {
            self._normalize_question(question_text)
            for question_text in recent_question_texts
        }
        clean_texts: list[str] = []
        for generated_question in generated_questions:
            clean_text = generated_question.question_text.strip()
            normalized = self._normalize_question(clean_text)
            if not normalized:
                raise ValueError("AI returned an empty follow-up question")
            if normalized in seen:
                raise ValueError("AI returned a duplicate follow-up question")
            seen.add(normalized)
            clean_texts.append(clean_text)
        return clean_texts

    def _recent_pending_goals(
        self, user_id: str, entry_date: date
    ) -> list[OpenLoopAndGoal]:
        """Pending tasks from the last seven days, plus manually-set tasks with no entry.

        Tasks set outside of journaling have no journal_entry_id, so they aren't bound to
        the rolling seven-day window that keeps entry-linked tasks bounded; they should always
        surface here until completed or abandoned. Weekly-planning goals (kind=GOAL) are a
        separate concept and are never fed into daily AI processing.
        """

        cutoff = entry_date - timedelta(days=7)
        linked_goals = self._session.scalars(
            select(OpenLoopAndGoal)
            .join(OpenLoopAndGoal.journal_entry)
            .where(
                OpenLoopAndGoal.user_id == user_id,
                OpenLoopAndGoal.status == GoalStatus.PENDING,
                OpenLoopAndGoal.kind == GoalKind.TASK,
                JournalEntry.date >= cutoff,
                JournalEntry.date <= entry_date,
            )
        )
        manually_set_goals = self._session.scalars(
            select(OpenLoopAndGoal).where(
                OpenLoopAndGoal.user_id == user_id,
                OpenLoopAndGoal.status == GoalStatus.PENDING,
                OpenLoopAndGoal.kind == GoalKind.TASK,
                OpenLoopAndGoal.journal_entry_id.is_(None),
            )
        )
        combined = {goal.id: goal for goal in [*linked_goals, *manually_set_goals]}
        return sorted(combined.values(), key=lambda goal: goal.created_at)

    def _recent_summaries(
        self, user_id: str, entry_date: date
    ) -> list[tuple[date, str]]:
        cutoff = entry_date - timedelta(days=14)
        rows = self._session.execute(
            select(JournalEntry.date, JournalEntry.context_summary)
            .where(
                JournalEntry.user_id == user_id,
                JournalEntry.date >= cutoff,
                JournalEntry.date < entry_date,
            )
            .order_by(JournalEntry.date.desc(), JournalEntry.created_at.desc())
            .limit(14)
        )
        return [(summary_date, summary) for summary_date, summary in rows]

    def _dimension_coverage(
        self, user_id: str, entry_date: date
    ) -> PromptDimensionCoverage:
        window_end = datetime.combine(entry_date, time.min, tzinfo=timezone.utc)
        cutoff = window_end - timedelta(days=7)
        rows = self._session.execute(
            select(FollowUpQuestion.dimension, func.count(FollowUpQuestion.id))
            .where(
                FollowUpQuestion.user_id == user_id,
                FollowUpQuestion.asked_at >= cutoff,
                FollowUpQuestion.asked_at < window_end,
            )
            .group_by(FollowUpQuestion.dimension)
        )
        counts = {dimension: count for dimension, count in rows}
        return PromptDimensionCoverage(
            physical=counts.get(QuestionDimension.PHYSICAL, 0),
            mental=counts.get(QuestionDimension.MENTAL, 0),
            social=counts.get(QuestionDimension.SOCIAL, 0),
            spiritual=counts.get(QuestionDimension.SPIRITUAL, 0),
        )

    def _recent_question_texts(self, user_id: str) -> list[str]:
        return list(
            self._session.scalars(
                select(FollowUpQuestion.question_text)
                .where(FollowUpQuestion.user_id == user_id)
                .order_by(FollowUpQuestion.asked_at.desc(), FollowUpQuestion.id.desc())
                .limit(15)
            )
        )

    def _yesterday_unanswered_questions(
        self, user_id: str, entry_date: date
    ) -> list[FollowUpQuestion]:
        return list(
            self._session.scalars(
                select(FollowUpQuestion)
                .join(FollowUpQuestion.journal_entry)
                .where(
                    FollowUpQuestion.user_id == user_id,
                    FollowUpQuestion.answered.is_(False),
                    JournalEntry.date == entry_date - timedelta(days=1),
                )
                .order_by(FollowUpQuestion.asked_at, FollowUpQuestion.id)
                .limit(15)
            )
        )
