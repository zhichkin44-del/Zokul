#!/bin/bash
# Zokul backup: database (pg_dump, gzip) and uploaded files (tar.gz), through Docker,
# so nothing has to be installed on the host. Keeps the newest $KEEP of each.
#
#   ./scripts/backup-db.sh                         # local stack (docker-compose.local.yml)
#   COMPOSE=docker-compose.prod.yml ./scripts/backup-db.sh /srv/zokul-backups
#
# The stack also backs itself up once a day (the "backup" service in the compose files).

set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash on Windows: keep /app/... paths as they are

COMPOSE="${COMPOSE:-docker-compose.local.yml}"
BACKUP_DIR="${1:-./backups}"
KEEP="${KEEP:-14}"
TS=$(date -u +%Y%m%d_%H%M%S)   # UTC, same as the backup service
dc() { docker compose -f "$COMPOSE" "$@"; }

mkdir -p "$BACKUP_DIR"
DB_FILE="$BACKUP_DIR/zokul_db_$TS.sql.gz"
FILES_FILE="$BACKUP_DIR/zokul_files_$TS.tar.gz"

echo "Database -> $DB_FILE"
dc exec -T postgres pg_dump -U zokul -d zokul --clean --if-exists --no-owner | gzip > "$DB_FILE.part"
mv "$DB_FILE.part" "$DB_FILE"

echo "Uploaded files -> $FILES_FILE"
dc exec -T server tar czf - -C /app/uploads . > "$FILES_FILE.part"
mv "$FILES_FILE.part" "$FILES_FILE"

# A dump that does not end with PostgreSQL's completion marker is broken.
if ! gzip -dc "$DB_FILE" | tail -n 5 | grep -q "PostgreSQL database dump complete"; then
  echo "ERROR: the database dump looks incomplete: $DB_FILE" >&2
  exit 1
fi

for prefix in zokul_db_ zokul_files_; do
  ls -1t "$BACKUP_DIR"/$prefix* 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do rm -f -- "$old"; done
done
echo "Done. $(ls -1 "$BACKUP_DIR"/zokul_db_* | wc -l) database backups kept in $BACKUP_DIR"
