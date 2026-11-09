#!/bin/sh
# Links the Kelpie layouts, themes and mods into Herdr's folder, then copies the icons out of the repo
# (Herdr draws no SVG reached through a symlink). Replaces symlinks only: a real file or folder in the
# way is reported and left alone. Merge keys.json into Herdr's own keys.json by hand.
set -e
repo=$(cd "$(dirname "$0")" && pwd)
herdr="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

link() {
  src="$1" dest="$2"
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then echo "skipped $dest: not a symlink"; return; fi
  ln -sfn "$src" "$dest"
}

mkdir -p "$herdr/layouts" "$herdr/themes" "$herdr/mods"
for f in "$repo"/layouts/kelpie*; do link "$f" "$herdr/layouts/$(basename "$f")"; done
for f in "$repo"/themes/kelpie*.json; do link "$f" "$herdr/themes/$(basename "$f")"; done
for m in kelpie kelpie-artifacts; do link "$repo/mods/$m" "$herdr/mods/$m"; done
sh "$repo/mods/kelpie/icons/install.sh"
echo "linked into $herdr"
