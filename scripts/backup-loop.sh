#!/bin/sh
# Runs inside the "backup" service of the compose files: a database dump and an
# archive of uploaded files right after start, then every BACKUP_EVERY seconds
# (default: once a day). Keeps the newest BACKUP_KEEP of each in /backups.
set -u
EVERY="${BACKUP_EVERY:-86400}"
KEEP="${BACKUP_KEEP:-14}"
mkdir -p /backups

until pg_isready -h postgres -U zokul -d zokul >/dev/null 2>&1; do sleep 2; done

while true; do
  ts=$(date +%Y%m%d_%H%M%S)
  if pg_dump -h postgres -U zokul -d zokul --clean --if-exists --no-owner | gzip > "/backups/zokul_db_$ts.sql.gz.part" \
     && gzip -dc "/backups/zokul_db_$ts.sql.gz.part" | tail -n 5 | grep -q "PostgreSQL database dump complete"; then
    mv "/backups/zokul_db_$ts.sql.gz.part" "/backups/zokul_db_$ts.sql.gz"
    echo "$(date -Iseconds) database backup ok: zokul_db_$ts.sql.gz"
  else
    rm -f "/backups/zokul_db_$ts.sql.gz.part"
    echo "$(date -Iseconds) DATABASE BACKUP FAILED" >&2
  fi
  if tar czf "/backups/zokul_files_$ts.tar.gz.part" -C /uploads .; then
    mv "/backups/zokul_files_$ts.tar.gz.part" "/backups/zokul_files_$ts.tar.gz"
  else
    rm -f "/backups/zokul_files_$ts.tar.gz.part"
    echo "$(date -Iseconds) FILES BACKUP FAILED" >&2
  fi
  for prefix in zokul_db_ zokul_files_; do
    ls -1t /backups/$prefix* 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do rm -f "$old"; done
  done
  sleep "$EVERY"
done
