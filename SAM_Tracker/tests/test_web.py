"""Smoke tests of the pages, with a temporary database."""
import pytest

from app import main, repository
from app.models import Offer


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app import config
    monkeypatch.setattr(repository, "DB_FILE", tmp_path / "test.db")
    monkeypatch.setattr(config, "CONFIG_FILE", tmp_path / "settings.yaml")  # never the real one
    monkeypatch.setattr(config, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(main, "setup_logging", lambda: None)
    app = main.create_app()
    app.config["TESTING"] = True
    run_id = repository.start_run("csv")
    with repository.connect() as conn:
        for nid, posted in (("v1", "2026-09-01"), ("v2", "2026-09-10")):
            offer = Offer(nid, "Web design services", agency="DOD", type="Solicitation",
                          solicitation_number="S1", posted_date=posted, deadline="2999-01-01")
            repository.upsert_offer(conn, offer, 4, ["web design"], "active", run_id)
        repository.sync_groups(conn, run_id)
    repository.finish_run(run_id, 2, 2, 1, None)
    return app.test_client()


def test_dashboard(client):
    page = client.get("/").get_data(as_text=True)
    assert "Open offers" in page
    assert "Run the tool" in page


def test_offers_page_shows_group_once_with_title_and_new_tag(client):
    page = client.get("/offers").get_data(as_text=True)
    assert "<h1>Offers</h1>" in page
    assert page.count('class="offer-title"') == 1
    assert "2 versions" in page
    assert "badge-new" in page


def test_discard_then_restore(client):
    assert client.post("/api/offers/v1/discard").get_json()["ok"]
    assert "offer-title" not in client.get("/offers").get_data(as_text=True)
    assert "offer-title" in client.get("/offers?view=discarded").get_data(as_text=True)
    assert client.post("/api/offers/v2/restore").get_json()["ok"]
    assert "offer-title" in client.get("/offers").get_data(as_text=True)


def test_unknown_action_is_rejected(client):
    assert client.post("/api/offers/v1/explode").status_code == 400


def test_quit_schedules_exit(client, monkeypatch):
    calls = []

    class FakeTimer:
        def __init__(self, delay, fn, args=()):
            calls.append((fn, args))

        def start(self):
            pass

    monkeypatch.setattr(main.threading, "Timer", FakeTimer)
    assert client.post("/api/quit").get_json()["ok"]
    assert calls and calls[0][1] == (0,)


def test_other_websites_cannot_post(client):
    evil = {"Origin": "https://evil.example"}
    assert client.post("/api/offers/v1/discard", headers=evil).status_code == 403
    assert client.post("/api/quit", headers=evil).status_code == 403
    ok = client.post("/api/offers/v1/discard", headers={"Origin": "http://127.0.0.1:5000"})
    assert ok.status_code == 200


def test_unknown_host_is_refused(client):
    assert client.get("/", headers={"Host": "attacker.example:5000"}).status_code == 403


def test_bad_config_shows_message_instead_of_crashing(client, tmp_path, monkeypatch):
    from app import config
    bad = tmp_path / "config.yaml"
    bad.write_text("keywords: [\n", encoding="utf-8")
    monkeypatch.setattr(config, "CONFIG_FILE", bad)
    for url in ("/", "/offers"):
        response = client.get(url)
        assert response.status_code == 200
        assert "Settings problem" in response.get_data(as_text=True)


def test_short_date_converts_to_local_time():
    from datetime import datetime
    expected = datetime.fromisoformat("2026-09-28T07:30:00-04:00").astimezone().strftime("%Y-%m-%d %H:%M")
    assert main.short_date("2026-09-28T07:30:00-04:00") == expected
    assert main.short_date("2026-09-28") == "2026-09-28"
    assert main.short_date("2026-09-25 10:41:47") == "2026-09-25 10:41"
    assert main.short_date("") == "-"


def test_descriptions_load_only_when_opened(client, monkeypatch):
    from app import repository as repo
    with repo.connect() as conn:
        conn.execute("UPDATE opportunities SET description = 'Secret long text about Web design and a website.'")
    page = client.get("/offers").get_data(as_text=True)
    assert "Secret long text" not in page  # not in the list page anymore
    assert "/api/offers/v2/description" in page

    html = client.get("/api/offers/v2/description").get_json()["html"]
    assert "Secret long text" in html
    assert "<mark>Web design</mark>" in html
    assert client.get("/api/offers/nope/description").status_code == 404


def test_title_only_keywords_are_not_highlighted_in_descriptions(client, tmp_path, monkeypatch):
    from app import config, repository as repo
    cfg = tmp_path / "config.yaml"
    cfg.write_text("keywords:\n  web design: 2\n  website: {weight: 1, title_only: true}\n", encoding="utf-8")
    monkeypatch.setattr(config, "CONFIG_FILE", cfg)
    with repo.connect() as conn:
        conn.execute("UPDATE opportunities SET description = 'Web design, see the website.', "
                     "matched_keywords = 'web design, website'")
    html = client.get("/api/offers/v2/description").get_json()["html"]
    assert "<mark>Web design</mark>" in html
    assert "<mark>website</mark>" not in html


def test_only_web_links_are_kept():
    assert main.safe_url("https://sam.gov/opp/1/view") == "https://sam.gov/opp/1/view"
    assert main.safe_url("javascript:alert(1)") == ""
    assert main.safe_url(" JavaScript:alert(1)") == ""
    assert main.safe_url("") == ""


def test_min_score_ignores_nan_and_inf():
    for value in ("nan", "inf", "-inf", "abc"):
        assert main.parse_filters({"min_score": value}, []).min_score is None
    assert main.parse_filters({"min_score": "2.5"}, []).min_score == 2.5


def test_posted_filter_values():
    assert main.parse_filters({"posted": "90"}, []).posted_within == 90
    for value in ("", "7", "abc", "-30", "999999"):
        assert main.parse_filters({"posted": value}, []).posted_within is None  # any time


def test_posted_menu_is_shown(client):
    page = client.get("/offers?posted=180").get_data(as_text=True)
    assert '<option value="180" selected>Last 180 days</option>' in page
    assert "Any time" in page


def test_api_option_is_gone(client):
    page = client.get("/").get_data(as_text=True)
    assert "API key" not in page and 'name="source"' not in page
    assert client.post("/settings/api-key", data={"api_key": "x"}).status_code == 404


def test_only_the_csv_source_exists():
    import pytest
    from app.config import load_settings_or_default
    from app.fetcher import CsvSource, FetchError, get_source
    settings, _ = load_settings_or_default()
    assert isinstance(get_source("csv", settings), CsvSource)
    with pytest.raises(FetchError):
        get_source("api", settings)


def test_whoami_gives_the_data_folder(client):
    from app import config
    data = client.get("/api/whoami").get_json()
    assert data == {"app": "SAM Tracker", "home": str(config.USER_DIR)}


def test_source_and_installed_copies_use_different_ports():
    import importlib
    import sys as _sys
    from app import config
    assert config.PORT == 8766  # tests run from source
    _sys.frozen = True
    try:
        assert importlib.reload(config).PORT == 8765  # the installed app
    finally:
        del _sys.frozen
        importlib.reload(config)


def test_launcher_only_reuses_its_own_copy(monkeypatch, tmp_path):
    import launcher
    from app import config
    monkeypatch.setattr(config, "USER_DIR", tmp_path)
    assert launcher.same_home(str(tmp_path))
    assert not launcher.same_home(str(tmp_path / "other"))
