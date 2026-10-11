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

# --- 4. No VNC RFB auth needed. ---
# The Guacamole connection uses security=none, so guacd connects without a
# VNC password. Access control lives at the Guacamole layer (per-session
# throwaway user) and 5901 is only reachable on the internal compose
# network. Debian TigervNC 1.13.1 ships no vncpasswd binary, so this also
# avoids a missing-tool failure at boot.

# --- 5. Session bus and X server. ---
eval "$(dbus-launch --sh-syntax)"
export DBUS_SESSION_BUS_ADDRESS DBUS_SESSION_BUS_PID

Xvnc :1 -geometry 1280x800 -depth 24 -SecurityTypes None &
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

# --- 6b. Pre-XFCE boot splash (Win7-style, ~2.5s, fails soft). ---
# Runs after the XFCE launch above (splash overlays while XFCE paints); dies
# on its own timer via boot-splash/kerryos-start. Missing script or missing
# xmessage never fails boot.
if [ -x /opt/kerryos/boot-splash/kerryos-start ]; then
  /opt/kerryos/boot-splash/kerryos-start || true
fi

# --- 7. Runtime theming (Phase 3): KerryAero windows + Win7 wallpaper ---
# Belt-and-braces on top of the seeded xfconf skeleton: force the KerryAero
# window theme, pin the panel to the bottom (Win7 taskbar position), and set
# every monitor/workspace backdrop to the shipped Win7-style gradient PNG
# (image-style 3 = scaled-to-fill). Seed values live in skel/.config; these
# runtime queries catch monitors XFCE registered under other names.
sleep 5
xfconf-query -c xfce4-panel -p /panels/panel-1/position -s "p=8" 2>/dev/null || true

# KerryAero window decorations (aero-glass title bars + glossy buttons).
xfconf-query -c xfwm4 -p /general/theme -s "KerryAero" 2>/dev/null || true
xfconf-query -c xfwm4 -p /general/title_font -s "Sans Bold 10" 2>/dev/null || true

WALLPAPER=/opt/kerryos/wallpaper.png
if [ -f "$WALLPAPER" ]; then
  # Re-skin any backdrop property XFCE has already registered.
  while IFS= read -r prop; do
    case "$prop" in
      */image-path|*/last-image)
        xfconf-query -c xfce4-desktop -p "$prop" \
          -t string -s "$WALLPAPER" 2>/dev/null || true ;;
      */image-style)
        xfconf-query -c xfce4-desktop -p "$prop" \
          -t int -s 3 2>/dev/null || true ;;
    esac
  done < <(xfconf-query -c xfce4-desktop -l 2>/dev/null \
             | grep -E '/(image-path|image-style|last-image)$' || true)

  # Seed the common monitor/workspace paths if xfdesktop has not yet created
  # them (fresh $HOME, first paint) — monitor names under Xvnc vary.
  for mon in monitorVNC-0 monitorVNC-1 monitor0 monitorVNCUnknown-1; do
    base="/backdrop/screen0/$mon/workspace0"
    xfconf-query -c xfce4-desktop -p "$base/last-image" \
      -t string -s "$WALLPAPER" --create 2>/dev/null || true
    xfconf-query -c xfce4-desktop -p "$base/image-style" \
      -t int -s 3 --create 2>/dev/null || true
  done
fi

wait "$SESSION_PID"
cleanup
