"""AI provider abstraction and OpenAI implementation."""

from typing import Optional, Protocol, TypeVar

from openai import OpenAI
from pydantic import BaseModel

from app.ai.schemas import DailyAIResult, openai_strict_schema

T = TypeVar("T", bound=BaseModel)


class JournalAI(Protocol):
    """Small boundary that makes providers and tests replaceable."""

    def process(
        self, *, system_prompt: str, user_prompt: str, model: Optional[str] = None
    ) -> DailyAIResult: ...

    def chat(
        self,
        *,
        system_prompt: str,
        messages: list[dict[str, str]],
        model: Optional[str] = None,
    ) -> str: ...

    def extract_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema_class: type[T],
        model: Optional[str] = None,
    ) -> T: ...

    def generate_embedding(self, text: str) -> list[float]: ...


class OpenAIJournalAI:
    """Request schema-constrained journal output from OpenAI."""

    def __init__(
        self, *, api_key: str, model: str, fast_model: str = "gpt-4o-mini"
    ) -> None:
        self._client = OpenAI(api_key=api_key)
        self._model = model
        self._fast_model = fast_model

    def process(
        self, *, system_prompt: str, user_prompt: str, model: Optional[str] = None
    ) -> DailyAIResult:
        completion = self._client.chat.completions.create(
            model=model or self._model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "daily_journal_result",
                    "strict": True,
                    "schema": openai_strict_schema(DailyAIResult),
                },
            },
        )
        content = completion.choices[0].message.content
        if not content:
            raise RuntimeError("AI provider returned an empty journal result")
        return DailyAIResult.model_validate_json(content)

    def chat(
        self,
        *,
        system_prompt: str,
        messages: list[dict[str, str]],
        model: Optional[str] = None,
    ) -> str:
        all_messages = [{"role": "system", "content": system_prompt}, *messages]
        completion = self._client.chat.completions.create(
            model=model or self._model,
            messages=all_messages,
        )
        content = completion.choices[0].message.content
        return content or "I couldn't generate a response. Please try asking again."

    def extract_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema_class: type[T],
        model: Optional[str] = None,
    ) -> T:
        completion = self._client.chat.completions.create(
            model=model or self._model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": schema_class.__name__.lower(),
                    "strict": True,
                    "schema": openai_strict_schema(schema_class),
                },
            },
        )
        content = completion.choices[0].message.content
        if not content:
            raise RuntimeError("AI provider returned an empty result")
        return schema_class.model_validate_json(content)

    def generate_embedding(self, text: str) -> list[float]:
        if not text or not text.strip():
            return []
        response = self._client.embeddings.create(
            input=text,
            model="text-embedding-3-small",
        )
        return response.data[0].embedding
