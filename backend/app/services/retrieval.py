"""Service for embedding-based semantic retrieval of journal entries."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.client import JournalAI
from app.models import JournalEntry


@dataclass(frozen=True)
class RetrievedEntry:
    entry: JournalEntry
    similarity: float


def retrieve_similar_entries(
    session: Session,
    ai: JournalAI,
    user_id: str,
    query: str,
    *,
    top_n: int = 5,
    similarity_threshold: Optional[float] = None,
) -> list[RetrievedEntry]:
    """Retrieve top-N journal entries most semantically similar to `query` by cosine similarity.

    Args:
        session: Active SQLAlchemy session.
        ai: JournalAI client for embedding generation.
        user_id: ID of the user whose journal entries to query.
        query: Percy chat question or query text to embed and match.
        top_n: Maximum number of results to return (default 5).
        similarity_threshold: Optional minimum cosine similarity score (0.0 - 1.0).
            Entries with similarity < threshold will be filtered out.

    Returns:
        List of `RetrievedEntry` instances ordered by similarity descending.
    """
    if not query or not query.strip():
        return []

    if top_n <= 0:
        return []

    query_embedding = ai.generate_embedding(query.strip())
    if not query_embedding:
        return []

    bind = session.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        dist_expr = JournalEntry.embedding.cosine_distance(query_embedding)
        sim_expr = (1 - dist_expr).label("similarity")

        stmt = select(JournalEntry, sim_expr).where(
            JournalEntry.user_id == user_id,
            JournalEntry.embedding.is_not(None),
        )

        if similarity_threshold is not None:
            stmt = stmt.where((1 - dist_expr) >= similarity_threshold)

        stmt = stmt.order_by(dist_expr.asc()).limit(top_n)

        results = session.execute(stmt).all()
        return [
            RetrievedEntry(entry=entry, similarity=float(sim))
            for entry, sim in results
        ]

    # Fallback for SQLite, in-memory test databases, or other engines
    entries = list(
        session.scalars(
            select(JournalEntry).where(
                JournalEntry.user_id == user_id,
                JournalEntry.embedding.is_not(None),
            )
        )
    )

    retrieved: list[RetrievedEntry] = []
    for entry in entries:
        parsed_emb = _parse_embedding(entry.embedding)
        if not parsed_emb:
            continue
        sim = _cosine_similarity(query_embedding, parsed_emb)
        if similarity_threshold is not None and sim < similarity_threshold:
            continue
        retrieved.append(RetrievedEntry(entry=entry, similarity=float(sim)))

    retrieved.sort(key=lambda item: item.similarity, reverse=True)
    return retrieved[:top_n]


def _cosine_similarity(vec1: Sequence[float], vec2: Sequence[float]) -> float:
    dot = sum(a * b for a, b in zip(vec1, vec2))
    norm1 = math.sqrt(sum(a * a for a in vec1))
    norm2 = math.sqrt(sum(b * b for b in vec2))
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot / (norm1 * norm2)


def _parse_embedding(raw: Any) -> list[float]:
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        return [float(x) for x in raw]
    if hasattr(raw, "tolist"):
        return [float(x) for x in raw.tolist()]
    if hasattr(raw, "__iter__") and not isinstance(raw, (str, bytes)):
        return [float(x) for x in raw]
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return []
        if raw.startswith("[") and raw.endswith("]"):
            import json

            return [float(x) for x in json.loads(raw)]
        return [float(x) for x in raw.split(",") if x.strip()]
    return []
