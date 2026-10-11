#!/usr/bin/env bash
# Rotates the Guacamole admin password via the Guacamole 1.5.x REST API.
#
# Run once after first deploy: this changes the password of GUAC_ADMIN_USER
# (default guacadmin) from whatever it currently is to GUAC_ADMIN_PASSWORD
# from the repo-root .env. If they differ, update .env first.
#
# Usage: ./set-admin-password.sh
#   (override endpoint with GUAC_BASE=http://... if needed)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

GUAC_BASE="${GUAC_BASE:-http://127.0.0.1:8081}"

require() {
  local var="$1"
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: $var is not set in $ENV_FILE." >&2
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

# Current credentials: the password the admin account has RIGHT NOW.
# By default that is the same value you intend to keep, which makes this a
# no-op password re-set (still worth running to verify the flow works).
CURRENT_PASSWORD="${GUAC_CURRENT_PASSWORD:-$GUAC_ADMIN_PASSWORD}"

TOKEN_JSON="$(curl -sS -X POST "$GUAC_BASE/api/tokens" \
  --data-urlencode "username=$GUAC_ADMIN_USER" \
  --data-urlencode "password=$CURRENT_PASSWORD")"
TOKEN="$(python3 -c "import json,sys; print(json.load(sys.stdin)['authToken'])" <<<"$TOKEN_JSON")"
if [[ -z "$TOKEN" || "$TOKEN" == "None" ]]; then
  echo "ERROR: login failed with the current password." >&2
  echo "If you already rotated it, set GUAC_CURRENT_PASSWORD=<old password> in the environment and re-run." >&2
  exit 1
fi

USER_URL="$GUAC_BASE/api/session/data/postgresql/users/$GUAC_ADMIN_USER?token=$TOKEN"
USER_JSON="$(curl -sS "$USER_URL")"
UPDATED_JSON="$(NEW_PASSWORD="$GUAC_ADMIN_PASSWORD" python3 - <<'PYEOF'
import json, os, sys
user = json.load(sys.stdin)
user["password"] = os.environ["NEW_PASSWORD"]
print(json.dumps(user))
PYEOF
<<<"$USER_JSON")"

curl -sS -o /dev/null -X PUT -H 'Content-Type: application/json' \
  -d "$UPDATED_JSON" "$USER_URL"

# Verify: a fresh token with the new password proves the rotation worked.
VERIFY_JSON="$(curl -sS -X POST "$GUAC_BASE/api/tokens" \
  --data-urlencode "username=$GUAC_ADMIN_USER" \
  --data-urlencode "password=$GUAC_ADMIN_PASSWORD")"
VERIFY_TOKEN="$(python3 -c "import json,sys; print(json.load(sys.stdin).get('authToken',''))" <<<"$VERIFY_JSON")"

if [[ -z "$VERIFY_TOKEN" ]]; then
  echo "ERROR: verification login failed after password update." >&2
  exit 1
fi

echo "OK: password for '$GUAC_ADMIN_USER' rotated and verified."
