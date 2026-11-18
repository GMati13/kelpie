---
covers:
  - mods/kelpie/artifacts.py
  - mods/kelpie-artifacts/main.js
  - mods/kelpie-artifacts/gallery.js
  - mods/kelpie-artifacts/markup.js
  - mods/kelpie-artifacts/session.js
---

# Artifacts and Screenshots

The story's Artifacts view (Claude Artifacts) and the Screenshots panel.

## Artifacts view

Artifacts view (Claude Artifacts, pages on claude.ai; #100): the story's tab after Screenshots, `artifactsView()` in StoryView, mode `artifacts`. `artifacts.py` reads the story's sessions' logs (`storySessions()`, ids only) for Artifact publishes (a publish whose `toolUseResult` gives a `ARTIFACT_LINK` url; reads, opens, assets and errors skipped), one entry per link with title, description, source path, first/last time, count, last session and its Claude config folder; indexed by offset like sessions.py in a private (0600) `~/.cache/kelpie/artifacts.json`. `storyArtifacts()` keeps only Artifact links; `artifactsOf()` reads once per load (and every 30 s while shown) into `ARTIFACT_LISTS`, counts `artifacts` in `kelpie.stories.counts`.

One made on another Claude account than the profile's says so. Open sets shared `kelpie.web.open` (`openArtifact()`), taken by the leading copy (`syncWebOpen()` in main.js: shown profile, 30 s, Artifact link only), `openInWeb()` shows the profile's slot and runs `terminal-browser new-tab --browser <key> <url>` in the profile's own folders (`PROFILE_BROWSER`, values as arguments), else opens the person's browser and says why; the icon opens the browser directly. Demo: fixture `artifacts` (`demoArtifacts()`). Not yet: actions sent to the Artifact's agent, thumbnails

## Screenshots view

Screenshots view: the Screenshots panel (`mods/kelpie-artifacts`, its folder, ids and `kelpie.artifacts` command keeping their old name so installs and keys don't break; the tab bar's panel button says Screenshots: justified gallery, zoom/pan viewer, mark-up, Add to chat, copy path, Show in Finder, remote fetch) scoped to every Claude session of the story. The title row (`Stories.shareShots()`, shown with every story) writes shared `kelpie.artifacts.sessions` = `{key, ids, keys: {id: subtask key}, terminals: {id: agent terminal}, on, started}` while the view shows (only `key` until the sessions are gathered, so the panel never shows another story's images), again after each stories reload, when the story's open agents change, and every 5 s at most while an open agent has no session in the list (a new agent's session is on disk only after its first message).

The panel polls every 3 s (no `watchFolder`), badges tiles with their subtask key when there are several, and offers Add to chat (the original, and in mark-up the marked version) whenever the story has an agent open: the image's own session's agent first, then the focused one, then the rest (`chatTargets()`; shared `kelpie.artifacts.sessions` also lists `agents`, the story space's agent terminals); with more than one it's a menu of their tab names, the one that took the image marked. Add to chat (or picking an agent in that menu) opens a note bar under the image, in place of the filmstrip or the mark-up tools (`noteBar()`, `openNote()`): "To <tab name>", an input for what to look at ("the button is cut off here"), Add (Enter) and Cancel (Esc; letters typed go to the note, not the viewer's keys); with nothing typed it's the image alone, as before. `pasteToChat()` pastes the path alone first (so Claude Code takes it for an image), then the note in a paste of its own `NOTE_AFTER` (400 ms) later, only while the same agent's pane is still open, then gives the clipboard back; the note is one line (`cleanNote()`: control characters and line breaks as spaces, as a line break would press Enter in the terminal, at most `NOTE_MAX` 500 characters).

The bar closes when another image shows or the mark-up ends. The marked version and a remote image's thumbnail are made in private folders of their own (`mktemp -d`: `herdr-markup.XXXXXX` under `TMPDIR`, `FLATTEN_SCRIPT` in markup.js, the person's own over a day old removed, links never; `THUMB_SCRIPT` in session.js, removed at once), never a fixed or unreserved name. `shots.js` just counts images for the tab bar. The Desk has the same view, scoped to its agents' sessions (`deskNow()` in desk.js, called by the tab bar while the Desk shows, which hands it its `cx`): its view is `kelpie.view` by the Desk's space id (`agent` or `shots`, `deskView()`/`showDeskView()`; `syncStories()` in work.js selects `story-shots` for it), and while Screenshots shows it writes `kelpie.artifacts.sessions` with key `desk:<profile>` and `desk: true` (the panel's empty text then names the Desk); its sessions are its open agents' (`claudeSession()`) and those seen on it before, shared `kelpie.desk.sessions` (by profile, newest first, 30 within 14 days, a deleted profile's dropped by `saveProfile()`), so an agent's images stay once its tab closes; gathered again when its agents change, every 5 s while one has no session yet, and once a minute, the count beside Screenshots from `countShots()`.

A Desk tab clicked, a new tab (the tab bar's +, `openDesk()` with a tab), a Desk agent's row or Next going to a waiting one goes back to its terminals
