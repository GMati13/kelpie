#!/bin/sh
# Copies these icons to ~/.config/herdr-app/art/kelpie/icons, where ui.js own() points: Herdr draws
# no SVG reached through stow's symlinked mod folder (as with Phosphor's PNGs). Run once per machine
# and after adding or changing an icon.
set -e
here=$(cd "$(dirname "$0")" && pwd)
dest="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/art/kelpie/icons"
mkdir -p "$dest"
cp "$here"/*.svg "$dest"/
echo "icons copied to $dest"
