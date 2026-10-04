@echo off
setlocal
rem Raccourci de developpement pour CARTEL.
rem AUCUN CHIFFRE MESURE DANS CE MENU : il portait « 100 graines x 2 bots », ce qui aurait
rem menti le jour d'un troisieme bot. Chaque outil annonce lui-meme ce qu'il lance.
rem Les lignes de commande ci-dessous sont verifiees par tests/run.gd (_test_commandes_citees) :
rem script existant, bot connu, constante resolvable. C'est le fichier qu'on CLIQUE, donc
rem celui qui pourrit le plus silencieusement.
rem Il n'y a pas encore de jeu a lancer : game/ et ses cinq ecrans (GDD 12bis) ne sont pas
rem ecrits. Ce que ce menu lance, c'est la SIMULATION, qui est le jeu aujourd'hui.
rem (Cette ligne annoncait « arrivent au jalon 1 » pendant tout le jalon 1 : une date tenue
rem  pour un etat, exactement comme un chiffre mesure qu'on recopie.)

set RACINE=%~dp0..
set GODOT=%RACINE%\tools\Godot_v4.7-stable_win64_console.exe

if not exist "%GODOT%" (
  echo.
  echo   Godot introuvable : %GODOT%
  echo   Le binaire vit dans tools\ qui est gitignore. Copie-le depuis bureau-etudes\tools\.
  echo.
  pause
  exit /b 1
)

:menu
cls
echo.
echo   CARTEL - jalon 1 en cours
echo   =========================
echo.
echo   1. Campagne tracee      - une partie semaine par semaine (bot discret)
echo   2. Campagne tracee      - le bot industriel
echo   3. Harnais complet      - tests, levier, perf, equilibrage
echo   4. Equilibrage seul     - les cibles du GDD 16 (il annonce ses graines et ses bots)
echo   5. Ouvrir dans Godot    - l'editeur (pas de scene pour l'instant)
echo   6. Quitter
echo.
set /p choix=  Choix :

if "%choix%"=="1" ( "%GODOT%" --headless --path "%RACINE%" -s res://tests/trace.gd -- 3 discret 26 & pause & goto menu )
if "%choix%"=="2" ( "%GODOT%" --headless --path "%RACINE%" -s res://tests/trace.gd -- 3 industriel 13 & pause & goto menu )
if "%choix%"=="3" ( call :harnais & pause & goto menu )
if "%choix%"=="4" ( "%GODOT%" --headless --path "%RACINE%" -s res://tests/balance.gd & pause & goto menu )
if "%choix%"=="5" ( start "" "%RACINE%\tools\Godot_v4.7-stable_win64.exe" --path "%RACINE%" -e & goto menu )
if "%choix%"=="6" exit /b 0
goto menu

:harnais
echo.
echo --- tests logiques ---
"%GODOT%" --headless --path "%RACINE%" -s res://tests/run.gd
echo.
echo --- levier (porte du jalon 0) ---
"%GODOT%" --headless --path "%RACINE%" -s res://tests/levier.gd
echo.
echo --- vitesse ---
"%GODOT%" --headless --path "%RACINE%" -s res://tests/perf.gd
echo.
echo --- equilibrage ---
"%GODOT%" --headless --path "%RACINE%" -s res://tests/balance.gd -- 20
exit /b 0
