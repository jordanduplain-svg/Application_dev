"""The Settings page: show, save, refuse invalid input, reset."""
import pytest

from app import config, main, repository


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(repository, "DB_FILE", tmp_path / "test.db")
    monkeypatch.setattr(config, "CONFIG_FILE", tmp_path / "settings.yaml")
    monkeypatch.setattr(config, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(main, "setup_logging", lambda: None)
    return main.create_app().test_client()


def form(**extra):
    """A valid form with two keywords, the second one title only."""
    data = {
        "kw_index": ["0", "1"], "kw_text": ["web design", "website"], "kw_weight": ["2", "1"],
        "kw_title_only": ["1"], "exclude_keywords": "radio\n\ncommand\n", "closed_types": "Award Notice",
        "min_score": "3", "days_back": "30", "keep_filtered_days": "90",
    }
    return data | extra


def test_page_lists_all_default_keywords(client):
    page = client.get("/settings").get_data(as_text=True)
    default_count = len(config.load_settings().keywords)  # first launch copied the defaults
    assert page.count('name="kw_text"') == default_count + 1  # + the hidden "new row" template
    assert 'value="marketing"' in page


def test_save(client):
    response = client.post("/settings", data=form())
    assert response.status_code == 302
    s = config.load_settings()
    assert [(k.text, k.weight, k.title_only) for k in s.keywords] == [("web design", 2, False), ("website", 1, True)]
    assert s.exclude_keywords == ["radio", "command"]
    assert s.min_score == 3
    assert "Settings saved" in client.get("/settings?done=saved").get_data(as_text=True)


def test_empty_rows_are_ignored(client):
    data = form(kw_index=["0", "1", "7"], kw_text=["web design", "website", "   "], kw_weight=["2", "1", "2"])
    assert client.post("/settings", data=data).status_code == 302
    assert len(config.load_settings().keywords) == 2


@pytest.mark.parametrize("extra, message", [
    ({"kw_text": ["web design", "Web  Design"]}, "twice"),
    ({"days_back": "0"}, "Days to look back"),
    ({"min_score": "high"}, "Minimum score"),
    ({"kw_weight": ["2", "lots"]}, "must be a number"),
])
def test_invalid_input_is_not_saved_and_typing_is_kept(client, extra, message):
    before = config.CONFIG_FILE.read_text(encoding="utf-8")
    response = client.post("/settings", data=form(**extra))
    page = response.get_data(as_text=True)
    assert response.status_code == 400
    assert "Not saved" in page and message in page
    assert 'value="web design"' in page  # what was typed is still there
    assert config.CONFIG_FILE.read_text(encoding="utf-8") == before


def test_reset_to_defaults(client):
    client.post("/settings", data=form())
    assert client.post("/settings/reset").status_code == 302
    assert len(config.load_settings().keywords) >= 130


def test_other_websites_cannot_change_settings(client):
    response = client.post("/settings", data=form(), headers={"Origin": "https://evil.example"})
    assert response.status_code == 403
