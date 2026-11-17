#!/usr/bin/env bash
# The person's repository (acme-web) with its own project skills, if any, in .claude/skills.
set -eu
cp -R "$(dirname "$0")/files/." .
git -c init.defaultBranch=main init -q . && git -c user.name=Acme -c user.email=dev@example.com -c commit.gpgsign=false add -A && git -c user.name=Acme -c user.email=dev@example.com -c commit.gpgsign=false commit -qm start
