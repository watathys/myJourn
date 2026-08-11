import re
from datetime import date, datetime, time, timedelta, timezone

import pytest
from app.ai.schemas import DailyAIResult, GeneratedFollowUpQuestion, PercyScheduledReminder
from app.constants import DEFAULT_NORTH_STAR
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
from app.services.daily_processing import DailyProcessingService, week_start_of
from sqlalchemy import func, select
from sqlalchemy.orm import Session


class FakeAI:
    def __init__(self, result: DailyAIResult) -> None:
        self.result = result
        self.system_prompt = ""
        self.user_prompt = ""

    def process(self, *, system_prompt: str, user_prompt: str) -> DailyAIResult:
        self.system_prompt = system_prompt
        self.user_prompt = user_prompt
        return self.result

    def generate_embedding(self, text: str) -> list[float]:
        return [0.1] * 1536


def generated(
    text: str, dimension: QuestionDimension = QuestionDimension.MENTAL
) -> GeneratedFollowUpQuestion:
    return GeneratedFollowUpQuestion(question_text=text, dimension=dimension)


def test_processes_without_mission_and_preserves_raw_transcript(session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()
    raw = "  Today was messy, but I called Mom. Need to book the dentist.  "
    ai = FakeAI(
        DailyAIResult(
            praise_message=None,
            formatted_narrative="Today was messy, but I called Mom.",
            alignment_summary="What I'm Working On\n\n- Book the dentist.",
            context_summary="Called Mom; intends to book the dentist.",
            completed_goal_ids=[],
            new_goals=["Book the dentist"],
            follow_up_questions=[
                generated(
                    "What would make booking the dentist easier?",
                    QuestionDimension.PHYSICAL,
                ),
                generated("How did the call with Mom sit with you?", QuestionDimension.SOCIAL),
            ],
            answered_follow_up_question_ids=[],
        )
    )

    result = DailyProcessingService(session=session, ai=ai).process(
        user_id=user.id,
        entry_date=date(2026, 7, 19),
        raw_transcript=raw,
    )

    assert DEFAULT_NORTH_STAR in ai.system_prompt
    assert "Their personal focus right now:" not in ai.system_prompt
    assert "missing mission" not in result.journal_entry.alignment_summary.casefold()
    assert result.journal_entry.raw_transcript == raw
    assert result.new_goals[0].goal_text == "Book the dentist"
    assert result.display_text.startswith("Today was messy")


def test_appends_thread_response_to_existing_entry(session: Session) -> None:
    user = User()
    entry = JournalEntry(
        user=user,
        date=date(2026, 7, 19),
        raw_transcript="The first part of my day.",
        formatted_narrative="The first part of my day.",
        alignment_summary="What I'm Working On",
        context_summary="Captured the first part of the day.",
        follow_up_questions=["What changed later?"],
    )
    session.add_all([user, entry])
    session.commit()
    ai = FakeAI(
        DailyAIResult(
            praise_message=None,
            formatted_narrative="Later, I had a helpful conversation.",
            alignment_summary="What I'm Working On\n\nKeep communicating clearly.",
            context_summary="Had a helpful conversation later.",
            completed_goal_ids=[],
            new_goals=[],
            follow_up_questions=[
                generated("What made the conversation helpful?", QuestionDimension.SOCIAL),
                generated("What do you want to remember from it?"),
            ],
            answered_follow_up_question_ids=[],
        )
    )

    result = DailyProcessingService(session=session, ai=ai).process(
        user_id=user.id,
        entry_date=entry.date,
        raw_transcript="What changed later?\n\nI had a helpful conversation.",
        append_to_entry_id=entry.id,
    )

    assert result.journal_entry.id == entry.id
    assert session.scalar(select(func.count(JournalEntry.id))) == 1
    assert result.journal_entry.raw_transcript.endswith(
        "What changed later?\n\nI had a helpful conversation."
    )
    assert result.journal_entry.formatted_narrative == (
        "The first part of my day.\n\nLater, I had a helpful conversation."
    )
    assert result.journal_entry.follow_up_questions == [
        "What made the conversation helpful?",
        "What do you want to remember from it?",
    ]


def test_completes_only_supplied_goal_and_adds_specific_praise(session: Session) -> None:
    user = User()
    source_entry = JournalEntry(
        user=user,
        date=date(2026, 7, 18),
        raw_transcript="I want to work out tomorrow.",
        formatted_narrative="I want to work out tomorrow.",
        alignment_summary="What I'm Working On\n\n- Work out tomorrow.",
        context_summary="Plans to do a morning workout.",
    )
    goal = OpenLoopAndGoal(
        user=user,
        journal_entry=source_entry,
        goal_text="Do a morning workout",
    )
    session.add_all(
        [
            user,
            source_entry,
            goal,
            MissionStatement(user=user, statement_text="Build consistency with kindness."),
        ]
    )
    session.commit()

    praise = "You followed through on your morning workout even when energy was low."
    ai = FakeAI(
        DailyAIResult(
            praise_message=praise,
            formatted_narrative="I got the workout done even though I felt tired.",
            alignment_summary=(
                "What I'm Working On\n\nI kept building consistency by showing up today."
            ),
            context_summary="Completed the morning workout despite feeling tired.",
            completed_goal_ids=[goal.id, "not-a-real-goal"],
            new_goals=[],
            follow_up_questions=[
                generated("What helped you start the workout?", QuestionDimension.PHYSICAL),
                generated("What would make tomorrow easier?"),
            ],
            answered_follow_up_question_ids=[],
        )
    )

    result = DailyProcessingService(session=session, ai=ai).process(
        user_id=user.id,
        entry_date=date(2026, 7, 19),
        raw_transcript="I did that workout this morning even though I was tired.",
    )

    assert "Their personal focus right now: Build consistency with kindness." in ai.system_prompt
    assert f"[{goal.id}] Do a morning workout" in ai.system_prompt
    assert result.praise_message == praise
    assert result.display_text.startswith(praise)
    assert session.scalar(select(OpenLoopAndGoal.status).where(OpenLoopAndGoal.id == goal.id)) == (
        GoalStatus.COMPLETED
    )


def test_prompt_uses_only_summaries_from_previous_14_days(session: Session) -> None:
    user = User()
    session.add(user)
    session.flush()
    for entry_date, marker in [
        (date(2026, 7, 1), "outside-window"),
        (date(2026, 7, 18), "three-days-back"),
        (date(2026, 7, 19), "yesterday"),
    ]:
        session.add(
            JournalEntry(
                user_id=user.id,
                date=entry_date,
                raw_transcript=f"raw-{marker}",
                formatted_narrative=f"Narrative {marker}",
                alignment_summary="What I'm Working On",
                context_summary=f"summary-{marker}",
            )
        )
    session.commit()
    ai = FakeAI(
        DailyAIResult(
            praise_message=None,
            formatted_narrative="Today.",
            alignment_summary="What I'm Working On\n\nKeep going.",
            context_summary="A compact summary of today.",
            completed_goal_ids=[],
            new_goals=[],
            follow_up_questions=[
                generated("What mattered today?", QuestionDimension.SPIRITUAL),
                generated("What comes next?"),
            ],
            answered_follow_up_question_ids=[],
        )
    )

    DailyProcessingService(session=session, ai=ai).process(
        user_id=user.id,
        entry_date=date(2026, 7, 21),
        raw_transcript="Today was quiet.",
    )

    assert "summary-three-days-back" in ai.system_prompt
    assert "summary-yesterday" in ai.system_prompt
    assert "outside-window" not in ai.system_prompt
    assert "raw-three-days-back" not in ai.system_prompt
    assert "Narrative three-days-back" not in ai.system_prompt


def _entry(user: User, entry_date: date, marker: str) -> JournalEntry:
    return JournalEntry(
        user=user,
        date=entry_date,
        raw_transcript=marker,
        formatted_narrative=marker,
        alignment_summary="What I'm Working On",
        context_summary=marker,
    )


def test_supplies_asked_at_coverage_latest_15_and_persists_canonical_rows(
    session: Session,
) -> None:
    user = User()
    session.add(user)
    session.flush()
    dimensions = list(QuestionDimension)
    for offset in range(1, 17):
        source = _entry(
            user,
            date(2000, 1, 1) + timedelta(days=offset),
            f"day-{offset}",
        )
        session.add(source)
        session.flush()
        session.add(
            FollowUpQuestion(
                id=f"question-{offset:02}",
                user=user,
                journal_entry=source,
                question_text=f"Historical question {offset}?",
                dimension=dimensions[(offset - 1) % len(dimensions)],
                asked_at=datetime(2026, 7, 20 - offset, tzinfo=timezone.utc),
            )
        )
    session.commit()
    ai = FakeAI(
        DailyAIResult(
            praise_message=None,
            formatted_narrative="Today I took a walk and reflected.",
            alignment_summary="What I'm Working On\n\nKeep moving.",
            context_summary="Took a reflective walk.",
            completed_goal_ids=[],
            new_goals=[],
            follow_up_questions=[
                generated("How did your body feel after the walk?", QuestionDimension.PHYSICAL),
                generated(
                    "What did the quiet reflection clarify?", QuestionDimension.SPIRITUAL
                ),
            ],
            answered_follow_up_question_ids=[],
        )
    )

    result = DailyProcessingService(session=session, ai=ai).process(
        user_id=user.id,
        entry_date=date(2026, 7, 20),
        raw_transcript="I took a walk and had a quiet reflection.",
    )

    assert "- physical: 2" in ai.system_prompt
    assert "- mental: 2" in ai.system_prompt
    assert "- social: 2" in ai.system_prompt
    assert "- spiritual: 1" in ai.system_prompt
    assert "previous seven days by asked_at" in ai.system_prompt
    assert "Historical question 1?" in ai.system_prompt
    assert "Historical question 15?" in ai.system_prompt
    assert "Historical question 16?" not in ai.system_prompt
    rows = list(
        session.scalars(
            select(FollowUpQuestion).where(
                FollowUpQuestion.journal_entry_id == result.journal_entry.id
            )
        )
    )
    assert [(row.question_text, row.dimension) for row in rows] == [
        ("How did your body feel after the walk?", QuestionDimension.PHYSICAL),
        ("What did the quiet reflection clarify?", QuestionDimension.SPIRITUAL),
    ]
    assert result.follow_up_questions == (
        "How did your body feel after the walk?",
        "What did the quiet reflection clarify?",
    )


def test_rejects_normalized_recent_and_in_batch_duplicates(session: Session) -> None:
    user = User()
    source = _entry(user, date(2026, 7, 18), "source")
    existing = FollowUpQuestion(
        user=user,
        journal_entry=source,
        question_text="What helped you rest?",
        dimension=QuestionDimension.PHYSICAL,
    )
    session.add_all([user, source, existing])
    session.commit()

    for questions in [
        [
            generated("  WHAT   helped you rest?  ", QuestionDimension.PHYSICAL),
            generated("What felt important?", QuestionDimension.SPIRITUAL),
        ],
        [
            generated("What felt important?"),
            generated(" what   felt important? "),
        ],
    ]:
        ai = FakeAI(
            DailyAIResult(
                praise_message=None,
                formatted_narrative="Today.",
                alignment_summary="What I'm Working On",
                context_summary="Today.",
                completed_goal_ids=[],
                new_goals=[],
                follow_up_questions=questions,
                answered_follow_up_question_ids=[],
            )
        )
        with pytest.raises(ValueError, match="duplicate"):
            DailyProcessingService(session=session, ai=ai).process(
                user_id=user.id,
                entry_date=date(2026, 7, 20),
                raw_transcript="Today.",
            )

    assert session.scalar(select(func.count(JournalEntry.id))) == 1
    assert session.scalar(select(func.count(FollowUpQuestion.id))) == 1


def test_marks_only_eligible_yesterday_unanswered_questions(session: Session) -> None:
    user = User()
    session.add(user)
    session.flush()
    questions: dict[str, FollowUpQuestion] = {}
    for marker, source_date, answered in [
        ("yesterday-open", date(2026, 7, 19), False),
        ("yesterday-answered", date(2026, 7, 19), True),
        ("older-open", date(2026, 7, 18), False),
    ]:
        source = _entry(user, source_date, marker)
        question = FollowUpQuestion(
            id=marker,
            user=user,
            journal_entry=source,
            question_text=f"Question {marker}?",
            dimension=QuestionDimension.MENTAL,
            answered=answered,
        )
        session.add_all([source, question])
        questions[marker] = question
    session.commit()
    ai = FakeAI(
        DailyAIResult(
            praise_message=None,
            formatted_narrative="I found a calmer approach.",
            alignment_summary="What I'm Working On",
            context_summary="Found a calmer approach.",
            completed_goal_ids=[],
            new_goals=[],
            follow_up_questions=[
                generated("What made the calmer approach possible?"),
                generated("Where could you use that approach next?"),
            ],
            answered_follow_up_question_ids=list(questions),
        )
    )

    DailyProcessingService(session=session, ai=ai).process(
        user_id=user.id,
        entry_date=date(2026, 7, 20),
        raw_transcript="I found a calmer approach to yesterday's issue.",
    )

    assert "[yesterday-open] Question yesterday-open?" in ai.system_prompt
    assert "[yesterday-answered]" not in ai.system_prompt
    assert "[older-open]" not in ai.system_prompt
    assert questions["yesterday-open"].answered is True
    assert questions["yesterday-answered"].answered is True
    assert questions["older-open"].answered is False


def test_prompt_requires_grounding_and_does_not_force_social_dimension(
    session: Session,
) -> None:
    user = User()
    session.add(user)
    session.commit()
    ai = FakeAI(
        DailyAIResult(
            praise_message=None,
            formatted_narrative="I slept poorly and struggled to focus.",
            alignment_summary="What I'm Working On",
            context_summary="Poor sleep affected focus.",
            completed_goal_ids=[],
            new_goals=[],
            follow_up_questions=[
                generated("How did poor sleep show up in your body?", QuestionDimension.PHYSICAL),
                generated("What made focusing hardest today?", QuestionDimension.MENTAL),
            ],
            answered_follow_up_question_ids=[],
        )
    )

    DailyProcessingService(session=session, ai=ai).process(
        user_id=user.id,
        entry_date=date(2026, 7, 20),
        raw_transcript="I slept poorly and struggled to focus.",
    )

    assert "never force a\n   social" in ai.system_prompt
    assert "only when today's transcript contains a\n   concrete anchor" in ai.system_prompt
    assert (
        "- physical: sleep, energy, movement, physical health, or body;"
        in ai.system_prompt
    )
    assert (
        "- mental: learning, focus, decision-making, work/projects, or intellectual growth;"
        in ai.system_prompt
    )
    assert (
        "- social: relationships, conversations, conflict, connection, or family/friends;"
        in ai.system_prompt
    )
    assert (
        "- spiritual: meaning, values, gratitude, purpose, or alignment with what matters."
        in ai.system_prompt
    )
    assert "mental: thoughts, emotions" not in ai.system_prompt
    assert "mental: learning, stress" not in ai.system_prompt
    assert all(
        question.dimension != QuestionDimension.SOCIAL
        for question in ai.result.follow_up_questions
    )


def test_prompt_instructs_life_audit_and_diagnostic_follow_ups(session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()
    ai = FakeAI(
        DailyAIResult(
            praise_message=None,
            formatted_narrative="I'm still sick despite playing volleyball daily.",
            alignment_summary="What I'm Working On",
            context_summary="Still sick while playing volleyball daily.",
            completed_goal_ids=[],
            new_goals=[],
            follow_up_questions=[
                generated("What do you do to unwind at night?", QuestionDimension.PHYSICAL),
                generated(
                    "How does volleyball impact your energy while sick?",
                    QuestionDimension.PHYSICAL,
                ),
            ],
            answered_follow_up_question_ids=[],
            life_insights=[
                "Maybe stop playing volleyball every day while sick so your body can recover."
            ],
        )
    )

    DailyProcessingService(session=session, ai=ai).process(
        user_id=user.id,
        entry_date=date(2026, 7, 20),
        raw_transcript=(
            "I just can't get over this sickness, but I've been playing volleyball every day."
        ),
    )

    assert (
        "The primary goal of\n   follow-up questions is to help the user figure out how to "
        "improve their life" in ai.system_prompt
    )
    assert "life_insights are a RARE, week-or-longer-scale audit" in ai.system_prompt


def test_seven_day_policy_simulation_rotates_without_repeats(session: Session) -> None:
    class RotationAI:
        def __init__(self) -> None:
            self.day = 0
            self.selected: list[tuple[QuestionDimension, ...]] = []

        def process(self, *, system_prompt: str, user_prompt: str) -> DailyAIResult:
            counts = {
                dimension: int(
                    re.search(rf"- {dimension.value}: (\d+)", system_prompt).group(1)
                )
                for dimension in QuestionDimension
            }
            chosen = tuple(
                sorted(QuestionDimension, key=lambda item: (counts[item], item.value))[:2]
            )
            self.day += 1
            self.selected.append(chosen)
            return DailyAIResult(
                praise_message=None,
                formatted_narrative=user_prompt,
                alignment_summary="What I'm Working On",
                context_summary=f"Anchored reflection day {self.day}.",
                completed_goal_ids=[],
                new_goals=[],
                follow_up_questions=[
                    generated(
                        f"What stands out about the {dimension.value} detail on day {self.day}?",
                        dimension,
                    )
                    for dimension in chosen
                ],
                answered_follow_up_question_ids=[],
            )

    user = User()
    session.add(user)
    session.commit()
    ai = RotationAI()
    anchored_entries = [
        "A walk energized me; I felt hopeful, called Ana, and reflected on what matters.",
        "I slept deeply, untangled worry, helped Ben, and felt grateful for the morning.",
        "My shoulders eased; I learned patiently, met Cara, and reconsidered my priorities.",
        "Cooking restored me; I made a decision, thanked Dev, and found meaning in the ritual.",
        "I stretched outside, felt calm, listened to Eli, and noticed a sense of wonder.",
        "Rest helped my headache; I focused well, set a boundary, and acted on my values.",
        "The hike challenged me; I processed fear, joined friends, and felt grounded.",
    ]
    start = date(2026, 7, 13)
    for offset, transcript in enumerate(anchored_entries):
        entry_date = start + timedelta(days=offset)
        result = DailyProcessingService(session=session, ai=ai).process(
            user_id=user.id,
            entry_date=entry_date,
            raw_transcript=transcript,
        )
        for question in session.scalars(
            select(FollowUpQuestion).where(
                FollowUpQuestion.journal_entry_id == result.journal_entry.id
            )
        ):
            question.asked_at = datetime.combine(
                entry_date, time(hour=12), tzinfo=timezone.utc
            )
        session.commit()

    texts = list(
        session.scalars(
            select(FollowUpQuestion.question_text).where(
                FollowUpQuestion.user_id == user.id
            )
        )
    )
    assert len(texts) == len(set(texts)) == 14
    for dimension in QuestionDimension:
        selected_each_day = [dimension in dimensions for dimensions in ai.selected]
        assert "11111" not in "".join("1" if selected else "0" for selected in selected_each_day)


def test_manually_set_goals_with_no_entry_surface_regardless_of_window(
    session: Session,
) -> None:
    user = User()
    session.add(user)
    session.flush()
    manual_goal = OpenLoopAndGoal(
        user_id=user.id,
        goal_text="Practice not complaining this week",
        status=GoalStatus.PENDING,
    )
    session.add(manual_goal)
    session.commit()
    ai = FakeAI(
        DailyAIResult(
            praise_message=None,
            formatted_narrative="Today.",
            alignment_summary="What I'm Working On",
            context_summary="Today.",
            completed_goal_ids=[],
            new_goals=[],
            follow_up_questions=[
                generated("What helped today?"),
                generated("What felt hard?"),
            ],
            answered_follow_up_question_ids=[],
        )
    )

    DailyProcessingService(session=session, ai=ai).process(
        user_id=user.id,
        entry_date=date(2026, 8, 20),
        raw_transcript="Today was a normal day.",
    )

    assert f"[{manual_goal.id}] Practice not complaining this week" in ai.system_prompt


def test_persists_percy_reminders_and_life_insights(session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()
    ai = FakeAI(
        DailyAIResult(
            praise_message=None,
            formatted_narrative="Today I noticed I complained a lot at work.",
            alignment_summary="What I'm Working On",
            context_summary="Complained more than usual today.",
            completed_goal_ids=[],
            new_goals=[],
            follow_up_questions=[
                generated("What triggered the complaining today?", QuestionDimension.MENTAL),
                generated("How did it feel afterward?", QuestionDimension.SOCIAL),
            ],
            answered_follow_up_question_ids=[],
            percy_reminders=["Remind me on weekly planning to set not complaining as a goal."],
            life_insights=["Complaining tends to spike on days with poor sleep."],
        )
    )

    result = DailyProcessingService(session=session, ai=ai).process(
        user_id=user.id,
        entry_date=date(2026, 7, 20),
        raw_transcript="Percy, remind me on weekly planning to work on not complaining.",
    )

    assert result.percy_reminders == (
        "Remind me on weekly planning to set not complaining as a goal.",
    )
    assert result.life_insights == ("Complaining tends to spike on days with poor sleep.",)
    reminder = session.scalar(select(PercyReminder).where(PercyReminder.user_id == user.id))
    assert reminder is not None
    assert reminder.reminder_text == (
        "Remind me on weekly planning to set not complaining as a goal."
    )
    assert reminder.is_dismissed is False
    insight = session.scalar(select(LifeInsight).where(LifeInsight.user_id == user.id))
    assert insight is not None
    assert insight.insight_text == "Complaining tends to spike on days with poor sleep."
    assert insight.is_read is False


def test_life_insight_cooldown_discards_recent_insights(session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    # Day 1: 2026-07-20 - First insight should be saved
    ai1 = FakeAI(
        DailyAIResult(
            praise_message=None,
            formatted_narrative="Day 1 transcript",
            alignment_summary="Working hard",
            context_summary="Day 1 context",
            completed_goal_ids=[],
            new_goals=[],
            follow_up_questions=[
                generated("Question 1"),
                generated("Question 2"),
            ],
            answered_follow_up_question_ids=[],
            life_insights=["First insight."],
        )
    )
    service = DailyProcessingService(session=session, ai=ai1)
    res1 = service.process(
        user_id=user.id,
        entry_date=date(2026, 7, 20),
        raw_transcript="Journal entry 1",
    )
    assert res1.life_insights == ("First insight.",)

    # Day 3: 2026-07-22 (2 days later) - Within 7-day cooldown, should be discarded
    ai2 = FakeAI(
        DailyAIResult(
            praise_message=None,
            formatted_narrative="Day 2 transcript",
            alignment_summary="Working hard",
            context_summary="Day 2 context",
            completed_goal_ids=[],
            new_goals=[],
            follow_up_questions=[
                generated("Question 3"),
                generated("Question 4"),
            ],
            answered_follow_up_question_ids=[],
            life_insights=["Second insight within cooldown."],
        )
    )
    service = DailyProcessingService(session=session, ai=ai2)
    res2 = service.process(
        user_id=user.id,
        entry_date=date(2026, 7, 22),
        raw_transcript="Journal entry 2",
    )
    assert res2.life_insights == ()

    insights_in_db = session.scalars(
        select(LifeInsight).where(LifeInsight.user_id == user.id)
    ).all()
    assert len(insights_in_db) == 1
    assert insights_in_db[0].insight_text == "First insight."

    # Day 8: 2026-07-27 (7 days after first insight) - Cooldown expired, should be saved
    ai3 = FakeAI(
        DailyAIResult(
            praise_message=None,
            formatted_narrative="Day 3 transcript",
            alignment_summary="Working hard",
            context_summary="Day 3 context",
            completed_goal_ids=[],
            new_goals=[],
            follow_up_questions=[
                generated("Question 5"),
                generated("Question 6"),
            ],
            answered_follow_up_question_ids=[],
            life_insights=["Third insight after cooldown."],
        )
    )
    service = DailyProcessingService(session=session, ai=ai3)
    res3 = service.process(
        user_id=user.id,
        entry_date=date(2026, 7, 27),
        raw_transcript="Journal entry 3",
    )
    assert res3.life_insights == ("Third insight after cooldown.",)

    insights_in_db_after = session.scalars(
        select(LifeInsight).where(LifeInsight.user_id == user.id)
    ).all()
    assert len(insights_in_db_after) == 2


def test_life_insight_8_day_boundary_simulation(session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    saved_days = {}
    start_date = date(2026, 8, 1)

    for day_offset in range(8):  # Day 1 through Day 8
        day_num = day_offset + 1
        current_date = start_date + timedelta(days=day_offset)

        ai = FakeAI(
            DailyAIResult(
                praise_message=None,
                formatted_narrative=f"Day {day_num} narrative",
                alignment_summary="Working hard",
                context_summary=f"Day {day_num} context",
                completed_goal_ids=[],
                new_goals=[],
                follow_up_questions=[
                    generated(f"Question A for day {day_num}"),
                    generated(f"Question B for day {day_num}"),
                ],
                answered_follow_up_question_ids=[],
                life_insights=[f"Insight candidate for day {day_num}"],
            )
        )

        service = DailyProcessingService(session=session, ai=ai)
        result = service.process(
            user_id=user.id,
            entry_date=current_date,
            raw_transcript=f"Journal entry for day {day_num}",
        )

        saved_days[day_num] = {
            "date": current_date,
            "returned_insight": result.life_insights,
            "status": "SAVED" if result.life_insights else "DISCARDED (Cooldown active)",
        }

    # Verify Day 1 saved, Days 2-7 discarded, Day 8 saved
    assert saved_days[1]["returned_insight"] == ("Insight candidate for day 1",)
    for day in range(2, 8):
        assert saved_days[day]["returned_insight"] == (), f"Day {day} should have been discarded"
    assert saved_days[8]["returned_insight"] == ("Insight candidate for day 8",)


def test_percy_scheduled_reminder_creates_task_with_remind_at(session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()
    ai = FakeAI(
        DailyAIResult(
            praise_message=None,
            formatted_narrative="Today was steady.",
            alignment_summary="What I'm Working On",
            context_summary="A steady day.",
            completed_goal_ids=[],
            new_goals=[],
            follow_up_questions=[
                generated("What made today feel steady?"),
                generated("What do you want tomorrow to hold?"),
            ],
            answered_follow_up_question_ids=[],
            percy_scheduled_reminders=[
                PercyScheduledReminder(
                    reminder_text="Read scriptures",
                    schedule_phrase="Saturday at 9am",
                )
            ],
        )
    )

    result = DailyProcessingService(session=session, ai=ai).process(
        user_id=user.id,
        entry_date=date(2026, 7, 20),
        raw_transcript="Percy, remind me Saturday at 9am to read my scriptures.",
    )

    assert len(result.new_goals) == 1
    task = result.new_goals[0]
    assert task.goal_text == "Read scriptures"
    assert task.kind == GoalKind.TASK
    assert task.remind_at is not None
    assert task.remind_at.weekday() == 5  # Saturday
    assert task.remind_at.hour == 9


def test_percy_goal_request_creates_weekly_goal(session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()
    entry_date = date(2026, 7, 20)
    ai = FakeAI(
        DailyAIResult(
            praise_message=None,
            formatted_narrative="Today was steady.",
            alignment_summary="What I'm Working On",
            context_summary="A steady day.",
            completed_goal_ids=[],
            new_goals=[],
            follow_up_questions=[
                generated("What made today feel steady?"),
                generated("What do you want tomorrow to hold?"),
            ],
            answered_follow_up_question_ids=[],
            percy_goal_requests=["Practice the piano every day"],
        )
    )

    result = DailyProcessingService(session=session, ai=ai).process(
        user_id=user.id,
        entry_date=entry_date,
        raw_transcript="Percy, set a goal to practice the piano every day this week.",
    )

    assert len(result.new_weekly_goals) == 1
    weekly_goal = result.new_weekly_goals[0]
    assert weekly_goal.goal_text == "Practice the piano every day"
    assert weekly_goal.kind == GoalKind.GOAL
    assert weekly_goal.week_start_date == week_start_of(entry_date)


def test_import_mode_preserves_raw_text_as_narrative(session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()
    original_wording = "went 2 the store. saw bob. felt gr8."
    ai = FakeAI(
        DailyAIResult(
            praise_message=None,
            formatted_narrative="imported",
            alignment_summary="What I'm Working On",
            context_summary="Went to the store and saw Bob.",
            completed_goal_ids=[],
            new_goals=[],
            follow_up_questions=[
                generated("How did seeing Bob feel?", QuestionDimension.SOCIAL),
                generated("What made the day feel good?", QuestionDimension.SPIRITUAL),
            ],
            answered_follow_up_question_ids=[],
        )
    )

    result = DailyProcessingService(session=session, ai=ai).process(
        user_id=user.id,
        entry_date=date(2020, 1, 1),
        raw_transcript=original_wording,
        is_import=True,
    )

    assert "bulk import" in ai.system_prompt
    assert result.journal_entry.formatted_narrative == original_wording
    assert result.journal_entry.raw_transcript == original_wording


def test_verbatim_mode_preserves_raw_text_and_skips_alignment_summary(session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()
    original_wording = "Today was long. I don't want this rewritten."
    ai = FakeAI(
        DailyAIResult(
            praise_message=None,
            formatted_narrative="verbatim",
            alignment_summary="What I'm Working On",
            context_summary="A long day.",
            completed_goal_ids=[],
            new_goals=[],
            follow_up_questions=[
                generated("What drained you most?", QuestionDimension.MENTAL),
                generated("Who did you lean on?", QuestionDimension.SOCIAL),
            ],
            answered_follow_up_question_ids=[],
        )
    )

    result = DailyProcessingService(session=session, ai=ai).process(
        user_id=user.id,
        entry_date=date(2026, 3, 10),
        raw_transcript=original_wording,
        verbatim=True,
    )

    assert "exact words" in ai.system_prompt
    assert result.journal_entry.formatted_narrative == original_wording
    assert result.journal_entry.alignment_summary == ""
