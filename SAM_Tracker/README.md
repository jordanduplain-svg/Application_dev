<p align="center"><img src="assets/icon.png" width="96" alt=""></p>

# SAM.gov Tracker

A small Windows app that finds US federal contract opportunities on
[SAM.gov](https://sam.gov) matching your keywords (marketing, communication,
branding, web design and development, software design...) and lets you review them.

- One click downloads the day's public list of offers (no account, no API key).
- Every offer gets a score from your keywords; the ones that match are shown,
  best first, with the reason (matched keywords highlighted).
- Only offers you can still answer are shown by default (deadline not passed).
- Amendments of the same offer are grouped, so you never see it twice.
- Discard what you don't want; you can always restore it.
- Keywords and rules are changed on the **Settings** page.

## Install (Windows 10 / 11)

1. Open the **[Releases](https://github.com/jordanduplain-svg/Application_dev/releases)** page, find the latest **SAM Tracker** release and download
   **`SAM-Tracker-Setup-x.y.z.exe`**.
2. Double-click it. Windows may show **"Windows protected your PC"**: the app is
   not signed by a paid certificate. Click **More info**, then **Run anyway**.
3. Follow the installer. No administrator rights are needed.
4. Start **SAM Tracker** from the desktop icon or the Start menu.

The app opens in its own window. Click **Run the tool** on the Dashboard: the
first run downloads about 240 MB and takes a minute or two, later runs are faster.
Use the **Quit** button (top right) to close the app completely.

> 🇫🇷 **En français :** dans [Releases](https://github.com/jordanduplain-svg/Application_dev/releases), télécharge `SAM-Tracker-Setup-x.y.z.exe`
> (la dernière version **SAM Tracker**), double-clique dessus. Si Windows affiche
> « Windows a protégé votre ordinateur », clique sur **Informations complémentaires**
> puis **Exécuter quand même**. Lance ensuite **SAM Tracker** depuis le bureau,
> puis clique sur **Run the tool**. Le bouton **Quit** ferme l'appli.

### Update, uninstall, your data

- **Update**: install the new version over the old one. Your settings and offers are kept.
- **Uninstall**: Windows Settings > Apps > SAM Tracker > Uninstall.
- **Your data** (settings, offers, downloaded list) is in `%LOCALAPPDATA%\SAM Tracker`.
  It is kept when you update or uninstall; delete that folder to start from scratch.

## How offers are selected

| Page | What you see |
| --- | --- |
| **Offers** | Offers whose score reaches the minimum score (or that you kept / restored) |
| **Filtered out** | Offers the tool rejected: score too low or an excluded word in the title. **Keep** brings one back |
| **Discarded** | Offers you discarded. **Restore** brings one back |

The score adds the **weight** of each keyword found in the description, and
**twice** the weight when it is in the title. Keywords marked **title only** are
only looked for in titles (for words too common in descriptions, like "website").
Each run re-scores the offers with your current settings, but never changes an
offer you discarded, restored or kept yourself: your decisions always win.

The tool reads the offers posted in the last 30 days (Settings: *Days to look back*)
**plus** older offers that are still open, since an offer can stay open for months.

---

## For developers

Python 3.11+ on Windows.

```bash
cd SAM_Tracker
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m pytest
start_app.bat
```

`start_app.bat` runs the app from source (same launcher as the installed app).
From source, settings are in `settings.yaml` (created from `config.yaml`, the
defaults shipped to every user) and data in `data/`. Set `SAM_TRACKER_HOME` to use
another folder.

### Build the installer locally

```bash
.venv\Scripts\pyinstaller sam_tracker.spec --noconfirm
"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" /DAppVersion=1.0.0 installer.iss
```

The installer is written to `Output\`. [Inno Setup 6](https://jrsoftware.org/isinfo.php) is needed for the second step.

### Publish a release

1. Set `__version__` in `app/__init__.py` (for example `1.1.0`) and commit.
2. `git tag sam-tracker-v1.1.0` then `git push origin sam-tracker-v1.1.0`.

GitHub Actions (`.github/workflows/sam-tracker.yml` at the root of the repository) runs
the tests, builds the app and the installer, and attaches `SAM-Tracker-Setup-1.1.0.exe`
to a new release. The tests also run on every change to this folder.

### Project layout

| File | Job |
| --- | --- |
| `launcher.py` | Entry point: starts the local server once, opens the app window |
| `app/main.py` | Web routes only |
| `app/pipeline.py` | The fetch, score, store pipeline |
| `app/runner.py` | Runs the pipeline in a background thread, live status |
| `app/fetcher.py` | Downloads the SAM.gov CSV (the data source) |
| `app/parser.py` | CSV rows -> `Offer` objects (the only place that knows CSV columns) |
| `app/scorer.py` | Keyword matching |
| `app/text_format.py` | Makes descriptions readable (paragraphs, labels, highlights) |
| `app/repository.py` | All SQLite access |
| `app/config.py` | Settings, and where the app keeps its files |
| `app/single_instance.py` | Only one copy of the app runs at a time |
| `app/static/style.css` | All styling, colors and fonts as variables at the top |
| `config.yaml` | Default settings (all the keywords) shipped to every user |
| `sam_tracker.spec`, `installer.iss` | Build recipes for the .exe and the installer |

To add a data source: in `app/fetcher.py`, write a class with a `name` and a
`fetch(self, since, report)` method that yields `Offer` objects, and register it
in `get_source()`.
