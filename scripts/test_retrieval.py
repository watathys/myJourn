"""Standalone script to test semantic retrieval of journal entries.

Usage:
    python scripts/test_retrieval.py --query "why have I been feeling tired lately" --top-n 3 --threshold 0.5
    python scripts/test_retrieval.py --mock --query "why have I been feeling tired lately"
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

# Ensure backend directory is in sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR / "backend"))

from app.ai.client import OpenAIJournalAI  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import JournalEntry, User  # noqa: E402
from app.services.retrieval import retrieve_similar_entries  # noqa: E402


class MockJournalAI:
    """Mock AI client when OpenAI key is not available or for offline/mock testing."""

    def generate_embedding(self, text: str) -> list[float]:
        dim = 1536
        vec = [0.0] * dim

        semantic_groups = {
            "tiredness": [
                "tired",
                "fatigue",
                "fatigued",
                "exhausted",
                "drained",
                "sluggish",
                "sleep",
                "slept",
                "insomnia",
                "coffee",
            ],
            "energy": ["energized", "energy", "run", "productive", "cardio"],
            "rest": ["relaxing", "restful", "peaceful", "park", "reading"],
            "stress": ["stress", "work", "deadline", "project", "launch"],
        }

        words = text.lower().replace(".", "").replace(",", "").replace("!", "").split()

        for w in words:
            # Hash individual word
            idx = abs(hash(w)) % dim
            vec[idx] += 1.0

            # Map semantic concept group to shared indices
            for group_idx, (group_name, group_words) in enumerate(semantic_groups.items()):
                if any(gw in w for gw in group_words):
                    for offset in range(10):
                        vec[(group_idx * 50 + offset) % dim] += 2.0

        norm = sum(x * x for x in vec) ** 0.5
        if norm > 0:
            vec = [x / norm for x in vec]
        return vec


SAMPLE_ENTRIES = [
    (
        date(2026, 7, 10),
        "Slept only 4 hours due to late night work. Woke up exhausted and drank three coffees.",
        "Slept 4 hours due to work deadline. Feeling very fatigued and tired, coffee didn't help much.",
    ),
    (
        date(2026, 7, 12),
        "Skipped gym and ate fast food. Felt sluggish all afternoon and had trouble focusing.",
        "Poor diet and lack of exercise leading to low energy levels and brain fog.",
    ),
    (
        date(2026, 7, 15),
        "Great 8 hour sleep! Went for a 5k morning run, feeling super energized and productive.",
        "High energy day after full 8-hour sleep and morning cardio.",
    ),
    (
        date(2026, 7, 18),
        "Stress from project launch kept me awake. Feeling drained, low energy, and tired.",
        "Work stress causing insomnia, persistent tiredness, and emotional exhaustion.",
    ),
    (
        date(2026, 7, 20),
        "Had a relaxing Sunday in the park reading a book with friends. Very peaceful.",
        "Restful weekend outdoor activity with social connection.",
    ),
]


def seed_sample_data(session, ai, user_id: str) -> None:
    print("\n[Seeding sample journal entries for test user...]")
    for entry_date, raw, summary in SAMPLE_ENTRIES:
        emb = ai.generate_embedding(summary)
        entry = JournalEntry(
            user_id=user_id,
            date=entry_date,
            raw_transcript=raw,
            formatted_narrative=raw,
            alignment_summary="Sample Alignment",
            context_summary=summary,
            embedding=emb,
        )
        session.add(entry)
    session.commit()
    print("Sample data seeded successfully!")


def main() -> None:
    parser = argparse.ArgumentParser(description="Test semantic retrieval of journal entries.")
    parser.add_argument(
        "--query",
        "-q",
        type=str,
        default="why have I been feeling tired lately",
        help="Query question to test embedding retrieval against context summaries.",
    )
    parser.add_argument(
        "--top-n",
        "-n",
        type=int,
        default=5,
        help="Number of top entries to retrieve (default: 5).",
    )
    parser.add_argument(
        "--threshold",
        "-t",
        type=float,
        default=None,
        help="Minimum similarity threshold (0.0 to 1.0).",
    )
    parser.add_argument(
        "--user-id",
        "-u",
        type=str,
        default=None,
        help="Specific user ID to search for.",
    )
    parser.add_argument(
        "--seed-sample-data",
        action="store_true",
        help="Force seed sample journal entries into the database.",
    )
    parser.add_argument(
        "--mock",
        action="store_true",
        help="Force using MockJournalAI instead of live OpenAI API.",
    )

    args = parser.parse_args()

    settings = get_settings()
    Base.metadata.create_all(engine)

    if settings.openai_api_key and not args.mock:
        print("Using OpenAIJournalAI for generating embeddings...")
        ai = OpenAIJournalAI(api_key=settings.openai_api_key, model=settings.openai_model)
    else:
        print("Using MockJournalAI for local/offline testing...")
        ai = MockJournalAI()

    with SessionLocal() as session:
        user_id = args.user_id
        if not user_id:
            user = session.query(User).first()
            if not user:
                user = User()
                session.add(user)
                session.commit()
            user_id = user.id

        # Check if user has any entries with embeddings
        existing_count = (
            session.query(JournalEntry)
            .filter(JournalEntry.user_id == user_id, JournalEntry.embedding.isnot(None))
            .count()
        )

        if existing_count == 0 or args.seed_sample_data:
            seed_sample_data(session, ai, user_id)

        print(f"\n=======================================================")
        print(f"QUERY: '{args.query}'")
        print(f"User ID: {user_id}")
        print(f"Config: top_n={args.top_n}, similarity_threshold={args.threshold}")
        print(f"=======================================================\n")

        retrieved = retrieve_similar_entries(
            session=session,
            ai=ai,
            user_id=user_id,
            query=args.query,
            top_n=args.top_n,
            similarity_threshold=args.threshold,
        )

        if not retrieved:
            print("No matching journal entries found.")
            return

        print(f"Retrieved {len(retrieved)} entries:\n")
        for i, item in enumerate(retrieved, 1):
            print(f"[{i}] Similarity: {item.similarity:.4f} | Date: {item.entry.date}")
            print(f"    Summary:   {item.entry.context_summary}")
            print(f"    Narrative: {item.entry.formatted_narrative}")
            print("-" * 60)


if __name__ == "__main__":
    main()
