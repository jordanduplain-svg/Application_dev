import pytest

from app import config
from app.config import ConfigError


@pytest.fixture
def write_config(tmp_path, monkeypatch):
    path = tmp_path / "config.yaml"
    monkeypatch.setattr(config, "CONFIG_FILE", path)

    def write(text):
        path.write_text(text, encoding="utf-8")
    return write


def test_minimal_config_uses_defaults(write_config):
    write_config("keywords:\n  marketing: 2\n")
    s = config.load_settings()
    assert s.csv_url == config.DEFAULT_CSV_URL
    assert (s.min_score, s.days_back) == (2, 30)


@pytest.mark.parametrize("text, message", [
    ("keywords:\n  marketing: 2\n bad indent: [\n", "typo"),
    ("keywords:\n  marketing: lots\n", "must be a number"),
    ("keywords:\n  '': 2\n", "keyword is empty"),
    ("keywords:\n  - marketing\n", "'keywords' must be"),
    ("days_back: 0\n", "Days to look back"),
    ("exclude_keywords: ['', radio]\n", "excluded word is empty"),
    ("days_back: 30\nkeep_filtered_days: 10\n", "Keep filtered-out offers"),
    ("keywords:\n  Web: 1\n  web: 2\n", "twice"),
])
def test_invalid_config_gives_readable_error(write_config, text, message):
    write_config(text)
    with pytest.raises(ConfigError, match=message):
        config.load_settings()


def test_pages_get_defaults_and_the_error(write_config):
    write_config("keywords: [\n")
    settings, error = config.load_settings_or_default()
    assert "typo" in error
    assert settings.closed_types == ["Award Notice", "Justification"]


def test_csv_url_new_and_old_places(write_config):
    write_config('csv_url: "https://example.com/a.csv"\n')
    assert config.load_settings().csv_url == "https://example.com/a.csv"
    write_config('sources:\n  csv:\n    url: "https://example.com/old.csv"\n')
    assert config.load_settings().csv_url == "https://example.com/old.csv"


def test_save_then_load_and_reset(tmp_path, monkeypatch):
    user = tmp_path / "settings.yaml"
    default = tmp_path / "config.yaml"
    default.write_text("keywords:\n  marketing: 2\n", encoding="utf-8")
    monkeypatch.setattr(config, "CONFIG_FILE", user)
    monkeypatch.setattr(config, "DEFAULT_CONFIG_FILE", default)

    raw = {"keywords": {"web design": 2, "website": {"weight": 1, "title_only": True}},
           "exclude_keywords": ["radio"], "min_score": 3, "days_back": 30, "keep_filtered_days": 90}
    config.save_settings(raw)
    s = config.load_settings()
    assert [k.text for k in s.keywords] == ["web design", "website"]  # order kept
    assert s.keywords[1].title_only and s.min_score == 3

    with pytest.raises(ConfigError):
        config.save_settings(raw | {"days_back": 0})
    assert config.load_settings().min_score == 3  # invalid settings never written

    config.reset_settings()
    assert [k.text for k in config.load_settings().keywords] == ["marketing"]


def test_first_launch_copies_the_defaults(tmp_path, monkeypatch):
    default = tmp_path / "config.yaml"
    default.write_text("keywords:\n  marketing: 2\n", encoding="utf-8")
    monkeypatch.setattr(config, "DEFAULT_CONFIG_FILE", default)
    monkeypatch.setattr(config, "CONFIG_FILE", tmp_path / "user" / "settings.yaml")
    monkeypatch.setattr(config, "DATA_DIR", tmp_path / "user" / "data")
    config.ensure_user_files()
    assert config.CONFIG_FILE.read_text(encoding="utf-8") == default.read_text(encoding="utf-8")
    assert config.DATA_DIR.is_dir()


def test_shipped_defaults_keep_all_the_keywords():
    raw = config.read_raw(config.DEFAULT_CONFIG_FILE)
    s = config.settings_from_raw(raw)
    texts = {k.text for k in s.keywords}
    assert len(s.keywords) >= 130
    assert {"marketing", "web development", "branding", "software design", "reactjs"} <= texts
