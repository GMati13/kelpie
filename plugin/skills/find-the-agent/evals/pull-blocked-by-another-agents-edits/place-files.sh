#!/usr/bin/env bash
# A clone one commit behind its origin, with someone else's uncommitted edit to the file that commit
# changes too, so `git pull` refuses: "Your local changes … would be overwritten by merge".
set -eu
git_() { git -c user.name=Acme -c user.email=dev@example.com -c commit.gpgsign=false -c init.defaultBranch=main "$@"; }
here=$(pwd)
mkdir -p "$here/.origin"
git_ init -q --bare "$here/.origin/acme.git"
git_ clone -q "$here/.origin/acme.git" "$here/seed" 2>/dev/null
cp -R "$(dirname "$0")/files/." "$here/seed/"
(cd "$here/seed" && git_ add -A && git_ commit -qm "start" && git_ push -q origin HEAD:main)
git_ clone -q "$here/.origin/acme.git" "$here/acme"
(cd "$here/seed" && printf 'export const radius = 6;\n' >> web/src/theme/tokens.ts && git_ commit -qam "rounder corners" && git_ push -q origin HEAD:main)
rm -rf "$here/seed"
printf 'export const darkAccent = "#5b8cff";\n' >> "$here/acme/web/src/theme/tokens.ts"
