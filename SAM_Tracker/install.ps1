# Installs SAM Tracker without Setup.exe, for PCs where Windows "Smart App Control" blocks
# the installer (the app itself runs fine). Paste in PowerShell:
#
#   irm https://raw.githubusercontent.com/jordanduplain-svg/Application_dev/main/SAM_Tracker/install.ps1 | iex
#
# Downloads the latest SAM Tracker release (ZIP), puts it in %LOCALAPPDATA%\Programs\SAM Tracker,
# creates the Start menu and desktop shortcuts, and adds it to Windows Settings > Apps
# (so it can be uninstalled from there). Also used to update: run it again.
# The user's data (%LOCALAPPDATA%\SAM Tracker) is never touched.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # much faster downloads in Windows PowerShell 5.1

$repo = 'jordanduplain-svg/Application_dev'
$appDir = Join-Path $env:LOCALAPPDATA 'Programs\SAM Tracker'
$exe = Join-Path $appDir 'SAM Tracker.exe'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SAMTracker'
$shortcuts = @(
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'SAM Tracker.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'SAM Tracker.lnk')
)

Write-Host 'SAM Tracker: looking for the latest version...'
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases?per_page=50" |
    Where-Object { $_.tag_name -like 'sam-tracker-v*' -and -not $_.draft -and -not $_.prerelease } |
    Select-Object -First 1
$asset = $release.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1
if (-not $asset) { throw 'No SAM Tracker download found on GitHub.' }
$version = $release.tag_name -replace '^sam-tracker-v', ''

# Stop a running copy, and remove a version installed with Setup.exe (same folder).
Get-Process 'SAM Tracker' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1
$innoUninstaller = Join-Path $appDir 'unins000.exe'
if (Test-Path $innoUninstaller) {
    Write-Host 'Removing the previous version...'
    Start-Process $innoUninstaller -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait
}

Write-Host "Downloading SAM Tracker $version..."
$zip = Join-Path $env:TEMP $asset.name
Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing
if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force }
Expand-Archive $zip -DestinationPath $appDir -Force
Remove-Item $zip

$shell = New-Object -ComObject WScript.Shell
foreach ($path in $shortcuts) {
    $link = $shell.CreateShortcut($path)
    $link.TargetPath = $exe
    $link.WorkingDirectory = $appDir
    $link.IconLocation = "$exe,0"
    $link.Save()
}

# Listed in Windows Settings > Apps, with a working "Uninstall" button.
$uninstall = "Get-Process 'SAM Tracker' -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 1; " +
    "Remove-Item -LiteralPath '$appDir' -Recurse -Force -ErrorAction SilentlyContinue; " +
    (($shortcuts | ForEach-Object { "Remove-Item -LiteralPath '$_' -ErrorAction SilentlyContinue" }) -join '; ') +
    "; Remove-Item -LiteralPath '$uninstallKey' -Recurse -Force"
New-Item $uninstallKey -Force | Out-Null
Set-ItemProperty $uninstallKey -Name DisplayName -Value 'SAM Tracker'
Set-ItemProperty $uninstallKey -Name DisplayVersion -Value $version
Set-ItemProperty $uninstallKey -Name Publisher -Value 'SAM Tracker'
Set-ItemProperty $uninstallKey -Name DisplayIcon -Value "$exe,0"
Set-ItemProperty $uninstallKey -Name InstallLocation -Value $appDir
Set-ItemProperty $uninstallKey -Name UninstallString -Value "powershell.exe -NoProfile -WindowStyle Hidden -Command `"$uninstall`""
Set-ItemProperty $uninstallKey -Name NoModify -Value 1 -Type DWord
Set-ItemProperty $uninstallKey -Name NoRepair -Value 1 -Type DWord

Write-Host "SAM Tracker $version is installed (desktop and Start menu). Starting it..."
Start-Process $exe
