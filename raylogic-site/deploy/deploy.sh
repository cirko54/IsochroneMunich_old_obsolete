#!/usr/bin/env bash
# Synchronisiert site/ und deploy/ auf die Synology. Aufruf vom Mac:
#   NAS=admin@nas.local NAS_PATH=/volume1/docker/raylogic ./deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

: "${NAS:?NAS=user@host setzen}"
: "${NAS_PATH:=/volume1/docker/raylogic}"
SSH_PORT="${SSH_PORT:-22}"

rsync -avz --delete -e "ssh -p $SSH_PORT" \
  --exclude '.DS_Store' \
  site deploy "$NAS:$NAS_PATH/"

# Statische Dateien werden per Volume gemountet – Neustart nur bei geänderter nginx.conf nötig
if [[ "${RELOAD:-0}" == "1" ]]; then
  ssh -p "$SSH_PORT" "$NAS" "sudo docker exec raylogic-web nginx -s reload"
fi
echo "Deploy fertig → $NAS:$NAS_PATH"
