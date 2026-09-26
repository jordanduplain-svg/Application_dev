"""Web routes only. Business logic lives in the other modules."""
from __future__ import annotations

import math
import os
import threading
from datetime import datetime
from urllib.parse import urlsplit

from flask import Flask, abort, jsonify, redirect, render_template, request, url_for

from . import __version__, config, repository, runner
from .logging_setup import setup_logging
from .repository import OfferFilters
from .text_format import format_description


ALLOWED_HOSTS = {"127.0.0.1", "localhost"}

# "Posted" filter on the Offers page: days -> label. Anything else = any time.
POSTED_WITHIN = {30: "Last 30 days", 90: "Last 90 days", 180: "Last 180 days"}


def short_date(value: str | None) -> str:
    """'2026-09-28T07:30:00-04:00' -> '2026-09-28 13:30' in the PC's time zone.

    Values without a time zone are shown as they are.
    """
    if not value:
        return "-"
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return value.replace("T", " ")[:16]
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone()
    return parsed.strftime("%Y-%m-%d %H:%M") if len(value) > 10 else value[:10]


def safe_url(value: str | None) -> str:
    """Links come from SAM.gov data: only web links are kept (no 'javascript:' and the like)."""
    value = (value or "").strip()
    return value if urlsplit(value).scheme in ("http", "https") else ""


def parse_filters(args, closed_types: list[str]) -> OfferFilters:
    def text(name: str) -> str | None:
        return (args.get(name) or "").strip() or None

    try:
        min_score = float(args["min_score"]) if text("min_score") else None
    except ValueError:
        min_score = None
    if min_score is not None and not math.isfinite(min_score):
        min_score = None  # "nan", "inf": not a real score
    view = args.get("view")
    posted = text("posted")
    posted_within = int(posted) if posted and posted.isdigit() and int(posted) in POSTED_WITHIN else None
    return OfferFilters(
        posted_within=posted_within,
        status=view if view in repository.STATUSES else "active",
        type=text("type"),
        min_score=min_score,
        q=text("q"),
        sort=args.get("sort") if args.get("sort") in repository.SORT_ORDERS else "score",
        open_only=args.get("show") != "all",
        closed_types=closed_types,
    )


def _number_or_text(value: str):
    """Form values are text: keep numbers as numbers in the settings file."""
    value = value.strip()
    try:
        number = float(value)
    except ValueError:
        return value  # left as typed, validation explains the problem
    return int(number) if number.is_integer() else number


def _lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


def settings_from_form(form, current: dict) -> tuple[dict, str | None]:
    """The Settings page form -> (settings dict, error or None).

    Other keys of `current` (like csv_url) are kept. A keyword typed twice is
    reported, and only its first row is kept so nothing else typed is lost.
    """
    keywords: dict = {}
    error = None
    title_only = set(form.getlist("kw_title_only"))
    rows = zip(form.getlist("kw_index"), form.getlist("kw_text"), form.getlist("kw_weight"))
    for index, text, weight in rows:
        text = " ".join(text.split())
        if not text:
            continue  # empty row
        if text.lower() in (k.lower() for k in keywords):
            error = f"Settings: the keyword '{text}' is there twice, the second one was removed."
            continue
        weight = _number_or_text(weight or "1")
        keywords[text] = {"weight": weight, "title_only": True} if index in title_only else weight
    return current | {
        "keywords": keywords,
        "exclude_keywords": _lines(form.get("exclude_keywords", "")),
        "closed_types": _lines(form.get("closed_types", "")),
        "min_score": _number_or_text(form.get("min_score", "")),
        "days_back": _number_or_text(form.get("days_back", "")),
        "keep_filtered_days": _number_or_text(form.get("keep_filtered_days", "")),
    }, error


def settings_rows(raw: dict) -> list[dict]:
    """Keyword rows for the Settings page."""
    rows = []
    for text, value in (raw.get("keywords") or {}).items():
        if isinstance(value, dict):
            rows.append({"text": text, "weight": value.get("weight", 1), "title_only": bool(value.get("title_only"))})
        else:
            rows.append({"text": text, "weight": value, "title_only": False})
    return rows


def create_app() -> Flask:
    config.ensure_user_files()
    setup_logging()
    repository.init_db()
    repository.mark_interrupted_runs()

    app = Flask(__name__)

    @app.before_request
    def only_this_app():
        """Refuse requests coming from other websites open in the browser.

        Host check: blocks DNS rebinding. Origin check on POST: blocks another
        page silently discarding offers, starting a run or stopping the app.
        """
        if request.host.split(":")[0] not in ALLOWED_HOSTS:
            abort(403)
        origin = request.headers.get("Origin")
        if request.method == "POST" and origin and urlsplit(origin).hostname not in ALLOWED_HOSTS:
            abort(403)

    @app.template_global()
    def asset(filename: str) -> str:
        """Static URL with the file's mtime, so browsers never use a stale copy."""
        path = os.path.join(app.static_folder, filename)
        version = int(os.path.getmtime(path)) if os.path.exists(path) else 0
        return url_for("static", filename=filename, v=version)

    app.jinja_env.globals["version"] = __version__
    app.add_template_filter(short_date, "short_date")
    app.add_template_filter(safe_url, "safe_url")

    @app.get("/")
    def dashboard():
        settings, config_error = config.load_settings_or_default()
        return render_template(
            "dashboard.html",
            stats=repository.dashboard_stats(settings.closed_types),
            runs=repository.recent_runs(),
            job=runner.snapshot(),
            settings=settings,
            config_error=config_error,
        )

    @app.get("/offers")
    def offers():
        settings, config_error = config.load_settings_or_default()
        filters = parse_filters(request.args, settings.closed_types)
        offers, total = repository.list_offers(filters)
        return render_template(
            "offers.html",
            offers=offers,
            total=total,
            filters=filters,
            types=repository.list_types(filters.status),
            last_run_id=repository.get_last_run_id(),
            config_error=config_error,
            posted_choices=POSTED_WITHIN,
        )

    def render_settings(raw: dict, error: str | None = None, message: str | None = None, status: int = 200):
        return render_template(
            "settings.html",
            raw=raw,
            rows=settings_rows(raw),
            error=error,
            message=message,
        ), status

    @app.get("/settings")
    def settings_page():
        messages = {
            "saved": "Settings saved. They apply from the next run: click Run the tool on the Dashboard.",
            "reset": "Default settings restored.",
        }
        try:
            raw = config.read_raw()
            config.settings_from_raw(raw)
            error = None
        except config.ConfigError as e:
            raw, error = config.read_raw(config.DEFAULT_CONFIG_FILE), f"{e} The defaults are shown below."
        return render_settings(raw, error, messages.get(request.args.get("done", "")))

    @app.post("/settings")
    def save_settings():
        try:
            current = config.read_raw()
        except config.ConfigError:
            current = config.read_raw(config.DEFAULT_CONFIG_FILE)
        raw, error = settings_from_form(request.form, current)
        if error is None:
            try:
                config.save_settings(raw)
            except config.ConfigError as e:
                error = str(e)
        if error:
            # show the form again with what was typed, nothing is saved
            return render_settings(raw, error, status=400)
        return redirect(url_for("settings_page", done="saved"))

    @app.post("/settings/reset")
    def reset_settings():
        config.reset_settings()
        return redirect(url_for("settings_page", done="reset"))

    @app.post("/api/run")
    def run():
        if not runner.start("csv"):
            return jsonify(runner.snapshot()), 409
        return jsonify(runner.snapshot())

    @app.get("/api/status")
    def status():
        return jsonify(runner.snapshot())

    @app.get("/api/whoami")
    def whoami():
        """Lets the launcher check that the app on this port uses *its* data folder."""
        return jsonify(app=config.APP_NAME, home=str(config.USER_DIR))

    @app.post("/api/quit")
    def quit_app():
        """Stop the server (it runs hidden when started from the desktop shortcut)."""
        threading.Timer(0.5, os._exit, args=(0,)).start()
        return jsonify(ok=True)

    @app.get("/api/offers/<notice_id>/description")
    def offer_description(notice_id: str):
        """Loaded when an offer is opened, so the lists stay light."""
        offer = repository.get_description(notice_id)
        if offer is None:
            return jsonify(html="<p class=\"muted\">This offer no longer exists. Reload the page.</p>"), 404
        settings, _ = config.load_settings_or_default()
        title_only = {k.text for k in settings.keywords if k.title_only}
        keywords = [k for k in (offer["matched_keywords"] or "").split(", ") if k and k not in title_only]
        return jsonify(html=str(format_description(offer["description"], keywords)))

    # discard: hide an offer. restore / keep: bring a discarded or filtered offer back.
    actions = {"discard": "discarded", "restore": "active", "keep": "active"}

    @app.post("/api/offers/<notice_id>/<action>")
    def change_status(notice_id: str, action: str):
        if action not in actions:
            return jsonify(ok=False, error="Unknown action"), 400
        return jsonify(ok=repository.set_status(notice_id, actions[action]))

    return app
