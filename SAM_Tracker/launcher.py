"""Entry point of the installed app (and of start_app.bat).

Starts the local server if it is not running yet, then opens the app in its
own window (Edge "app mode": no tabs, no address bar). If the app is already
running, it only opens a window. The "Quit" button in the app stops it.
"""
from __future__ import annotations

import ctypes
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

from app import config, single_instance

URL = f"http://127.0.0.1:{config.PORT}"


def is_running() -> bool:
    try:
        with urllib.request.urlopen(f"{URL}/api/status", timeout=2):
            return True
    except OSError:
        return False


def find_edge() -> str | None:
    candidates = [
        os.path.join(os.environ.get(var, ""), r"Microsoft\Edge\Application\msedge.exe")
        for var in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA")
    ]
    return next((c for c in candidates if os.path.isfile(c)), None) or shutil.which("msedge")


def open_window() -> None:
    edge = find_edge()
    if edge:
        subprocess.Popen([edge, f"--app={URL}", "--window-size=1400,900"])
    else:
        webbrowser.open(URL)


def show_error(message: str) -> None:
    """A Windows message box: the installed app has no console to print to."""
    if os.name == "nt":
        ctypes.windll.user32.MessageBoxW(None, message, config.APP_NAME, 0x10)
    else:
        print(message, file=sys.stderr)


def open_when_ready() -> None:
    for _ in range(100):  # up to 20 s
        if is_running():
            open_window()
            return
        time.sleep(0.2)
    show_error("The app did not start. Details are in the log file:\n" + str(config.LOG_FILE))


def main() -> int:
    if is_running():
        open_window()
        return 0
    # Wait a little in case a copy that was just quit is still stopping.
    if not single_instance.acquire(wait=5):
        open_when_ready()  # another copy is starting right now
        return 0

    from werkzeug.serving import make_server

    from app.main import create_app

    try:
        server = make_server("127.0.0.1", config.PORT, create_app(), threaded=True)
    except OSError:
        show_error(f"Port {config.PORT} is already used by another program on this computer.\n"
                   f"Close it, then start {config.APP_NAME} again.")
        return 1
    threading.Thread(target=open_when_ready, daemon=True).start()
    server.serve_forever()  # until "Quit" in the app
    return 0


if __name__ == "__main__":
    sys.exit(main())
