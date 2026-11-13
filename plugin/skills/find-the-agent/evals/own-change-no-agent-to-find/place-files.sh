#!/usr/bin/env bash
set -eu
git_() { git -c user.name=Acme -c user.email=dev@example.com -c commit.gpgsign=false -c init.defaultBranch=main "$@"; }
cp -R "$(dirname "$0")/files/." .
git_ init -q && git_ add -A && git_ commit -qm "start"
printf '\nRun `npm run dev` to start it.\n' >> README.md
