import threading
import time
from datetime import datetime, timedelta, timezone

import pytest

from app import repository
from app.models import Offer, group_key
from app.repository import OfferFilters


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(repository, "DB_FILE", tmp_path / "test.db")
    repository.init_db()


def upsert(status, run_id, notice_id="n1", title="Title", sync=True, **fields):
    fields.setdefault("posted_date", "2026-09-25")
    offer = Offer(notice_id, title, **fields)
    with repository.connect() as conn:
        repository.upsert_offer(conn, offer, 3, ["marketing"], status, run_id)
        if sync:
            repository.sync_groups(conn, run_id)


def status_of(notice_id="n1"):
    with repository.connect() as conn:
        return conn.execute("SELECT status FROM opportunities WHERE notice_id=?", (notice_id,)).fetchone()[0]


def new_groups(run_id):
    with repository.connect() as conn:
        return repository.count_new_groups(conn, run_id)


def ids(**kw):
    rows, _ = repository.list_offers(OfferFilters(**kw))
    return [r["notice_id"] for r in rows]


# ---- statuses ----

def test_new_active_offer_counts_as_new_once():
    upsert("active", 1)
    assert new_groups(1) == 1
    upsert("active", 2)
    assert new_groups(2) == 0


def test_filtered_offer_becoming_active_counts_as_new():
    upsert("filtered", 1)
    upsert("active", 2)
    assert status_of() == "active"
    assert new_groups(2) == 1


def test_run_follows_score_when_not_manual():
    upsert("active", 1)
    upsert("filtered", 2)
    assert status_of() == "filtered"


def test_manual_status_is_never_overridden():
    upsert("active", 1)
    repository.set_status("n1", "discarded")
    upsert("active", 2)
    assert status_of() == "discarded"

    repository.set_status("n1", "active")  # restore
    upsert("filtered", 3)
    assert status_of() == "active"


# ---- duplicates ----

def test_group_key_uses_solicitation_number_and_agency():
    a = Offer("a", "Title A", agency="DOD", solicitation_number="W91-26-Q-1")
    b = Offer("b", "Title A - Amendment 1", agency="dod", solicitation_number=" w91-26-q-1 ")
    c = Offer("c", "Title A", agency="NASA", solicitation_number="W91-26-Q-1")
    assert group_key(a) == group_key(b) != group_key(c)
    assert group_key(Offer("d", "Same  title", agency="X")) == group_key(Offer("e", "same title", agency="X"))


def test_versions_are_shown_once_latest_first():
    upsert("active", 1, "v1", solicitation_number="S1", agency="DOD", posted_date="2026-09-01")
    upsert("active", 1, "v2", solicitation_number="S1", agency="DOD", posted_date="2026-09-10")
    upsert("active", 1, "other", solicitation_number="S2", agency="DOD")
    rows, total = repository.list_offers(OfferFilters(open_only=False))
    by_id = {r["notice_id"]: r for r in rows}
    assert total == 2
    assert set(by_id) == {"v2", "other"}
    assert by_id["v2"]["versions"] == 2
    assert [v["notice_id"] for v in by_id["v2"]["other_versions"]] == ["v1"]
    assert new_groups(1) == 2


def test_discard_applies_to_all_versions_and_future_ones():
    upsert("active", 1, "v1", solicitation_number="S1", agency="DOD")
    upsert("active", 1, "v2", solicitation_number="S1", agency="DOD")
    repository.set_status("v1", "discarded")
    assert status_of("v1") == status_of("v2") == "discarded"

    upsert("active", 2, "v3", solicitation_number="S1", agency="DOD")  # new amendment
    assert status_of("v3") == "discarded"


def test_group_is_active_if_any_version_is():
    upsert("active", 1, "v1", solicitation_number="S1", agency="DOD", posted_date="2026-09-01")
    upsert("filtered", 1, "v2", solicitation_number="S1", agency="DOD", posted_date="2026-09-10")
    assert status_of("v2") == "active"
    assert ids(open_only=False) == ["v2"]


# ---- listing ----

def test_open_only_hides_expired_and_closed_types():
    upsert("active", 1, "open", title="A", type="Solicitation", deadline="2999-01-01T12:00:00")
    upsert("active", 1, "no-deadline", title="B", type="Special Notice")
    upsert("active", 1, "expired", title="C", type="Solicitation", deadline="2000-01-01T12:00:00")
    upsert("active", 1, "awarded", title="D", type="Award Notice")

    closed = ["Award Notice"]
    assert set(ids(closed_types=closed)) == {"open", "no-deadline"}
    assert set(ids(closed_types=closed, open_only=False)) == {"open", "no-deadline", "expired", "awarded"}

    stats = repository.dashboard_stats(closed)
    assert (stats["open"], stats["closed"]) == (2, 2)


def test_new_in_run_filter():
    upsert("active", 1, "old", title="Old")
    upsert("active", 2, "new", title="New")
    assert ids(new_in_run=2) == ["new"]


def test_list_offers_limit_and_total():
    for i in range(5):
        upsert("active", 1, notice_id=f"n{i}", title=f"T{i}")
    rows, total = repository.list_offers(OfferFilters(), limit=2)
    assert len(rows) == 2
    assert total == 5


def test_interrupted_runs_are_closed():
    run_id = repository.start_run("csv")
    repository.mark_interrupted_runs()
    run = repository.recent_runs(1)[0]
    assert run["id"] == run_id and run["finished_at"] and "Interrupted" in run["error"]


# ---- bug fixes ----

def test_deadline_uses_exact_time_and_time_zone():
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(timespec="seconds")
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(timespec="seconds")
    today = datetime.now().date().isoformat()
    upsert("active", 1, "past-hour", title="A", deadline=past)
    upsert("active", 1, "next-hour", title="B", deadline=future)
    upsert("active", 1, "today-no-time", title="C", deadline=today)
    assert set(ids()) == {"next-hour", "today-no-time"}


def test_archived_offer_without_deadline_is_hidden():
    upsert("active", 1, "archived", title="A", type="Special Notice", archive_date="2000-01-01")
    upsert("active", 1, "live", title="B", type="Special Notice", archive_date="2999-01-01")
    assert ids() == ["live"]
    rows, _ = repository.list_offers(OfferFilters(open_only=False))
    assert {r["notice_id"]: r["archived"] for r in rows} == {"archived": 1, "live": 0}


def test_old_rows_can_be_rescored():
    upsert("filtered", 1, "old", title="Branding", posted_date="2026-01-01")
    upsert("filtered", 1, "recent", title="Other", posted_date="2026-09-25")
    upsert("active", 1, "manual", title="Mine", posted_date="2026-01-01")
    repository.set_status("manual", "discarded")
    with repository.connect() as conn:
        rows = repository.rows_before(conn, "2026-09-01")
        assert [r["notice_id"] for r in rows] == ["old"]  # rows handled by hand are left alone
        repository.update_score(conn, rows[0], 5, ["branding"], "active", 2)
    assert status_of("old") == "active"
    assert new_groups(2) == 1


def test_user_action_waits_for_a_running_import():
    """A run holding the write lock must not make Discard fail."""
    upsert("active", 1, "n1")
    started = threading.Event()

    def long_write():
        with repository.connect() as conn:
            conn.execute("UPDATE opportunities SET score = score")
            started.set()
            time.sleep(1.5)

    t = threading.Thread(target=long_write)
    t.start()
    started.wait()
    assert repository.set_status("n1", "discarded")
    t.join()
    assert status_of() == "discarded"


def test_purge_keeps_old_offers_that_are_still_open():
    upsert("filtered", 1, "old-open", title="A", posted_date="2026-01-01", deadline="2999-01-01")
    upsert("filtered", 1, "old-no-deadline", title="B", posted_date="2026-01-01", archive_date="2999-01-01")
    upsert("filtered", 1, "old-closed", title="C", posted_date="2026-01-01", deadline="2026-02-01")
    with repository.connect() as conn:
        assert repository.purge_filtered(conn, "2026-06-01") == 1
    with repository.connect() as conn:
        left = {r[0] for r in conn.execute("SELECT notice_id FROM opportunities")}
    assert left == {"old-open", "old-no-deadline"}


def test_purge_removes_only_old_offers_filtered_by_the_tool():
    upsert("filtered", 1, "old-filtered", title="A", posted_date="2026-01-01", archive_date="2026-02-01")
    upsert("filtered", 1, "recent-filtered", title="B", posted_date="2026-09-25")
    upsert("active", 1, "old-active", title="C", posted_date="2026-01-01")
    upsert("filtered", 1, "old-kept", title="D", posted_date="2026-01-01")
    repository.set_status("old-kept", "active")          # kept by hand
    upsert("active", 1, "old-discarded", title="E", posted_date="2026-01-01")
    repository.set_status("old-discarded", "discarded")  # discarded by hand
    with repository.connect() as conn:
        assert repository.purge_filtered(conn, "2026-06-01") == 1
    with repository.connect() as conn:
        left = {r[0] for r in conn.execute("SELECT notice_id FROM opportunities")}
    assert left == {"recent-filtered", "old-active", "old-kept", "old-discarded"}
    repository.compact()  # must not fail


def test_list_columns_cover_every_column_but_description():
    with repository.connect() as conn:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(opportunities)")}
    listed = {c.strip() for c in repository.LIST_COLUMNS.split(",")}
    assert listed == cols - {"description"}


def test_search_still_looks_in_descriptions():
    upsert("active", 1, "n1", title="Plain title")
    with repository.connect() as conn:
        conn.execute("UPDATE opportunities SET description = 'needle in here'")
    assert ids(q="needle") == ["n1"]


def test_group_shows_best_score_and_its_keywords():
    """The latest version (e.g. 'Intent to Award') may have no keywords: show the best one."""
    with repository.connect() as conn:
        old = Offer("v1", "Old", solicitation_number="S1", agency="DLA", posted_date="2026-09-01")
        new = Offer("v2", "Intent to Award", solicitation_number="S1", agency="DLA", posted_date="2026-09-14")
        repository.upsert_offer(conn, old, 4, ["web design"], "active", 1)
        repository.upsert_offer(conn, new, 0, [], "filtered", 1)
        repository.sync_groups(conn, 1)
    rows, _ = repository.list_offers(OfferFilters(open_only=False))
    assert len(rows) == 1
    row = rows[0]
    assert (row["notice_id"], row["title"]) == ("v2", "Intent to Award")  # latest version shown
    assert (row["score"], row["matched_keywords"]) == (4, "web design")  # best score kept
    assert ids(open_only=False, min_score=3) == ["v2"]  # filters use the group score too


def test_offers_saved_by_a_failed_run_count_as_new_in_the_next_run():
    failed = repository.start_run("csv")
    upsert("active", failed, "n1", title="Saved before the crash")
    repository.finish_run(failed, 1, 1, 0, "Network error")
    ok = repository.start_run("csv")
    with repository.connect() as conn:
        repository.adopt_unfinished_runs(conn, ok)
        assert repository.count_new_groups(conn, ok) == 1
    repository.finish_run(ok, 1, 1, 1, None)
    rows, _ = repository.list_offers(OfferFilters())
    assert rows[0]["group_new_run"] == ok  # NEW tag shown after the good run


def test_purge_keeps_old_versions_of_offers_still_shown():
    upsert("active", 1, "v-new", title="T", solicitation_number="S1", agency="A", posted_date="2026-09-20")
    upsert("filtered", 1, "v-old", title="T", solicitation_number="S1", agency="A",
           posted_date="2026-01-01", sync=False)
    with repository.connect() as conn:
        assert repository.purge_filtered(conn, "2026-06-01") == 0
    assert status_of("v-old") == "filtered"  # still there: its offer is shown


def test_compact_does_not_fail_when_the_database_is_busy(monkeypatch):
    monkeypatch.setattr(repository, "BUSY_TIMEOUT", 0.1)
    reader = repository.sqlite3.connect(repository.DB_FILE)
    reader.execute("BEGIN IMMEDIATE")  # someone else holds a write lock
    try:
        assert repository.compact() is False
    finally:
        reader.rollback()
        reader.close()
    assert repository.compact() is True


def test_search_percent_and_underscore_are_literal():
    upsert("active", 1, "pct", title="Save 50% now")
    upsert("active", 1, "other", title="Save 500 now")
    upsert("active", 1, "under", title="file_name here")
    upsert("active", 1, "no-under", title="fileXname here")
    assert ids(q="50%") == ["pct"]
    assert ids(q="file_name") == ["under"]


def test_posted_within_filter():
    from datetime import date, timedelta
    for nid, days_ago in (("d10", 10), ("d60", 60), ("d120", 120), ("d400", 400)):
        upsert("active", 1, nid, title=nid, posted_date=(date.today() - timedelta(days=days_ago)).isoformat())
    assert set(ids(posted_within=30)) == {"d10"}
    assert set(ids(posted_within=90)) == {"d10", "d60"}
    assert set(ids(posted_within=180)) == {"d10", "d60", "d120"}
    assert set(ids()) == {"d10", "d60", "d120", "d400"}  # any time
