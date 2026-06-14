#!/bin/sh
set -e

# On se place dans le dossier de l'API : le schéma Prisma et le code compilé
# (dist/) y sont relatifs. Lancer ces commandes depuis /app échouerait.
cd "$(dirname "$0")/.."

echo "Running database migrations..."
npx prisma migrate deploy

# Démarrage des workers BullMQ (pipeline asynchrone : parsing CV, scraping,
# génération et envoi d'emails) ET de l'API, chacun dans son process.
echo "Starting workers..."
node dist/worker.js &
WORKER_PID=$!

echo "Starting API..."
node dist/server.js &
API_PID=$!

# Supervision : si l'un des deux process s'arrête (worker OU API), on stoppe
# l'autre et on quitte en erreur pour que l'orchestrateur (Docker/K8s) relance
# un conteneur sain — au lieu de laisser tourner une API sans workers.
wait -n 2>/dev/null || wait
echo "Un process s'est arrêté — arrêt du conteneur."
kill "$WORKER_PID" "$API_PID" 2>/dev/null || true
exit 1
