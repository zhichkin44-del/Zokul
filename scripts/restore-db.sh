#!/bin/bash
# Zokul restore: puts a backup made by backup-db.sh back into the running stack.
# The current data is REPLACED. Make a fresh backup first if you may need it.
#
#   ./scripts/restore-db.sh backups/zokul_db_20261023_120000.sql.gz [backups/zokul_files_….tar.gz] [--yes]
#   COMPOSE=docker-compose.prod.yml ./scripts/restore-db.sh …

set -euo pipefail
export MSYS_NO_PATHCONV=1

COMPOSE="${COMPOSE:-docker-compose.local.yml}"
dc() { docker compose -f "$COMPOSE" "$@"; }

DB_FILE=""; FILES_FILE=""; YES=""
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    *.sql.gz) DB_FILE="$arg" ;;
    *.tar.gz) FILES_FILE="$arg" ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done
[ -n "$DB_FILE" ] && [ -f "$DB_FILE" ] || { echo "Usage: $0 <zokul_db_….sql.gz> [zokul_files_….tar.gz] [--yes]" >&2; exit 2; }

if [ -z "$YES" ]; then
  read -r -p "This replaces all current Zokul data with $DB_FILE. Type 'restore' to continue: " answer
  [ "$answer" = "restore" ] || { echo "Aborted."; exit 1; }
fi

echo "Stopping the server so nobody writes during the restore…"
dc stop server >/dev/null
echo "Restoring the database…"
gzip -dc "$DB_FILE" | dc exec -T postgres psql -q -U zokul -d zokul -v ON_ERROR_STOP=1 >/dev/null
dc start server >/dev/null
if [ -n "$FILES_FILE" ]; then
  echo "Restoring uploaded files…"
  dc exec -T server sh -c 'cd /app/uploads && tar xzf -' < "$FILES_FILE"
fi
echo "Restore complete. Everyone stays signed in unless JWT_SECRET changed."
