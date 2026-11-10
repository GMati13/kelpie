#!/bin/sh
# End-to-end check of Kelpie in a real Herdr, macOS only, never run in CI (tests/README.md, "The
# end-to-end demo check"). In a throwaway Herdr home it installs Kelpie, starts a second Herdr window
# on that home, checks the mod, opens the demo (`kelpie.demo`), checks `herdr-app status` has no
# errors, shoots the README's states and compares them with docs/screenshots/ within a tolerance, then
# removes the demo and quits that window.
#
#   scripts/e2e-demo.sh <throwaway Herdr home>        e.g. ~/.local/share/kelpie/e2e/herdr-app
#
# Environment:
#   HERDR_BIN      the Herdr binary to start (default: the first program in /Applications/Herdr.app/Contents/MacOS)
#   E2E_TOLERANCE  the share of pixels that may differ from a saved screenshot (default 0.08)
#   E2E_WAIT       seconds to let each state draw before its shot (default 3)
#
# Ask the person first: spaces live in herdr-core, shared by every Herdr window, so the demo's spaces
# show in their own window too while this runs (the end removes them). It refuses Herdr's own home
# (~/.config/herdr-app) and any folder holding something it didn't make.
set -u

die() { printf 'e2e-demo: %s\n' "$*" >&2; exit 1; }
say() { printf '== %s\n' "$*"; }

[ "$(uname)" = Darwin ] || die "macOS only (it starts Herdr's macOS app)."
[ $# -eq 1 ] && [ -n "$1" ] || die "usage: scripts/e2e-demo.sh <throwaway Herdr home>"
command -v herdr-app >/dev/null 2>&1 || die "herdr-app isn't on PATH."
repo=$(cd "$(dirname "$0")/.." && pwd -P) || exit 1

# The throwaway home: a real path (its folder must exist; links resolved), never Herdr's own home or
# anything inside it, and either new, empty, or one this script made before (its marker file).
# Checked before anything is made.
parent=$(cd "$(dirname "$1")" 2>/dev/null && pwd -P) || die "$(dirname "$1") doesn't exist."
home="$parent/$(basename "$1")"
[ -d "$home" ] && home=$(cd "$home" && pwd -P)
own=$(cd "$HOME/.config/herdr-app" 2>/dev/null && pwd -P || printf '%s' "$HOME/.config/herdr-app")
case "$home/" in
  "$own/"*) die "$home is Herdr's own home (or inside it): give a throwaway folder." ;;
esac
case "$own/" in
  "$home/"*) die "$home holds Herdr's own home: give a throwaway folder." ;;
esac
[ "$home" != "$HOME" ] && [ "$home" != / ] || die "$home can't be the Herdr home of a test."
case "$(basename "$home")" in .|..) die "give the throwaway folder by its name." ;; esac
marker="$home/.kelpie-e2e"
if [ -d "$home" ] && [ ! -e "$marker" ] && [ -n "$(ls -A "$home")" ]; then
  die "$home isn't empty and wasn't made by this script: give a new or empty folder."
fi
[ -e "$home" ] && [ ! -d "$home" ] && die "$home is a file."
mkdir -p "$home" && : > "$marker" || die "can't make $home."

if [ -n "${HERDR_BIN:-}" ]; then bin=$HERDR_BIN
else bin=$(find /Applications/Herdr.app/Contents/MacOS -maxdepth 1 -type f -perm -u+x 2>/dev/null | head -n 1)
fi
[ -n "$bin" ] && [ -x "$bin" ] || die "no Herdr binary found: set HERDR_BIN."

export HERDR_APP_HOME="$home"
tolerance=${E2E_TOLERANCE:-0.08}
wait_s=${E2E_WAIT:-3}
shots="$home/e2e-shots"
mkdir -p "$shots"
log="$home/e2e-herdr.log"
herdr_do() { herdr-app do "$@" || say "herdr-app do $1 failed"; }

# What this run started, undone however it ends: the demo removed, the window quit.
pid=""
demo=""
cleanup() {
  if [ -n "$demo" ]; then say "removing the demo"; herdr-app do kelpie.demo-remove >/dev/null 2>&1; sleep 2; fi
  if [ -n "$pid" ]; then say "quitting the test window"; kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

say "installing Kelpie into $home"
"$repo/install.sh" || die "install.sh failed."

say "starting a Herdr window on $home"
"$bin" >"$log" 2>&1 &
pid=$!
up=""
for _ in $(seq 1 60); do
  if herdr-app status >/dev/null 2>&1; then up=1; break; fi
  kill -0 "$pid" 2>/dev/null || die "Herdr quit at start (see $log)."
  sleep 0.5
done
[ -n "$up" ] || die "Herdr didn't answer herdr-app status in 30 s (see $log)."

failed=""
say "herdr-app check"
(cd "$repo" && herdr-app check mods/kelpie && herdr-app check mods/kelpie-artifacts) || failed="$failed check"

# Errors in herdr-app status: any line naming an error, other than an empty list of them.
status_ok() {
  out=$(herdr-app status 2>&1) || { printf '%s\n' "$out"; return 1; }
  bad=$(printf '%s\n' "$out" | grep -i 'error' | grep -viE 'errors?[":[:space:]]*(\[\]|0|none)([^[:alnum:]]|$)' || true)
  [ -z "$bad" ] || { printf '%s\n' "$bad"; return 1; }
}

say "opening the demo"
herdr_do layout.switch '{"name":"Kelpie"}'
sleep 2
herdr_do kelpie.demo
demo=1
sleep 10
herdr_do kelpie.profile-demo
sleep 2
status_ok || failed="$failed status"

# Each README screenshot's state, then its shot.
shoot() { sleep "$wait_s"; herdr-app shot "$shots/$1.png" || failed="$failed shot:$1"; }
herdr_do kelpie.preview-ACME-142; herdr_do kelpie.view-agent; shoot story
herdr_do kelpie.view-changes; shoot changes
herdr_do kelpie.view-agent
herdr_do kelpie.what-next; sleep 8; shoot next
herdr_do 'kelpie.preview-review:web#421'; shoot review
herdr_do kelpie.preview-ACME-180; shoot overview
herdr_do layout.switch '{"name":"Kelpie-Plain"}'; sleep 2
herdr_do kelpie.preview-ACME-142; shoot plain
herdr_do layout.switch '{"name":"Kelpie"}'
status_ok || failed="$failed status-after"

# Each shot against the saved one: the share of pixels that differ by more than a little, a shot of
# another size scaled to the saved one's first.
say "comparing with docs/screenshots (tolerance $tolerance)"
if python3 -c 'import PIL' 2>/dev/null; then
  for name in story changes next review overview plain; do
    python3 -I - "$repo/docs/screenshots/$name.png" "$shots/$name.png" "$tolerance" <<'PY' || failed="$failed compare:$name"
import sys
from PIL import Image, ImageChops
saved, shot, tolerance = sys.argv[1], sys.argv[2], float(sys.argv[3])
try:
    a = Image.open(saved).convert("RGB")
    b = Image.open(shot).convert("RGB")
except OSError as e:
    print(f"  {shot}: {e}"); sys.exit(1)
note = ""
if a.size != b.size:
    note = f" (shot {b.size[0]}x{b.size[1]} scaled to {a.size[0]}x{a.size[1]})"
    b = b.resize(a.size)
d = ImageChops.difference(a, b).convert("L").point(lambda v: 255 if v > 24 else 0)
share = sum(1 for v in d.getdata() if v) / (a.size[0] * a.size[1])
ok = share <= tolerance
print(f"  {'ok  ' if ok else 'DIFF'} {saved.rsplit('/', 1)[-1]}: {share:.1%} of pixels differ{note}")
sys.exit(0 if ok else 1)
PY
  done
else
  say "python3 with PIL (Pillow) isn't installed: skipping the comparison; the shots are in $shots"
fi

if [ -n "$failed" ]; then printf 'e2e-demo: FAILED:%s (shots in %s, Herdr log %s)\n' "$failed" "$shots" "$log" >&2; exit 1; fi
say "all good (shots in $shots)"
