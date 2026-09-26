"""Runs the pipeline in a background thread for the web app, with a live status."""
from __future__ import annotations

import logging
import threading

from .config import ConfigError
from .fetcher import FetchError
from .parser import CsvFormatError
from .pipeline import run_pipeline

log = logging.getLogger(__name__)

_lock = threading.Lock()
_state: dict = {"state": "idle", "step": "", "message": "Ready.", "percent": None}


def snapshot() -> dict:
    with _lock:
        return dict(_state)


def _set(**values) -> None:
    with _lock:
        _state.update(values)


def start(source_name: str) -> bool:
    """Start a run. Returns False if one is already running."""
    with _lock:
        if _state["state"] == "running":
            return False
        _state.update(state="running", step="starting", message="Starting...", percent=None)
    threading.Thread(target=_run, args=(source_name,), daemon=True).start()
    return True


def _report(step: str, message: str, percent: float | None) -> None:
    _set(step=step, message=message, percent=percent)


def _run(source_name: str) -> None:
    try:
        result = run_pipeline(source_name, _report)
        _set(state="done", step="done", message=result.message, percent=100)
    except (FetchError, CsvFormatError, ConfigError) as e:
        log.error("Run failed: %s", e)
        _set(state="error", step="error", message=str(e), percent=None)
    except Exception as e:  # never kill the app, show the error instead
        log.exception("Run failed")
        _set(state="error", step="error", message=f"Unexpected error: {e}", percent=None)
