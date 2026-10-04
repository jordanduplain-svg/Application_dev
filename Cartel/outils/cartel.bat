@echo off
setlocal
rem Raccourci de developpement pour CARTEL.
rem AUCUN CHIFFRE MESURE DANS CE MENU : chaque outil annonce lui-meme ce qu'il lance.
rem Les lignes de commande ci-dessous sont verifiees par src/tests/run.ts (testCommandesCitees) :
rem script existant, bot connu, constante resolvable. C'est le fichier qu'on CLIQUE, donc
rem celui qui pourrit le plus silencieusement.
rem L'interface (les ecrans du GDD 12bis) n'est pas encore ecrite : ce menu lance la
rem SIMULATION et son harnais, sous Node (portage TypeScript, GDD 13).

set RACINE=%~dp0..
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js introuvable. Installe-le : winget install OpenJS.NodeJS.LTS
  echo.
  pause
  exit /b 1
)
cd /d "%RACINE%"

:menu
cls
echo.
echo   CARTEL - jalon 1 en cours
echo   =========================
echo.
echo   1. Campagne tracee      - une partie semaine par semaine (bot discret)
echo   2. Campagne tracee      - le bot industriel
echo   3. Harnais complet      - types, tests, levier, perf, equilibrage
echo   4. Equilibrage seul     - les cibles du GDD 16 (il annonce ses graines et ses bots)
echo   5. Quitter
echo.
set /p choix=  Choix :

if "%choix%"=="1" ( node src/tests/trace.ts 3 discret 26 & pause & goto menu )
if "%choix%"=="2" ( node src/tests/trace.ts 3 industriel 13 & pause & goto menu )
if "%choix%"=="3" ( call :harnais & pause & goto menu )
if "%choix%"=="4" ( node src/tests/balance.ts & pause & goto menu )
if "%choix%"=="5" exit /b 0
goto menu

:harnais
echo.
echo --- types ---
call npx tsc --noEmit -p .
echo.
echo --- tests logiques ---
node src/tests/run.ts
echo.
echo --- levier (porte du jalon 0) ---
node src/tests/levier.ts
echo.
echo --- vitesse ---
node src/tests/perf.ts
echo.
echo --- equilibrage ---
node src/tests/balance.ts 20
exit /b 0
