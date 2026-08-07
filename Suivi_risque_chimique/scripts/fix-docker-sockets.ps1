# =====================================================================
# Réparation du démarrage de Docker Desktop (Windows).
#
# Symptôme : Docker Desktop affiche « An unexpected error occurred »
# avec un message du type :
#   remove C:\Users\<vous>\AppData\Local\Docker\run\dockerInference:
#   The file cannot be accessed by the system.
#
# Cause : Docker Desktop ne nettoie pas ses fichiers socket Unix à
# l'arrêt de Windows. Au redémarrage, il ne sait pas les supprimer
# (l'API Windows n'accède pas à ces fichiers socket) et abandonne.
# Bug connu, revient après chaque arrêt brutal ou redémarrage.
#
# Remède : supprimer les sockets orphelins VIA WSL (qui, lui, sait les
# manipuler), puis relancer Docker Desktop. Ce script fait les deux.
#
# Usage :  .\scripts\fix-docker-sockets.ps1
# =====================================================================

$ErrorActionPreference = "Stop"

$user = $env:USERNAME
$paths = @(
  "/mnt/c/Users/$user/AppData/Local/Docker/run/dockerInference",
  "/mnt/c/Users/$user/AppData/Local/Docker/run/userAnalyticsOtlpHttp.sock",
  "/mnt/c/Users/$user/AppData/Local/docker-secrets-engine/engine.sock"
)

Write-Host "Suppression des sockets Docker orphelins via WSL..."
wsl -- rm -f @paths
if ($LASTEXITCODE -ne 0) {
  Write-Warning "La suppression via WSL a echoue (WSL absent ?). Supprimez manuellement les fichiers ci-dessus."
  exit 1
}

$dockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
if (Test-Path $dockerExe) {
  Write-Host "Lancement de Docker Desktop..."
  Start-Process $dockerExe
  Write-Host "OK - attendez que l'icone Docker passe au vert, puis relancez votre commande."
} else {
  Write-Warning "Docker Desktop introuvable a l'emplacement standard."
}
