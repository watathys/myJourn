"""Helpers for goals and tasks, such as target count parsing."""

from __future__ import annotations

import re


def parse_target_count_from_text(text: str) -> int:
    """Parse target count from goal text, e.g. 'Run 10x' -> 10, 'Do 5 pushups' -> 5."""
    match = re.search(r"\b(\d+)\s*(?:x|times)\b", text, re.IGNORECASE)
    if match:
        try:
            val = int(match.group(1))
            if 1 <= val <= 1000:
                return val
        except ValueError:
            pass
    return 1
