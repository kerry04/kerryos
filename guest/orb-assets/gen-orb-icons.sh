#!/usr/bin/env bash
#
# gen-orb-icons.sh — generate the Win7-style start orb icons into
# guest/orb-assets/hicolor/<size>/apps/kerryos-start.png.
#
# The orb is the classic Win7 Start button: a glossy blue orb with a
# lighter inner halo on top and a darker rim underneath. Sizes generated:
# 16 (panel), 22 (panel retina), 24 (fallback), 32 (menu title), 48 (large).
#
# Why code-generated: same principle as the wallpaper and the xfwm4 theme
# — no binary assets committed to the repo. Run this (via a Dockerfile
# step during image build) to regenerate the PNGs.
#
# Output layout follows the freedesktop icon-theme spec so Whisker Menu can
# pick it up by name once installed under /usr/share/icons/hicolor/:
#   <size>/apps/kerryos-start.png
set -euo pipefail
cd "$(dirname "$0")"

OUTDIR="hicolor"
SIZES=(16 22 24 32 48)

# Palette: Win7 orb blues.
OUTER_RIM="#1c5a8e"
MID_GLOW="#2b9bf3"
INNER_HALO="#8fd0ff"
BOTTOM_SHADE="#0d50a0"
HIGHLIGHT="#b3e0ff"

mkdir -p "$OUTDIR"
for size in "${SIZES[@]}"; do
  dir="$OUTDIR/${size}x${size}/apps"
  mkdir -p "$dir"
  out="$dir/kerryos-start.png"

  c=$((size / 2))      # center
  rim_r=$((size / 2))  # outer rim radius (edge)
  orb_r=$((c - 1))     # inner orb radius

  convert -size "${size}x${size}" xc:none \
    \( -clone 0 -fill "$OUTER_RIM" -draw "circle $c,$c $c,0" \) \
    \( -clone 0 -fill "$MID_GLOW" -draw "circle $c,$c $c,$((c - orb_r))" \) \
    \( -size "${size}x${size}" radial-gradient:"$INNER_HALO"-"$MID_GLOW" \
       -alpha set -channel A -evaluate multiply 0.55 +channel \) \
    -composite \
    \( -size "${size}x${size}" xc:none -fill "$HIGHLIGHT" \
       -draw "ellipse $c,$c $orb_r,$orb_r 0,360" \
       -channel A -evaluate multiply 0.22 +channel \) \
    -composite \
    -strip "$out"
done

echo "orb icons generated:"
find "$OUTDIR" -name '*.png' | sort
