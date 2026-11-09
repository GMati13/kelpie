#!/bin/sh
# Links the Kelpie layouts, themes and mods into Herdr's folder, then copies the icons out of the repo
# (Herdr draws no SVG reached through a symlink). Replaces symlinks only: a real file or folder in the
# way is reported and left alone, except the layouts' own previews (Kelpie*.svg), copied over each time.
# Merge keys.json into Herdr's own keys.json by hand.
set -e
repo=$(cd "$(dirname "$0")" && pwd)
herdr="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

link() {
  src="$1" dest="$2"
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then echo "skipped $dest: not a symlink"; return; fi
  ln -sfn "$src" "$dest"
}

mkdir -p "$herdr/layouts" "$herdr/themes" "$herdr/mods"
# This repo's links are made again, so a renamed layout or theme leaves no old name behind (macOS
# ignores case: an old kelpie.json would still be found as Kelpie.json, and listed under its old name).
for l in "$herdr"/layouts/* "$herdr"/themes/*; do
  if [ -L "$l" ]; then case "$(readlink "$l")" in "$repo"/*) rm "$l" ;; esac; fi
done
for f in "$repo"/layouts/Kelpie*.json; do link "$f" "$herdr/layouts/$(basename "$f")"; done
# The layouts' previews (the settings' layout picker) are copied: Herdr draws no image reached through a symlink.
for f in "$repo"/layouts/Kelpie*.svg; do
  dest="$herdr/layouts/$(basename "$f")"
  rm -f "$dest"
  cp "$f" "$dest"
done
for f in "$repo"/themes/Kelpie*.json; do link "$f" "$herdr/themes/$(basename "$f")"; done
for m in kelpie kelpie-artifacts; do link "$repo/mods/$m" "$herdr/mods/$m"; done
sh "$repo/mods/kelpie/icons/install.sh"
echo "linked into $herdr"
