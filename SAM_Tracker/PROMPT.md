# Project: SAM.gov Opportunity Tracker

Build a small local web app in Python that downloads US federal contract opportunities from SAM.gov, scores them against my keywords, and lets me review them in a browser.

## Goals
- Clean, simple code that is easy to maintain and extend.
- No build step, no JavaScript framework. Runs with one command.
- Every rule I may want to change later (keywords, weights, thresholds, date range) lives in ONE config file, not in the code.

## Stack
- Python 3.11+
- Flask (or FastAPI) + Jinja2 templates
- SQLite for storage (single file `data/opportunities.db`)
- Plain HTML + CSS + a little vanilla JS
- `requirements.txt` and a `README.md` explaining install, run, and how to change keywords

## Project structure
app/
  main.py            # web routes only
  runner.py          # background job: fetch -> score -> store, exposes live status
  models.py          # shared dataclasses (Offer, KeywordRule)
  config.py          # loads config.yaml
  fetcher.py         # downloads the CSV
  parser.py          # reads the CSV into clean records
  scorer.py          # keyword matching and scoring
  repository.py      # all SQLite access
  templates/         # Jinja pages
  static/            # CSS, small JS
config.yaml          # keywords, weights, min score, days to look back
data/                # db + downloaded CSV (gitignored)
tests/               # pytest tests for parser and scorer

Keep each module focused on one job. Routes must not contain business logic.

## Data source
Only source: the public daily CSV (no account, no key):
https://falextracts.s3.amazonaws.com/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv

- Updated daily, large file (200 MB or more): download with streaming, show progress.
- Read the real CSV header first; do not assume column names. Map needed fields
  (notice id, title, agency, type, posted date, response deadline, NAICS, description, link)
  in one place in parser.py.
- Handle encoding problems (try utf-8, fall back to latin-1).
- Keep rows posted within the last N days (N in config.yaml), plus older rows that
  are still open (deadline not passed and not archived): offers can stay open for months.
- Deadlines with a time but no time zone are SAM.gov US Eastern time (America/New_York,
  needs the `tzdata` package on Windows).

No SAM.gov API mode (removed on purpose: it needs a key, allows ~10 calls a day and
only gives links to descriptions). The source sits behind a small interface in
fetcher.py so another one could be added later.

## Scoring
- config.yaml holds the keywords, each as `word: weight` or
  `word: {weight: 1, title_only: true}` (for words too common in descriptions, like "website").
- Default keywords cover marketing, digital marketing, strategic communications,
  public affairs / relations, advertising, outreach, social media, content, SEO,
  branding, graphic design, web design / development, website, UX.
- Exclude keywords (title only): radio, telecommunication(s), command, control.
- Score = sum of weights for keywords found in title (count double) and description.
- Case insensitive, match whole words / phrases ("web design" also matches "web-design").
- Offers under the min score or with an exclude keyword get status `filtered`.
- Store the matched keywords with each offer so the UI can show why it matched.

## Storage
Table `opportunities` with: notice_id (unique), title, agency, type, posted_date,
deadline, naics, description, url, score, matched_keywords, status, manual,
new_in_run_id, first_seen_at, discarded_at.
- status values: `active`, `filtered`, `discarded`.
- Every run recomputes the status from the score (active or filtered),
  EXCEPT when the user changed it by hand (`manual = 1`): user decisions always win.
- `new_in_run_id` = the run in which the offer first became active (drives the NEW tag).
- Re-running the tool must not create duplicates (upsert on notice_id)
  and must never bring back an offer I discarded.
- Table `runs` with: started_at, finished_at, rows_read, matched, new_offers, error.

## Duplicates
SAM.gov publishes a new notice for each amendment or repost. Group versions by
`group_key` = solicitation number + agency (fallback: normalized title + agency).
Show one row per group (the latest version) with a "N versions" badge and the older
versions in the details. Counts, NEW tag and user actions work per group; a new
amendment of a discarded group stays discarded.

## Scope
Runs only when the user clicks "Run the tool": no scheduled job, no email,
no report files (removed on purpose; the app stores no credentials).
Only source for now: SAM.gov (RAMP has no public API; USAspending lists past
awards, not open offers; SBA.gov points to SAM.gov).
Runs left unfinished (app stopped mid-run) are marked "Interrupted" at startup.

## Pages

### 1. Dashboard (`/`)
- Total active offers.
- Number of new offers from the last run.
- Count per type (Solicitation, Presolicitation, Sources Sought, etc.).
- Date and result of the last run.
- A big "Run the tool" button that starts the fetch in the background
  and shows a live status (downloading / parsing / scoring / done / error).

### 2. Offers (`/offers`)
- Offers grouped by type, each group sorted by score (highest first, then newest).
  A "Sort by" option switches to date (newest first).
- Each row shows: title, agency, posted date, deadline, score, matched keywords,
  and a "NEW" tag if it came from the last run.
- Clicking a row expands it in place to show full details
  (description, NAICS, deadline, link to the offer on sam.gov). Click again to collapse.
- A "Discard" button on each offer. Discarding is instant, no page reload.
- A "Discarded" tab or section listing discarded offers with a "Restore" button.
- A "Filtered out" tab listing offers the tool rejected, with a "Keep" button.
- Filters: by type, by min score, text search and "Posted": last 30 / 90 / 180 days or any time (default).
- By default show only open offers: hide those whose deadline has passed and the
  closed types listed in config.yaml (`closed_types`: Award Notice, Justification,
  the contract is already awarded). A "Show: All" option shows them with an
  EXPIRED / AWARDED tag. The dashboard counts open offers, plus an "Expired / awarded" count.
- Descriptions are loaded only when an offer is opened (GET /api/offers/<id>/description),
  formatted into paragraphs with bold section labels and highlighted keywords
  (title-only keywords are not highlighted). List queries never read the description column.
- Closed filtered-out offers older than `keep_filtered_days` (config, default 90) are
  deleted at each run, then the database is compacted; offers still open, offers
  handled by hand and versions of offers still shown are kept.
- Search treats % and _ literally; "nan"/"inf" in Min score are ignored.
- Only one copy of the app runs at a time (lock on data/app.lock, waits 5 s for a
  copy that is stopping).
- Render at most 500 offers per page (in the current sort order), show the total count.

## Design
Functional, modern but clearly structured look (not retro, not "floating" minimalism):
- Grey-blue page background, not all white
- Every block is a bordered panel with a dark blue title band, so areas are clearly delimited
- Dashboard: Summary panel with 5 stat tiles in one row, then two aligned columns
  (Run the tool | Offers by type), then Last runs full width
- Gridded tables (visible cell borders, header row background, zebra rows)
- Filters in an aligned 4-column grid inside their own panel
- System font, one blue accent color, dark sticky top bar with tabs, toast messages for actions
- Automatic dark mode (prefers-color-scheme)
- Keep all styling in one CSS file with variables at the top so the look can be changed easily
- Usable on a laptop screen and on a phone (no horizontal page scroll)

## Quality
- Clear function names, type hints, short docstrings.
- Log to console and to `data/app.log`.
- pytest tests for parser, scorer, repository, and smoke tests of the pages (Flask test client).
- Errors (network down, bad CSV) are shown in the UI, never crash the app.
- README with: install, run, how to change keywords, how to add a new data source.

## Packaging (installable Windows app)
- `launcher.py` is the entry point: starts the local server once (port 8765, single
  instance), opens the app in its own Edge "app mode" window, or only opens a window
  if the app already runs. Errors are shown in a Windows message box.
- User files live in `%LOCALAPPDATA%\SAM Tracker` when installed (`settings.yaml`,
  `data/`); `config.yaml` in the bundle holds the default settings (all keywords) and is
  copied on first launch. From source, the project folder is used. `SAM_TRACKER_HOME` overrides.
- Settings page (`/settings`): edit keywords (weight, title only, add, remove, search),
  excluded words, closed types, minimum score, days to look back, keep filtered days;
  "Reset to defaults". Invalid input is never saved and what was typed is kept.
- `sam_tracker.spec` (PyInstaller, windowed, one folder) builds `SAM Tracker.exe`;
  `installer.iss` (Inno Setup, per-user, no admin rights, EN/FR) builds the Setup.
- `.github/workflows/sam-tracker.yml` (root of the multi-app repository, working
  directory `SAM_Tracker`): tests on every change; on a `sam-tracker-v*` tag, build
  and attach the Setup to a GitHub release (the tag must match `app.__version__`).
