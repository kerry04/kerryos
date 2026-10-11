#!/usr/bin/env bash
# Generates guacamole/initdb.sql (the Guacamole JDBC schema) from the
# official guacamole image. One-time step on brain 67.
#
# ARM64-SAFE: the official guacamole image is AMD64-only and cannot RUN on
# brain 67, but the schema is just SQL text. We pull the image (no run),
# create a stopped container, copy the schema files out, and run initdb.sh
# on the HOST. Never `docker run` the AMD64 image.
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

echo "Pulling $IMAGE schema files (image is AMD64-only; we never run it)..."
docker pull --platform linux/amd64 "$IMAGE" >/dev/null

TMPDIR="$(mktemp -d)"
trap 'docker rm -f "$CID" >/dev/null 2>&1; rm -rf "$TMPDIR"' EXIT
CID="$(docker create --platform linux/amd64 "$IMAGE")"
docker cp "$CID:/opt/guacamole/bin/initdb.sh" "$TMPDIR/initdb.sh"
docker cp "$CID:/opt/guacamole/schema" "$TMPDIR/schema"

echo "Generating PostgreSQL schema -> $OUT"
# initdb.sh cats the schema files; run it on the host with the extracted dir.
(cd "$TMPDIR" && bash initdb.sh --postgres) > "$OUT"

LINES="$(wc -l < "$OUT")"
if [[ "$LINES" -lt 100 ]]; then
  echo "ERROR: generated schema looks too short ($LINES lines). Aborting." >&2
  rm -f "$OUT"
  exit 1
fi

echo "OK: wrote $OUT ($LINES lines)."
echo "If postgres already started with an empty DB, load it with:"
echo "  source ../../.env && docker exec -i -e PGPASSWORD=\$POSTGRES_PASSWORD \\"
echo "    kerryos-postgres-1 psql -U guacamole_user -d guacamole_db < $OUT"
echo "(Fresh installs: postgres picks it up automatically from"
echo " /docker-entrypoint-initdb.d/ on first start.)"
