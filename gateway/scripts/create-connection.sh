#!/usr/bin/env bash
# Creates the single Guacamole VNC connection "kerryos-guest" via the
# Guacamole 1.5.x REST API, and prints its identifier.
#
# The session broker rotates this connection's VNC password per session;
# the placeholder password set here is never used for real sessions.
#
# Requires: repo-root .env with GUAC_ADMIN_USER and GUAC_ADMIN_PASSWORD.
# Guacamole client must be running (docker compose up -d).
#
# Usage: ./create-connection.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

GUAC_BASE="${GUAC_BASE:-http://127.0.0.1:8081/guacamole}"
CONN_NAME="kerryos-guest"

require() {
  local var="$1"
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: $var is not set. Copy .env.example to .env and fill it in." >&2
    exit 1
  fi
}

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "ERROR: $ENV_FILE not found. Copy .env.example to .env first." >&2
  exit 1
fi

require GUAC_ADMIN_USER
require GUAC_ADMIN_PASSWORD

# 1. Log in -> auth token
TOKEN_JSON="$(curl -sS -X POST "$GUAC_BASE/api/tokens" \
  --data-urlencode "username=$GUAC_ADMIN_USER" \
  --data-urlencode "password=$GUAC_ADMIN_PASSWORD")"
TOKEN="$(python3 -c "import json,sys; print(json.load(sys.stdin)['authToken'])" <<<"$TOKEN_JSON")"
if [[ -z "$TOKEN" || "$TOKEN" == "None" ]]; then
  echo "ERROR: failed to get auth token. Response was: $TOKEN_JSON" >&2
  exit 1
fi

# 2. Check whether the connection already exists (idempotent)
EXISTING_JSON="$(curl -sS "$GUAC_BASE/api/session/data/postgresql/connections?token=$TOKEN")"
EXISTING_ID="$(CONN_NAME="$CONN_NAME" python3 -c "
import json, os, sys
conns = json.load(sys.stdin)
target = os.environ['CONN_NAME']
for c in conns.values():
    if c.get('name') == target:
        print(c.get('identifier'))
        break
" <<<"$EXISTING_JSON")"

if [[ -n "$EXISTING_ID" ]]; then
  echo "Connection '$CONN_NAME' already exists. Identifier: $EXISTING_ID"
  echo "Ensure .env has GUAC_CONNECTION_ID=$EXISTING_ID"
  exit 0
fi

# 3. Create the connection. The guest container takes the static address
#    172.28.0.10 on br-kerryos (broker reserves it); VNC listens on 5901.
CREATE_BODY="$(python3 - <<'PYEOF'
import json
print(json.dumps({
    "name": "kerryos-guest",
    "protocol": "vnc",
    "parameters": {
        "hostname": "172.28.0.10",
        "port": "5901",
        "password": "PLACEHOLDER_BROKER_ROTATES_PER_SESSION",
        "security": "none",
        "disable-audio": "true",
    },
    "attributes": {
        "max-connections": "1",
        "max-connections-per-user": "1",
    },
}))
PYEOF
)"
CREATE_RESP="$(curl -sS -X POST -H 'Content-Type: application/json' \
  -d "$CREATE_BODY" \
  "$GUAC_BASE/api/session/data/postgresql/connections?token=$TOKEN")"
NEW_ID="$(python3 -c "import json,sys; print(json.load(sys.stdin).get('identifier',''))" <<<"$CREATE_RESP")"

if [[ -z "$NEW_ID" ]]; then
  echo "ERROR: connection creation failed. Response was: $CREATE_RESP" >&2
  exit 1
fi

echo "Created connection '$CONN_NAME'. Identifier: $NEW_ID"
echo ""
echo "HUMAN ACTION: put this in the repo-root .env:"
echo "  GUAC_CONNECTION_ID=$NEW_ID"
