# Kelpie

Herdr layouts built around profiles and stories (Jira sprint, pull requests, Claude agents). How to work on it (development, security, testing, product rules) is in `.claude/rules/`, which Claude Code loads on its own. This file is the map: the rules every change needs, and where each part is described. How each part works is in `docs/reference/` (the table below): read the part's doc before changing it, and keep it true in the same commit. Open source, MIT (`LICENSE`); bundled fonts and icons keep their own licences beside them (OFL, ISC): anything third-party added needs its licence file and an MIT-compatible licence.

## First: universal, not personal

This is a standalone product meant to be shared: anyone installs it and sets it up from the profile dialog. It knows nothing about one person's setup.
- No personal preferences, accounts, paths, projects, boards, orgs, company tools or shell setup in code, docs, layouts, keys or `.claude/` here. Anything that differs per person is a profile setting (or Herdr's own settings) with a generic default, or a convention that degrades gracefully (a folder named after the ticket key)
- A user's own setup lives in their dotfiles, which reuse this repo and put their config on top: their Herdr `keys.json` and settings, Claude Code status line wiring, shell functions, personal permissions (`.claude/settings.local.json`, git-ignored). Notes about one person's machine go there, not here
- Flag macOS-only or other assumptions where they matter (Keychain sign-in, `~/.claude*` folders)
- Every prompt, message and guide Kelpie gives Claude says what to look at or do, never how to reach it: Claude works through its own setup (its MCP servers, plugins, tools and permissions). Kelpie's own plumbing (`jira.sh`, its `gh` calls, the person's Kelpie sign-in) is never offered as a way around that setup, and a message never names a tool ("using gh"). When Claude can't reach something, it says so and asks; that's how it's meant to work, not something to work around. Checking Kelpie's own sign-in is the profile dialog's Check button, not an agent running Kelpie's scripts

## Rules every change touches

The traps that broke Kelpie before, each in a line. The doc named after each has the whole story.

- **One context for every copy.** Herdr runs every copy of a mod in one JavaScript context: per-copy state goes on the view (`this`), state every copy must see goes through `setShared()`, never a module variable (`runtime.md`).
- **Reads in a render.** Take `spaces`, `agents`, `panes`, `terminals`, `focused`, `layout`, `shared`, `setShared`, `run` and `hc` from `host.js`, never from `herdr`; a render reads each list and key once, never per space or agent, and never changes a read value in place; work out what's derived with `memo()` (`runtime.md`, `tests/js/render-cost.test.mjs`).
- **Shared writes.** Every write rewrites Herdr's whole `shared.json` and redraws every copy: write only when the value changes, never on every render, and prune entries of closed spaces and deleted profiles (`pruneShared()`, `byProfile()`) (`runtime.md`).
- **Bounded memory.** Herdr runs for days: every cache per key or per patch has a bound (`keep()`, `ByText`) and a test in `tests/js/memory.test.mjs`. Never stream frames into a mod's `image()` or hand it a new path per frame: Herdr never frees images (`runtime.md`, `web-panel.md`).
- **Renders are short.** Herdr interrupts a render that runs too long: heavy work is cached per input and spread over renders with `cx.timer.after`, not a task spawned in the render (`changes.md`).
- **Start-up work** (copies, polls, timers, command loops) goes after the root views' `checking()` guard, as `herdr-app check` runs `init()` for real (Working routine, below).
- **Herdr calls.** `run()` returns null: never chain on it or wait on it. A new tab is `newTab()` in config.js, never `run("tab.new")`. Never `hc kill` or `hc rm` a shown Web slot's terminal (`web-panel.md`).
- **Messages to agents** go only through `sendToClaude()`, which checks the terminal really runs Claude. What they say is built only by `dispatchText()` and the fill functions, from values Kelpie checked (keys, rebuilt links, folders it made), never a title, description or name others wrote (`prompts.md`, `.claude/rules/security.md`).
- **Writes to the board or GitHub, or starting agents,** happen only on the person's click in a dialog (`askRun()`, taken by `takeRuns()`), never from a `kelpie.*` command or a plugin request, as any agent can run one. Profile changes from outside wait for a yes the same way (`CONFIRM_KEYS`, `profiles.md`).
- **Boards** are asked only through `board.js` (`boardOf()`, `hasBoard()`): no view calls `jira()` or reads `.jira` (`boards.md`).
- **GitHub** is asked only through `gh()` in pulls.js, which guards the account's shared budget; queries are constants with every value a variable. A change to a query or a poll measures `tests/js/budget.test.mjs` again (`pull-requests.md`).
- **The plugin's tools** hand a Claude only its own profile's work: a new request handler goes through `whoAsks()`/`allowedFor()` (`accounts.md`, Account boundary). Anything under `plugin/` is changed with the skill-creator skill and raises the plugin's version (`plugin.md`, `.claude/rules/development.md`).
- **Looks.** Buttons, marks, icons, magic and dialogs come from the visual kit (`visual-kit.md`); a skin changes the look only, never sizes or behaviour (`skins.md`). Every new state Kelpie learns to show is added to the demo's fixture (`demo.md`).
- **Names.** The mod's name is written only as `MOD` in ui.js; no project, board, org, site or path in code (`profiles.md`, Shareability).

## Reference

Each doc starts with the files it `covers` (front matter): change one of them, and that doc is the one to keep true. `tests/js/docs.test.mjs` holds the map together (below).

| Doc | What it covers |
|---|---|
| [How the mod runs](docs/reference/runtime.md) | One JavaScript context for every copy, the cost of host reads, memory over a long session, scroll positions, and the load record for why something shows late |
| [The Kelpie layout](docs/reference/layout.md) | The layout's blocks and roles, the tab bar's column, folding, split panes, keys and overlays |
| [Profiles](docs/reference/profiles.md) | What a profile holds, the profile dialog, Let me configure it for you, agents' changes and the yes-dialog, sending to agents, and what a space belongs to |
| [Accounts and sessions](docs/reference/accounts.md) | Claude accounts per profile, the GitHub account and Kelpie's own gh, the footer's limits, the account boundary between profiles, and the session index |
| [Boards](docs/reference/boards.md) | The board layer and its three boards (Jira, a GitHub Project, a Linear team), Jira's sign-in and time estimates |
| [The story list](docs/reference/stories/list.md) | The sidebar's groups (In progress, reviews, your pull requests, To do, sunk, Done, Unassigned), what a story is, kept and reassigned stories, the order, priority, and when a story sinks |
| [A story's details](docs/reference/stories/details.md) | A story's header and its actions, assignees, tags, status chips, Move to Done and busy runs, the tab bar, descriptions and comments, pull request lines and subtask rows, and passages |
| [Pause and clean up](docs/reference/stories/cleanup.md) | Pausing agents and stories, what happens when a story's space closes, and what Clean up takes |
| [The Changes view](docs/reference/changes.md) | Each pull request's files and a story's uncommitted and unpushed work, the file list, the diff and its keys, and what keeps a big diff within a render |
| [Pull requests and reviews](docs/reference/pull-requests.md) | Every gh call and GitHub's budget, reviews and Start review, Approve, PR buttons, the quick read after a turn, and PR notifications |
| [What Kelpie sends Claude](docs/reference/prompts.md) | Every message carries only values Kelpie checked (KELPIE-302) |
| [Next and What next?](docs/reference/next.md) | Next's queue, its card, Claude's picks and What next?, Next's pointer, and agents' asks |
| [Agents waiting on you](docs/reference/attention.md) | Agents that end a turn waiting on the person, found as their turns end, and how they show |
| [The Desk](docs/reference/desk.md) | One space per profile for work without a ticket |
| [Ask Claude](docs/reference/ask-claude.md) | The Ask line, what it sends and to whom, right-click menus, and the story's tasks |
| [The Claude Code plugin](docs/reference/plugin.md) | The MCP server's tools, the SessionStart hook, the skills and dispatchers, and their evals |
| [Artifacts and Screenshots](docs/reference/artifacts.md) | The story's Artifacts view (Claude Artifacts) and the Screenshots panel |
| [The visual kit](docs/reference/visual-kit.md) | Buttons, marks, agent states, magic, icons, dialogs and spacing |
| [Skins](docs/reference/skins.md) | How a Kelpie layout gets its own look, the skin hooks, art and fonts |
| [The Web panel](docs/reference/web-panel.md) | A browser per profile, and kittyfix.py, the proxy fixing Herdr's kitty graphics bugs |
| [The demo](docs/reference/demo.md) | The demo profile, its fixture, its stand-in agents, and how to take screenshots of it |

## Structure

```
layouts/Kelpie*.json, Kelpie*.svg  # the Kelpie layout (Quiet Pages skin) and Kelpie-Plain (no skin), each with its picker preview
themes/Kelpie*.json              # their themes
mods/kelpie/                    # the mod behind every Kelpie view (its name: MOD in ui.js, commands, shared keys)
                                #   attention.js: what needs the person (blocked agents so far, the footer mark's words), #249
                                #   triage.js and last-turn.py: agents that wait on the person in silence, found as their turns end (#251)
                                #   its board layer, board.js: Jira (sprint.js, jira.sh), a GitHub Project (project.js, issues.js, project-check.js) or a Linear team (linear.js, linear.sh; loader only so far)
mods/kelpie/demo/               # the demo: demo.json (its fixture) and agent.sh (a stand-in Claude agent)
mods/kelpie-artifacts/          # Artifacts panel and the Screenshots view
plugin/                        # the Claude Code plugin: server.py (MCP tools), hooks/, skills/ (each with evals/; the dispatchers with references/routine.md) and evals/ (docs/reference/plugin.md)
.claude-plugin/marketplace.json # makes the repo a plugin marketplace (`/plugin marketplace add <clone>`)
keys.json                      # the layout:Kelpie* key sections, to merge into Herdr's keys.json
install.sh                     # links all of it into ~/.config/herdr-app
docs/reference/                # how each part works, a doc per part (the map above)
docs/screenshots/               # the README's screenshots, of the demo (Demo below: retake them there, 1440×900, zoom 1)
.claude/settings.json          # shared Claude Code permissions
test.sh                        # runs every test suite (tests/README.md)
tests/                         # stubs/ (herdr, gpui-kit, gpui-base for Node), lib/, js/, shell/, python/
tests/snapshots/               # what each view draws, as text (js/views-*.test.mjs; re-recording: tests/README.md)
scripts/pre-commit             # git hook running ./test.sh (enable: git config core.hooksPath scripts)
scripts/bench-kittyfix.py      # what kittyfix.py costs in CPU and memory, on terminal-browser-shaped frames (temp folder, no Herdr)
scripts/e2e-demo.sh            # end-to-end check in a second Herdr window on a throwaway home (macOS, not CI; ask first)
scripts/bench-background.py    # times sessions.py, changes.py and a review's checkout on a made-up home (#40)
docs/performance/               # the performance review's write-ups (background.md: scripts and loads)
.github/workflows/test.yml     # CI: ./test.sh on macOS and Linux, on every push and pull request
```

## Commit Format

`[scope] description`, scopes: `kelpie`, `skins`, `artifacts`, `docs`, `tests`. Start with a verb (`add`, `update`, `fix`, `remove`), lowercase, concise.

## Install

- `./install.sh` links layouts, themes and mods into `~/.config/herdr-app` (`HERDR_APP_HOME` overrides), then copies what Herdr won't read through a link: the layouts' previews (`layouts/Kelpie*.svg`, the settings' layout picker, copied over each time), the icons (`mods/kelpie/icons/install.sh`) and each skin's art and fonts (`mods/kelpie/skins/copy-art.sh`, the same script the footer runs on each start), so the first start already has the skin's fonts. It replaces only its own links: each run removes its links into the repo and makes them again (so a renamed file leaves no old name; macOS ignores case), and removes broken `[Kk]elpie*` links of an old clone; a real file or folder in the way is left alone, and the run ends by naming it and exits 1. The previews are drawn like Herdr's own: a few bold shapes, as they show about 108px wide. The README's keys step merges `keys.json` with `jq -s '.[0] * .[1]'`, written back with `cat` so a symlinked keys.json (one kept in dotfiles) stays a link
- Herdr won't load images or SVGs through symlinks, and hot reload can't see through them: the footer copies icons and skin art to `~/.config/herdr-app/art/kelpie/` on each start (and skin fonts to `fonts/`, loaded on Herdr's next start)
- Key sections in `keys.json` go into Herdr's own `keys.json` (its `global` section, `cmd-shift-s` → `kelpie.web`, too)

## Working routine

- Tests: `./test.sh` before every commit (about 20 s; the hook, once enabled per clone with `git config core.hooksPath scripts`, and CI run it too). The rules for tests are `.claude/rules/testing.md`; the harness (stubs, helpers, snapshots, the end-to-end check) is `tests/README.md`. A mod's internals may be exported for a test (the `export` keyword only); a shell script a test must run lives in its own file under `mods/kelpie/` (like `skins/copy-art.sh`)
- After editing a mod, re-create its link so hot reload notices: `ln -sfn "$PWD/mods/kelpie" ~/.config/herdr-app/mods/kelpie` from the repo (same for `kelpie-artifacts`), then `herdr-app check mods/kelpie` and `herdr-app status` (its errors list). A check runs `init()` for real (Herdr 0.1.16, Kelpie's minimum: `exec`, `hc` and file writes included, only warning "the child runs for real") and renders once, so both mods' root views (`Quiet` in main.js, `Artifacts` in kelpie-artifacts) return early while `checking()` is true, once what they draw from is set (#284, `tests/js/check.test.mjs`): start-up work (copies, polls, timers, command loops) goes after that guard. A check gives no role, so the work roles' views behind `WORK_ROLES` are never started by one. Pointing the link at another folder (a git worktree, say) isn't noticed until a file's content changes there: touching isn't enough, so add a line to a file and take it out again
- A layout file edit often isn't noticed while that layout is shown, even relinked: `herdr-app do layout.switch '{"name":"<another Kelpie layout>"}'` and back reloads it, but closes open Herdr windows (the settings window, say), so tell the user first. `layout.resize`/`layout.show` act live
- Look before claiming: `node --check --input-type=module < file.js` for syntax, then `herdr-app shot <scratchpad>/x.png` and crop (PIL). For a state hard to reach (a near-limit footer), change the threshold temporarily, shoot, restore, and grep that the restore took
- Driving the UI from outside (`herdr-app do kelpie.profile-<id>`, `kelpie.preview-<KEY>`, `pane.split`…): put the screen back as it was afterwards (profile, panel, sidebar width). `pane.split` once came out doubled: check `herdr-app ls` and close only the panes you made
- `!`-prefixed commands get no TTY: anything interactive (`claude /login`) runs in a real Herdr terminal
- `.claude/settings.json` is the shared permission list (Herdr's, git's and gh's reading commands, `node --check`, web searches and github.com pages; not `gh api`, which asks each time, as no prefix rule tells its reads from its writes (`-X`, `-f`/`-F`, `--input`, a GraphQL mutation); `hc kill`/`hc rm` always ask; `tests/js/settings.test.mjs` keeps it so); personal permissions go in `.claude/settings.local.json` (git-ignored)
- Mods have no readable console, and why something shows late is in the load record (`herdr-app do kelpie.debug-loads`): both in `docs/reference/runtime.md` (Debugging, The load record)

## Herdr notes

- The Web panel's browser runs behind `mods/kelpie/kittyfix.py`, a proxy fixing Herdr's kitty graphics bugs; it needs `terminal-browser config set render.presenter patched` once per machine (`docs/reference/web-panel.md`)
- Claude's usage limits come from Claude Code's status line, `mods/kelpie/claude-statusline.sh`, which the person wires up in their own setup (`docs/reference/accounts.md`, Claude's limits)
- Installing any mod whose `mod.json` has a `place` other than `none` docks it into the shown layout the first time Herdr sees it, rewriting that layout file. Restore from git

## Keeping these docs

- `CLAUDE.md` is loaded into every session, so it holds only what every change needs: the universal rules, the traps above, the map, install and the routine. How a part works goes in its doc under `docs/reference/`, read when that part is touched.
- Where a change goes: the doc whose `covers` lists the file changed (several may: stories.js is described by the story docs, Next and Changes). A new part gets a doc of its own, its `covers`, and a row in the map above.
- Write from the final code, as it is now; the `#n` and KELPIE-n of the change that taught a rule stay beside it, as the reason it exists. Why, not what: the code says what.
- Budgets (`tests/js/docs.test.mjs`): `CLAUDE.md` at most 40 000 characters, each doc at most 30 000; past that, split the doc by topic, don't trim what's true. The test also checks every doc is in the map, every map row has its doc, every `covers` entry names files that exist, and every script of the mods and the plugin is covered by some doc.
- The kelpie-scribe skill checks a change against all of this before a pull request.
