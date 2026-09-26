import subprocess
import sys
import textwrap

from app import single_instance


def test_second_copy_cannot_take_the_lock(tmp_path):
    lock = tmp_path / "app.lock"
    assert single_instance.acquire(lock)
    # Another process (like a second click on the shortcut) must be refused.
    code = textwrap.dedent(f"""
        import sys
        sys.path.insert(0, {str(single_instance.__file__.rsplit('app', 1)[0])!r})
        from pathlib import Path
        from app import single_instance
        sys.exit(0 if single_instance.acquire(Path({str(lock)!r})) else 3)
    """)
    result = subprocess.run([sys.executable, "-c", code], timeout=30)
    assert result.returncode == 3


def test_waits_for_a_copy_that_is_stopping(tmp_path):
    """Quit then relaunch at once: the new copy must start once the old one is gone."""
    lock = tmp_path / "app.lock"
    root = single_instance.__file__.rsplit("app", 1)[0]
    holder = subprocess.Popen([sys.executable, "-c", textwrap.dedent(f"""
        import sys, time
        sys.path.insert(0, {root!r})
        from pathlib import Path
        from app import single_instance
        single_instance.acquire(Path({str(lock)!r}))
        print("locked", flush=True)
        time.sleep(1.5)   # like a copy that takes a moment to stop
    """)], stdout=subprocess.PIPE, text=True)
    assert holder.stdout.readline().strip() == "locked"
    assert not single_instance.acquire(lock, wait=0)
    assert single_instance.acquire(lock, wait=5)
    holder.wait(timeout=10)
