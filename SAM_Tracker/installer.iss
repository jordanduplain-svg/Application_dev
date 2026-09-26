; Inno Setup recipe: packs dist\SAM Tracker (built by PyInstaller) into SAM-Tracker-Setup-<version>.exe
; Build:  ISCC.exe /DAppVersion=1.0.0 installer.iss   (done automatically by GitHub Actions on a release)
;
; Installs for the current user only: no administrator rights needed.
; The user's data (settings, offers, downloaded CSV) lives in %LOCALAPPDATA%\SAM Tracker and is kept
; when the app is updated or uninstalled.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6E3B4F0A-8C2D-4E7B-9A51-3D2C7F1B9E44}
AppName=SAM Tracker
AppVersion={#AppVersion}
AppVerName=SAM Tracker {#AppVersion}
AppPublisher=SAM Tracker
DefaultDirName={localappdata}\Programs\SAM Tracker
DefaultGroupName=SAM Tracker
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=Output
OutputBaseFilename=SAM-Tracker-Setup-{#AppVersion}
SetupIconFile=assets\icon.ico
UninstallDisplayIcon={app}\SAM Tracker.exe
UninstallDisplayName=SAM Tracker
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; close a running copy before updating or uninstalling
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "dist\SAM Tracker\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\SAM Tracker"; Filename: "{app}\SAM Tracker.exe"
Name: "{autodesktop}\SAM Tracker"; Filename: "{app}\SAM Tracker.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\SAM Tracker.exe"; Description: "{cm:LaunchProgram,SAM Tracker}"; Flags: nowait postinstall skipifsilent
