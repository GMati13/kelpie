#!/bin/sh
# Runs every test suite (tests/README.md): JavaScript (node:test, mods under stubs; shell scripts run
# in temp folders with fake programs) and Python (unittest). Exits non-zero when any test fails.
#   ./test.sh            everything
#   ./test.sh js|py      one suite
# Needs node (22 or later), python3, git and jq; installs nothing.
cd "$(dirname "$0")" || exit 1
only=${1:-all}
failed=""
start=$(date +%s)

if [ "$only" = all ] || [ "$only" = js ]; then
  echo "== JavaScript and shell (node:test)"
  # shellcheck disable=SC2046 # test files have no spaces in their names
  node --import ./tests/stubs/register.mjs --test --test-reporter=spec $(find tests -name '*.test.mjs' | sort) || failed="$failed js"
fi

if [ "$only" = all ] || [ "$only" = py ]; then
  echo "== Python (unittest)"
  python3 -I -m unittest discover -s tests/python -t tests/python -p 'test_*.py' || failed="$failed python"
fi

echo
if [ -n "$failed" ]; then
  echo "FAILED:$failed ($(($(date +%s) - start)) s)"
  exit 1
fi
echo "All tests passed ($(($(date +%s) - start)) s)."
