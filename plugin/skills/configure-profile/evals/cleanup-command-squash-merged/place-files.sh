#!/usr/bin/env bash
# The profile's folder (its get_profile mock says ~/cwd/acme): a clone of a remote, where ACME-12's branch
# was squash-merged (its own commits never reach main) and ACME-14's still has work main doesn't have.
set -eu
g() { git -c user.email=t@example.com -c user.name=t "$@"; }
mkdir -p acme
git init -q --bare -b main acme/origin.git
git clone -q acme/origin.git acme/web 2>/dev/null
cd acme/web
echo app > app.txt; git add .; g commit -qm init; git push -q origin main
git checkout -q -b 12-offline; echo cache > cache.txt; git add .; g commit -qm "cache pages"; echo sync > sync.txt; git add .; g commit -qm "sync on reconnect"
git push -q origin 12-offline
git checkout -q main; git merge -q --squash 12-offline >/dev/null; g commit -qm "Offline mode (#31)"; git push -q origin main
git checkout -q -b 14-search; echo search > search.txt; git add .; g commit -qm "search box"
git checkout -q main
mkdir -p ../worktrees/ACME-12
git worktree add -q ../worktrees/ACME-12/web 12-offline
