#!/bin/sh
# Asks a Jira Cloud site for the Kelpie layout's board and prints {site, code, authed, body} as JSON.
#   jira.sh [--email <email> --token-command <command>] <site> <keychain item> search '<jql>' [<nextPageToken>]
#   jira.sh [--email <email> --token-command <command>] <site> <keychain item> get '<path>'
#   jira.sh [--email <email> --token-command <command>] <site> <keychain item> transition <KEY> <transition id>
# search: one page (up to 100) of a search; get: a GET, e.g. /rest/agile/1.0/board/<id>;
# transition: moves an issue along its workflow (the ids are GET /rest/api/3/issue/<KEY>/transitions).
# <site> is https://<name>.atlassian.net. Sign-in is the Jira email and an API token: with
# --token-command, the token is what that command prints (1Password's `op read …`, `pass …`,
# `secret-tool lookup …`), run by the user's shell; else it comes from the login Keychain item (macOS),
# whose account is the email and password the token. The token only travels through pipes, to curl's
# stdin: never on a command line, in the environment, a file or the output. One request per run; the
# only write is transition, which changes nothing but the issue's status.

email=
token=
token_command=
while :; do
  case "$1" in
    --email) email=$2; shift 2 ;;
    --token-command) token_command=$2; shift 2 ;;
    *) break ;;
  esac
done

site=${1%/}
item=$2
shift 2 2>/dev/null

# Jira Cloud only: the token goes to this site, so nothing but https://<name>.atlassian.net.
if ! printf '%s' "$site" | grep -Eq '^https://[A-Za-z0-9-]+\.atlassian\.net$'; then
  jq -nc '{code: 0, error: "site"}'; exit 0
fi

nl='
'
if [ -n "$token_command" ]; then
  # Its errors are dropped too: a secret tool's message could quote what it read.
  if ! token=$("${SHELL:-/bin/sh}" -c "$token_command" 2>/dev/null </dev/null) || [ -z "$token" ]; then
    jq -nc --arg site "$site" '{site: $site, code: 0, body: null, error: "command"}'
    exit 0
  fi
  # Only its first line counts, without a trailing CR (Windows line ends).
  token=${token%%"$nl"*}
  token=${token%"$(printf '\r')"}
elif [ -n "$item" ]; then
  token=$(security find-generic-password -s "$item" -w 2>/dev/null)
  email=$(security find-generic-password -s "$item" 2>/dev/null | sed -n 's/^ *"acct"<blob>="\(.*\)"$/\1/p')
fi
if [ -z "$token" ] || [ -z "$email" ]; then
  jq -nc --arg site "$site" '{site: $site, code: 0, body: null, error: "missing"}'
  exit 0
fi
# Both go into curl's config inside double quotes: a quote, backslash or line break there would add
# options of its own (another URL that gets the credentials, say), so a sign-in holding one is refused.
case "$email$token" in
  *'"'*|*'\'*|*"$(printf '\r')"*|*"$nl"*)
    jq -nc --arg site "$site" '{site: $site, code: 0, body: null, error: "invalid"}'
    exit 0 ;;
esac

body=$(mktemp) || exit 1
headers=$(mktemp) || exit 1
trap 'rm -f "$body" "$headers"' EXIT

case "$1" in
  search)
    request=$(jq -nc --arg jql "$2" --arg page "$3" '{jql: $jql, maxResults: 100, fields: ["summary", "status", "assignee", "issuetype", "priority", "parent"]}
      + (if $page == "" then {} else {nextPageToken: $page} end)')
    set -- -X POST "$site/rest/api/3/search/jql" --data "$request" ;;
  get)
    case "$2" in /rest/*) ;; *) jq -nc '{code: 0, error: "path"}'; exit 0 ;; esac
    set -- "$site$2" ;;
  transition)
    printf %s "$2" | grep -Eq '^[A-Z][A-Z0-9_]*-[0-9]+$' && printf %s "$3" | grep -Eq '^[0-9]+$' || { jq -nc '{code: 0, error: "usage"}'; exit 0; }
    set -- -X POST "$site/rest/api/3/issue/$2/transitions" --data "$(jq -nc --arg id "$3" '{transition: {id: $id}}')" ;;
  *) jq -nc '{code: 0, error: "usage"}'; exit 0 ;;
esac

code=$(printf 'user = "%s:%s"\n' "$email" "$token" |
  curl -sS --max-time 20 -K - -o "$body" -D "$headers" -w '%{http_code}' \
    -H 'Accept: application/json' -H 'Content-Type: application/json' "$@" 2>/dev/null)

# A rejected token still gets 200 and an empty, anonymous result: Jira names the account only
# when the request was signed in.
if grep -qi '^x-aaccountid:' "$headers"; then authed=true; else authed=false; fi

jq -nc --arg site "$site" --arg code "${code:-0}" --argjson authed "$authed" --rawfile raw "$body" \
  '{site: $site, code: ($code | tonumber), authed: $authed, body: ($raw | try fromjson catch null)}'
