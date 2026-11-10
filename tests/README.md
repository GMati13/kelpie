# Kelpie's tests

```sh
./test.sh        # everything, about 10 s
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

Any security-relevant change comes with a test that fails without it (break the protection, see the
test fail, put it back).

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
tests/js/*.test.mjs     mods' logic, under the stubs
tests/shell/*.test.mjs  shell scripts run for real in temp folders (jira.sh, install.sh, ...)
tests/python/test_*.py  kittyfix.py, changes.py, sessions.py (unittest; helpers in kelpie_test.py)
```

## Adding a test

- **JavaScript**: a `tests/js/<topic>.test.mjs` with `node:test` and `node:assert/strict`. Import the mod's
  file by path (`../../mods/kelpie/config.js`) and the stub as the mod does (`import { mock } from "herdr"`);
  call `mock.reset()` in `beforeEach`. Every test file runs in its own process, so module state starts
  fresh per file, not per test. A function a test needs that the mod doesn't export may be exported for
  it: keep the change to the `export` keyword.
- **Shell**: a `tests/shell/<script>.test.mjs` that runs the script with `sh()` in a `tempDir()`, with the
  programs it calls faked by `fakeBin()`. Point any home the script uses (`HOME`, `HERDR_APP_HOME`) into a
  temp folder.
- **Python**: a `tests/python/test_<name>.py`; `load("kittyfix", argv)` imports a script as a module,
  `run_script("changes", args, home)` runs one as Kelpie does (`python3 -I`).
- A real bug found by a test: don't fix it in the same change unless asked. Mark the test
  `{ todo: "BUG: ..." }` (node) so it runs and reports without failing, and say where the bug is.

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
- `nextCommand()` and `watchFolder()` never resolve, so a mod's command loop just waits.

### `gpui-kit` and `gpui-base`

Every factory (`div()`, `h_flex()`, `svg(path)`, `Button.new(id)`, `TextView.html(id, html)`, `new
AvatarImage(path)`, ...) returns a recording element: any method call is recorded with its arguments and
returns the same element, so any chain a view builds works. `.when(cond, fn)`, `.when_some(value, fn)` and
`.when_else(cond, yes, no)` run their branch as gpui does. State handles (`InputState.new(cx)`,
`TextareaState.new(...)`, `VirtualListScrollHandle.new()`) keep `set_value()`/`value()` and record the rest.
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
