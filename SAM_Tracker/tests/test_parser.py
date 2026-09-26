import csv
from datetime import date

import pytest

from app.parser import CSV_COLUMNS, CsvFormatError, parse_date, read_csv

HEADER = list(CSV_COLUMNS.values()) + ["PopCity", "PopState", "PopCountry", "Extra"]


def write_csv(path, rows, encoding="utf-8", header=HEADER):
    with open(path, "w", encoding=encoding, newline="") as f:
        w = csv.DictWriter(f, fieldnames=header)
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in header})


def row(notice_id, posted, title="Title", **extra):
    return {"NoticeId": notice_id, "Title": title, "PostedDate": posted, "Type": "Solicitation", **extra}


def test_parse_date():
    assert parse_date("2026-09-25 10:41:47") == date(2026, 9, 25)
    assert parse_date("2026-09-25T09:00:00-04:00") == date(2026, 9, 25)
    assert parse_date("") is None


def test_filters_by_date(tmp_path):
    path = tmp_path / "f.csv"
    write_csv(path, [
        row("a", "2026-09-25 10:00:00"),
        row("b", "2026-08-01 10:00:00", ArchiveDate="2026-09-01"),  # old and archived
        row("c", ""),
    ])
    offers = list(read_csv(path, since=date(2026, 9, 1), today=date(2026, 9, 26)))
    assert [o.notice_id for o in offers] == ["a"]


def test_older_offers_still_open_are_kept(tmp_path):
    path = tmp_path / "f.csv"
    write_csv(path, [
        row("open-deadline", "2026-07-01", ResponseDeadLine="2030-06-12T12:00:00-04:00", ArchiveDate="2030-07-01"),
        row("no-deadline", "2026-07-01", ArchiveDate="2026-12-01"),
        row("deadline-passed", "2026-07-01", ResponseDeadLine="2026-09-01", ArchiveDate="2026-12-01"),
        row("archived", "2026-07-01", ResponseDeadLine="2030-01-01", ArchiveDate="2026-09-20"),
    ])
    offers = list(read_csv(path, since=date(2026, 9, 1), today=date(2026, 9, 26)))
    assert [o.notice_id for o in offers] == ["open-deadline", "no-deadline"]


def test_deadline_without_time_zone_gets_us_eastern():
    from app.parser import normalize_deadline
    assert normalize_deadline("2026-10-30T23:59:00") == "2026-10-30T23:59:00-04:00"  # EDT
    assert normalize_deadline("2026-12-30T23:59:00") == "2026-12-30T23:59:00-05:00"  # EST
    assert normalize_deadline("2026-10-30T23:59:00+01:00") == "2026-10-30T23:59:00+01:00"
    assert normalize_deadline("2026-10-30") == "2026-10-30"
    assert normalize_deadline("") == ""


def test_maps_fields_and_place(tmp_path):
    path = tmp_path / "f.csv"
    write_csv(path, [row("a", "2026-09-25", title="  Web design  ", PopCity="Atlanta", PopState="GA")])
    offer = next(read_csv(path, since=date(2026, 1, 1)))
    assert offer.title == "Web design"
    assert offer.type == "Solicitation"
    assert offer.place == "Atlanta, GA"


def test_windows_1252_file(tmp_path):
    path = tmp_path / "f.csv"
    write_csv(path, [row("a", "2026-09-25", title="Café branding")], encoding="cp1252")
    assert next(read_csv(path, since=date(2026, 1, 1))).title == "Café branding"


def test_mixed_utf8_and_windows_1252_lines(tmp_path):
    """The real SAM.gov file mixes both encodings: each line must be decoded correctly."""
    path = tmp_path / "f.csv"
    utf8_part = tmp_path / "utf8.csv"
    write_csv(utf8_part, [row("b", "2026-09-25", title="Café branding ’s")], encoding="utf-8")
    header, utf8_line = utf8_part.read_bytes().split(b"\r\n", 1)
    cp1252_part = tmp_path / "cp.csv"
    write_csv(cp1252_part, [row("a", "2026-09-25", title="Tree Cutting – USDA")], encoding="cp1252")
    cp1252_line = cp1252_part.read_bytes().split(b"\r\n", 1)[1]
    path.write_bytes("﻿".encode("utf-8") + header + b"\r\n" + cp1252_line + utf8_line)

    titles = [o.title for o in read_csv(path, since=date(2026, 1, 1))]
    assert titles == ["Tree Cutting – USDA", "Café branding ’s"]


def test_both_encodings_in_the_same_line():
    from app.parser import decode_line
    raw = "“quoted” ".encode("utf-8") + "– dash".encode("cp1252")
    assert decode_line(raw) == "“quoted” – dash"


def test_rows_without_notice_id_are_skipped(tmp_path):
    path = tmp_path / "f.csv"
    write_csv(path, [row("", "2026-09-25"), row("a", "2026-09-25")])
    assert [o.notice_id for o in read_csv(path, since=date(2026, 1, 1))] == ["a"]


def test_archive_date_is_read(tmp_path):
    path = tmp_path / "f.csv"
    write_csv(path, [row("a", "2026-09-25", ArchiveDate="2026-10-13")])
    assert next(read_csv(path, since=date(2026, 1, 1))).archive_date == "2026-10-13"


def test_missing_column_raises(tmp_path):
    path = tmp_path / "f.csv"
    write_csv(path, [], header=["NoticeId", "Title"])
    with pytest.raises(CsvFormatError):
        list(read_csv(path, since=date(2026, 1, 1)))
