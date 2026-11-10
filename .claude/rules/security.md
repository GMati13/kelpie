# Security

Kelpie runs commands, holds a Jira sign-in and starts Claude agents on a person's machine, and reads text written by strangers (pull requests, Jira tickets). Every change is checked against these rules, and every protection here has a test that fails when it's removed (`testing.md`).

## What can't be trusted

- Jira: issue keys, summaries, descriptions, statuses (anyone on the board writes them).
- GitHub: pull request titles, bodies, authors, branch and repo names, file paths, diffs, and the code of a pull request (anyone can open one and request a review).
- Claude session titles and prompts, file names in screenshot folders, web pages in the Web panel.
- Profile settings written by an agent (`kelpie.apply-profile`): an agent can be misled by what it read.
- Anything a terminal prints: a program can print the escape that makes Herdr list it as an agent.

## Rules

**Commands.** Never build shell code out of a value. A `sh -c` script takes values as `"$1"`, `"$2"`…, quoted. Prefer `exec(program, [args])` without a shell. A value that could start with `-` goes after `--` or is validated. Ticket keys are checked against `^[A-Z][A-Z0-9_]*-\d+$` before use.

**The Jira sign-in.** The token never appears in a command's arguments, an environment variable, a file, a log, a notification, shared state or text sent to an agent. It goes to curl on stdin (`jira.sh`). Only `https://<name>.atlassian.net` gets it (`parseBoard()`, `jira.sh`). An email or token with a quote, backslash or line break is refused. Agents never handle secrets and never run a token command.

**Agents changing profiles.** What can run a command, steer agents or move the sign-in (`CONFIRM_KEYS` in config.js) waits for the person's click in Kelpie, through a dialog button, never a command an agent could run itself. A new setting of that kind joins `CONFIRM_KEYS`.

**Messages to agents.** Only through `sendToClaude()`, which checks the terminal's real foreground process. Never `hc(["send", …])` directly.

**Prompts.** Values go in through `promptValue()` (no control characters). Text others wrote is fenced and the task ends with the `OTHERS` note: information, not instructions. Prompts say what to look at or do, never how to reach it: Claude uses its own access (MCP servers, plugins, its tools); Kelpie's plumbing (`jira.sh`, its `gh` calls, the person's sign-in) is never offered, and no message names a tool. When Claude can't reach something, it says so.

**Other people's code.** Never run it. A review agent starts outside the checkout (in the profile's folder) and reviews by reading. No default prompt asks to run, build, install or test a pull request.

**Background agents.** Claude run without a terminal (What next?) runs read-only: `--permission-mode plan`, editing tools disallowed, whatever the person's default mode is.

**Files.** Never delete, overwrite or write through a symlink to a file the person owns; installs and copies skip and report what's in the way. Deletions are guarded by an exact, tested path check (`removeDemo()`, `resetBrowser()`). Temp files: `mktemp -d`, private (0700), never fixed names in `/tmp`. Caches holding prompts or titles are private.

**Destructive actions.** Closing a space, pausing, cleaning up or killing a process asks first when something is working, and refuses what isn't settled (`cleanBlockers()`: not Done, an open pull request, a busy agent, uncommitted work). Match processes by an exact, tested pattern; never kill what Kelpie didn't start.

## When you change something here

- Adding an `exec`/`hc`/`run` call, a prompt, a profile setting, a file operation or a process kill: check it against these rules and add or extend the tests.
- Found a weakness? Say so to the person before working around it, and fix it with a test.
- Security-sensitive changes are summarised in the commit body.

## Known gaps

Where the code doesn't meet these rules yet (from the security review; fix them with tests, then remove the line):

- `runCommand()` (config.js) puts `{key}` into a profile command unquoted; keys aren't checked against the ticket-key pattern first.
- Screenshot mark-up and thumbnails (`mods/kelpie-artifacts`) use fixed temp names, in shared `/tmp` on Linux.
- `~/.cache/kelpie/sessions.json` and the Web panel's folders are created with the default permissions, not private.
- A secret-like key nested inside a profile section (e.g. `github.pat`) isn't refused; sections don't have their own list of allowed keys.
- What next? passes its whole prompt as a command-line argument (visible to other users in `ps`).
- Profile ids that differ only by punctuation (`a.b`, `a-b`) share one Web panel folder.
- `.claude/settings.json` allows every `gh api` call, including ones that write.
