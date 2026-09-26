# PyInstaller recipe: builds dist/SAM Tracker/SAM Tracker.exe (a folder, fast to start).
# Build:  .venv\Scripts\pyinstaller sam_tracker.spec --noconfirm
# The installer (installer.iss) then packs that folder into SAM-Tracker-Setup.exe.
from PyInstaller.utils.hooks import collect_data_files

datas = [
    ("app/templates", "app/templates"),
    ("app/static", "app/static"),
    ("config.yaml", "."),               # default settings, copied to the user folder on first launch
] + collect_data_files("tzdata")          # US time zones for SAM.gov deadlines

a = Analysis(
    ["launcher.py"],
    pathex=[],
    datas=datas,
    hiddenimports=[],
    excludes=["pytest", "PIL", "tkinter"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="SAM Tracker",
    icon="assets/icon.ico",
    console=False,  # no black window: the app opens in its own window
    upx=False,      # UPX-packed files are more often flagged by antivirus software
)
coll = COLLECT(exe, a.binaries, a.datas, name="SAM Tracker", upx=False)
