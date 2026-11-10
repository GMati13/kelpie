#!/usr/bin/env bash
# The profile's folder (its get_profile mock says ~/cwd/acme, the run's working folder): two clones,
# and a ticket folder with a worktree, as teams lay them out.
set -eu
mkdir -p acme
for r in web api; do git init -q -b main "acme/$r"; git -C "acme/$r" -c user.email=t@example.com -c user.name=t commit -q --allow-empty -m init; done
mkdir -p acme/worktrees/ACME-12
git -C acme/web worktree add -q -b ACME-12-offline ../worktrees/ACME-12/web
