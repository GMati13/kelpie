# Testing

Development here is done largely by AI agents, so the tests are what keeps it safe: nothing reaches `main` with a failing test, and nothing security-relevant changes without a test. These are the rules; `tests/README.md` is the harness itself (layout, stubs, helpers, snapshots, what's covered) and the one place that describes it.

## Running

- `./test.sh` runs every suite; `./test.sh js` (JavaScript and the shell scripts' tests) or `./test.sh py` (Python) runs one. It must pass before any commit: the pre-commit hook (`scripts/pre-commit`, enabled once per clone with `git config core.hooksPath scripts`) and CI (`.github/workflows/test.yml`, macOS and Linux) run it too.
- It needs Node 22 or later, `python3`, `git` and `jq`, and installs nothing.

## Writing tests

- **Every change comes with tests**: a fix gets a test that failed before it; a feature gets tests for what it promises; a security protection gets a test that fails when the protection is removed. Prove that last one: break the protection, watch the test fail, restore it.
- **Where:** JavaScript in `tests/js/*.test.mjs` with `node:test`, the mods running against the stand-ins for Herdr's host modules in `tests/stubs/` (`herdr`'s `mock`, `gpui-kit`, `gpui-base`); shell scripts in `tests/shell/*.test.mjs`, run for real in a `tempDir()` with the programs they call faked by `fakeBin()` (`tests/lib/helpers.mjs`); Python in `tests/python/test_*.py` with `unittest`.
- **Views:** what a view draws is a text snapshot in `tests/snapshots/` (`views-*.test.mjs`). A view changed on purpose: re-record with `UPDATE_SNAPSHOTS=1 ./test.sh js`, then read `git diff tests/snapshots/` and keep only lines you meant. Never re-record just to make a test pass.
- **No real world:** tests never reach Jira, GitHub or Claude, never touch `~/.config/herdr-app` or `~/.local/share/kelpie`, never run `herdr-app do` or `hc`, never start Herdr. Everything they make goes in a temporary folder.
- **Fast and exact:** a test checks one behaviour, by its observable result, with no sleeps beyond what the behaviour itself needs (`until()` waits for work a call leaves running).
- **Use the demo fixture** (`mods/kelpie/demo/demo.json`, loaded by `tests/lib/stories.mjs` and `tests/lib/views.mjs`) for realistic data; a test that needs a new situation adds it there or builds its own small data, never changes the mods for it.
- A function that's hard to reach from a test may be exported for it: only the `export` keyword, with a comment saying it's for the tests. Don't change behaviour to make something testable without saying why.
- `scripts/e2e-demo.sh` checks Kelpie in a real Herdr window (macOS, never in CI). Run it only with the person's OK (`tests/README.md` says why).

## When a test fails

Find out why. Never weaken, skip or delete a test, or commit with `--no-verify`, to get a commit through. A test that's wrong is fixed in its own commit, saying why it was wrong. A bug your change is about is fixed with its test. A real bug a test finds outside your change is a test marked `{ todo: "BUG: <what and where>" }` (it runs and reports without failing): tell the person, and fix it in its own commit, turning the `todo` into a real test.
