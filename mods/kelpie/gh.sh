#!/bin/sh
# Runs gh as a profile's GitHub account (its `github.account`, one of the accounts gh is signed in
# to), whichever one gh has active: gh keeps one "active" token per host, which any other sign-in on
# the machine can replace. The token is asked for by the account's name and handed to that one gh
# run through its environment (GH_TOKEN), never as an argument or into a file. No account given:
# plain gh, its active account. Run by pulls.js (gh()).
#   gh.sh <account or ""> <gh arguments…>
account=$1
shift
[ -n "$account" ] || exec gh "$@"
# A GitHub login: letters, digits and single hyphens, not starting with one (so never an option).
printf '%s' "$account" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9]|-[A-Za-z0-9])*$' || { echo "That isn't a GitHub account name: $account" >&2; exit 2; }
token=$(gh auth token --hostname github.com --user "$account" 2>/dev/null) && [ -n "$token" ] \
  || { echo "gh isn't signed in to the GitHub account $account. Sign in to it in a terminal: gh auth login" >&2; exit 1; }
GH_TOKEN=$token exec gh "$@"
