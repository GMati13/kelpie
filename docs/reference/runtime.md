---
covers:
  - mods/kelpie/host.js
  - mods/kelpie/debug.js
  - mods/kelpie/source.js
---

# How the mod runs

One JavaScript context for every copy, the cost of host reads, memory over a long session, scroll positions, and the load record for why something shows late. Read it before adding state, a cache or a read to any view.

## One context for every copy

Herdr now runs every copy of a mod in one JavaScript context (it used to give each its own), so a module variable is written by every copy that runs that code: per-copy state goes on the view (`this`), and state every copy must see goes through shared state. The story list puts a trimmed copy of its data in `kelpie.stories.data` (by profile, ~80 KB) and starts from it after a restart (a freshness line says loading/updated/old; for a load of a second or more its tooltip says how long each part took, the board, each pull request search, the sessions, sorting it out and drawing the list, and which it waited on most: `timing` in the data, `loadTimes()`, as the parts run at once and the load waits for the slowest, #108); a copy older than the list's 2-minute timer loads as soon as that profile shows, and a load still busy after 2 minutes (its task dropped by a reload mid-load) no longer blocks the next (`STUCK` in source.js), and a reload asked for while a load runs (Refresh, which Kelpie's own moves and approvals press, an agent's turn ending: `load(cx, {again: true})`) isn't dropped: as that load began before the change, the list loads once more on the draw after it ends (`again` in source.js, `AGAIN` in stories.js); a timer's or a stale copy's request isn't kept, the load running answers it; the others read it.

Preview `kelpie.stories.preview` (by profile), view `kelpie.view` (by story space, or `preview:<profile>`), counts `kelpie.stories.counts`, paused agents `kelpie.paused` (by profile, then key; each with `config`, its Claude config folder when not the default `~/.claude`, so Resume runs `env CLAUDE_CONFIG_DIR=… claude --resume`), launches in flight `kelpie.launching` (by story key, 30 s at most), the last action's note `kelpie.stories.note` (by profile, `{text, full, keys, at}`, 5 minutes; `say(about, text)` in stories.js, `about` `{profile, keys}`, the shown profile when left out: a note whose keys are all one story's (its own or its subtasks') shows only in that story's details, `storyNote()`; one about several stories or none (Clean up all, Run all) under the list's freshness line, `listNote()`; another profile's nowhere), diff ticks `kelpie.viewed` (`<repo path or PR>:<path>:<patch hash>` -> story key, so a changed file is unticked), the menu `kelpie.spacemenu`.

Each fresh load prunes them (`pruneShared()`): views of closed spaces, ticks and counts of keys no profile's data has, paused entries of keys the profile no longer lists (only from a load with a sprint and every PR), and every entry kept by profile of a deleted profile (`byProfile()`: its stories copy, preview, note, asks, picks, pointer, leftovers, `kelpie.notify.prs`…; not its paused agents), as a deleted profile's stories copy stayed in shared state for good (#39). Every write of shared state rewrites Herdr's whole `shared.json` and redraws every copy, so a write that changes nothing is skipped (`setCounts()`: the Screenshots count asked every 5 s)

## Host reads

Host reads cost what they hold: `spaces()`, `agents()`, `panes()` and `shared(key)` convert their whole value into the mod engine on every call, and herdr-core lists every space, pane and agent of every Herdr window (a day of story agents is dozens). So a render reads each list once and works from that, never once per space or agent: `spaceProfiles()` in config.js gives each space's profile from one read of each (`profileOf()` for one space, `spacesOf()`, `profileAgents()` and the profile menu go through it). Re-reading them per space made every Kelpie view grow with the square of what herdr-core held (about 1100 reads per sidebar render with 30 other spaces open), past the time Herdr gives a render, and the demo's sidebar stayed "interrupted" (#104). `tests/js/render-cost.test.mjs` checks each view reads as much with 60 other spaces open as with 30.

And a render reads each list and shared key once in all (#37): the helpers it goes through each asked again (a tab bar render read the spaces 19 times, the skin's `shared("layout")` 120 times in the sidebar), so every mod file takes `spaces`, `agents`, `panes`, `terminals`, `focused`, `layout`, `shared`, `setShared`, `run` and `hc` from `host.js`, never from `herdr` (a test holds it): inside `rendering()`, which main.js wraps around every Kelpie view's render, each read is made once and handed to every caller (so never change a read value in place: the test stub hands them out frozen), and `memo(name, fn)` keeps what's worked out from them (`storyItems()`, asked by the tab bar, the layout's sync and the keys); `setShared()` drops the key written and every memo, `run()` and `hc()` everything; outside a render (clicks, timers, tasks after their first await) every read is fresh.

The story list reads the shared stories copy (every profile's, ~80 KB each) only until it has its own. That test checks too that a settled render of each view, drawn through main.js, reads nothing twice and writes nothing

## Memory over a long session

Memory over a long session (#41): Herdr runs for days and every copy of the mod shares one context, so nothing the views load is kept per key for good. The per-key loads in stories.js keep only the entries written most recently, `KEEP` (Changes of 10 stories, 150 descriptions, 60 status lines, 60 screenshot lists, 60 status menus, 100 files' text for opening a diff's gaps), through `keep()`, which never drops one still loading or the one just written; one dropped and shown again just loads again. The caches keyed by whole patches (`HASHES`, `FILE_STATUS`, `DIFFS`) are `ByText`, under 8 million characters of patches each, the oldest going first (a count alone, 4000 patches, once let them hold hundreds of MB).

Images Herdr is handed have stable paths (a thumbnail per screenshot, a file per avatar, the skin's art), so its image cache grows only with what exists; never hand it a new path per frame (Web panel, above). Tests: `tests/js/memory.test.mjs`. A new cache per key or per patch gets a bound and a test there

## Scroll positions

Scroll positions: each thing shown keeps its own, so another story opens at its own place and coming back finds the first where it was. Every scroll box's id names what it shows (`story-overview-<key>`, `pr-desc-view-<key>`, `change-files-<key>`, `diff-x-<key>`, `work-side-list-<profile>`, `work-side-plain-<profile>`, `artifact-grid-<scope>`; the profile dialog's `work-setup-body-<tab>`), and as GPUI keeps an element's own position only while it's drawn, the position itself is a scroll handle lent per key by `ScrollPool` (ui.js): Herdr makes handles only in `init`, so a view makes a few there (12 for the details, 8 for Changes and each sidebar) and a key shown again gets its own back; once all are lent, the one shown longest ago goes to the new key, put back to the top.

A story's are keyed by profile too (`<profile>:<key>`), as two profiles may show one board. StoryBody's `detailScrolls` (the details and a lone pull request's description, `scrollBox()`, whose first child is an empty line: a handle goes "to the top" by revealing child 0 with the least scroll, which for one tall child already at the top scrolled to its bottom; a passage's reader returns before the overview is built, so a pointing's trip to the top isn't spent on a box not drawn), StoryView's `diffScrolls` (`all`, `one` with the file it holds as `oneFile`, `files`; a file jump, `this.jump`, ends when another story shows), StoryList's `listScrolls` and WorkSide's `plainScrolls`. The Artifacts grid has only the id.

Tests: `tests/js/scroll.test.mjs`

## Debugging

Mods have no readable console: debug with a temporary `setShared("kelpie.debug.<role>", {...})`, written only on change (a write per render can loop), and read `~/.config/herdr-app/shared.json`. Herdr owns that file, stray keys can't be deleted by hand, so keep debug names obvious

## The load record

Why something shows late: the load record (`debug.js`, #110). Every full load of a source (`Source.load`, the story list's `stories:<profile>`), quick pull request read (`quick:<profile>`) and sessions read (`sessions:<profile>`) notes when it was last asked for and why (`start`, `timer`, `refresh`, `stale: older than the timer`, `an agent's turn ended`, `asked again while one ran`…, the `why` option of `load()`, `quickPulls()`, `loadSessions()`), what waits (asked while one ran) and what was turned away and why (a load running answers it, GitHub's limit or low budget, nothing loaded yet), each run's start, wait and time taken (`took`, ms) or error, and the last 30 runs, newest first. It's kept in memory, always; `herdr-app do kelpie.debug-loads` turns writing it on (a toast says so) and off: on, it's shared `kelpie.debug.loads` (switch `kelpie.debug.on`), clock times and ms, written at most every `DEBUG_EVERY` (3 s, the rest by one `cx.timer.after`) and only when it changed, a request turned away again for the same reason changing nothing written, so it can't make the list draw over and over; off, the key goes.

Read it with `jq '."kelpie.debug.loads"' ~/.config/herdr-app/shared.json`. Tests: `tests/js/debug.test.mjs`
