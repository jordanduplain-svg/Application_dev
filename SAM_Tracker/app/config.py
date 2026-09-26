"""Settings from config.yaml, and where the app keeps its files.

Two places:
- the bundle (code, pages, default settings in config.yaml): read-only once installed;
- the user folder (their settings.yaml, database, downloaded CSV, log):
  %LOCALAPPDATA%\\SAM Tracker for the installed app, the project folder when
  running from source. SAM_TRACKER_HOME overrides it.
"""
from __future__ import annotations

import os
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

from .models import KeywordRule

APP_NAME = "SAM Tracker"

FROZEN = getattr(sys, "frozen", False)  # True in the installed .exe
# Uncommon ports, less likely to be used by another program. The installed app
# and a copy run from source get different ports so they never mix their data.
PORT = 8765 if FROZEN else 8766
BUNDLE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))


def _user_dir() -> Path:
    if os.environ.get("SAM_TRACKER_HOME"):
        return Path(os.environ["SAM_TRACKER_HOME"])
    if FROZEN:
        return Path(os.environ.get("LOCALAPPDATA", Path.home())) / APP_NAME
    return BUNDLE_DIR


USER_DIR = _user_dir()
DEFAULT_CONFIG_FILE = BUNDLE_DIR / "config.yaml"
CONFIG_FILE = USER_DIR / "settings.yaml"  # the user's own copy, edited on the Settings page
DATA_DIR = USER_DIR / "data"
DB_FILE = DATA_DIR / "opportunities.db"
CSV_FILE = DATA_DIR / "ContractOpportunitiesFullCSV.csv"
LOG_FILE = DATA_DIR / "app.log"


def ensure_user_files() -> None:
    """First launch: create the user folder and copy the default settings into it."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not CONFIG_FILE.exists():
        shutil.copyfile(DEFAULT_CONFIG_FILE, CONFIG_FILE)


@dataclass(frozen=True)
class Settings:
    keywords: list[KeywordRule]
    exclude_keywords: list[str]
    closed_types: list[str]
    min_score: float
    days_back: int
    keep_filtered_days: int
    csv_url: str


DEFAULT_CSV_URL = (
    "https://falextracts.s3.amazonaws.com/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv"
)


class ConfigError(Exception):
    """The settings are invalid. The message is safe to show and says what to fix."""


def _number(value, name: str, cast=float):
    try:
        return cast(value)
    except (TypeError, ValueError):
        raise ConfigError(f"Settings: '{name}' must be a number, got '{value}'.") from None


def parse_keywords(raw: dict) -> list[KeywordRule]:
    """Accept `word: weight` or `word: {weight: 1, title_only: true}`."""
    if raw is not None and not isinstance(raw, dict):
        raise ConfigError("Settings: 'keywords' must be a list of 'word: weight' lines.")
    rules = []
    for text, value in (raw or {}).items():
        text = str(text).strip()
        if not text:
            raise ConfigError("Settings: a keyword is empty.")
        if isinstance(value, dict):
            weight = _number(value.get("weight", 1), f"weight of {text}")
            rules.append(KeywordRule(text, weight, bool(value.get("title_only", False))))
        else:
            rules.append(KeywordRule(text, _number(value, f"weight of {text}")))
    return rules


def read_raw(path: Path | None = None) -> dict:
    """The settings file as a plain dict (what the Settings page edits)."""
    try:
        with open(path or CONFIG_FILE, encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
    except FileNotFoundError:
        raise ConfigError("The settings file is missing: use Reset to defaults on the Settings page.") from None
    except yaml.YAMLError as e:
        where = getattr(e, "problem_mark", None)
        line = f" (line {where.line + 1})" if where else ""
        raise ConfigError(f"The settings file has a typo{line}: check indentation and ':' characters.") from None
    if not isinstance(raw, dict):
        raise ConfigError("Settings: unexpected content, use Reset to defaults on the Settings page.")
    return raw


def settings_from_raw(raw: dict) -> Settings:
    """Validate the settings. Raises ConfigError with a readable message."""
    # "sources: csv: url" is the old place of csv_url, still accepted.
    legacy_url = ((raw.get("sources") or {}).get("csv") or {}).get("url")
    exclude = [str(k).strip() for k in raw.get("exclude_keywords") or []]
    if any(not k for k in exclude):
        raise ConfigError("Settings: an excluded word is empty.")
    days_back = _number(raw.get("days_back", 30), "Days to look back", int)
    if days_back < 1:
        raise ConfigError("Settings: 'Days to look back' must be 1 or more.")
    keep_filtered_days = _number(raw.get("keep_filtered_days", 90), "Keep filtered-out offers", int)
    if keep_filtered_days < days_back:
        raise ConfigError("Settings: 'Keep filtered-out offers' must be at least 'Days to look back'.")
    keywords = parse_keywords(raw.get("keywords"))
    seen: set[str] = set()
    for rule in keywords:
        if rule.text.lower() in seen:
            raise ConfigError(f"Settings: the keyword '{rule.text}' is there twice.")
        seen.add(rule.text.lower())
    return Settings(
        keywords=keywords,
        exclude_keywords=exclude,
        closed_types=[str(t).strip() for t in raw.get("closed_types") or [] if str(t).strip()],
        min_score=_number(raw.get("min_score", 2), "Minimum score"),
        days_back=days_back,
        keep_filtered_days=keep_filtered_days,
        csv_url=raw.get("csv_url") or legacy_url or DEFAULT_CSV_URL,
    )


def load_settings() -> Settings:
    """Read the user's settings. Called on every run so edits apply without restart.

    Raises ConfigError with a readable message when the file is invalid.
    """
    return settings_from_raw(read_raw())


def load_settings_or_default() -> tuple[Settings, str | None]:
    """For pages: never crash on bad settings, show the problem instead."""
    try:
        return load_settings(), None
    except ConfigError as e:
        fallback = Settings(
            keywords=[], exclude_keywords=[], closed_types=["Award Notice", "Justification"],
            min_score=2, days_back=30, keep_filtered_days=90, csv_url=DEFAULT_CSV_URL,
        )
        return fallback, str(e)


SETTINGS_HEADER = """# SAM.gov Tracker settings. Edited by the Settings page of the app:
# prefer the page, it checks everything before saving.
"""


def save_settings(raw: dict) -> Settings:
    """Validate, then write the user's settings file. Raises ConfigError if invalid."""
    settings = settings_from_raw(raw)
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG_FILE.with_suffix(".tmp")
    tmp.write_text(SETTINGS_HEADER + yaml.safe_dump(raw, sort_keys=False, allow_unicode=True), encoding="utf-8")
    tmp.replace(CONFIG_FILE)  # never leave a half-written file
    return settings


def reset_settings() -> None:
    """Back to the settings shipped with the app."""
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(DEFAULT_CONFIG_FILE, CONFIG_FILE)
