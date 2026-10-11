#!/usr/bin/env bash
# KerryOS Phase 4 egress verification.
# Run on brain 67 after the guest + Tinyproxy are up. Usage:
#   ./verify-egress.sh [container-name]     (default: kerryos-session)
#
# The guest's proxy env (http_proxy/https_proxy=http://172.28.0.20:3128)
# is what curl picks up automatically.
set -u

CONTAINER="${1:-kerryos-session}"
FAIL=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

echo "== KerryOS egress check: guest container '$CONTAINER' =="
echo

# Precondition: container is running.
if ! docker inspect --format='{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
    echo "FAIL: container '$CONTAINER' is not running. Aborting."
    exit 2
fi

# 1) Allowed domain must work end to end through the proxy.
CODE=$(docker exec "$CONTAINER" curl -s -o /dev/null -w "%{http_code}" \
    --max-time 15 https://sokoresult.com 2>/dev/null || true)
if [ "$CODE" = "200" ]; then
    pass "allowed domain reachable (https://sokoresult.com -> HTTP $CODE)"
else
    fail "allowed domain blocked or broken (https://sokoresult.com -> HTTP '${CODE:-no response}')"
fi

# 2) Non-allowlisted domain must NOT load. Tinyproxy answers denials with
#    HTTP 403, and plain curl exits 0 on a 403 — so -f is load-bearing here:
#    it turns any HTTP error into a non-zero exit, which is what we assert.
if docker exec "$CONTAINER" curl -sf -o /dev/null --max-time 8 \
    https://example.com >/dev/null 2>&1; then
    fail "egress leak: https://example.com loaded from the guest"
else
    pass "non-allowlisted domain blocked (https://example.com failed as expected)"
fi

# 3) Oracle metadata endpoint must be unreachable. Via the proxy this is a
#    fast 403 from Tinyproxy's filter (IP literal matches nothing); with no
#    proxy it is a firewall timeout. Either way -f makes it a non-zero exit,
#    which is the pass. (nftables rule 8 independently blocks the proxy
#    container from reaching private IPs even if the filter were wrong.)
if docker exec "$CONTAINER" curl -sf -o /dev/null --max-time 5 \
    http://169.254.169.254/ >/dev/null 2>&1; then
    fail "metadata leak: http://169.254.169.254/ responded from the guest"
else
    pass "metadata endpoint unreachable from guest (denied/timeout)"
fi

echo
if [ "$FAIL" -eq 0 ]; then
    echo "ALL EGRESS CHECKS PASSED"
    exit 0
else
    echo "ONE OR MORE EGRESS CHECKS FAILED"
    exit 1
fi
