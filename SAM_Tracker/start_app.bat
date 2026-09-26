@echo off
rem Starts SAM.gov Tracker from source (developers). The installed app does the same with "SAM Tracker.exe".
rem Opens the app in its own window; the "Quit" button in the app stops it.
cd /d "%~dp0"
start "" ".venv\Scripts\pythonw.exe" launcher.py
