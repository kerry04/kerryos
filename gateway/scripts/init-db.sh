#!/usr/bin/env bash
# Generates guacamole/initdb.sql (the Guacamole JDBC schema) using the
# official guacamole image's own initdb.sh. One-time step on brain 67.
#
# Idempotent: skips if guacamole/initdb.sql already exists, unless --force.
#
# Usage: ./init-db.sh [--force]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$SCRIPT_DIR/../guacamole/initdb.sql"
IMAGE="guacamole/guacamole:1.5.5"

if [[ -f "$OUT" && "${1:-}" != "--force" ]]; then
  echo "initdb.sql already exists at $OUT - skipping (pass --force to regenerate)."
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker not found. Run this script on brain 67." >&2
  exit 1
fi

echo "Pulling $IMAGE (multi-arch; brain 67 will pull the arm64 variant)..."
docker pull "$IMAGE" >/dev/null

echo "Generating PostgreSQL schema -> $OUT"
docker run --rm "$IMAGE" /opt/guacamole/bin/initdb.sh --postgres > "$OUT"

LINES="$(wc -l < "$OUT")"
if [[ "$LINES" -lt 100 ]]; then
  echo "ERROR: generated schema looks too short ($LINES lines). Aborting." >&2
  rm -f "$OUT"
  exit 1
fi

echo "OK: wrote $OUT ($LINES lines)."
echo "The postgres service mounts this into /docker-entrypoint-initdb.d/ on first start."
