#!/usr/bin/env bash
#
# KerryOS guest entrypoint. Runs as the unprivileged `visitor` user
# (Dockerfile USER). The container starts --read-only with tmpfs mounts on
# /home/visitor, /tmp and /run, so every write below lands on tmpfs and
# nothing persists between sessions.
#
# Responsibilities:
#   1. Refuse to start without a broker-supplied VNC password (never baked in).
#   2. Route all guest egress through the broker-supplied proxy.
#   3. Seed a fresh $HOME from /opt/kerryos/skel when it is empty.
#   4. Write the per-session VNC password file.
#   5. Start Xvnc :1, then the XFCE session, then apply runtime theming.
set -euo pipefail

fail() { echo "entrypoint: $*" >&2; exit 1; }

# --- 1. Fail fast: no password, no desktop. ---
[ -n "${VNC_PASSWORD:-}" ] || fail "VNC_PASSWORD is empty; refusing to start without a broker-supplied password."

# --- 2. Egress goes through the proxy the broker passes in, nothing else. ---
if [ -n "${HTTP_PROXY:-}" ]; then
  export http_proxy="$HTTP_PROXY"
  export https_proxy="$HTTP_PROXY"
fi
export no_proxy="${NO_PROXY:-localhost,127.0.0.1}"

# --- 3. Seed a pristine $HOME from the skeleton on every boot. ---
SKEL=/opt/kerryos/skel
[ -d "$SKEL" ] || fail "skeleton directory $SKEL is missing from the image."
shopt -s dotglob nullglob
home_files=( "$HOME"/* )
if [ "${#home_files[@]}" -eq 0 ]; then
  cp -a "$SKEL"/. "$HOME"/
  chmod 700 "$HOME"
  chmod +x "$HOME"/Desktop/*.desktop 2>/dev/null || true
fi
shopt -u dotglob nullglob

# --- 4. Per-session VNC password file. ---
mkdir -p "$HOME/.vnc"
printf '%s' "$VNC_PASSWORD" | vncpasswd -f > "$HOME/.vnc/passwd"
chmod 600 "$HOME/.vnc/passwd"
unset VNC_PASSWORD  # keep it out of the environment of everything below

# --- 5. Session bus and X server. ---
eval "$(dbus-launch --sh-syntax)"
export DBUS_SESSION_BUS_ADDRESS DBUS_SESSION_BUS_PID

Xvnc :1 -geometry 1280x800 -depth 24 -rfbauth "$HOME/.vnc/passwd" &
XVNC_PID=$!
for _ in $(seq 1 50); do
  [ -S /tmp/.X11-unix/X1 ] && break
  sleep 0.2
done
[ -S /tmp/.X11-unix/X1 ] || fail "Xvnc did not create /tmp/.X11-unix/X1"

# --- 6. XFCE session (runs in foreground via startxfce4). ---
startxfce4 &
SESSION_PID=$!

cleanup() {
  kill "$SESSION_PID" "$XVNC_PID" 2>/dev/null || true
}
trap cleanup TERM INT

# --- 7. Runtime theming, belt and braces on top of the seeded xfconf. ---
# Give the panel and desktop a moment to register their xfconf channels,
# then pin the panel to the bottom (p=8 = bottom edge, full width) and
# paint the desktop KerryOS blue (#2056A8, solid, no image).
sleep 5
xfconf-query -c xfce4-panel -p /panels/panel-1/position -s "p=8" 2>/dev/null || true
while IFS= read -r prop; do
  case "$prop" in
    */color1)
      xfconf-query -c xfce4-desktop -p "$prop" \
        -t int -t int -t int -t int -s 8224 -s 22102 -s 43176 -s 65535 \
        2>/dev/null || true ;;
    */image-style)
      xfconf-query -c xfce4-desktop -p "$prop" -t int -s 0 2>/dev/null || true ;;
  esac
done < <(xfconf-query -c xfce4-desktop -l 2>/dev/null | grep -E '/(color1|image-style)$' || true)

wait "$SESSION_PID"
cleanup
