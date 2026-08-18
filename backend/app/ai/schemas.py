"""Provider-independent structured output contracts for journal processing."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models import QuestionDimension


class GeneratedFollowUpQuestion(BaseModel):
    """An internally tagged question; only its text is exposed to clients."""

    model_config = ConfigDict(extra="forbid")

    question_text: str = Field(
        min_length=1,
        description=(
            "A brief contextual question grounded in the current journal entry aimed at "
            "helping the user figure out how to improve their life or uncover root causes."
        ),
    )
    dimension: QuestionDimension = Field(
        description="The single life dimension explored by this question."
    )


class PercyScheduledReminder(BaseModel):
    """A Percy request that names a specific day/time to be reminded."""

    model_config = ConfigDict(extra="forbid")

    reminder_text: str = Field(
        min_length=1,
        description=(
            'What to be reminded of, as a short task, e.g. "Read scriptures". Do not '
            "include the schedule phrase or the address to Percy in this text."
        ),
    )
    schedule_phrase: str = Field(
        min_length=1,
        description=(
            'The natural-language day/time the user gave, verbatim, e.g. "Saturday at '
            '9am" or "next Monday morning". Used to compute the actual reminder time.'
        ),
    )


class DailyAIResult(BaseModel):
    """Validated output expected from any configured AI provider."""

    model_config = ConfigDict(extra="forbid")

    praise_message: Optional[str] = Field(
        description="Warm, specific praise tied to an actually completed pending goal, or null."
    )
    formatted_narrative: str = Field(
        min_length=1, description="A lightly edited Day One-style narrative in the user's voice."
    )
    alignment_summary: str = Field(
        min_length=1, description='The complete "What I\'m Working On" section.'
    )
    context_summary: str = Field(
        min_length=1,
        max_length=800,
        description="A compact factual summary for bounded context in later journal entries.",
    )
    completed_goal_ids: list[str] = Field(
        description="IDs of supplied pending goals clearly completed in this transcript."
    )
    new_goals: list[str] = Field(
        description="Distinct new open loops or goals explicitly present in the transcript."
    )
    follow_up_questions: list[GeneratedFollowUpQuestion] = Field(
        min_length=2,
        max_length=3,
        description="Two or three contextual, internally tagged questions for tomorrow.",
    )
    answered_follow_up_question_ids: list[str] = Field(
        description=(
            "IDs of supplied yesterday questions that the current transcript genuinely answers."
        ),
    )
    percy_reminders: list[str] = Field(
        default_factory=list,
        description=(
            "Verbatim requests the user directly addressed to their AI ('Percy') asking to be "
            "reminded of something during weekly planning, with no specific day/time attached, "
            "e.g. 'Percy remind me on weekly planning to work on not complaining.' Empty if none."
        ),
    )
    percy_scheduled_reminders: list[PercyScheduledReminder] = Field(
        default_factory=list,
        description=(
            "Requests the user addressed to Percy that name a specific day and/or time to be "
            "reminded, e.g. 'Percy, remind me Saturday at 9am to read my scriptures.' These "
            "become a scheduled task with a calendar reminder, not a weekly-planning note. "
            "Empty if none were made today."
        ),
    )
    percy_goal_requests: list[str] = Field(
        default_factory=list,
        description=(
            "Requests the user addressed to Percy to set something as a goal for the week, "
            "e.g. 'Percy, set a goal to practice the piano every day this week.' Extract just "
            "the goal itself (e.g. 'Practice the piano every day'). Empty if none were made."
        ),
    )
    life_insights: list[str] = Field(
        default_factory=list,
        description=(
            "Zero or more short, specific life-audit insights pointing out patterns, trade-offs, "
            "or contradictions between user struggles/goals and daily habits, offering direct, "
            "actionable suggestions to improve their life (e.g. pausing high-impact exercise "
            "while sick, or swapping mental-fatiguing screen time for a relaxing habit). "
            "Grounded in concrete evidence from today's transcript or recent summaries. "
            "Empty if nothing clear and new stands out."
        ),
    )


class PercyGoalExtracted(BaseModel):
    """Schema for extracting goal details from natural language with Percy."""

    model_config = ConfigDict(extra="forbid")

    goal_text: str = Field(
        min_length=1,
        description="Clean concise text for the goal, e.g. 'Go to the gym', 'Read 3 chapters'. Do not include schedule or reminder details here.",
    )
    target_count: int = Field(
        default=1,
        ge=1,
        le=1000,
        description="Number of checkable boxes/repetitions for this week. E.g., 'every day this week' or 'daily' = 7, '5 times' = 5. Default to 1 if not specified.",
    )
    remind_time_str: Optional[str] = Field(
        default=None,
        description="Time string if a specific time of day was requested (e.g. '9am-10am', '9:00 AM', '8:30pm'), or null if no time was mentioned.",
    )
    is_daily_recurring: bool = Field(
        default=False,
        description="True if the user requested daily/everyday reminders or repeating reminders throughout the week.",
    )
    reply: str = Field(
        min_length=1,
        description="A warm, concise 1-2 sentence response from Percy confirming the created goal, target count, and calendar reminders.",
    )


class ParsedScheduleItem(BaseModel):
    """Schema for extracting schedule/reminder details from natural language task or goal inputs."""

    model_config = ConfigDict(extra="forbid")

    clean_text: str = Field(
        min_length=1,
        description=(
            "Clean text for the item without schedule or reminder instructions. "
            "E.g., 'drink a protein shake' or 'fill up my water bottle'."
        ),
    )
    has_schedule: bool = Field(
        description="True if a time, date, or reminder request was present in the user input."
    )
    schedule_phrase: Optional[str] = Field(
        default=None,
        description=(
            "Natural language phrase for the day/time if present, e.g. 'thursday at 9am' "
            "or 'every day at 3pm'. Null if no schedule."
        ),
    )
    remind_time_str: Optional[str] = Field(
        default=None,
        description="Time string if a time of day was requested (e.g. '9:00 AM', '3pm', '9am-10am').",
    )
    target_count: int = Field(
        default=1,
        ge=1,
        le=1000,
        description="Number of checkable boxes/repetitions. E.g. 'every day' or 'daily' = 7, '3 times' = 3. Default 1.",
    )
    is_daily_recurring: bool = Field(
        default=False,
        description="True if the user requested daily or every day recurring reminders.",
    )


class WeeklyReflectionAIResult(BaseModel):
    """Structured output schema for the AI weekly reflection call."""

    model_config = ConfigDict(extra="forbid")

    summary_narrative: str = Field(
        min_length=1,
        description=(
            "A short overall narrative of the user's week (3-5 sentences), warm but honest tone, "
            "grounded strictly in what actually appeared in that week's entries."
        ),
    )
    what_went_well: list[str] = Field(
        min_length=1,
        description=(
            "Specific wins, follow-throughs, or positive patterns, cited from actual entries "
            "(not generic praise)."
        ),
    )
    what_was_hard: list[str] = Field(
        min_length=1,
        description=(
            "Genuine struggles or recurring friction points that came up, stated kindly "
            "and non-judgmentally."
        ),
    )
    patterns_worth_noticing: list[str] = Field(
        default_factory=list,
        description=(
            "Life insights that fired that week, plus optionally one new pattern if there is "
            "clear 3+ day evidence within just this week (same evidence bar as rule 12, no single-day guesses)."
        ),
    )
    suggested_focuses: list[str] = Field(
        min_length=1,
        max_length=2,
        description=(
            "1-2 suggested focuses for next week, grounded in the above, not generic advice."
        ),
    )


def openai_strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Adapt a Pydantic JSON schema for OpenAI strict structured outputs."""

    schema = deepcopy(model.model_json_schema())

    def enforce(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                enforce(item)
            return
        if not isinstance(node, dict):
            return
        # OpenAI rejects sibling keywords next to $ref (e.g. description).
        if "$ref" in node:
            ref = node["$ref"]
            node.clear()
            node["$ref"] = ref
            return
        if node.get("type") == "object" or "properties" in node:
            node["additionalProperties"] = False
            properties = node.get("properties")
            if isinstance(properties, dict):
                node["required"] = list(properties.keys())
        for value in node.values():
            enforce(value)

    enforce(schema)
    return schema
