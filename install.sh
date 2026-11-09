#!/bin/sh
# Installs Kelpie into Herdr's folder (~/.config/herdr-app, or $HERDR_APP_HOME): links the layouts,
# themes and mods, so a `git pull` updates them, and copies what Herdr won't read through a link (the
# layouts' previews, the icons, the skins' art and fonts). Run it again after updating.
# Replaces only its own links and copies: a real file or folder of yours in the way is left alone,
# and the run ends by naming it and failing. Merge keys.json into Herdr's own keys.json by hand (README).
set -e
repo=$(cd "$(dirname "$0")" && pwd)
herdr="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
skipped=""

link() {
  src="$1" dest="$2"
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then skipped="$skipped
  $dest"; return 0; fi
  ln -sfn "$src" "$dest"
}

mkdir -p "$herdr/layouts" "$herdr/themes" "$herdr/mods"
# The links are made again each run, so a renamed layout or theme leaves no old name behind (macOS
# ignores case: an old kelpie.json would still be found as Kelpie.json, under its old name). Gone too:
# a Kelpie link left broken by a clone since moved or deleted.
for l in "$herdr"/layouts/* "$herdr"/themes/*; do
  [ -L "$l" ] || continue
  case "$(readlink "$l")" in "$repo"/*) rm "$l"; continue ;; esac
  case "${l##*/}" in [Kk]elpie*) [ -e "$l" ] || rm "$l" ;; esac
done
for f in "$repo"/layouts/Kelpie*.json; do link "$f" "$herdr/layouts/${f##*/}"; done
for f in "$repo"/themes/Kelpie*.json; do link "$f" "$herdr/themes/${f##*/}"; done
for m in kelpie kelpie-artifacts; do link "$repo/mods/$m" "$herdr/mods/$m"; done
# The layouts' previews (the settings' layout picker): Herdr draws no image reached through a link.
for f in "$repo"/layouts/Kelpie*.svg; do
  rm -f "$herdr/layouts/${f##*/}"
  cp "$f" "$herdr/layouts/"
done
# The icons, and each skin's art and fonts (the footer copies them too, on each start).
sh "$repo/mods/kelpie/icons/install.sh" >/dev/null
sh "$repo/mods/kelpie/skins/copy-art.sh" "$repo/mods/kelpie/skins" "$herdr/art/kelpie/skins" "$herdr/fonts"

if [ -n "$skipped" ]; then
  echo "Not installed: these are real files or folders, not Kelpie's links. Move them aside and run this again:$skipped" >&2
  exit 1
fi
echo "Kelpie is installed in $herdr."
echo "Restart Herdr if it's running (it loads fonts at start), then pick Kelpie in Settings > Look."
