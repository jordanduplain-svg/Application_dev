"""Data sources. Each source yields Offer objects through the same interface.

To add a source: write a class with `name` and `fetch(since, report)`,
then register it in `get_source`.
"""
from __future__ import annotations

import logging
from datetime import date
from pathlib import Path
from typing import Callable, Iterator, Protocol

import requests

from . import parser
from .config import CSV_FILE, Settings
from .models import Offer

log = logging.getLogger(__name__)

# report(step, message, percent or None)
ReportFn = Callable[[str, str, "float | None"], None]


class FetchError(Exception):
    """A source could not deliver data. The message is safe to show in the UI."""


class Source(Protocol):
    name: str

    def fetch(self, since: date, report: ReportFn) -> Iterator[Offer]: ...


class CsvSource:
    """Daily public CSV extract of SAM.gov contract opportunities."""

    name = "csv"

    def __init__(self, url: str, path: Path = CSV_FILE):
        self.url = url
        self.path = path

    def fetch(self, since: date, report: ReportFn) -> Iterator[Offer]:
        self._download(report)
        report("parsing", "Reading the CSV file...", None)
        yield from parser.read_csv(
            self.path,
            since,
            on_row=lambda n: report("parsing", f"Reading the CSV file... {n:,} rows", None),
        )

    def _download(self, report: ReportFn) -> None:
        """Download the CSV, skipping it if the remote file did not change."""
        etag_file = self.path.with_suffix(".etag")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            head = requests.head(self.url, timeout=30)
            head.raise_for_status()
            etag = head.headers.get("ETag", "")
            if etag and self.path.exists() and etag_file.exists() and etag_file.read_text() == etag:
                report("downloading", "CSV unchanged since last download, using local copy", 100)
                return

            tmp = self.path.with_suffix(".part")
            with requests.get(self.url, stream=True, timeout=60) as r:
                r.raise_for_status()
                total = int(r.headers.get("Content-Length", 0))
                done = 0
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(chunk_size=1 << 20):
                        f.write(chunk)
                        done += len(chunk)
                        pct = done * 100 / total if total else None
                        report("downloading", f"Downloading CSV... {done / 1e6:.0f} / {total / 1e6:.0f} MB", pct)
            tmp.replace(self.path)
            etag_file.write_text(etag)
        except requests.RequestException as e:
            log.exception("CSV download failed")
            raise FetchError(f"Could not download the SAM.gov CSV ({type(e).__name__}). Check your connection.") from None


def get_source(name: str, settings: Settings) -> Source:
    if name == "csv":
        return CsvSource(settings.csv_url)
    raise FetchError(f"Unknown source: {name}")
