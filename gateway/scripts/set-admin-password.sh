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

GUAC_BASE="${GUAC_BASE:-http://127.0.0.1:8081/guacamole}"

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
TOKEN="$(printf '%s' "$TOKEN_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('authToken',''))")"
if [[ -z "$TOKEN" || "$TOKEN" == "None" ]]; then
  echo "ERROR: login failed with the current password." >&2
  echo "If you already rotated it, set GUAC_CURRENT_PASSWORD=<old password> in the environment and re-run." >&2
  exit 1
fi

USER_URL="$GUAC_BASE/api/session/data/postgresql/users/$GUAC_ADMIN_USER?token=$TOKEN"

# Changing your OWN password requires the dedicated /password endpoint
# (PUT of a full user object on yourself is rejected with 403 by
# guacamole-auth-jdbc 1.5.5, even for the ADMINISTER system permission).
curl -sS -o /tmp/guac_pw_resp.$$ -X PUT -H 'Content-Type: application/json' \
  -d "{\"oldPassword\":\"$CURRENT_PASSWORD\",\"newPassword\":\"$GUAC_ADMIN_PASSWORD\"}" \
  "$USER_URL/password"
HTTP_CODE=$(curl -sS -o /dev/null -w '%{http_code}' "$USER_URL")
HTTP_CODE=$(curl -sS -o /dev/null -w '%{http_code}' "$USER_URL/password")
if [ -s /tmp/guac_pw_resp.$$ ] && grep -q 'Error' /tmp/guac_pw_resp.$$ 2>/dev/null; then
  cat /tmp/guac_pw_resp.$$ >&2
fi
rm -f /tmp/guac_pw_resp.$$

# Verify: a fresh token with the new password proves the rotation worked.
VERIFY_JSON="$(curl -sS -X POST "$GUAC_BASE/api/tokens" \
  --data-urlencode "username=$GUAC_ADMIN_USER" \
  --data-urlencode "password=$GUAC_ADMIN_PASSWORD")"
VERIFY_TOKEN="$(printf '%s' "$VERIFY_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('authToken',''))")"

if [[ -z "$VERIFY_TOKEN" ]]; then
  echo "ERROR: verification login failed after password update." >&2
  exit 1
fi

echo "OK: password for '$GUAC_ADMIN_USER' rotated and verified."
