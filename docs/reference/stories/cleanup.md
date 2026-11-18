---
covers:
  - mods/kelpie/stories.js
---

# Pause and clean up

Pausing agents and stories, what happens when a story's space closes, and what Clean up takes.

## Pause and clean up

Pause keeps an agent's session (`~/.claude*/sessions/<pid>.json`) and closes its pane (its tab when alone there), asking first (a second click) when the agent is working; Pause (header) pauses every agent in the story's space (`pauseWholeStory()`) (each under its tab's key, else the story's) and closes the space (`space.close`, confirmed), asking first when one works or a tab has no agent; if any has no session found, the space stays and the note says which. `run()` returns null: never chain `.then`/`.catch` on it or wait on it. When a story's space closes (its last tab, say), `syncTracking()` previews that story instead of following Herdr to another space; a deliberate switch still ends a preview.

Clean up only takes settled work (`cleanBlockers()`): the story done on its board (a lone PR: merged), or your part of it handed over (#318, `handedOver()`: build()'s `sunk`, every subtask of yours at or past the handover column, else the story's own status, whatever the board's status after it says, as what comes after is other people's; the story's own status earlier doesn't hold it back, as #304 settled), or reassigned, none of its pull requests open, no agent of it (or in its space) working or waiting; and right before cleaning, no uncommitted work in its ticket folders, and for a story not finished on the board (reassigned, or only handed over) no commits that no remote branch has (`unsaved()`, changes.py `--unpushed`: its work may never have been merged; a finished story's branch may be gone from the remote once merged, so it isn't asked), as a clean-up command may delete them; all checked again when it runs, after the dialog.

A done story, and on a team's board one only handed over (on a board worked alone Built waits on the person to check it, so it stays listed), stays in the list while it has a space, a paused session or leftovers found (`settled()`, `build()`'s `left`, `leftStories()`; the leftovers check looks at every finished story of the board, listed or not, `{ all: true }`, so one left with only a ticket folder still gets its broom); it closes its space after the dialog, drops its `kelpie.paused`/`kelpie.view`/`kelpie.stories.counts` entries and runs the clean-up command when it left something.
