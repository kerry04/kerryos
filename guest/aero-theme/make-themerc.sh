#!/usr/bin/env bash
#
# make-themerc.sh — build the KerryAero xfwm4 theme into aero-theme/xfwm4/.
#
# The xfwm4 theme engine is XPM-based: every decoration piece (title bar,
# buttons, edges) is a tiny XPM sprite, and the color palette referenced from
# themerc uses fixed color names. This script generates all XPMs and themerc
# programmatically so the repo carries no binary assets and the theme stays
# re-runnable and reviewable as code.
#
# Run from the repo root:      ./guest/aero-theme/make-themerc.sh
# Output:                      guest/aero-theme/xfwm4/{*.xpm, themerc}
#
# The palette deliberately mirrors Windows Aero: a near-white glassy chrome
# with a subtle blue sheen, a slightly darker 1px outer frame, and the classic
# gloss "hot" highlights on hover-able button glyphs.
set -euo pipefail
cd "$(dirname "$0")"

OUT=xfwm4
mkdir -p "$OUT"

# -----------------------------------------------------------------------------
# Palette (referenced by name from themerc — numbers are missing there).
# -----------------------------------------------------------------------------
PALETTE_FILE="$OUT/.palette"
cat > "$PALETTE_FILE" <<'EOF'
# NAME    HEX         (comment)
glass    #F7F9FC      # near-white glass chrome (title bar face)
glass2   #E4EBF3      # subtle gradient bottom of the title bar
sheen    #DCE7F5      # pale blue sheen on the lower half
sheen2   #C9DAF0      # deeper sheen, button hover accent
outer    #A8B6C7      # 1px outer frame (slate blue-gray)
inner    #E9EFF6      # 1px inner edge highlight
ink      #1F2A3A      # deep navy ink for glyph strokes / title text
ink_soft #5A7089      # secondary glyph color
hot      #DDF0FF      # button hover glow (very pale blue-white)
disabled #B8C4D2      # disabled glyph color
EOF

# Map palette names -> hex for XPM c-strings.
declare -A C
while read -r name hex _comment; do
  case "$name" in \#*) continue ;; esac
  C[$name]="$hex"
done < "$PALETTE_FILE"

# ---------------------------------------------------------------------------- #
# XPM helpers.
# make_xpm NAME WIDTH HEIGHT LINES_ARRAY  where LINES_ARRAY is a bash array of
# 1-2-char pixel codes already mapped to palette color names via a char map.
# We build small sprites as plain strings and write .xpm files directly.
# ---------------------------------------------------------------------------- #
gen_xpm() {
  # $1 = filename, $2 = width, $3 = height, $4 = transparent color name ("" = none),
  # stdin = line-by-row pixel chars, each char must be a key in CHARMAP.
  local fname="$1" w="$2" h="$3"
  local rows=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && rows+=("$line")
  done
  if (( ${#rows[@]} != h )); then
    echo "make-themerc: $fname expected $h rows, got ${#rows[@]}" >&2
    exit 1
  fi
  # Palette chars: all squares are solid; no per-sprite transparency.
  local -A chars=()
  local -A char2color=()
  local nchars=0
  local row ch
  for row in "${rows[@]}"; do
    for (( i=0; i<${#row}; i++ )); do
      ch="${row:$i:1}"
      if [[ -z "${chars[$ch]+x}" ]]; then
        chars[$ch]="$ch"
        char2color[$ch]="$ch"
        nchars=$((nchars+1))
      fi
    done
  done
  # Now write the XPM. Color table maps each char to a real hex from C[] using
  # a per-char mapping table we build below in "$OUT/.charmap-$fname-base".
  local path="$OUT/$fname.xpm"
  {
    echo '/* XPM */'
    echo "static char *$fname[] = {"
    echo " \"$w $h $nchars 1\","
  local keys=("${!chars[@]}")
  local k
  for k in "${keys[@]}"; do
      if [[ "$k" == "." ]]; then
        echo " \".\tc None\","
      else
    echo " \"$k\tc #KERRY_CH_$k#\","
      fi
    done
    # pixel rows
    for row in "${rows[@]}"; do
      echo " \"$row\","
    done
    echo "};"
  } > "$path"
  # Rewrite the #KERRY_CH_x# placeholders with real hex codes from the palette.
  # (Direct sed on a temp file — replaces per-char once.)
  local tmp="$path.tmp"
  cp "$path" "$tmp"
  for k in "${!chars[@]}"; do
    [[ "$k" == "." ]] && continue
    local colorname="${CHARMAP[$k]:-glass}"
    local hexcolor="${C[$colorname]:-#F7F9FC}"
    python3 - "$k" "$hexcolor" "$tmp" <<'PYEOF'
import sys, os
ch = sys.argv[1]
hexcolor = sys.argv[2]
path = sys.argv[3]
with open(path, "r") as fh:
    s = fh.read()
s = s.replace("#KERRY_CH_%s#" % ch, hexcolor.lstrip("#"))
with open(path, "w") as fh:
    fh.write(s)
PYEOF
  done
  rm -f "$tmp"
}

# Actual sprite definitions. Each sprite: one char per pixel, chars mapped via
# the CHARMAP associative array (char -> palette color name).

# g = glass (title bar face)
# 2 = glass2 (bottom of title bar gradient)
# s = sheen
# S = sheen2
# o = outer frame slate
# i = inner light edge
# k = ink (deep navy glyph)
# _ = ink_soft
# h = hot (hover glow, unused in baseline sprite but referenced in palette)
# . = transparent
declare -A CHARMAP=(
  [g]=glass
  [2]=glass2
  [s]=sheen
  [S]=sheen2
  [o]=outer
  [i]=inner
  [k]=ink
  [_]=ink_soft
  [h]=hot
)

# --- Title bar: 1px top inner highlight + glass face + sheen bottom. --------
# Height matches xfwm4 default 20px title area (incl. label row).
gen_xpm title-1-active   100 20 <<'XPM'
iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii
igggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggi
igggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggi
igggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggi
igggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggi
igggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggi
igggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggi
igggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggi
igggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggi
igggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggi
igggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggi
igggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggi
igggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggi
igggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggi
igggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggi
iggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg2gggggggi
iggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg22222222ggi
ig2ssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss2gi
ioooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooi
iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii
XPM

# --- Buttons: 12x12 glyphs, 1px inset panel, deep navy ink strokes. --------
# close button: glyph is an X in ink
gen_xpm close-active     12 12 <<'XPM'
kkkkkkkkkkkk
kiiiiiiiiiiik
kikiiiiiiikik
kiikiiiiiikik
kiiikiiiikik
kiiikiiikik
kiiiiikikik
kiiiiikkiik
kiiikiiiikik
kiikiiiiiikik
kikiiiiiiikik
kkkkkkkkkkkk
XPM

# minimize button: glyph is a horizontal bar near the bottom
gen_xpm minimize-active  12 12 <<'XPM'
kkkkkkkkkkkk
kiiiiiiiiiiik
kiiiiiiiiiiik
kiiiiiiiiiiik
kiiiiiiiiiiik
kiiiiiiiiiiik
kiiiiiiiiiiik
kiiikkkkkkiik
kiiikkkkkkiik
kiiiiiiiiiiik
kiiiiiiiiiiik
kkkkkkkkkkkk
XPM

# maximize button: glyph is a hollow square
gen_xpm maximize-active  12 12 <<'XPM'
kkkkkkkkkkkk
kiiiiiiiiiiik
kiiikkkkkkiik
kiiikiikiik
kiiikkiiik
kiiikkiikik
kiiikkiiik
kiiikkiikik
kiiikkiiik
kiiikkkkkkiik
kiiiiiiiiiiik
kkkkkkkkkkkk
XPM

# --- Inactive state: everything muted, glyphs in soft ink. ------------------
sed -e 's/-active/-inactive/g' "$OUT/title-1-active.xpm" \
  | sed -e 's/#F7F9FC/#EDF1F7/g' \
        -e 's/#E4EBF3/#DFE6EE/g' \
        -e 's/#DCE7F5/#D8E2EE/g' \
        -e 's/#1F2A3A/#8A97A6/g' \
  > "$OUT/title-1-inactive.xpm"

for b in close minimize maximize; do
  sed -e 's/#1F2A3A/#8A97A6/g' \
      -e 's/#E9EFF6/#F2F5F9/g' \
    "$OUT/$b-active.xpm" > "$OUT/$b-inactive.xpm"
done

# --- Pushed (pressed) state: glyphs filled with sheen2 accent ---------------
sed -e 's/#1F2A3A/#0F3D91/g' -e 's/#E9EFF6/#C9DAF0/g' \
  "$OUT/close-active.xpm" > "$OUT/close-pressed.xpm"
sed -e 's/#1F2A3A/#0F3D91/g' -e 's/#E9EFF6/#C9DAF0/g' \
  "$OUT/minimize-active.xpm" > "$OUT/minimize-pressed.xpm"
sed -e 's/#1F2A3A/#0F3D91/g' -e 's/#E9EFF6/#C9DAF0/g' \
  "$OUT/maximize-active.xpm" > "$OUT/maximize-pressed.xpm"

# --- themerc: frame style wrapper referencing our sprites. ------------------
cat > "$OUT/themerc" <<'EOF'
# KerryAero — KerryOS take on Windows Aero window decorations.
# Generated by make-themerc.sh; edit the generator, not this file.

# Frame colors.
frame_border_left		outer
frame_border_right		outer
frame_border_top_top		outer
frame_border_top_bottom		outer
frame_border_bottom		outer

# Title bar text.
title_text			ink
title_text_shadow		glass
title_shadow_offset_x		0
title_shadow_offset_y		1
title_shadow_color		#FFFFFF80

# Buttons (active / inactive / pressed).
button_inactive			close-inactive, minimize-inactive, maximize-inactive
button_active			close-active, minimize-active, maximize-active
button_pressed			close-pressed, minimize-pressed, maximize-pressed
button_offset			4
button_spacing			2

# Title app icon (not used; xfwm4 handles that from the app icon).
title_horizontal_offset		3
title_vertical_offset		2

# Which XPMs xfwm4 looks for (explicitly listed so the theme is self-contained).
title-1-active
title-1-inactive
EOF

echo "KerryAero theme generated in $OUT:"
ls -la "$OUT"
