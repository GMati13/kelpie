# Testing

Development here is done largely by AI agents, so the tests are what keeps it safe: nothing reaches `main` with a failing test, and nothing security-relevant changes without a test. `tests/README.md` describes the harness in detail.

## Running

- `./test.sh` runs every suite (JavaScript, shell scripts, Python). It must pass before any commit; the pre-commit hook and the GitHub workflow run it too.
- It needs nothing installed beyond the requirements in the README (Node, `python3`, `sh`) and works on macOS and Linux.

## Writing tests

- **Every change comes with tests**: a fix gets a test that failed before it; a feature gets tests for what it promises; a security protection gets a test that fails when the protection is removed. Prove that last one: break the protection, watch the test fail, restore it.
- **Where:** JavaScript with `node:test`, using the stand-ins for Herdr's mod libraries (`herdr`, `gpui-kit`, `gpui-base`) in `tests/stubs/`; shell scripts run in a temporary folder with fake `curl`/`gh`/`security` on `PATH`; Python with `unittest`.
- **Views:** what a view draws is checked as a recorded element tree (snapshot); a snapshot that changes is reviewed like code, never just re-recorded to make a test pass.
- **No real world:** tests never reach Jira, GitHub or Claude, never touch `~/.config/herdr-app` or `~/.local/share/kelpie`, never run `herdr-app do`, `hc send/kill/rm`. Everything they make goes in a temporary folder they remove.
- **Fast and exact:** a test checks one behaviour, by its observable result, with no sleeps beyond what the behaviour itself needs.
- **Use the demo fixture** (`mods/kelpie/demo/demo.json`) for realistic story data; a test that needs a new situation adds it there or builds its own small data.
- A function that's hard to reach from a test may be exported for it; say so in a comment. Don't change behaviour to make something testable without saying why.

## When a test fails

Find out why. Never weaken, skip or delete a test to get a commit through. A test that's wrong is fixed in its own commit, saying why it was wrong. A real bug a test found is fixed with the test, or, if it can't be fixed now, the test is marked `todo` with the reason and the person is told.
