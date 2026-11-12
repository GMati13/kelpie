#!/bin/sh
# Runs gh as a profile's GitHub account (its `github.account`, one of the accounts gh is signed in
# to), whichever one gh has active: gh keeps one "active" token per host, which any other sign-in on
# the machine can replace. The token is asked for by the account's name and handed to that one gh
# run through its environment (GH_TOKEN), never as an argument or into a file. No account given:
# plain gh, its active account. Run by pulls.js (gh()).
#   An API call also prints the response's headers first (`--include`), which the limit guard
# (ghlimit.js guarded()) reads for a refusal's Retry-After and takes off again; not when the call asks
# for them itself, nor with --paginate, which would print them for every page.
#   gh.sh <account or ""> <gh arguments…>
# Never traced: bash, which is macOS's sh, takes xtrace from an exported SHELLOPTS, and a trace would
# print the token.
set +xv
account=$1
shift
if [ "$1" = api ]; then
  include=--include
  for a in "$@"; do case $a in -i|--include|--paginate) include= ;; esac; done
  if [ -n "$include" ]; then shift; set -- api "$include" "$@"; fi
fi
[ -n "$account" ] || exec gh "$@"
# A GitHub login: letters, digits and single hyphens, not at either end (so never an option). A case
# pattern, not grep, which checks each line on its own and would pass "bob" with a second line.
case $account in -*|*-|*--*|*[!A-Za-z0-9-]*) echo "That isn't a GitHub account name." >&2; exit 2 ;; esac
# The token is only ever assigned: no command gets it as an argument.
token=$(gh auth token --hostname github.com --user "$account" 2>/dev/null) || token=
case $token in "") echo "gh isn't signed in to the GitHub account $account. Sign in to it in a terminal: gh auth login" >&2; exit 1 ;; esac
GH_TOKEN=$token exec gh "$@"
