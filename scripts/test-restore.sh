#!/bin/bash
# Proves a backup can be restored: loads the newest (or the given) database backup
# into a throwaway PostgreSQL container and compares row counts with the live database.
# Touches nothing in the running stack.
#
#   ./scripts/test-restore.sh [backups/zokul_db_….sql.gz]

set -euo pipefail
export MSYS_NO_PATHCONV=1

COMPOSE="${COMPOSE:-docker-compose.local.yml}"
DB_FILE="${1:-$(ls -1t ./backups/zokul_db_*.sql.gz 2>/dev/null | head -n 1)}"
[ -n "$DB_FILE" ] && [ -f "$DB_FILE" ] || { echo "No backup found. Run ./scripts/backup-db.sh first." >&2; exit 2; }
NAME="zokul-restore-test-$$"
TABLES="users chats chat_participants messages message_reads invites audit_log agent_tokens"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "Backup: $DB_FILE"
docker run -d --rm --name "$NAME" -e POSTGRES_USER=zokul -e POSTGRES_PASSWORD=zokul -e POSTGRES_DB=zokul postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U zokul -d zokul >/dev/null 2>&1 && break; sleep 1; done
sleep 2
gzip -dc "$DB_FILE" | docker exec -i "$NAME" psql -q -U zokul -d zokul -v ON_ERROR_STOP=1 >/dev/null

count() { # $1 = "live" or "copy", $2 = table
  local q="SELECT count(*) FROM $2"
  if [ "$1" = live ]; then docker compose -f "$COMPOSE" exec -T postgres psql -tA -U zokul -d zokul -c "$q"; else docker exec "$NAME" psql -tA -U zokul -d zokul -c "$q"; fi | tr -d '\r'
}
fail=0
printf '%-20s %8s %8s\n' table live restored
for t in $TABLES; do
  a=$(count live "$t"); b=$(count copy "$t")
  mark=""; [ "$a" = "$b" ] || { mark="  <- differs (data changed since the backup?)"; fail=1; }
  printf '%-20s %8s %8s%s\n' "$t" "$a" "$b" "$mark"
done
owner=$(docker exec "$NAME" psql -tA -U zokul -d zokul -c "SELECT count(*) FROM users WHERE role = 'admin'" | tr -d '\r')
[ "$owner" = "1" ] || { echo "Restored copy has $owner owners, expected 1"; fail=1; }
if [ $fail = 0 ]; then echo "RESTORE TEST PASSED"; else echo "RESTORE TEST: differences found"; exit 1; fi
