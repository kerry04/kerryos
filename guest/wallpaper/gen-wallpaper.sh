#!/usr/bin/env bash
#
# gen-wallpaper.sh — render the KerryOS Win7-style wallpaper to PNG.
#
# Why a rebuild script instead of a checked-in PNG: the wallpaper is a
# geometric gradient (Win 7's famous "harmony" glow, a soft radial cyan bloom
# on a deep blue field with a subtle light sweep), which we can express in a
# few lines of pure math via ImageMagick. Committing the output would bloat
# the repo and hide the design; committing the generator keeps the theme
# reviewable and re-tunable in code.
#
# Output: <repo>/guest/wallpaper/kerryos-wallpaper.png (1280x800, matches
# the Xvnc default geometry in guest/entrypoint.sh so XFCE never scales it).
set -euo pipefail
cd "$(dirname "$0")"

OUT=wallpaper
mkdir -p "$OUT"

PNG="$OUT/kerryos-wallpaper.png"

# --- Recipe (ImageMagick 6 syntax, all built-ins, nothing exotic): ----------
# 1. Base: cool deep blue radial gradient (KerryOS navy-blue glow).
# 2. Overlay: soft cyan bloom slightly above center (the "harmony" halo).
# 3. Sweep: faint diagonal white sheen for that Win7 light-band feel.
# 4. Vignette: darken edges so the Xfce panel stays legible against the wall.
convert -size 1280x800 radial-gradient:'#1d4eae'-'#0b2258' \
    \( -size 1280x800 radial-gradient:'#4fc3f7'-'none' \
       -alpha set -channel A -evaluate multiply 0.5 +channel \) \
    -composite \
    \( -size 1280x800 gradient:'#ffffff40'-'none' -rotate 20 \) \
    -composite \
    \( -size 1280x800 radial-gradient:none-'#000000' -alpha set \
       -channel A -evaluate multiply 0.35 +channel \) \
    -composite \
    -strip "$PNG"

echo "Wallpaper written:"
ls -la "$PNG"
