#!/usr/bin/env bash
# Generates guacamole/initdb.sql (the Guacamole JDBC schema) by downloading
# the official schema SQL for the matching Guacamole version. One-time step.
#
# Why not the Docker image: the official guacamole image is AMD64-only and
# cannot run on brain 67 (ARM64). The schema is plain SQL, versioned in the
# guacamole-client repo, so we fetch it directly. No Docker needed at all.
#
# Idempotent: skips if guacamole/initdb.sql already exists, unless --force.
#
# Usage: ./init-db.sh [--force]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$SCRIPT_DIR/../guacamole/initdb.sql"

GUAC_VERSION="1.5.5"
BASE="https://raw.githubusercontent.com/apache/guacamole-client/${GUAC_VERSION}/extensions/guacamole-auth-jdbc/modules/guacamole-auth-jdbc-postgresql/schema"

if [[ -f "$OUT" && "${1:-}" != "--force" ]]; then
  echo "initdb.sql already exists at $OUT - skipping (pass --force to regenerate)."
  exit 0
fi

# A stale empty file or directory from the old Docker-based script blocks us.
if [[ -e "$OUT" ]]; then
  echo "Removing stale $OUT ..."
  rm -rf "$OUT"
fi

echo "Downloading Guacamole $GUAC_VERSION PostgreSQL schema..."
curl -sSf "$BASE/001-create-schema.sql" -o "$OUT"
curl -sSf "$BASE/002-create-admin-user.sql" >> "$OUT"

LINES="$(wc -l < "$OUT")"
if [[ "$LINES" -lt 100 ]]; then
  echo "ERROR: downloaded schema looks too short ($LINES lines). Aborting." >&2
  rm -f "$OUT"
  exit 1
fi

echo "OK: wrote $OUT ($LINES lines)."
echo "If postgres already started with an empty DB, wipe and restart so it"
echo "auto-initializes:  docker compose stop postgres && docker volume rm"
echo "kerryos_pgdata && docker compose up -d postgres"
