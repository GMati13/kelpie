#!/bin/sh
# Kelpie's demo agent (demo.js): stands in for a Claude agent in a demo space. It reports itself to
# Herdr as one (OSC 7501: app claude-code, in a state), names its session (the terminal's title, as
# Claude Code does) and draws the lines it was given. A message sent to it (Herdr's first task, a
# button's ask) plays a short turn: working for a few seconds, then done.
#   agent.sh <idle|working|blocked|done|shell> <session name> [line ...]
# `shell` reports nothing: a plain terminal. Lines may carry ANSI colours as \033 escapes.
state=${1:-idle}
title=$2
[ $# -ge 2 ] && shift 2 || shift $#

report() {
  [ "$state" = shell ] && return
  case "$1" in
    blocked) printf '\033]7501;state=blocked:app=claude-code:kind=permission\007' ;;
    *) printf '\033]7501;state=%s:app=claude-code\007' "$1" ;;
  esac
}

[ -n "$title" ] && printf '\033]2;%s\007' "$title"
printf '\033[2J\033[H\033[?25l' # cleared, the cursor hidden
for line; do printf '%b\n' "$line"; done
report "$state"
stty -echo 2>/dev/null
while IFS= read -r said; do
  [ "$state" = shell ] && continue
  [ -n "$said" ] || continue
  printf '\n\033[2m> %s\033[0m\n' "$said"
  report working
  sleep 6
  printf '\033[32m●\033[0m Done. (This is Kelpie'"'"'s demo: nothing was changed.)\n'
  report done
done
# Input closed: stay on screen.
while :; do sleep 3600; done
