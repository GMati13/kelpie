#!/bin/sh
# Checks the person's own shell setup for a profile's GitHub account: starts their shell the way Herdr
# starts an agent's (login and interactive, so it reads their .zshrc, or bash's .bash_profile) with
# KELPIE_GH_ACCOUNT set, and asks GitHub whom its gh acts as. The login comes last in what it prints;
# 15 s at most. Run by setup.js (the GitHub page's "Check my shell").
#   gh-shell-check.sh <account>
account=$1
printf '%s' "$account" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9]|-[A-Za-z0-9])*$' || { echo "That isn't a GitHub account name." >&2; exit 2; }
KELPIE_GH_ACCOUNT=$account GH_PAGER='' "${SHELL:-/bin/sh}" -lic 'gh api user --jq .login' </dev/null 2>/dev/null & p=$!
(sleep 15; kill "$p") >/dev/null 2>&1 & k=$!
wait "$p"; r=$?
kill "$k" 2>/dev/null
exit "$r"
