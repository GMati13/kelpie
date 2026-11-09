#!/bin/sh
# Claude Code's status line command, for the Kelpie footer. Claude Code hands it the session's model,
# effort and rate limits on stdin; this saves them per session for the sidebar and prints nothing,
# so Claude's own footer stays as it was.
#   settings.json: "statusLine": {"type": "command", "command": "sh ~/.config/herdr-app/mods/kelpie/claude-statusline.sh [name]"}
# The sidebar names the account: [name] when given (each account's settings.json can pass its own),
# else its config folder's (CLAUDE_CONFIG_DIR ~/.claude-work reads Work), else Claude.
# Each file also keeps `config`, the session's CLAUDE_CONFIG_DIR (null when unset: Claude's own ~/.claude),
# so the Kelpie footer can show an account's limits with no agent of it focused.

DIR="$HOME/.cache/kelpie/limits"
mkdir -p "$DIR" && chmod 700 "$DIR"

account=$1
if [ -z "$account" ] && [ -n "$CLAUDE_CONFIG_DIR" ]; then
  account=$(basename "$CLAUDE_CONFIG_DIR" | sed 's/^\.//; s/^claude[-_.]//' | awk '{print toupper(substr($0, 1, 1)) substr($0, 2)}')
fi
[ -n "$account" ] || account=Claude

input=$(cat)
id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
case "$id" in ''|*[!0-9a-f-]*) exit 0 ;; esac

printf '%s' "$input" | jq -c --arg account "$account" --arg config "$CLAUDE_CONFIG_DIR" '{
  account: $account,
  config: (if $config == "" then null else $config end),
  model: .model.display_name,
  effort: .effort.level,
  thinking: .thinking.enabled,
  five_hour: .rate_limits.five_hour,
  seven_day: .rate_limits.seven_day,
  at: now | floor
}' > "$DIR/$id.json.tmp" 2>/dev/null && mv "$DIR/$id.json.tmp" "$DIR/$id.json"

# Sessions that ended a week ago or more (an account's last known limits stay that long).
find "$DIR" -name '*.json' -mmin +10080 -delete 2>/dev/null
exit 0
