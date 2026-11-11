#!/bin/sh
# Checks the person's own shell setup for a profile's GitHub account: starts their shell the way Herdr
# starts an agent's (login and interactive, so it reads their .zshrc, or bash's .bash_profile) with
# KELPIE_GH_ACCOUNT and KELPIE_GH_BIN set, as Kelpie starts them (githubEnv in ui.js), and asks GitHub
# whom gh acts as there (`shell=`) and in a program started from it (`program=`, a plain `sh -c`, which
# reads no shell setup: what fails when only a gh() function is set up); `token=1` when the shell setup
# sets GH_TOKEN itself. 15 s at most. Run by setup.js (the GitHub page's "Check my shell").
#   gh-shell-check.sh <account>
account=$1
printf '%s' "$account" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9]|-[A-Za-z0-9])*$' || { echo "That isn't a GitHub account name." >&2; exit 2; }
bin=$(cd "$(dirname "$0")" && pwd)/bin
KELPIE_GH_ACCOUNT=$account KELPIE_GH_BIN=$bin GH_PAGER='' "${SHELL:-/bin/sh}" -lic '
  echo "shell=$(gh api user --jq .login 2>/dev/null)"
  echo "program=$(sh -c "gh api user --jq .login" 2>/dev/null)"
  [ -n "$GH_TOKEN" ] && echo "token=1"; :' </dev/null 2>/dev/null & p=$!
(sleep 15; kill "$p") >/dev/null 2>&1 & k=$!
wait "$p"; r=$?
kill "$k" 2>/dev/null
exit "$r"
