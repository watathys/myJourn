"""Service for applying and learning user spelling corrections."""

from __future__ import annotations

import difflib
import re
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import SpellingCorrection


def apply_spelling_corrections(text: str, corrections: list[tuple[str, str]]) -> str:
    """Apply learned spelling corrections to text using word-boundary matching."""
    if not text or not corrections:
        return text

    # Sort corrections by length of incorrect_word descending so longer phrases match first
    sorted_corrections = sorted(corrections, key=lambda c: len(c[0]), reverse=True)

    for incorrect_word, correct_word in sorted_corrections:
        inc = incorrect_word.strip()
        cor = correct_word.strip()
        if not inc or not cor or inc.casefold() == cor.casefold():
            continue

        pattern = re.compile(rf"\b{re.escape(inc)}\b", re.IGNORECASE)

        def _replace_match(match: re.Match, cor: str = cor) -> str:
            matched_text = match.group(0)
            if cor[0].isupper() and not cor.isupper():
                return cor
            if matched_text.isupper():
                return cor.upper()
            if matched_text.istitle():
                return cor.capitalize()
            return cor

        text = pattern.sub(_replace_match, text)

    return text


def extract_spelling_corrections(old_text: str, new_text: str) -> list[tuple[str, str]]:
    """Compare old_text and new_text to extract word-level spelling corrections."""
    if not old_text or not new_text or old_text.strip() == new_text.strip():
        return []

    old_words = re.findall(r"\b[^\W\d_]+\b", old_text)
    new_words = re.findall(r"\b[^\W\d_]+\b", new_text)

    if not old_words or not new_words:
        return []

    matcher = difflib.SequenceMatcher(None, old_words, new_words)
    extracted: list[tuple[str, str]] = []
    seen: set[str] = set()

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "replace":
            old_sub = old_words[i1:i2]
            new_sub = new_words[j1:j2]

            if len(old_sub) == 1 and len(new_sub) == 1:
                ow, nw = old_sub[0], new_sub[0]
                if ow.casefold() != nw.casefold():
                    key = ow.casefold()
                    if key not in seen:
                        seen.add(key)
                        extracted.append((ow, nw))

            elif len(old_sub) == len(new_sub) and len(old_sub) <= 3:
                for ow, nw in zip(old_sub, new_sub):
                    if ow.casefold() != nw.casefold():
                        key = ow.casefold()
                        if key not in seen:
                            seen.add(key)
                            extracted.append((ow, nw))

            elif len(old_sub) == 1 and len(new_sub) > 1:
                ow, nw = old_sub[0], new_sub[0]
                if ow.casefold() != nw.casefold():
                    key = ow.casefold()
                    if key not in seen:
                        seen.add(key)
                        extracted.append((ow, nw))
            elif len(old_sub) > 1 and len(new_sub) == 1:
                ow, nw = old_sub[0], new_sub[0]
                if ow.casefold() != nw.casefold():
                    key = ow.casefold()
                    if key not in seen:
                        seen.add(key)
                        extracted.append((ow, nw))

    return extracted


def get_user_spelling_corrections(session: Session, user_id: str) -> list[SpellingCorrection]:
    """Retrieve all spelling corrections for a user ordered by update time."""
    return list(
        session.scalars(
            select(SpellingCorrection)
            .where(SpellingCorrection.user_id == user_id)
            .order_by(SpellingCorrection.updated_at.desc(), SpellingCorrection.created_at.desc())
        )
    )


def save_spelling_correction(
    session: Session, user_id: str, incorrect_word: str, correct_word: str
) -> Optional[SpellingCorrection]:
    """Upsert a spelling correction for a user."""
    inc = incorrect_word.strip()
    cor = correct_word.strip()
    if not inc or not cor or inc.casefold() == cor.casefold():
        return None

    existing = session.scalars(
        select(SpellingCorrection).where(
            SpellingCorrection.user_id == user_id,
            SpellingCorrection.incorrect_word.ilike(inc),
        )
    ).first()

    if existing is not None:
        existing.correct_word = cor
        existing.correction_count += 1
        return existing

    correction = SpellingCorrection(
        user_id=user_id,
        incorrect_word=inc,
        correct_word=cor,
        correction_count=1,
    )
    session.add(correction)
    return correction


def learn_spelling_corrections(
    session: Session, user_id: str, old_text: str, new_text: str
) -> list[SpellingCorrection]:
    """Extract and save spelling corrections from a text edit."""
    extracted = extract_spelling_corrections(old_text, new_text)
    saved: list[SpellingCorrection] = []
    for incorrect_word, correct_word in extracted:
        correction = save_spelling_correction(session, user_id, incorrect_word, correct_word)
        if correction is not None:
            saved.append(correction)
    return saved


def delete_spelling_correction(session: Session, user_id: str, correction_id: str) -> bool:
    """Delete a spelling correction by ID."""
    correction = session.get(SpellingCorrection, correction_id)
    if correction is None or correction.user_id != user_id:
        return False
    session.delete(correction)
    return True
