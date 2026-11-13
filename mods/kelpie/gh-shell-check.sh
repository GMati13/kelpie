#!/bin/sh
# Checks the person's own shell setup for a profile's GitHub account: starts their shell the way Herdr
# starts an agent's (login and interactive, so it reads their .zshrc, or bash's .bash_profile) with
# KELPIE_GH_ACCOUNT and KELPIE_GH_BIN set, as Kelpie starts them (githubEnv in ui.js), and asks GitHub
# whom gh acts as there (`shell=`) and in a program started from it (`program=`, a plain `sh -c`, which
# reads no shell setup: what fails when only a gh() function is set up); `token=1` when the shell setup
# sets GH_TOKEN itself. 15 s at most. Run by setup.js (the GitHub page's "Check my shell").
#   gh-shell-check.sh <account>
account=$1
# A GitHub login: letters, digits and single hyphens, not at either end (GITHUB_LOGIN in ui.js). A case
# pattern, not grep, which checks each line on its own and would pass "bob" with a second line.
case $account in ""|-*|*-|*--*|*[!A-Za-z0-9-]*) echo "That isn't a GitHub account name." >&2; exit 2 ;; esac
bin=$(cd "$(dirname "$0")" && pwd)/bin
# 15 s at most (KELPIE_CHECK_FOR, seconds, for the tests). The shell runs in a process group of its own,
# which the timer kills whole with KILL: an interactive shell ignores TERM, and whatever it started (a
# gh still waiting, a step of the shell setup) would keep its output open. setsid where there is one
# (Linux), else sh's job control (macOS's sh, bash); with neither, only the shell itself is killed.
limit=${KELPIE_CHECK_FOR:-15}
case $limit in ""|*[!0-9]*) limit=15 ;; esac
own=
if command -v setsid >/dev/null 2>&1; then own=setsid; else set -m 2>/dev/null; fi
KELPIE_GH_ACCOUNT=$account KELPIE_GH_BIN=$bin GH_PAGER='' $own "${SHELL:-/bin/sh}" -lic '
  echo "shell=$(gh api user --jq .login 2>/dev/null)"
  echo "program=$(sh -c "gh api user --jq .login" 2>/dev/null)"
  [ -n "$GH_TOKEN" ] && echo "token=1"; :' </dev/null 2>/dev/null & p=$!
(sleep "$limit"; kill -KILL "-$p" || kill -KILL "$p") >/dev/null 2>&1 & k=$!
wait "$p" 2>/dev/null; r=$?
kill "-$k" 2>/dev/null || kill "$k" 2>/dev/null
exit "$r"
