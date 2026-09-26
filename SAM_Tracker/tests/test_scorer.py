from app.config import parse_keywords
from app.models import KeywordRule
from app.scorer import Scorer


def make_scorer(exclude=None):
    rules = [KeywordRule("marketing", 1), KeywordRule("web design", 1), KeywordRule("branding", 2),
             KeywordRule("website", 1, title_only=True)]
    return Scorer(rules, exclude)


def test_title_counts_double():
    result = make_scorer().score("Marketing services", "")
    assert result.score == 2
    assert result.matched == ["marketing"]


def test_title_and_description_add_up():
    result = make_scorer().score("Marketing services", "Includes branding work")
    assert result.score == 2 + 2
    assert result.matched == ["marketing", "branding"]


def test_case_insensitive_and_phrase_with_dash():
    assert make_scorer().score("", "WEB-DESIGN and Web  Design").matched == ["web design"]


def test_whole_words_only():
    # "marketingly" and "rebranding" must not match
    assert make_scorer().score("Rebranding", "marketingly").score == 0


def test_title_only_keyword_ignores_description():
    assert make_scorer().score("", "See the website for details").score == 0
    assert make_scorer().score("Website redesign", "").score == 2


def test_exclude_keyword_in_title():
    result = make_scorer(["radio"]).score("Radio marketing", "")
    assert result.excluded
    assert result.score == 0


def test_parse_keywords_both_forms():
    rules = parse_keywords({"seo": 2, "website": {"weight": 1, "title_only": True}})
    assert rules == [KeywordRule("seo", 2), KeywordRule("website", 1, True)]
