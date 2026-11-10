# Kelpie

A kelpie is the sheepdog that works the flock on its own and comes back only when it's needed. This one does the same for your Claude agents in Herdr.

Layouts and mods for [Herdr](https://herdr.dev) built around profiles and stories: a profile's Jira sprint in the sidebar, each story as a Herdr space with its Claude agents, its pull requests, changes and screenshots, and a browser panel per profile.

- `layouts/Kelpie.json` (the Quiet Pages look) and `layouts/Kelpie-Plain.json` (no skin), with their themes and previews
- `mods/kelpie`: every Kelpie view (sidebar, story header, Changes, tab bar, footer, dialogs, skins)
- `mods/kelpie-artifacts`: the Artifacts panel and the Screenshots view

![A story whose agent is waiting on a permission prompt: the story's description above, the sidebar's stories each marked with what they need](docs/screenshots/story.png)

## A look around

Each story's pull requests and uncommitted work, file by file, with a review's progress kept as you go:

![The Changes view: a file list on the left, a diff on the right](docs/screenshots/changes.png)

Next takes you to whatever needs you, most urgent first. Claude can add its own picks from the sprint, the reviews waiting on you and the repos you work in:

![The Next queue opened: what needs you, a finished story to clean up, and three picks from Claude](docs/screenshots/next.png)

A review waiting for you, before any agent starts on it:

![A pull request waiting for review, with its author, checks and files](docs/screenshots/review.png)

A story nobody has started yet:

![A story not started: its description, and its subtasks each with what can be done next (Start work, or Resume an earlier session)](docs/screenshots/overview.png)

`Kelpie-Plain` is the same layout without the skin:

![The story view in the Kelpie-Plain layout](docs/screenshots/plain.png)

## Requirements

- [Herdr](https://herdr.dev), with its `herdr-app` and `hc` commands on your `PATH` (tested with Herdr 0.1.14 and herdr-core 0.1.19), and [Claude Code](https://claude.com/claude-code)
- `git`, `jq`, `curl`, and `python3` (its standard library only)
- For pull requests: the GitHub CLI `gh`, signed in (`gh auth login`)
- For Jira (Jira Cloud only): an API token, kept in the macOS Keychain or printed by a command of your own (`op read …`, `pass …`, `secret-tool lookup …`); the profile dialog sets it up
- Optional:
  - [ImageMagick](https://imagemagick.org) (`magick`) to mark up screenshots before sending them to an agent
  - [`terminal-browser`](https://terminal-browser.com) (`brew install --cask terminal-browser`) for the Web panel
  - `sqlite3`, which lets Restart browser forget a page that froze it

Developed on macOS. Linux is meant to work but is less tested. There, Kelpie has no Keychain (use a token command for Jira), opens links with `xdg-open`, and reads screenshot sizes with ImageMagick's `identify`, as `sips` is macOS-only (without it, the gallery's thumbnails are the full images).

## Install

```sh
git clone https://github.com/GMati13/kelpie.git
cd kelpie
./install.sh
```

`install.sh` links the layouts, themes and mods into Herdr's folder (`~/.config/herdr-app`, or `$HERDR_APP_HOME`), so a `git pull` updates them, and copies what Herdr won't read through a link: the layouts' previews, the icons, and the skin's art and fonts. Run it again after updating. It never overwrites a file of yours: if one is in the way, it names it and stops.

Then:

1. **Restart Herdr** if it's running: it loads fonts only at start.
2. **Add Kelpie's keys** to Herdr's own `~/.config/herdr-app/keys.json`. Kelpie's `keys.json` has a section for each layout (`layout:Kelpie`, `layout:Kelpie-Plain`), which go in as they are, and one global key (`cmd-shift-s` toggles the Web panel), which goes into your `global` section. This merges them, keeping a backup and your own keys (Kelpie's win where both bind the same key):

   ```sh
   k=~/.config/herdr-app/keys.json
   [ -f "$k" ] && cp "$k" "$k.bak" || echo '{}' > "$k"
   jq -s '.[0] * .[1]' "$k" keys.json > "$k.new" && cat "$k.new" > "$k" && rm "$k.new"
   ```

   In the Kelpie layouts, these replace Herdr's: `cmd-w` closes a tab (asking first, Pause or Close, for a story's last one), `cmd-n` opens a new space for the profile, `cmd-b` hides the sidebar. Kelpie's own: `cmd-shift-j` next thing that needs you, `cmd-shift-k` find a story, `cmd-shift-r` start or show the story's agent, `cmd-alt-p` pause, `cmd-alt-c` new Claude, `cmd-alt-t` new terminal, `cmd-alt-d` the Desk, `cmd-shift-h` fold the story's details.
3. **Pick Kelpie** in Herdr's Settings › Look (or press `ctrl-shift-l` to cycle through layouts).
4. **Make a profile** from the profile menu at the top of the sidebar (New profile…).

### Profiles

A profile is a folder you work in, plus whatever you connect to it: a Jira board (its sprint becomes the sidebar's stories), a GitHub owner (pull requests and reviews), a Claude account (Default, Claude's own `~/.claude`, or any other `~/.claude*` folder that has a `settings.json` or `projects/`: one you've run Claude with via `CLAUDE_CONFIG_DIR`), a start page for the Web panel. Only the folder is needed. Without Jira, the sidebar lists the profile's spaces and their agents instead. A space belongs to the profile whose folder it started in. Every setting can also be set up by a Claude agent: "Let me configure it for you" in the profile dialog, through Kelpie's Claude Code plugin (below; Kelpie offers to install it the first time).

### Optional

- **Claude's usage limits in the footer:** point Claude Code's status line at Kelpie's script, in the `settings.json` of each Claude config folder you use (`~/.claude`, and any other you run with `CLAUDE_CONFIG_DIR`):

  ```json
  "statusLine": { "type": "command", "command": "sh ~/.config/herdr-app/mods/kelpie/claude-statusline.sh" }
  ```

  It saves the limits for Kelpie and prints nothing, so it replaces a status line you already have. A word after the path names the account in the footer (`… claude-statusline.sh Work`). With `HERDR_APP_HOME`, use that folder in the path.
- **The Web panel:** run `terminal-browser config set render.presenter patched` once, for its images to draw in place.
- **Kelpie's Claude Code plugin:** lets Claude set up a profile with you ("Let me configure it for you" in the profile dialog, which offers to install it), and show you where a story says something: ask the Claude you're talking to "where does the story say…?", and it opens the story in Kelpie with the passage marked in its description, instead of only quoting it. Install it on each Claude account a profile uses; in Claude Code, from anywhere:

  ```
  /plugin marketplace add <path to your Kelpie clone>
  /plugin install kelpie@kelpie
  ```

  It needs `python3` and Herdr's `herdr-app` on your `PATH`, and shows stories of the profile Kelpie has on screen (a story's own description; not a subtask's yet).
- **Changing a skin's art:** the art is already built; after editing it, rebuild with `python3 mods/kelpie/skins/<name>/build.py` (needs pillow).

## Try it without Jira

```sh
herdr-app do kelpie.demo
```

This adds a profile called Acme, with a made-up sprint, pull requests and agents in every state, and opens its stories as spaces. Nothing reaches Jira, GitHub or Claude. Its agents are a stand-in script, and its links can't reach anyone. What it shows comes from `mods/kelpie/demo/demo.json`: edit it and press Refresh to set up another situation.

To take it away again (its spaces, the profile and its folder):

```sh
herdr-app do kelpie.demo-remove
```

## Contributing

`CLAUDE.md` holds the internals and design notes. It's written for the coding agents that work on Kelpie, so it's dense, but it's the reference for how every part works.

Run `./test.sh` before committing (Node 22 or later, `python3`, `git` and `jq`; nothing to install), or let git run it for you: `git config core.hooksPath scripts`. CI runs it on macOS and Linux. `tests/README.md` says how the tests work and how to add one; a security-relevant change comes with a test. The rules for working on Kelpie (development, testing, security, product) are in `.claude/rules/`.

## License

MIT, see `LICENSE`. Bundled third-party files keep their own licences, kept beside them:

- Icons in `mods/kelpie/icons/`: [Lucide](https://lucide.dev), ISC (`mods/kelpie/icons/LICENSE`)
- Fonts in `mods/kelpie/skins/quiet-pages/fonts/`: DM Sans, DM Mono and Fraunces, SIL Open Font License 1.1 (`OFL-*.txt` there)
