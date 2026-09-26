"""All SQLite access lives here.

Duplicates: every version of the same opportunity (amendments, reposts) shares a
`group_key`. The UI shows one row per group, the most recent version, and user
actions (discard, restore, keep) apply to the whole group.
"""
from __future__ import annotations

import logging
import sqlite3
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from typing import Iterator

from .config import DB_FILE
from .models import Offer, group_key

log = logging.getLogger(__name__)

# status:
#   active    -> score >= min_score, shown on the Offers page
#   filtered  -> score too low or excluded keyword, shown on the Filtered page
#   discarded -> removed by the user
# manual = 1 when the user changed the status by hand. Runs never override it.
# new_in_run_id = the run in which the row first became active (drives the NEW tag).
SCHEMA = """
CREATE TABLE IF NOT EXISTS opportunities (
    notice_id           TEXT PRIMARY KEY,
    title               TEXT NOT NULL,
    solicitation_number TEXT,
    group_key           TEXT,
    agency              TEXT,
    sub_agency          TEXT,
    type                TEXT,
    posted_date         TEXT,
    deadline            TEXT,
    archive_date        TEXT,
    naics               TEXT,
    set_aside           TEXT,
    place               TEXT,
    contact_name        TEXT,
    contact_email       TEXT,
    url                 TEXT,
    description         TEXT,
    score               REAL,
    matched_keywords    TEXT,
    status              TEXT NOT NULL DEFAULT 'active',
    manual              INTEGER NOT NULL DEFAULT 0,
    new_in_run_id       INTEGER,
    first_seen_at       TEXT,
    discarded_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_opp_status ON opportunities (status, posted_date);

CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT,
    started_at  TEXT,
    finished_at TEXT,
    rows_read   INTEGER DEFAULT 0,
    matched     INTEGER DEFAULT 0,
    new_offers  INTEGER DEFAULT 0,
    error       TEXT
);
"""

# Columns added after the first version: {name: type}. Added on startup if missing.
MIGRATIONS = {"solicitation_number": "TEXT", "group_key": "TEXT", "archive_date": "TEXT"}

# Wait this long for the database instead of failing with "database is locked"
# (a run writes in batches; user clicks wait for the current batch to finish).
BUSY_TIMEOUT = 30  # seconds

STATUSES = ("active", "filtered", "discarded")
MAX_ROWS = 500  # groups rendered per page, the rest is reachable with filters


def now() -> str:
    return datetime.now().isoformat(sep=" ", timespec="seconds")


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_FILE, timeout=BUSY_TIMEOUT)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)
        _migrate(conn)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_opp_group ON opportunities (group_key)")


def _migrate(conn: sqlite3.Connection) -> None:
    existing = {r["name"] for r in conn.execute("PRAGMA table_info(opportunities)")}
    for name, sql_type in MIGRATIONS.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE opportunities ADD COLUMN {name} {sql_type}")
    # Rows stored before grouping existed: key them on title + agency for now.
    # The next run refreshes them with the solicitation number.
    rows = conn.execute("SELECT notice_id, title, agency FROM opportunities WHERE group_key IS NULL").fetchall()
    conn.executemany(
        "UPDATE opportunities SET group_key=? WHERE notice_id=?",
        [(group_key(Offer(r["notice_id"], r["title"], agency=r["agency"] or "")), r["notice_id"]) for r in rows],
    )


# ---------- runs ----------

def start_run(source: str) -> int:
    with connect() as conn:
        cur = conn.execute("INSERT INTO runs (source, started_at) VALUES (?, ?)", (source, now()))
        return int(cur.lastrowid)


def finish_run(run_id: int, rows_read: int, matched: int, new_offers: int, error: str | None) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE runs SET finished_at=?, rows_read=?, matched=?, new_offers=?, error=? WHERE id=?",
            (now(), rows_read, matched, new_offers, error, run_id),
        )


def mark_interrupted_runs() -> None:
    """Runs left unfinished because the app stopped. Called at startup."""
    with connect() as conn:
        conn.execute(
            "UPDATE runs SET finished_at=?, error='Interrupted (the app stopped during the run)' "
            "WHERE finished_at IS NULL",
            (now(),),
        )


def last_successful_run_id(conn: sqlite3.Connection) -> int | None:
    row = conn.execute(
        "SELECT id FROM runs WHERE finished_at IS NOT NULL AND error IS NULL ORDER BY id DESC LIMIT 1"
    ).fetchone()
    return row["id"] if row else None


def get_last_run_id() -> int | None:
    with connect() as conn:
        return last_successful_run_id(conn)


def recent_runs(limit: int = 5) -> list[dict]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]


# ---------- writing offers ----------

def upsert_offer(conn: sqlite3.Connection, offer: Offer, score: float,
                 matched: list[str], status: str, run_id: int) -> None:
    """Insert or refresh one version with the status computed by the scorer.

    A status the user set by hand (manual = 1) is kept, and a new version of a
    group the user already handled takes that status too.
    """
    key = group_key(offer)
    old = conn.execute(
        "SELECT status, manual FROM opportunities WHERE notice_id=?", (offer.notice_id,)
    ).fetchone()
    values = asdict(offer) | {"group_key": key, "score": score, "matched_keywords": ", ".join(matched)}

    if old is None:
        manual = conn.execute(
            "SELECT status FROM opportunities WHERE group_key=? AND manual=1 LIMIT 1", (key,)
        ).fetchone()
        if manual:
            status = manual["status"]
        values |= {
            "status": status,
            "manual": 1 if manual else 0,
            "new_in_run_id": run_id if status == "active" else None,
            "first_seen_at": now(),
        }
        cols = list(values)
        conn.execute(
            f"INSERT INTO opportunities ({', '.join(cols)}) VALUES ({', '.join(':' + c for c in cols)})",
            values,
        )
        return

    new_status = old["status"] if old["manual"] else status
    values["status"] = new_status
    if new_status == "active" and old["status"] != "active":
        values["new_in_run_id"] = run_id
    cols = [c for c in values if c != "notice_id"]
    conn.execute(
        f"UPDATE opportunities SET {', '.join(f'{c}=:{c}' for c in cols)} WHERE notice_id=:notice_id",
        values,
    )


def sync_groups(conn: sqlite3.Connection, run_id: int) -> None:
    """A group is active if any of its versions is: activate the other versions too."""
    conn.execute(
        """UPDATE opportunities SET status='active', new_in_run_id=COALESCE(new_in_run_id, ?)
           WHERE manual=0 AND status='filtered'
             AND group_key IN (SELECT group_key FROM opportunities WHERE status='active')""",
        (run_id,),
    )


def rows_before(conn: sqlite3.Connection, since: str) -> list[sqlite3.Row]:
    """Offers posted before `since` (YYYY-MM-DD), not in today's data, not handled by hand.

    Used to re-score them with the current keywords.
    """
    return conn.execute(
        "SELECT notice_id, title, description, status FROM opportunities "
        "WHERE manual = 0 AND substr(posted_date, 1, 10) < ?",
        (since,),
    ).fetchall()


def update_score(conn: sqlite3.Connection, row: sqlite3.Row, score: float,
                 matched: list[str], status: str, run_id: int) -> None:
    becomes_active = status == "active" and row["status"] != "active"
    conn.execute(
        """UPDATE opportunities SET score=?, matched_keywords=?, status=?,
               new_in_run_id = CASE WHEN ? THEN ? ELSE new_in_run_id END
           WHERE notice_id=?""",
        (score, ", ".join(matched), status, becomes_active, run_id, row["notice_id"]),
    )


def purge_filtered(conn: sqlite3.Connection, before: str) -> int:
    """Delete closed offers the tool filtered out, posted before `before` (YYYY-MM-DD).

    Never touches offers still open (they would come back at every run), offers
    the user handled by hand, nor any version of an offer still shown somewhere
    (active or discarded), so its history stays whole.
    Call it after sync_groups. Returns the number deleted.
    """
    cur = conn.execute(
        f"""DELETE FROM opportunities
            WHERE status = 'filtered' AND manual = 0 AND substr(posted_date, 1, 10) < ?
              AND (({DEADLINE_PASSED_SQL}) = 1 OR ({ARCHIVED_SQL}) = 1)
              AND group_key NOT IN (SELECT group_key FROM opportunities WHERE status <> 'filtered')""",
        (before,),
    )
    return cur.rowcount


def compact() -> bool:
    """Give the space of deleted rows back to the disk (rewrites the file).

    Optional housekeeping: if a page is reading the database at that moment,
    skip it (next run will do it) instead of failing the run.
    """
    try:
        with connect() as conn:
            conn.execute("VACUUM")
        return True
    except sqlite3.OperationalError as e:
        log.warning("Database compaction skipped (%s), will retry on a later run", e)
        return False


def adopt_unfinished_runs(conn: sqlite3.Connection, run_id: int) -> None:
    """Offers first saved by a run that failed or was interrupted count as new in this run.

    Runs save in batches, so a failed run can leave offers behind; without this they
    would never get the NEW tag (they would look already seen).
    """
    conn.execute(
        """UPDATE opportunities SET new_in_run_id = ?
           WHERE new_in_run_id IN (SELECT id FROM runs WHERE id <> ? AND (error IS NOT NULL OR finished_at IS NULL))""",
        (run_id, run_id),
    )


def get_description(notice_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT description, matched_keywords FROM opportunities WHERE notice_id = ?", (notice_id,)
        ).fetchone()
        return dict(row) if row else None


def count_new_groups(conn: sqlite3.Connection, run_id: int) -> int:
    """Groups that became active for the first time in this run."""
    return conn.execute(
        """SELECT COUNT(*) FROM (
             SELECT group_key FROM opportunities WHERE status='active'
             GROUP BY group_key HAVING MIN(new_in_run_id) = ?)""",
        (run_id,),
    ).fetchone()[0]


def set_status(notice_id: str, status: str) -> bool:
    """User action on an offer: applies to every version of it. Runs leave it alone."""
    if status not in STATUSES:
        raise ValueError(status)
    discarded_at = now() if status == "discarded" else None
    with connect() as conn:
        cur = conn.execute(
            """UPDATE opportunities SET status=?, manual=1, discarded_at=?
               WHERE group_key = (SELECT group_key FROM opportunities WHERE notice_id=?)""",
            (status, discarded_at, notice_id),
        )
        return cur.rowcount > 0


# ---------- reading offers (one row per group) ----------

# Deadline passed, at the exact time and time zone given by SAM.gov
# ("2026-09-28T07:30:00-04:00"). A date without time counts until the end of that day.
DEADLINE_PASSED_SQL = """
    CASE
        WHEN deadline IS NULL OR deadline = '' THEN 0
        WHEN length(deadline) <= 10 THEN deadline < date('now', 'localtime')
        ELSE COALESCE(datetime(deadline) < datetime('now'),
                      substr(deadline, 1, 10) < date('now', 'localtime'))
    END
"""
# SAM.gov archives every notice after its archive date, even without a deadline.
ARCHIVED_SQL = """
    CASE WHEN archive_date IS NULL OR archive_date = '' THEN 0
         ELSE substr(archive_date, 1, 10) < date('now', 'localtime') END
"""

# Every column except the (large) description: lists never need it, and reading
# 30,000 descriptions made the "Filtered out" page slow. It is loaded on demand.
LIST_COLUMNS = """
    notice_id, title, solicitation_number, group_key, agency, sub_agency, type, posted_date,
    deadline, archive_date, naics, set_aside, place, contact_name, contact_email, url,
    score, matched_keywords, status, manual, new_in_run_id, first_seen_at, discarded_at
"""
# In lists, score and keywords are those of the group's best version: an amendment
# like "Intent to Award" often has no keywords although the offer matched.
_GROUP_COLUMNS = LIST_COLUMNS.replace(
    "score, matched_keywords,",
    """MAX(score) OVER (PARTITION BY group_key) AS score,
       FIRST_VALUE(matched_keywords) OVER (
           PARTITION BY group_key ORDER BY score DESC, posted_date DESC) AS matched_keywords,""",
)

# Latest version of each group with a given status, plus group-level fields.
GROUPS_SQL = f"""
    WITH ranked AS (
        SELECT {_GROUP_COLUMNS},
            ROW_NUMBER() OVER (PARTITION BY group_key ORDER BY posted_date DESC) AS rn,
            COUNT(*) OVER (PARTITION BY group_key) AS versions,
            MIN(new_in_run_id) OVER (PARTITION BY group_key) AS group_new_run,
            {DEADLINE_PASSED_SQL} AS deadline_passed,
            {ARCHIVED_SQL} AS archived
        FROM opportunities WHERE status = ?
    )
    SELECT * FROM ranked WHERE rn = 1
"""


@dataclass
class OfferFilters:
    status: str = "active"
    type: str | None = None
    min_score: float | None = None
    q: str | None = None
    sort: str = "score"  # key of SORT_ORDERS
    open_only: bool = True  # hide expired offers and closed types
    closed_types: list[str] = field(default_factory=list)
    new_in_run: int | None = None  # only groups that are new in this run
    posted_within: int | None = None  # days; None = any time


SORT_ORDERS = {
    "score": "score DESC, posted_date DESC",
    "date": "posted_date DESC, score DESC",
}


def _open_condition(closed_types: list[str]) -> tuple[str, list]:
    """Still possible to answer: deadline not passed, not archived, type not closed.

    Applies to the rows of GROUPS_SQL (uses its computed columns).
    """
    sql = "deadline_passed = 0 AND archived = 0"
    if closed_types:
        sql += f" AND type NOT IN ({', '.join('?' * len(closed_types))})"
    return sql, list(closed_types)


def _escape_like(text: str) -> str:
    """Search for '50%' or 'a_b' literally: % and _ are wildcards in SQL LIKE."""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _conditions(f: OfferFilters) -> tuple[str, list]:
    """Extra conditions on the latest version of each group."""
    sql: list[str] = []
    params: list = []
    if f.open_only:
        cond, cond_params = _open_condition(f.closed_types)
        sql.append(f"AND {cond}")
        params += cond_params
    if f.type:
        sql.append("AND type = ?")
        params.append(f.type)
    if f.min_score is not None:
        sql.append("AND score >= ?")
        params.append(f.min_score)
    if f.posted_within:
        sql.append("AND substr(posted_date, 1, 10) >= ?")
        params.append((date.today() - timedelta(days=f.posted_within)).isoformat())
    if f.q:
        sql.append("AND (title LIKE ? ESCAPE '\\' OR agency LIKE ? ESCAPE '\\' OR notice_id IN "
                   "(SELECT notice_id FROM opportunities WHERE description LIKE ? ESCAPE '\\'))")
        params += [f"%{_escape_like(f.q)}%"] * 3
    if f.new_in_run is not None:
        sql.append("AND group_new_run = ?")
        params.append(f.new_in_run)
    return " ".join(sql), params


def list_offers(f: OfferFilters, limit: int = MAX_ROWS) -> tuple[list[dict], int]:
    """One row per group, sorted by f.sort. Returns (rows, total groups matching).

    Rows with several versions get `other_versions`: the older ones, newest first.
    """
    conds, params = _conditions(f)
    base = f"{GROUPS_SQL} {conds}"
    all_params = [f.status, *params]
    order = SORT_ORDERS.get(f.sort, SORT_ORDERS["score"])
    with connect() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM ({base})", all_params).fetchone()[0]
        rows = [dict(r) for r in conn.execute(f"{base} ORDER BY {order} LIMIT ?", [*all_params, limit])]

        grouped = {r["group_key"]: r for r in rows if r["versions"] > 1}
        for r in rows:
            r["other_versions"] = []
        if grouped:
            marks = ", ".join("?" * len(grouped))
            for v in conn.execute(
                f"""SELECT notice_id, group_key, type, posted_date, deadline, url FROM opportunities
                    WHERE status = ? AND group_key IN ({marks}) ORDER BY posted_date DESC""",
                [f.status, *grouped],
            ):
                row = grouped[v["group_key"]]
                if v["notice_id"] != row["notice_id"]:
                    row["other_versions"].append(dict(v))
        return rows, total


def list_types(status: str) -> list[str]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT DISTINCT type FROM opportunities WHERE status=? ORDER BY type", (status,)
        ).fetchall()
        return [r["type"] for r in rows]


def dashboard_stats(closed_types: list[str]) -> dict:
    """Counts for the dashboard, in groups (an offer and its amendments count once)."""
    open_sql, open_params = _open_condition(closed_types)
    active = f"SELECT * FROM ({GROUPS_SQL})"
    with connect() as conn:
        last_id = last_successful_run_id(conn)
        counts = dict(conn.execute(
            "SELECT status, COUNT(DISTINCT group_key) FROM opportunities GROUP BY status"
        ).fetchall())
        open_count = conn.execute(
            f"SELECT COUNT(*) FROM ({active} WHERE {open_sql})", ["active", *open_params]
        ).fetchone()[0]
        new = conn.execute(
            f"SELECT COUNT(*) FROM ({active} WHERE {open_sql} AND group_new_run = ?)",
            ["active", *open_params, last_id],
        ).fetchone()[0] if last_id else 0
        by_type = conn.execute(
            f"SELECT type, COUNT(*) AS n FROM ({active} WHERE {open_sql}) GROUP BY type ORDER BY n DESC",
            ["active", *open_params],
        ).fetchall()
        return {
            **{s: counts.get(s, 0) for s in STATUSES},
            "open": open_count,
            "closed": counts.get("active", 0) - open_count,
            "new": new,
            "by_type": [dict(r) for r in by_type],
            "last_run_id": last_id,
        }
