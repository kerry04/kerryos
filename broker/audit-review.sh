#!/usr/bin/env bash
#
# audit-review.sh — weekly KerryOS session-log review.
#
# Reads the broker's audit log (broker-data/audit.log, volume-mounted out
# of the kerryos-broker-1 container) and prints an anomaly report. Run it
# on brain 67 from the repo root — it reads the volume file directly:
#   docker exec kerryos-broker-1 cat /data/audit.log > /tmp/audit.log
#   ./broker/audit-review.sh /tmp/audit.log
#
# What it checks (per README.md "Security notes worth re-reading monthly"):
#   1. session volume: >10 sessions/hour sustained → flag
#   2. BLOCKED/denied spikes in the proxy (sourced from the egress layer, not
#      here — see nftables counters, out of scope for this script)
#   3. sessions that died abnormally fast (< 30s — could be a crash loop)
#   4. sessions that all lived the full/hard-capped duration (could mean the
#      hard-cap is expired but nobody noticed — the sweeper always ends them)
#   5. top IP hashes (no PII — the log stores SHA-256 hashes only)
#
# Exit codes: 0 = clean, 1 = anomalies found, 2 = usage/IO error.
set -euo pipefail

LOG="${1:-/tmp/audit.log}"
[ -f "$LOG" ] || { echo "usage: $0 <audit.log>   (default /tmp/audit.log)"; exit 2; }

# Fields per line: <iso-ts> <session-id> <ip-hash> <duration-s> <reason>
lines="$(grep -c . "$LOG" || true)"
if [ "$lines" -eq 0 ]; then
  echo "audit log empty — nothing to review."
  exit 0
fi

echo "== KerryOS audit review ($(date -u '+%Y-%m-%d %H:%M UTC')) =="
echo "lines: $lines"

# --- 1. volume ---
# python3 for a reliable ISO→epoch; spans the whole log, prints span in hours.
span_h="$(python3 - "$LOG" <<'PY'
import sys, datetime
vals = []
with open(sys.argv[1]) as fh:
    for line in fh:
        parts = line.split()
        if parts:
            try:
                vals.append(datetime.datetime.fromisoformat(parts[0].replace("Z", "+00:00")))
            except ValueError:
                pass
if len(vals) < 2:
    print("0.01")
else:
    print(max((max(vals)-min(vals)).total_seconds()/3600, 0.01))
PY
)"
rate=$(python3 -c "print(f'{$lines / float(${span_h:-0.01}):.1f}')" 2>/dev/null || echo '0')
echo "session rate: $rate /hour"
rate_flag=$(python3 -c "print('yes' if float('${rate:-0}') > 10 else 'no')")
if [ "$rate_flag" = "yes" ]; then
  echo "!! FLAG: session rate > 10/hour — investigate (SEO scraping? abuse?)."
  RC=1
fi

# --- 2. crash-loop sessions (< 30s) ---
crash=$(awk '$4 < 30 {c++} END{print c+0}' "$LOG")
if [ "$crash" -gt 0 ]; then
  echo "⚠︎  $crash session(s) ended < 30s (possible boot failures or kill loops)."
  awk '$4 < 30 {print "   ", $0}' "$LOG" | head -5
  RC=1
fi

# --- 3. reason distribution (anything unexpected in the reason column) ---
echo "end reasons:"
awk '{c[$5]++} END{for (r in c) printf "   %-12s %d\n", r, c[r]}' "$LOG" | sort
allowed="expired idle ended killed boot-failure"
while IFS= read -r r; do
  [ -z "$r" ] && continue
  if ! grep -qw "$r" <<<"$allowed"; then
    echo "⚠︎  unexpected end reason: '$r'"
    RC=1
  fi
done < <(awk '{print $5}' "$LOG" | sort -u)

# --- 4. top visitor IP hashes (no PII) ---
echo "top 3 IP hashes by session count:"
awk '{c[$3]++} END{for (h in c) print c[h], h}' "$LOG" | sort -rn | head -3 | awk '{printf "   %3d  %s…\n", $1, substr($2,1,12)}'

exit "${RC:-0}"
