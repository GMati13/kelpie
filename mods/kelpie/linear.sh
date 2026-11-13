#!/bin/sh
# Asks Linear's API one GraphQL question for the Kelpie layout's board and prints {code, body} as JSON.
#   linear.sh [--token-command <command>] <keychain item> '<request>'
# <request> is the JSON body, { query, variables }, its query one of linear.js's own (an operation
# named Kelpie…). Sign-in is a Linear personal API key: with --token-command, the key is what that
# command prints (1Password's `op read …`, `pass …`, `secret-tool lookup …`), run by the user's shell;
# else it's the password of the login Keychain item (macOS). The key only travels through pipes, to
# curl's stdin: never on a command line, in the environment, a file or the output. It goes to
# https://api.linear.app/graphql and nowhere else: the address is written here, not passed in. One
# request per run; the only write linear.js asks for is an issue's state.

# Never traced: bash, which is macOS's sh, takes xtrace from an exported SHELLOPTS, and a trace would
# print the key.
set +xv
token=
token_command=
while :; do
  case "$1" in
    --token-command) token_command=$2; shift 2 ;;
    *) break ;;
  esac
done

item=$1
request=$2

nl='
'
cr=$(printf '\r')
# Only Kelpie's own operations: a query or mutation named Kelpie…, as JSON with variables beside it.
if ! printf '%s' "$request" | jq -e 'type == "object" and (.query | type == "string" and test("^(query|mutation) Kelpie[A-Za-z]+[ ({]"))' >/dev/null 2>&1; then
  jq -nc '{code: 0, error: "usage"}'; exit 0
fi

if [ -n "$token_command" ]; then
  # Its errors are dropped too: a secret tool's message could quote what it read.
  if ! token=$("${SHELL:-/bin/sh}" -c "$token_command" 2>/dev/null </dev/null) || [ -z "$token" ]; then
    jq -nc '{code: 0, body: null, error: "command"}'
    exit 0
  fi
  # Only its first line counts, without a trailing CR (Windows line ends).
  token=${token%%"$nl"*}
  token=${token%"$cr"}
elif [ -n "$item" ]; then
  token=$(security find-generic-password -s "$item" -w 2>/dev/null)
fi
if [ -z "$token" ]; then
  jq -nc '{code: 0, body: null, error: "missing"}'
  exit 0
fi
# It goes into curl's config inside double quotes: a quote, backslash or line break there would add
# options of its own (another URL that gets the key, say), so a key holding one is refused.
case "$token" in
  *'"'*|*'\'*|*"$cr"*|*"$nl"*)
    jq -nc '{code: 0, body: null, error: "invalid"}'
    exit 0 ;;
esac

body=$(mktemp) || exit 1
trap 'rm -f "$body"' EXIT

code=$(printf 'header = "Authorization: %s"\n' "$token" |
  curl -sS --max-time 20 -K - -o "$body" -w '%{http_code}' -X POST \
    -H 'Accept: application/json' -H 'Content-Type: application/json' \
    --data-raw "$request" https://api.linear.app/graphql 2>/dev/null)

jq -nc --arg code "${code:-0}" --rawfile raw "$body" '{code: ($code | tonumber), body: ($raw | try fromjson catch null)}'
