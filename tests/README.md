# Kelpie's tests

```sh
./test.sh        # everything, about 20 s
./test.sh js     # JavaScript and shell only (node:test)
./test.sh py     # Python only (unittest)
node --import ./tests/stubs/register.mjs --test tests/js/cleanup.test.mjs   # one file
```

Needs Node 22 or later, `python3`, `git` and `jq`; nothing to install. It runs on macOS and Linux (CI runs
both: `.github/workflows/test.yml`). It never touches the real Herdr homes (`~/.config/herdr-app`,
`~/.local/share/kelpie`), never runs `herdr-app do` or `hc`, and never starts Herdr: every test works in
temp folders, and the mods run against stubs.

Run it before committing. To have git do it, once per clone:

```sh
git config core.hooksPath scripts      # or: ln -s ../../scripts/pre-commit .git/hooks/pre-commit
```

What must be tested, and what to do when a test fails, are the rules in `.claude/rules/testing.md`;
this file is how the harness works.

## Layout

```
test.sh                 the entry point
tests/stubs/            the host modules a mod imports, for Node
  register.mjs          loaded with `node --import`: installs loader.mjs
  loader.mjs            maps "herdr", "gpui-kit", "gpui", "gpui-base" to the stubs; the repo's .js load as ES modules
  herdr.js              the "herdr" stub (`mock`)
  gpui-kit.js           element recorder (div, svg, image, View, ...) and tree/snapshot helpers
  gpui-base.js          h_flex, v_flex, components (Button.new, TextView.html, ...) and state handles
tests/lib/helpers.mjs   temp folders, fake programs, running scripts, git fixtures, until(), bodyOf()
tests/lib/stories.mjs   story data: the demo loaded as the story list loads it, small hand-built issues and PRs
tests/lib/views.mjs     the demo as a Herdr world at a fixed time, a fake cx, draw() (Snapshots, below)
tests/lib/snapshot.mjs  a view's element tree as text, compared with tests/snapshots/ (Snapshots, below)
tests/js/*.test.mjs     mods' logic, under the stubs; views-*.test.mjs, what the views draw
tests/snapshots/        the views' snapshots, one .txt per state (plain/: the Kelpie-Plain layout)
tests/shell/*.test.mjs  shell scripts run for real in temp folders (jira.sh, gh.sh, avatar.sh, install.sh, ...)
tests/python/test_*.py  kittyfix.py, changes.py, sessions.py, plugin/server.py (unittest; helpers in kelpie_test.py)
```

## Adding a test

- **JavaScript**: a `tests/js/<topic>.test.mjs` with `node:test` and `node:assert/strict`. Import the mod's
  file by path (`../../mods/kelpie/config.js`) and the stub as the mod does (`import { mock } from "herdr"`);
  call `mock.reset()` in `beforeEach`. Every test file runs in its own process, so module state starts
  fresh per file, not per test. A function a test needs that the mod doesn't export may be exported for
  it: keep the change to the `export` keyword (stories.js, with many, lists them in one `export { ... }`
  at its end, "for the tests only").
- **Shell**: a `tests/shell/<script>.test.mjs` that runs the script with `sh()` in a `tempDir()`, with the
  programs it calls faked by `fakeBin()`. Point any home the script uses (`HOME`, `HERDR_APP_HOME`) into a
  temp folder.
- **Python**: a `tests/python/test_<name>.py`; `load("kittyfix", argv)` imports a script as a module,
  `run_script("changes", args, home)` runs one as Kelpie does (`python3 -I`).
- A real bug found by a test outside your change: mark the test `{ todo: "BUG: ..." }` (node) so it
  runs and reports without failing, say where the bug is, and fix it in its own commit
  (`.claude/rules/testing.md`).

## The stubs

### `herdr` (`tests/stubs/herdr.js`)

`mock` is the control object:

- `mock.reset()`: everything back to empty (call it in `beforeEach`).
- `mock.state`: what Herdr would report. `shared` (a Map behind `shared()`/`setShared()`; values are
  copied in and out as JSON, as Herdr's store does), `spaces`, `agents`, `panes`, `terminals`, `layout`,
  `focused`, `props` (an overlay's or block's props), `theme`, `window` (`platform: "macos"`), `settings`,
  `appHome` and `home` (non-existent paths by default: set them to a `tempDir()` when a test writes files).
- `mock.calls`: every call made, in order, as `{ fn, args }`; `mock.of("exec")` gives the argument lists of
  one function (`exec`, `hc`, `run`, `openOverlay`, `closeOverlay`, `notify`, `setShared`, `readTextFile`,
  `writeTextFile`, `setAgentOrder`, ...).
- `mock.on.<fn> = (...args) => result`: answers a call (a value or a promise). `undefined` falls back to
  the default: `exec`/`hc` answer `{ code: 0, stdout: "", stderr: "" }`, `openOverlay` an id, the rest null.
- `mock.realExec(cmd, args, options)`: runs a command for real (spawnSync) and answers as `exec` does,
  e.g. `mock.on.exec = (c, a, o) => (c === "python3" ? mock.realExec(c, a, { ...o, env }) : undefined)`.
  Pass `env`, or it gets the test process's environment.
- `mock.repoPath(path)`: the mods count as installed in `appHome()/mods`, so `modFile()` paths map to the
  repo's `mods/` (used by `readTextFile` and `realExec`).
- `mock.sharedValue(key)`: a shared value without recording a call.
- `mock.reads`: how many times a render read each host value (`spaces`, `agents`, `panes`, `terminals`,
  `focused`, `shared:<key>`); set it to `{}` before the render to count.
- `nextCommand()` and `watchFolder()` never resolve, so a mod's command loop just waits.

### `gpui-kit` and `gpui-base`

Every factory (`div()`, `h_flex()`, `svg(path)`, `Button.new(id)`, `TextView.html(id, html)`, `new
AvatarImage(path)`, ...) returns a recording element: any method call is recorded with its arguments and
returns the same element, so any chain a view builds works. `.when(cond, fn)` runs its branch as gpui
does; `.when_some()` and `.when_else()` throw, as Herdr's elements don't have them (a view calling one
isn't drawn: "unknown element method"). State handles (`InputState.new(cx)`,
`TextareaState.new(...)`, `VirtualListScrollHandle.new()`) keep `set_value()`/`value()` and record the rest.
`.map(fn)` runs `fn` on the element, as gpui's does.
`View` is a plain base class (`this.props`).

For inspecting what a view rendered (import from `"gpui-kit"`):

- `tree(el)`: plain data `{ kind, args, calls: [[method, args]] }`, children expanded, functions as `"[fn]"`;
  stable for `deepEqual` or a stored snapshot.
- `snapshot(el)`: the same as indented text, one call per line, for readable diffs.
- `walk(el)`: every element node, depth first; `texts(el)`: the strings passed to `child`/`children`.
- `handlers(el, "on_click")`: `[{ id, fn }]`, to press a button: `handlers(el).find((h) => h.id === "x").fn(event, cx)`.
- `isElement(x)`, `nodeOf(el)`, `element(kind, args)`.

### Helpers (`tests/lib/helpers.mjs`)

- `REPO`, `repoFile(...)`, `readRepo(...)`: the repo and its files.
- `tempDir()`: a real-path temp folder, removed when the test process ends. `put(path, text, mode)` writes a
  file and its folders.
- `fakeBin()`: a folder of fake programs. `.add(name, body)` makes one that records its argv, stdin and
  environment and then runs `body` (shell; `$STDIN` is the file its stdin went to); `.path` is a PATH with
  the fakes first; `.calls(name)` reads the runs back as `{ name, argv, stdin, env }`.
- `sh(cmd, args, { env, cwd, input })`: runs a program with a minimal environment (PATH, a temp HOME,
  `SHELL=/bin/sh`, plus `env`) and returns `{ code, stdout, stderr }`.
- `git(cwd, ...args)`: git for fixtures, without the person's config, hooks or signing.
- `until(check, ms)`: waits for code that runs on after a call returns (a `run("space.new")`, say).
- `bodyOf(source, start)`: a top-level function's text, for static checks on the source.

### Story data (`tests/lib/stories.mjs`)

- `demoData(profile = DEMO_PROFILE)`: what the story list's load gives for the demo profile
  (`StoryList.fetch`, each request answered by demo.js from `mods/kelpie/demo/demo.json`), ready for
  `build()`. Nothing runs: no exec, no network. `demoData(DEMO_PROJECT_PROFILE)` loads the same demo
  with its board a GitHub Project (kelpie.demo-github), answered by demo.js `demoProject()`; the parity
  test in `project.test.mjs` checks both build the same stories.
- `issue(key, status, parent)`, `pr(title, { checks, review, merged, draft, repo, number })` and
  `data({ parents, children, mine, prs, sessions, reviews, columns })`: hand-built data in the shapes the
  list keeps, on a board `COLUMNS` of To Do, In Progress, QA (the default handover column) and Done.
  Statuses: `todo`, `doing`, `blocked`, `qa`, `done`. Keys need a project of two letters or more
  (`AB-1`): a one-letter one isn't a ticket key to Kelpie.

## What's covered

- `stories.test.mjs`: `build()`: stories from issues and subtasks, pull requests attached by the key in
  their titles (`keyIn`, `projectsOf`: a subtask's key, a leading `[KEY]`, `UTF-8` not a ticket), agents by
  tab name else space (`agentsByKey`), sessions and paused agents; `need()` ranks, `ordered()` and
  `needQueue()`; sinking at the handover column; subtask stages and `progress()`; `prState()`'s order; the
  demo's stories end to end.
- `next.test.mjs`: `needQueueOf()` (needs you, reviews, the Desk asking, one clean-up item, Claude's
  picks and when they drop out), `nextIn()`, `applyPicks()`'s rules (Jira and GitHub Project lookups faked
  through `exec`).
- `issues.test.mjs`: a GitHub Project's issues (issues.js, through board.js) on hand-built data in board.js's
  header shape: `issueRef()` (malformed keys refused), the description (only an issue page's address,
  Markdown with only http(s) links), `ticketText`/`lookUp` (one constant query, values as variables; a
  sub-issue goes to its story), Status options and a move (the mutation's argv, every id checked before gh
  runs), the status chip (no menu off the Project; the new status shown at once), the demo's answers.
- `next-plugin.test.mjs`: the plugin's Next requests (`kelpie.add-next`, `suggest-next`, `get-next`): an
  agent's ask checked (key, links, caps), where it sits in the queue, when it goes, a click on it.
- `adf.test.mjs`: every ADF node kind to blocks, unknown ones kept as text, `adfLines`, `adfText`.
- `diff.test.mjs`: `diffRows`, `wordChanges`, `fileStatus`, `changeSquares`, `syntaxOf`/`syntaxSpans`,
  `patchHash`'s stable values.
- `board.test.mjs`: `boardOf()`/`hasBoard()` (a profile or a setup, none without a board), `ticketUrl()`,
  the board's questions answered for the demo (`loadBoard`, `description`, `ticketText`, `statusOptions`,
  `lookUp`), that no view but board.js calls `jira()` or reads a profile's `jira` section itself; a GitHub
  Project's board, `parseProject()` and the key prefixes (`defaultPrefix`, `parsePrefixes`, `prefixFor`).
- `project.test.mjs`: a GitHub Project's load (project.js) on a faked gh: the iteration scope, no
  iteration field, none running, sub-issues off the Project, drafts and pull request items skipped,
  paging, user and organisation queries, every call a constant query with its values as variables (and
  bad owners, numbers and node ids refused), keys and prefixes (collisions, repos with none), pull
  requests attached by closing links (a title's key wins), a Project issue's link, and the demo loaded as
  a Project building the same stories as the Jira demo (the parity test), and what a load costs of the
  account's GitHub budget (sub-issues asked flat, kept stories `KEPT_SLOTS` a query, `rateLimit` asked).
- `budget.test.mjs`: what one full story load may ask of GitHub (#150): a realistic Project profile against a
  fake gh that counts requests, how many run at once and their points by GitHub's own prices (written in
  the test, from `rateLimit(dryRun: true)`: measure again when a query changes), and the hour that makes.
- `ghlimit.test.mjs`: GitHub's API limits (#129, ghlimit.js around pulls.js `gh()`): a refused call stops
  the rest of its kind (GraphQL or REST) as that account until the reset or a secondary limit's wait,
  said in plain words with the time; side-by-side refusals counting once; a description that mentions
  rate limits isn't one; the story list loading at most every 10 minutes while the budget runs low, its
  quick reads stopped, a refused load keeping the last stories and their age, a Jira board keeping its
  pull requests; the demo playing it from its fixture (`github.limit`). `views-github.test.mjs` checks the
  GitHub demo's card saying it (`stories-limit`), used up and running low.
- `views-github.test.mjs`: the demo on its GitHub Project board: the sidebar, a story's title row and its
  details (`tests/snapshots/github/`), the same stories as the Jira demo's but for the board's own names and
  links.
- `labels.test.mjs`: what kind of work a ticket is (#53): labels kept clean and small (`labelsOf()`: control
  characters, length, a colour only as six hex digits), the tags a row shows (`tagsOf()`: the usual type
  hidden, a bug first and once on either board), colours readable on dark and light themes (`legible()`,
  `tagColor()`), and the demo's tags on the list's rows, the title row and subtask rows, on Jira and on a
  GitHub Project.
- `config.test.mjs`: `profileOf` (deepest folder, ownership, an agent's `cd`), `spacesOf`, `deskOf`,
  `handoverFrom`, prompt filling (`jiraTask`, `fillLines`, `mergeTask`, `approvalTask`, `askText`), and
  `claudeArgv`/`shellArgv`/`resumeArgv` per account and for the demo.
- `demo.test.mjs`: each answer demo.js gives (Jira's board, sprints, searches, issues, transitions; pull
  requests, files, uncommitted work, sessions, limits) and a schema check of `demo.json` (parents,
  statuses, pull requests, tabs for agent.sh, `demo-` session ids, links reaching no one).
- `project-check.test.mjs`: the profile dialog's GitHub Project Check (`project-check.js`) on a faked
  `exec`: constant queries with the owner and number only as variables, the account through gh.sh, the
  token's scopes from `X-OAuth-Scopes` (`project`, `read:project`, none, no header), the command it
  offers to add the scope, an unreadable Project, the demo's answered from the fixture.
- `prompts`, `profile-apply`, `send`, `cleanup`, `browser`: what Kelpie tells Claude and the safety rules
  around it. `configure`: Let me configure it for you, and the plugin check and install behind it.
- Stories over time: `moved` (a ticket's new status shown at once, until a load agrees), `quick` (pull
  requests read again when an agent's turn ends, and one an agent just opened shown at once), `reload` (a reload asked for mid-load isn't dropped),
  `reassigned` (a story given to someone else stays while something of it is here), `leftovers` (the
  check behind a finished story's broom), `note` (where the last action's note shows), `avatars`
  (assignees' pictures, fetched once).
- Actions: `move-to-done`, `run-picks` (Claude's picks started together), `story-task-send` (the Merge
  and Request approval menus' sends), `terminal` (a story's Terminal), `pulls` (Approve), `point` (what
  Next points at in a story), `passage` (a description's passage shown), `playing` (the web panel's
  sound mark), `menu-button` (a press on an open menu stays on it), `scroll` (each thing keeps its own
  scroll position), `artifacts-note` (Add to chat's note: the image's path, then the note as one clean
  line, only into the agent it was opened for).
- `views-changes.test.mjs`: the Changes view on a big pull request never spends a whole render on its
  patches. `harness` and `snapshot`: the stubs and the snapshot helper themselves.
- `tests/shell/`: jira.sh, gh.sh (the profile's GitHub account), the shell `gh()` function the README
  gives and Check my shell, avatar.sh, install.sh with the icon and art copies, and e2e-demo.sh's guards.
  `tests/python/`: kittyfix.py, changes.py (ticket
  folders, branches, worktrees, renames, untracked files), sessions.py (titles, keys, accounts, the index
  read incrementally, in a fake HOME), plugin/server.py (its tools, with a fake `herdr-app`).
- `skills.test.mjs`: the plugin's configure-profile skill against config.js: every setting that waits for
  the person's yes, what's saved at once and carried over between boards, the scopes, button messages and
  placeholders, so the agents' guide keeps up with the profile's settings.
- `tests/python/test_plugin.py`: the plugin's MCP server (`plugin/server.py`) against a fake `herdr-app`, its
  manifests, and the evals' stand-in tool list, `plugin/evals/mocks/kelpie/_tools.json`, kept equal to what the
  server lists. After changing a tool, save it again:
  `printf '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n' | python3 -I plugin/server.py | jq .result > plugin/evals/mocks/kelpie/_tools.json`.
- `render-cost.test.mjs`: each view (the story list, a story's title row and details, the tab bar, the
  footer, the profile menu) reads Herdr's lists as often with 60 other spaces open as with 30 (#104);
  `spaceProfiles()` reads each list once.
- `agent-marks.test.mjs`: an agent's state has one mark (`agentMark()`, #101): the tab bar, a split pane's
  header, the sidebar's agent rows and a subtask's slot draw the same for each state in both layouts, no two
  states alike (unknown isn't idle), motion only for working and needs you, a Claude's tab never its icon
  (snapshots `toolbar/agent-states`, `plain/toolbar/agent-states`).
- `space-menu.test.mjs`: the profile menu with many profiles: its list has a height of its own, so it
  scrolls, its last entries inside it; ↑/↓ and opening it bring a row into view; it reads Herdr's lists as
  often with 30 profiles as with 3.
- `views-*.test.mjs`: what the views draw, as snapshots (next section).

## Snapshots: what the views draw

`tests/js/views-*.test.mjs` render Kelpie's views under the stubs and compare what they drew with a
text file in `tests/snapshots/` (`plain/` holds the same views in the Kelpie-Plain layout; the rest are
the Kelpie layout, with its Quiet Pages skin). A view that changes what it draws for a state fails its
test with a diff, so a change to a view shows exactly what it changed.

| File | Covers |
| --- | --- |
| `views-sidebar` | the story list in every state the demo has (needs you, changes requested, failing checks, ready to merge, working, finished with the broom, paused, not open, waiting on others), reviews, your pull requests and "No ticket", the Desk (open, closed, without an agent), Next (no picks, Claude's picks, brewing, the Desk asking, all clear) and the opened queue; a finished story with a working agent has no broom |
| `views-header` | the title row's main action per state (Peek, Fix checks, Address comments, Merge, Show agent, Resume, Start work), Pause, the icons, More open, folded; a review before and while its agent runs (and Approve asking twice); a pull request with no ticket |
| `views-body` | the details: the description folded with Show more and opened, a subtask's own description, the subtasks with their actions, the fade only while the details overflow (`fits()`), a review's details |
| `views-toolbar` | the tab bar: agent tabs, the + menu, Changes and Screenshots with counts; a preview (Overview, the rest only when they hold something), a review (Changes alone), the Desk |
| `views-dialogs` | the clean-up confirm with its leftovers, Clean up all, the "Leave KEY?" dialog of a story's last tab, an agent's profile change waiting for a yes, the story picker (and filtered); the profile dialog's Agents, GitHub and Board pages (Jira, and a GitHub Project after a Check), and what its Board page saves (one board, prefixes, the board's prompt moving with it) |
| `views-footer` | the Claude limits line (usual, near a limit with its reset time, past a reset), the profile picker row and menu |

Not covered yet: what the Changes view draws (`StoryView`, a virtual list whose rows Herdr draws on demand), the
profile dialog's other pages (`setup.js`), the pane headers (`panes.js`), the plain sidebar of a profile without
Jira (`WorkSide.plain`), the older Hub roles and the `kelpie-artifacts` mod.

**The world.** `tests/lib/views.mjs` pins the clock (every `Date.now()` and `new Date()` is Tuesday
2026-11-10 10:00 UTC) and the time zone, and builds Herdr's state from the demo fixture
(`mods/kelpie/demo/demo.json`): the demo profile as `kelpie.demo` saves it, the fixture's spaces as
spaces `s0`… with tabs `t<space>-<tab>`, panes and agents (`a<space>-<tab>`), owned by the profile, the
Desk and paused agents. `loadStories(StoryList)` loads the stories the way the sidebar does (the demo
answers from the fixture), once per file; `setupDemoWorld({ stories, shown, layout, agentOf, spaces,
profile, props })` puts a test's situation in place; `draw(view)` does init, a first render, waits for
what it started (`cx.spawn`) and renders again. A new situation goes in the fixture or in the test's
own options, never in the mods.

**Reading one.** One element per line, children indented under it:

```
h_flex #story-ACME-151 [hover(bg=hover)] {click} tip="Checks failing on ACME-152 (payments#97)"
  svg own:circle-x [fg=blocked]
  "Pay with Apple Pay at checkout"
```

the element's kind (`svg chrome:…`/`own:…` for Herdr's and Kelpie's icons), `#id`, its colours as the
theme's token names (`accent/26` is a tint; a colour no token has stays as `#rrggbb`), what hovering
changes, a font family or weight a skin set, `opacity=`, motion (`~spin`, `~loop(opacity)`,
`~frames(n)`), the handlers it has (`{click down:left}`, not what they do) and its tooltip; text
children in quotes; `@content` for an element given to a method other than `child` (an open Popup's
list); four or more sibling leaves alike but for their colours (a skin's bands) as one line with
`×N`. Padding, margins, gaps, sizes, flex, radius and text size are left out, so spacing tweaks don't
churn every snapshot; a colour, text, id, handler or structure change does show.

**Updating.** A view changed on purpose: re-record, then read the diff before committing.

```sh
UPDATE_SNAPSHOTS=1 ./test.sh js      # or one file: UPDATE_SNAPSHOTS=1 node --import ./tests/stubs/register.mjs --test tests/js/views-header.test.mjs
git diff tests/snapshots/
```

A changed snapshot is reviewed like code: every changed line should be one you meant. Never re-record
to make a failing test pass without knowing why it changed. A missing snapshot fails (CI never
records); a test renamed or removed leaves its old file behind, so delete it by hand. A real bug a
snapshot shows is a `todo` test that asserts the right thing (and records its snapshot once fixed).

## The end-to-end demo check (macOS, not in CI)

`scripts/e2e-demo.sh <throwaway Herdr home>` checks Kelpie in a real Herdr: it installs Kelpie into that
home (`install.sh` with `HERDR_APP_HOME`), starts a second Herdr window on it (`HERDR_BIN`, else the
binary in `/Applications/Herdr.app`), runs `herdr-app check` on both mods, switches the window to the
Kelpie layout, opens the demo (`kelpie.demo`), checks `herdr-app status` names no errors, takes the
README's shots (story, changes, next, review, overview, plain, through `kelpie.preview-<KEY>`,
`kelpie.view-*`, `kelpie.what-next` and `layout.switch`) into `<home>/e2e-shots/`, and compares each
with `docs/screenshots/` (python3 with Pillow: the share of pixels that differ, `E2E_TOLERANCE`,
default 0.08; skipped with a message without Pillow). However it ends, it runs `kelpie.demo-remove`
and quits that window.

Run it only with the person's OK: spaces live in herdr-core, shared by every Herdr window, so the
demo's spaces show in their own window while it runs, and `layout.switch` closes the test window's
other windows. It refuses `~/.config/herdr-app`, anything inside it or linked to it, the home folder,
and a non-empty folder it didn't make (it leaves a `.kelpie-e2e` marker in the ones it makes), and
runs only on macOS; `tests/shell/e2e-demo.test.mjs` checks those refusals with every program faked.
`herdr-app` is called with `HERDR_APP_HOME` set to the throwaway home, so it talks to the test window.
The Next shot is taken with the queue closed (no command opens it), so expect `next.png` to differ
more than the rest.
