---
covers:
  - mods/kelpie/desk.js
---

# The Desk

One space per profile for work without a ticket.

## Desk

Desk (`desk.js` rows, `deskOf()`/`openDesk()`/`isDesk()` in config.js): one space per profile for work without a ticket, named `Desk`, first in every profile's sidebar (StoryList and `plain()`), even before it exists. Shared `kelpie.desk` maps profile → space id (a profile space named `Desk` counts too), and it's noted in `kelpie.space.profile` like a New space. Opening it asks what to start, as the tab bar's + does: Claude or Terminal (`newRows()` in desk.js, on the profile's account, in its folder). Closed, its row ("Open the Desk") is that menu; open, `cmd-alt-d` (`kelpie.desk`, `goDesk()`) shows it, and on a closed Desk opens that menu in the sidebar (shared `kelpie.desk.ask`; it shows the sidebar first); opening it clears the profile's story preview (`PREVIEWS`), which would hide its terminals.

Drawn as a section like "Working on": a `Desk` group heading (its agents counted; a click on its name or empty part shows the Desk as last seen, its last focused tab, as `cmd-alt-d` does, without picking an agent, #133; while it has agents its plain terminals, which stay off the list, are a terminal mark and count after theirs, a click showing the Desk on that terminal, a menu of them when several) with + (the same Claude/Terminal menu) and, in Jira profiles, a clock menu of earlier sessions naming no ticket (no `first` keys, no key in the title, resumed on it) after the rule, then one-line rows of its agents (`agentLabels()` in ui.js numbers names that repeat, "Claude Code 2"; "Working on" uses it too).

The heading names the Desk, so it has a row of its own only without agents: "Open the Desk" while closed, else its tab count, muted, showing it. Not a story: `storyNow()` is null there, so the header hides and the tab bar is a plain space's, plus Screenshots after its +, as a story's (`deskNow()` in desk.js, below under Screenshots view). It's out of "Other spaces"/"Working on"; its close dialog says it opens again. `cmd-shift-j` and the list's Next go to it after the blocked stories, before the agents waiting on you, your pull requests' needs and the reviews (#252) while one of its agents waits for you (`needQueueOf()`, item `{ key: "desk" }`). Pause (`pauseDesk()` in desk.js: a pause icon in its heading while it has agents, ⌥⌘P on the Desk, and the Pause of its last tab's close dialog, "Leave the Desk?", while it has an agent; the dialogs' Pause runs `kelpie.pause-desk`) keeps each agent's Claude session in shared `kelpie.desk.paused` (by profile, `{sessionId, cwd, name, at, config}`, apart from the stories' `kelpie.paused`, whose keys `pruneShared()` keeps only while listed) and closes the Desk; asking first (the heading's a dialog, ⌥⌘P a second press) when an agent works or a tab has no agent; an agent whose session isn't found keeps the Desk open with it, the others' panes closing. ⌥⌘P on a focused Desk agent pauses only it (`pauseDeskByKey()`).

Paused agents are offered first in the menu that opens the Desk (the closed row, "Open the Desk · n paused", ⌥⌘D, and the heading's +): Resume all and each by its tab name (`resumeDesk()`: one after another, the first opening the Desk; each leaves the list before it launches, so a second click can't open it twice, and goes back when the Desk never shows up). A deleted profile's entries go with it. No "move to story": a story comes from asking Claude to create it
