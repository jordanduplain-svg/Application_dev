"""The fetch -> score -> store pipeline, run in the background by runner.py."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, timedelta

from . import repository
from .config import load_settings
from .fetcher import ReportFn, get_source
from .scorer import Scorer

log = logging.getLogger(__name__)

COMMIT_EVERY = 500  # rows
VACUUM_AFTER = 2000  # deleted rows: below that, not worth rewriting the file


@dataclass
class RunResult:
    run_id: int
    rows_read: int
    matched: int
    new: int  # groups that became active for the first time

    @property
    def message(self) -> str:
        return f"Done. {self.rows_read:,} offers checked, {self.matched} match, {self.new} new."


def run_pipeline(source_name: str, report: ReportFn) -> RunResult:
    """Fetch offers, score them, store them. Records the run, success or failure.

    Raises FetchError / CsvFormatError (safe to show) or any unexpected error.
    """
    settings = load_settings()
    source = get_source(source_name, settings)
    scorer = Scorer(settings.keywords, settings.exclude_keywords)
    since = date.today() - timedelta(days=settings.days_back)
    run_id = repository.start_run(source.name)
    log.info("Run %s started (source=%s, since=%s)", run_id, source.name, since)

    def status_for(title: str, description: str):
        result = scorer.score(title, description)
        keep = not result.excluded and result.score >= settings.min_score
        return result, keep, "active" if keep else "filtered"

    rows_read = matched = 0
    seen: set[str] = set()  # offers of this run, already scored
    try:
        with repository.connect() as conn:
            for offer in source.fetch(since, report):
                rows_read += 1
                seen.add(offer.notice_id)
                result, keep, status = status_for(offer.title, offer.description)
                matched += keep
                repository.upsert_offer(conn, offer, result.score, result.matched, status, run_id)
                if rows_read % COMMIT_EVERY == 0:
                    conn.commit()  # short write locks: user clicks never wait long
                if rows_read % 2000 == 0:
                    report("scoring", f"Scoring... {rows_read:,} checked, {matched} matching", None)

            # Offers not in today's data (closed, or older than the window): re-score
            # them so keyword changes in config.yaml apply to them too.
            for row in repository.rows_before(conn, since.isoformat()):
                if row["notice_id"] in seen:
                    continue
                result, _, status = status_for(row["title"], row["description"] or "")
                repository.update_score(conn, row, result.score, result.matched, status, run_id)
            repository.sync_groups(conn, run_id)

            # Keep the database small: old filtered-out offers go away (after the
            # group sync, so versions of offers still shown are kept).
            cutoff = date.today() - timedelta(days=settings.keep_filtered_days)
            purged = repository.purge_filtered(conn, cutoff.isoformat())

            repository.adopt_unfinished_runs(conn, run_id)
            new = repository.count_new_groups(conn, run_id)
    except Exception as e:
        repository.finish_run(run_id, rows_read, matched, 0, str(e))
        raise

    repository.finish_run(run_id, rows_read, matched, new, None)
    if purged >= VACUUM_AFTER:
        report("scoring", f"Removed {purged:,} old filtered-out offers, compacting the database...", None)
        repository.compact()
        log.info("Removed %s old filtered-out offers and compacted the database", purged)
    result = RunResult(run_id, rows_read, matched, new)
    log.info("Run %s: %s", run_id, result.message)
    return result
