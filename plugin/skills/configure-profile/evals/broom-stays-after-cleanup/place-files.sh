#!/usr/bin/env bash
# The profile's folder: a clone whose ACME-12 branch was rebase-merged on the remote (the same changes
# under other hashes) while the local main is behind, and the person's story script judging by commits.
set -eu
g() { git -c user.email=t@example.com -c user.name=t "$@"; }
mkdir -p acme/scripts
git init -q --bare -b main acme/origin.git
git clone -q acme/origin.git acme/web 2>/dev/null
cd acme/web
echo app > app.txt; git add .; g commit -qm init; git push -q origin main
git checkout -q -b 12-offline; echo cache > cache.txt; git add .; g commit -qm "cache pages"; echo sync > sync.txt; git add .; g commit -qm "sync on reconnect"
git push -q origin 12-offline
# On the remote, someone else's work lands first, then 12-offline is rebased onto it and merged.
tmp=$(mktemp -d); git clone -q ../origin.git "$tmp/w" 2>/dev/null
( cd "$tmp/w" && echo docs > docs.txt && git add . && g commit -qm "docs" && g cherry-pick origin/12-offline~1 origin/12-offline >/dev/null && git push -q origin main )
rm -rf "$tmp"
git fetch -q origin
git checkout -q main
cd ..
cat > scripts/story.sh <<'SH'
#!/bin/sh
# Story commands: story.sh leftovers|clean KEY, run in the profile folder. Branches are "<n>-...".
mode=$1; key=$2; n=${key##*-}
cd web || exit 1
for b in $(git for-each-ref --format='%(refname:short)' "refs/heads/$n-*"); do
  if git merge-base --is-ancestor "$b" main; then m=merged; else m="not merged"; fi
  case $mode in
  leftovers) echo "branch $b ($m)";;
  clean) if [ "$m" = merged ]; then git branch -d "$b" >/dev/null && echo "removed $b"; else echo "kept $b (not merged into main)"; fi;;
  esac
done
SH
