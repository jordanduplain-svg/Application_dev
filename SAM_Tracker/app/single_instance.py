"""Make sure only one copy of the app runs at a time.

On Windows a second server can open the same port as the first one, so the
port alone does not protect us: an exclusive lock on data/app.lock does.
The lock is released by the system when the process ends, even after a crash.
"""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import IO

from .config import DATA_DIR

LOCK_FILE = DATA_DIR / "app.lock"

_handle: IO | None = None  # kept open for the life of the process


def acquire(path: Path = LOCK_FILE, wait: float = 0) -> bool:
    """Take the lock. Returns False if another copy of the app still holds it after `wait` seconds.

    Waiting covers "Quit, then relaunch at once": the old copy needs a moment to stop.
    """
    deadline = time.monotonic() + wait
    while not _try_acquire(path):
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.25)
    return True


def _try_acquire(path: Path) -> bool:
    global _handle
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = open(path, "a+")
    try:
        if os.name == "nt":
            import msvcrt
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return False
    _handle = handle
    return True
