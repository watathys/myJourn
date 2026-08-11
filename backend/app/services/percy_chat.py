"""Service for interactive Percy chatbot sessions about user context and insights."""

from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.client import JournalAI
from app.models import (
    GoalStatus,
    JournalEntry,
    LifeInsight,
    MissionStatement,
    OpenLoopAndGoal,
    User,
)
from app.schemas import PercyChatMessage
from app.services.retrieval import retrieve_similar_entries

logger = logging.getLogger(__name__)


def relative_time_str(entry_date: date, ref_date: Optional[date] = None) -> str:
    ref = ref_date or date.today()
    delta_days = (ref - entry_date).days
    if delta_days <= 0:
        return "today"
    if delta_days == 1:
        return "yesterday"
    if delta_days < 14:
        return f"{delta_days} days ago"
    if delta_days < 60:
        weeks = max(1, round(delta_days / 7))
        unit = "week" if weeks == 1 else "weeks"
        return f"{weeks} {unit} ago"
    if delta_days < 365:
        months = max(1, round(delta_days / 30))
        unit = "month" if months == 1 else "months"
        return f"{months} {unit} ago"
    years = max(1, round(delta_days / 365))
    unit = "year" if years == 1 else "years"
    return f"{years} {unit} ago"


def chat_with_percy(
    session: Session,
    ai: JournalAI,
    user_id: str,
    message: str,
    history: list[PercyChatMessage],
    insight_id: Optional[str] = None,
    insight_text: Optional[str] = None,
) -> str:
    user = session.get(User, user_id)
    if user is None:
        raise LookupError(f"user {user_id!r} does not exist")

    mission = session.scalar(
        select(MissionStatement.statement_text).where(MissionStatement.user_id == user_id)
    )

    insights = list(
        session.scalars(
            select(LifeInsight)
            .where(LifeInsight.user_id == user_id, LifeInsight.is_dismissed.is_(False))
            .order_by(LifeInsight.created_at.desc())
        )
    )

    target_insight_str = insight_text or ""
    if insight_id and not target_insight_str:
        found_insight = session.get(LifeInsight, insight_id)
        if found_insight and found_insight.user_id == user_id:
            target_insight_str = found_insight.insight_text

    recent_entries = list(
        session.scalars(
            select(JournalEntry)
            .where(JournalEntry.user_id == user_id)
            .order_by(JournalEntry.date.desc(), JournalEntry.created_at.desc())
            .limit(30)
        )
    )

    retrieved = (
        retrieve_similar_entries(
            session=session,
            ai=ai,
            user_id=user_id,
            query=message,
            top_n=8,
            similarity_threshold=0.25,
        )
        if hasattr(ai, "generate_embedding")
        else []
    )

    recent_entry_ids = {entry.id for entry in recent_entries}
    semantic_entries = [
        item.entry for item in retrieved if item.entry.id not in recent_entry_ids
    ]

    goals_and_tasks = list(
        session.scalars(
            select(OpenLoopAndGoal)
            .where(
                OpenLoopAndGoal.user_id == user_id,
                OpenLoopAndGoal.status != GoalStatus.ABANDONED,
            )
            .order_by(OpenLoopAndGoal.created_at.desc())
            .limit(20)
        )
    )

    mission_summary = mission.strip() if mission and mission.strip() else "No North Star set yet."

    insights_summary = (
        "\n".join(f"- {item.insight_text}" for item in insights)
        if insights
        else "No insights recorded yet."
    )

    recent_summary_parts = []
    for entry in recent_entries:
        narrative_snippet = entry.formatted_narrative.strip()
        if len(narrative_snippet) > 500:
            narrative_snippet = narrative_snippet[:500] + "..."
        rel_time = relative_time_str(entry.date)
        recent_summary_parts.append(
            f"Date: {entry.date.isoformat()} ({rel_time})\n"
            f"Reflection: {narrative_snippet}\n"
            f"Summary: {entry.alignment_summary}\n"
        )
    recent_entries_summary = (
        "\n---\n".join(recent_summary_parts)
        if recent_summary_parts
        else "No recent journal entries yet."
    )

    semantic_summary_parts = []
    for entry in semantic_entries:
        narrative_snippet = entry.formatted_narrative.strip()
        if len(narrative_snippet) > 500:
            narrative_snippet = narrative_snippet[:500] + "..."
        rel_time = relative_time_str(entry.date)
        semantic_summary_parts.append(
            f"Date: {entry.date.isoformat()} (from {rel_time})\n"
            f"Reflection: {narrative_snippet}\n"
            f"Summary: {entry.alignment_summary}\n"
        )
    semantic_entries_summary = (
        "\n---\n".join(semantic_summary_parts)
        if semantic_summary_parts
        else "No additional semantic matches outside the recent window."
    )

    tasks_goals_summary = (
        "\n".join(
            f"- [{item.kind.value.upper()}] {item.goal_text} ({item.status.value})"
            for item in goals_and_tasks
        )
        if goals_and_tasks
        else "No active tasks or goals."
    )

    focus_section = (
        f"\nTARGET INSIGHT BEING DISCUSSED:\n\"{target_insight_str}\"\n"
        if target_insight_str
        else ""
    )

    system_prompt = f"""You are Percy, a warm, thoughtful, empathetic, and highly perceptive AI journal companion in MyJourn.
You are chatting directly with the user about themselves, their reflections, habits, patterns, and AI insights.

YOUR CONTEXT ABOUT THE USER:
- North Star (Mission Statement):
{mission_summary}

- Life Insights Surfaced So Far:
{insights_summary}
{focus_section}
- Recent Journal Entries (Most recent first, up to 30 entries):
{recent_entries_summary}

- Semantically Relevant Older Entries (Retrieved by vector similarity to current user message):
{semantic_entries_summary}

- Active Tasks & Goals:
{tasks_goals_summary}

INSTRUCTIONS:
1. Answer the user's question directly, insightfully, and concisely.
2. You have access to both a recent window of journal entries and semantically relevant older entries retrieved for the user's message. When referencing older entries, note roughly when they are from (e.g. "from 3 weeks ago", "a month ago", or citing the date).
3. If asked about how an insight was reached or why you reached a conclusion, explain clearly based on specific entries, dates, or recurring patterns in their journal history.
4. Be warm, supportive, and conversational.
5. Speak in the first person ("I noticed in your entry on...", "Looking back at your journal...").
6. Stay grounded in the user's actual journal context and do not invent details outside their journal context.
"""

    messages_list = [{"role": msg.role, "content": msg.content} for msg in history]
    messages_list.append({"role": "user", "content": message.strip()})

    try:
        return ai.chat(system_prompt=system_prompt, messages=messages_list)
    except Exception as exc:
        logger.warning("Percy chat error: %s", exc, exc_info=True)
        return "I had trouble generating a response right now. Please try again in a moment."
