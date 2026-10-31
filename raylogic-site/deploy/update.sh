#!/bin/sh
# Holt neue Commits und lädt nginx neu, falls sich die Server-Konfiguration geändert hat.
# Gedacht für den DSM-Aufgabenplaner (alle 10 Minuten, Benutzer root).
set -eu
cd "$(dirname "$0")/.."

KEY=/volume1/docker/raylogic-deploy-key
[ -f "$KEY" ] && export GIT_SSH_COMMAND="ssh -i $KEY -o StrictHostKeyChecking=accept-new"

before=$(git rev-parse HEAD)
git pull --ff-only --quiet
after=$(git rev-parse HEAD)

[ "$before" = "$after" ] && exit 0
echo "$(date '+%F %T') aktualisiert: $before -> $after"

if git diff --name-only "$before" "$after" | grep -q '^deploy/'; then
  docker exec raylogic-web nginx -s reload
fi
