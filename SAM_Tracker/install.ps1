# Installs SAM Tracker without Setup.exe. Paste in PowerShell:
#
#   irm https://raw.githubusercontent.com/jordanduplain-svg/Application_dev/main/SAM_Tracker/install.ps1 | iex
#
# Why: Windows 11 "Smart App Control" blocks unsigned programs (the Setup.exe and the
# SAM Tracker.exe built by GitHub). This script runs the app with the official Python
# from python.org, which is signed and therefore allowed, instead of an unsigned .exe.
#
# What it does:
#   1. uses Python 3.11+ if present, otherwise installs Python 3.12 for this user (winget);
#   2. downloads the app's code of the latest SAM Tracker release;
#   3. puts it in %LOCALAPPDATA%\Programs\SAM Tracker with its own Python environment;
#   4. creates the Start menu and desktop shortcuts, and a Windows Settings > Apps entry;
#   5. starts the app.
# Run it again to update. The user's data (%LOCALAPPDATA%\SAM Tracker) is never touched.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # much faster downloads in Windows PowerShell 5.1

$repo = 'jordanduplain-svg/Application_dev'
$appDir = Join-Path $env:LOCALAPPDATA 'Programs\SAM Tracker'
$venvPythonw = Join-Path $appDir '.venv\Scripts\pythonw.exe'
$launcher = Join-Path $appDir 'launcher.py'
$icon = Join-Path $appDir 'assets\icon.ico'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SAMTracker'
$shortcuts = @(
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'SAM Tracker.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'SAM Tracker.lnk')
)

function Find-Python {
    # A real python.exe 3.11+ (not the Microsoft Store shortcut that only opens the Store).
    $candidates = @()
    if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($v in '3.13', '3.12', '3.11') { $candidates += , @('py', "-$v") }
    }
    $candidates += , @('python')
    foreach ($c in $candidates) {
        try {
            $pyArgs = @($c | Select-Object -Skip 1) + @('-c', 'import sys; print(sys.executable if sys.version_info >= (3, 11) else str())')
            $exe = (& $c[0] @pyArgs 2>$null | Select-Object -Last 1)
            if ($exe -and (Test-Path $exe) -and ($exe -notlike '*\WindowsApps\*')) { return $exe.Trim() }
        } catch { }
    }
    return $null
}

Write-Host 'SAM Tracker: looking for the latest version...'
# Stored first: Windows PowerShell 5.1 passes a JSON array down a pipe as one single object.
$releases = Invoke-RestMethod "https://api.github.com/repos/$repo/releases?per_page=50"
$release = $releases |
    Where-Object { $_.tag_name -like 'sam-tracker-v*' -and -not $_.draft -and -not $_.prerelease } |
    Select-Object -First 1
$asset = $release.assets | Where-Object { $_.name -like '*-source.zip' } | Select-Object -First 1
if (-not $asset -and -not $env:SAM_TRACKER_SOURCE_ZIP) { throw 'No SAM Tracker download found on GitHub.' }
$version = $release.tag_name -replace '^sam-tracker-v', ''

$python = Find-Python
if (-not $python) {
    Write-Host 'Installing Python 3.12 (official, from python.org) for this user...'
    winget install --id Python.Python.3.12 --exact --scope user --silent --accept-package-agreements --accept-source-agreements | Out-Null
    $python = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
    if (-not (Test-Path $python)) { throw 'Python could not be installed. Install Python 3.12 from python.org, then run this command again.' }
}
Write-Host "Using Python: $python"

# Stop a running copy, and remove a version installed with Setup.exe (same folder).
Get-Process 'SAM Tracker' -ErrorAction SilentlyContinue | Stop-Process -Force
Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" |
    Where-Object { $_.CommandLine -like "*$appDir*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
$innoUninstaller = Join-Path $appDir 'unins000.exe'
if (Test-Path $innoUninstaller) {
    Write-Host 'Removing the previous version...'
    Start-Process $innoUninstaller -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait
}

if ($env:SAM_TRACKER_SOURCE_ZIP) {
    # Testing a build before publishing it: use a local ZIP instead of the download.
    $zip = Join-Path $env:TEMP 'sam-tracker-local-test.zip'
    Copy-Item $env:SAM_TRACKER_SOURCE_ZIP $zip -Force
    $version = 'local'
} else {
    Write-Host "Downloading SAM Tracker $version..."
    $zip = Join-Path $env:TEMP $asset.name
    Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing
}
if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force }
Expand-Archive $zip -DestinationPath $appDir -Force
Remove-Item $zip
if (-not (Test-Path $launcher)) { throw 'The download is incomplete. Run the command again in a few minutes.' }
New-Item (Join-Path $appDir 'installed.flag') -ItemType File -Force | Out-Null  # installed mode: data in %LOCALAPPDATA%\SAM Tracker

Write-Host 'Preparing the app (about one minute)...'
& $python -m venv (Join-Path $appDir '.venv')
if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python environment.' }
& (Join-Path $appDir '.venv\Scripts\python.exe') -m pip install --disable-pip-version-check --quiet -r (Join-Path $appDir 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not download the app components. Check the internet connection and run the command again.' }

$shell = New-Object -ComObject WScript.Shell
foreach ($path in $shortcuts) {
    $link = $shell.CreateShortcut($path)
    $link.TargetPath = $venvPythonw
    $link.Arguments = "`"$launcher`""
    $link.WorkingDirectory = $appDir
    $link.IconLocation = "$icon,0"
    $link.Description = 'SAM Tracker'
    $link.Save()
}

# Listed in Windows Settings > Apps, with a working "Uninstall" button.
$uninstall = "Get-CimInstance Win32_Process -Filter `"Name='pythonw.exe'`" | Where-Object { `$_.CommandLine -like '*$appDir*' } | ForEach-Object { Stop-Process -Id `$_.ProcessId -Force }; Start-Sleep 1; " +
    "Remove-Item -LiteralPath '$appDir' -Recurse -Force -ErrorAction SilentlyContinue; " +
    (($shortcuts | ForEach-Object { "Remove-Item -LiteralPath '$_' -ErrorAction SilentlyContinue" }) -join '; ') +
    "; Remove-Item -LiteralPath '$uninstallKey' -Recurse -Force"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($uninstall))
New-Item $uninstallKey -Force | Out-Null
Set-ItemProperty $uninstallKey -Name DisplayName -Value 'SAM Tracker'
Set-ItemProperty $uninstallKey -Name DisplayVersion -Value $version
Set-ItemProperty $uninstallKey -Name Publisher -Value 'SAM Tracker'
Set-ItemProperty $uninstallKey -Name DisplayIcon -Value "$icon,0"
Set-ItemProperty $uninstallKey -Name InstallLocation -Value $appDir
Set-ItemProperty $uninstallKey -Name UninstallString -Value "powershell.exe -NoProfile -WindowStyle Hidden -EncodedCommand $encoded"
Set-ItemProperty $uninstallKey -Name NoModify -Value 1 -Type DWord
Set-ItemProperty $uninstallKey -Name NoRepair -Value 1 -Type DWord

Write-Host "SAM Tracker $version is installed (desktop and Start menu). Starting it..."
Start-Process $venvPythonw -ArgumentList "`"$launcher`"" -WorkingDirectory $appDir
