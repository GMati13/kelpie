# Security

Kelpie runs commands, holds a Jira sign-in and starts Claude agents on a person's machine, and reads text written by strangers (pull requests, Jira tickets). Every change is checked against these rules, and every protection here has a test that fails when it's removed (`testing.md`).

## What can't be trusted

- Jira: issue keys, summaries, descriptions, statuses (anyone on the board writes them).
- GitHub: pull request titles, bodies, authors, branch and repo names, file paths, diffs, and the code of a pull request (anyone can open one and request a review).
- Claude session titles and prompts, file names in screenshot folders, web pages in the Web panel.
- Profile settings written by an agent (`kelpie.apply-profile`): an agent can be misled by what it read.
- Anything a terminal prints: a program can print the escape that makes Herdr list it as an agent.

## Rules

**Commands.** Never build shell code out of a value. A `sh -c` script takes values as `"$1"`, `"$2"`…, quoted. Prefer `exec(program, [args])` without a shell. A value that could start with `-` goes after `--` or is validated. Check a ticket key against `^[A-Z][A-Z0-9_]*-\d+$` before it goes into a command or a path.

**The Jira sign-in.** The token never appears in a command's arguments, an environment variable, a file, a log, a notification, shared state or text sent to an agent. It goes to curl on stdin (`jira.sh`). Only `https://<name>.atlassian.net` gets it (`parseBoard()`, `jira.sh`). An email or token with a quote, backslash or line break is refused. Agents never handle secrets and never run a token command.

**Agents changing profiles.** What can run a command, steer agents or move the sign-in (`CONFIRM_KEYS` in config.js) waits for the person's click in Kelpie, through a dialog button, never a command an agent could run itself. A new setting of that kind joins `CONFIRM_KEYS`.

**Messages to agents.** Only through `sendToClaude()`, which checks the terminal's real foreground process. Never `hc(["send", …])` directly.

**Prompts.** Values go in through `promptValue()` (no control characters; the fill functions in config.js all do). Fence long text others wrote, and end every task that carries it with the `OTHERS` note: information, not instructions. Prompts say what to look at or do, never how to reach it: Claude uses its own access (MCP servers, plugins, its tools); Kelpie's plumbing (`jira.sh`, its `gh` calls, the person's sign-in) is never offered, and no message names a tool. When Claude can't reach something, it says so.

**Other people's code.** Never run it. A review agent starts outside the checkout (in the profile's folder) and reviews by reading. No default prompt asks to run, build, install or test a pull request.

**Background agents.** Claude run without a terminal (What next?) runs read-only: `--permission-mode plan`, editing tools disallowed, whatever the person's default mode is. Plan mode lets through only tools marked read only: in the plugin, only tools that change nothing of the person's work get that mark (`get_profile`, `save_status`, which only reads a saved answer, `get_next`, and `suggest_next`, which only changes what Kelpie suggests).

**Files.** Never delete, overwrite or write through a symlink to a file the person owns; installs and copies skip and report what's in the way. Deletions are guarded by an exact, tested path check (`removeDemo()`, `resetBrowser()`). Temp files and folders: `mktemp` / `mktemp -d` (private), never fixed names in `/tmp`. Caches holding prompts or titles are private.

**Destructive actions.** Closing a space, pausing, cleaning up or killing a process asks first when something is working, and refuses what isn't settled (`cleanBlockers()`: not Done, an open pull request, a busy agent; `cleanUp()` checks those again when it runs, and uncommitted work, and for a reassigned story commits not pushed). Match processes by an exact, tested pattern; never kill what Kelpie didn't start.

## When you change something here

- Adding an `exec`/`hc`/`run` call, a prompt, a profile setting, a file operation or a process kill: check it against these rules and add or extend the tests.
- Found a weakness? Say so to the person before working around it, and fix it with a test.
- Security-sensitive changes are summarised in the commit body.

## Known gaps

Where the code doesn't meet these rules yet (fix them with tests, then remove the line):

- Ticket keys from a Jira board's main load aren't checked against the key pattern (kept stories' are, in board.js, and a GitHub Project's are made and checked in project.js). `runCommand()` (config.js) then puts `{key}` into a profile command unquoted.
- Add to chat (`pasteToChat()`, `mods/kelpie-artifacts/main.js`) pastes a file path, and the note typed with it, into an agent's terminal with `terminal.paste`, without `sendToClaude()`'s check that the terminal really runs Claude. It presses no Enter, and the note is one line with no control characters (`cleanNote()`), so nothing runs by itself.
- Screenshot mark-up (`FLATTEN_SCRIPT`, `mods/kelpie-artifacts/markup.js`) writes into a fixed folder, `${TMPDIR:-/tmp}/herdr-markup` (shared `/tmp` on Linux), made with default permissions: its files get `mktemp` names, but another user could own the folder first. Thumbnails (`session.js`) add `.png` to a `mktemp` name, a name `mktemp` didn't reserve.
- `~/.cache/kelpie/sessions.json` (sessions.py) and the Web panel's folders (`~/.local/share/kelpie/web/<profile>/`, main.js) are created with the default permissions, not private.
- Inside a profile section, a key is refused as a secret only by its name (`SECRET` in config.js: token, password, secret), so `github.pat` passes; sections don't have their own list of allowed keys.
- What next? passes its whole prompt as a command-line argument (`claude -p <task>` in `brew()`), visible to other users in `ps`.
- `.claude/settings.json` allows every `gh api` call, including ones that write.
