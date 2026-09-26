"""Keyword matching and scoring."""
from __future__ import annotations

import re
from dataclasses import dataclass

from .models import KeywordRule

TITLE_MULTIPLIER = 2


@dataclass(frozen=True)
class ScoreResult:
    score: float
    matched: list[str]
    excluded: bool = False


def compile_keyword(keyword: str) -> re.Pattern[str]:
    """Whole word / phrase, case insensitive. 'web design' also matches 'web-design'."""
    words = [re.escape(w) for w in keyword.split()]
    return re.compile(r"(?<!\w)" + r"[\s\-]+".join(words) + r"(?!\w)", re.IGNORECASE)


class Scorer:
    def __init__(self, keywords: list[KeywordRule], exclude_keywords: list[str] | None = None):
        self._keywords = [
            (rule, compile_keyword(rule.text), rule.text.split()[0].lower()) for rule in keywords
        ]
        self._exclude = [compile_keyword(k) for k in exclude_keywords or []]

    def score(self, title: str, description: str) -> ScoreResult:
        """Title hits count TITLE_MULTIPLIER times, description hits once."""
        if any(p.search(title) for p in self._exclude):
            return ScoreResult(score=0, matched=[], excluded=True)

        # Fast substring check on the first word before running the regex.
        title_lower, desc_lower = title.lower(), description.lower()
        total = 0.0
        matched: list[str] = []
        for rule, pattern, first_word in self._keywords:
            hit = False
            if first_word in title_lower and pattern.search(title):
                total += rule.weight * TITLE_MULTIPLIER
                hit = True
            if not rule.title_only and first_word in desc_lower and pattern.search(description):
                total += rule.weight
                hit = True
            if hit:
                matched.append(rule.text)
        return ScoreResult(score=total, matched=matched)
