#!/bin/sh
# Copies each skin's art (png, svg, in subfolders too) from skins/<name>/art to <art>/<name>, and its
# fonts (ttf, otf) to Herdr's fonts folder, when missing or changed: Herdr draws no image reached
# through a symlink, and loads fonts from its own folder (on its next start). Run by install.sh and by
# the Kelpie footer on each start (main.js).
#   copy-art.sh <skins folder> <art folder> <fonts folder>
for d in "$1"/*/art; do
  [ -d "$d" ] || continue
  n=${d%/art}; n=${n##*/}
  (cd "$d" && find . -type f \( -name '*.png' -o -name '*.svg' \)) | while IFS= read -r f; do
    f=${f#./}
    mkdir -p "$2/$n/$(dirname "$f")"
    cmp -s "$d/$f" "$2/$n/$f" || cp "$d/$f" "$2/$n/$f"
  done
done
for f in "$1"/*/fonts/*.ttf "$1"/*/fonts/*.otf; do
  [ -f "$f" ] || continue
  mkdir -p "$3"
  cmp -s "$f" "$3/${f##*/}" || cp "$f" "$3/"
done
true
