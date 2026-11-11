# Kelpie

A kelpie is the sheepdog that works the flock on its own and comes back only when it's needed. This one does the same for your Claude agents in Herdr.

Kelpie is early and not stable yet: things change, sometimes a lot, between updates. Pull often, and run `./install.sh` again after you do.

Layouts and mods for [Herdr](https://herdr.dev) built around profiles and stories: a profile's sprint in the sidebar (from a Jira board or a GitHub Project), each story as a Herdr space with its Claude agents, its pull requests, changes and screenshots, and a browser panel per profile.

- `layouts/Kelpie.json` (the Quiet Pages look) and `layouts/Kelpie-Plain.json` (no skin), with their themes and previews
- `mods/kelpie`: every Kelpie view (sidebar, story header, Changes, tab bar, footer, dialogs, skins)
- `mods/kelpie-artifacts`: the Artifacts panel and the Screenshots view

![A story whose agent is at work: the story's description above its agent's terminal, the sidebar's stories each marked with what they need](docs/screenshots/story.png)

## A look around

Each story's pull requests and uncommitted work, file by file, with a review's progress kept as you go:

![The Changes view: a file list on the left, a diff on the right](docs/screenshots/changes.png)

Next takes you to whatever needs you, most urgent first. Claude can add its own picks from the sprint, the reviews waiting on you and the repos you work in:

![The Next queue opened: what needs you, the reviews waiting on you, finished stories to clean up, and Claude's picks](docs/screenshots/next.png)

A review waiting for you, before any agent starts on it:

![A pull request waiting for review, with its author, checks and files](docs/screenshots/review.png)

A story nobody has started yet:

![A story not started: its description and its subtasks, yours first, with Start work in its header](docs/screenshots/overview.png)

`Kelpie-Plain` is the same layout without the skin:

![The story view in the Kelpie-Plain layout](docs/screenshots/plain.png)

## Requirements

- [Herdr](https://herdr.dev), with its `herdr-app` and `hc` commands on your `PATH` (tested with Herdr 0.1.15 and herdr-core 0.1.20), and [Claude Code](https://claude.com/claude-code)
- `git`, `jq`, `curl`, and `python3` (its standard library only)
- For pull requests, and for a GitHub Project as the board: the GitHub CLI `gh`, signed in (`gh auth login`). Moving a Project's tickets from Kelpie also needs gh's `project` scope (the profile dialog checks it and gives the command)
- For Jira (Jira Cloud only): an API token, kept in the macOS Keychain or printed by a command of your own (`op read …`, `pass …`, `secret-tool lookup …`); the profile dialog sets it up
- Optional:
  - [ImageMagick](https://imagemagick.org) (`magick`) to mark up screenshots before sending them to an agent
  - [`terminal-browser`](https://terminal-browser.com) (`brew install --cask terminal-browser`) for the Web panel
  - `sqlite3`, which lets Restart browser forget a page that froze it

Developed on macOS. Linux is meant to work but is less tested. There, Kelpie has no Keychain (use a token command for Jira), opens links with `xdg-open`, and reads screenshot sizes with ImageMagick's `identify`, as `sips` is macOS-only. Without `sips`, the Screenshots gallery shows the full images as its thumbnails.

## Install

```sh
git clone https://github.com/GMati13/kelpie.git
cd kelpie
./install.sh
```

`install.sh` links the layouts, themes and mods into Herdr's folder (`~/.config/herdr-app`, or `$HERDR_APP_HOME`), so a `git pull` updates them, and copies what Herdr won't read through a link: the layouts' previews, the icons, and the skin's art and fonts. Run it again after updating. It never overwrites a file of yours: if one is in the way, it names it and stops.

Then:

1. **Restart Herdr** if it's running: it loads fonts only at start.
2. **Add Kelpie's keys** to Herdr's own `~/.config/herdr-app/keys.json`. Kelpie's `keys.json` has a section for each layout (`layout:Kelpie`, `layout:Kelpie-Plain`), which go in as they are, and one global key (`cmd-shift-s` toggles the Web panel), which goes into your `global` section. From your Kelpie clone, this merges them, keeping a backup and your own keys (Kelpie's win where both bind the same key; with `HERDR_APP_HOME`, use that folder for `k`):

   ```sh
   k=~/.config/herdr-app/keys.json
   [ -f "$k" ] && cp "$k" "$k.bak" || echo '{}' > "$k"
   jq -s '.[0] * .[1]' "$k" keys.json > "$k.new" && cat "$k.new" > "$k" && rm "$k.new"
   ```

   In the Kelpie layouts, these replace Herdr's: `cmd-w` closes a tab (asking first, Pause or Close, for a story's last one), `cmd-n` opens a new space for the profile, `cmd-b` hides the sidebar. Kelpie's own: `cmd-shift-j` next thing that needs you, `cmd-shift-k` find a story, `cmd-shift-r` start or show the story's agent, `cmd-alt-p` pause, `cmd-alt-c` new Claude, `cmd-alt-t` new terminal, `cmd-alt-d` the Desk, `cmd-shift-h` fold the story's details.
3. **Pick Kelpie** in Herdr's Settings › Look (or press `ctrl-shift-l` to cycle through layouts).
4. **Make a profile** from the profile menu at the top of the sidebar (New profile…).

### Profiles

A profile is a folder you work in, plus whatever you connect to it: a board, Jira or a GitHub Project (its sprint becomes the sidebar's stories; below), a GitHub owner (pull requests and reviews), a Claude account (Default, Claude's own `~/.claude`, or any other `~/.claude*` folder that has a `settings.json` or `projects/`: one you've run Claude with via `CLAUDE_CONFIG_DIR`) and a GitHub account (below, Several accounts), a start page for the Web panel. Only the folder is needed. Without a board, the sidebar lists the profile's spaces and their agents instead. A space belongs to the profile it was opened from (`cmd-n`), else to the profile whose folder it started in. Each profile also has a Desk, first in its sidebar: one space for work that isn't on any ticket (`cmd-alt-d`). Every setting can also be set up by a Claude agent: "Let me configure it for you" in the profile dialog, through Kelpie's Claude Code plugin (below; Kelpie offers to install it the first time).

### A board: Jira or a GitHub Project

A profile has one board at most, chosen on the profile dialog's Board page. Either way, your tickets become stories, their subtasks show under them, starting one opens a Herdr space named after its key, and its status chip moves the ticket. When a story is finished, Move to Done (the double check in the story's header, and on each story past your part in the sidebar) moves your subtasks and then the story to the board's done column in one go, leaving others' subtasks as they are, and can clean the story up right after. To find work to pick up, turn on Show unassigned work on the same page: the sprint's stories and subtasks nobody has then show in a folded section at the end of the sidebar, and you take one on the board.

- **Jira** (Jira Cloud only): paste the board's address (it ends in `/boards/<number>`) and sign in with an API token, kept in the macOS Keychain or printed by a command of your own. The page gives the command that stores the token, and Check signs in and reads the board.
- **A GitHub Project:** paste the Project's address, `https://github.com/users/<you>/projects/<number>` or `https://github.com/orgs/<org>/projects/<number>`, and press Check. There's no sign-in of its own: Kelpie reads the Project with gh, as the profile's GitHub account (Several accounts, below). To move tickets, gh's sign-in needs the `project` scope (`read:project` only reads). Check says which it has and, when it's missing, gives the command to run in a terminal:

  ```sh
  gh auth refresh -h github.com -s project
  ```

  Stories come from the Project's current iteration, or from all its open work when it has no iteration field. A story is the parent of an issue assigned to you, or that issue itself; its sub-issues are the subtasks, and the Project's Status options are the columns. Pull requests attach by the key in their title, or by GitHub's "closes #42" link.

  **Ticket keys:** an issue's key is its repo's prefix and its number, like `WEB-42` for issue #42 of `acme/web`. The prefix is the repo's name in capitals, letters and digits only (`my-app` gives `MYAPP`). After a Check, the Board page lists the Project's repos with each one's prefix, and you can change any of them: a prefix is a letter, then letters or digits, 2 to 20 in all, and no two repos may share one. Keys name the story's space and its ticket folder, so change a prefix before you start work under it.

### Several accounts

Each profile can run on its own Claude account and its own GitHub account, so work and personal (or two clients) never mix.

- **Claude:** give each account a config folder of its own and sign in there once, for example `CLAUDE_CONFIG_DIR=~/.claude-work claude`. Pick it as the profile's Claude account (the profile dialog's Agents page, which walks through all of this, commands to copy included). For its usage limits in the footer, give that folder's `settings.json` the status line below (Optional), and install Kelpie's plugin on it too. The profile's new agents, What next? and its terminals start with `CLAUDE_CONFIG_DIR` set, so a `claude` you type there uses it too; a resumed session keeps the account it ran on. If your shell picks a Claude account by folder (a `claude` function of your own), have it leave the choice alone when `CLAUDE_ACCOUNT_CHOSEN` is set, as Kelpie's terminals set it.
- **GitHub:** sign in to each account with `gh auth login` (gh keeps them all; `gh auth status` lists them) and pick one as the profile's GitHub account (the GitHub page). Kelpie's own pull request lists, files and Approve use it. The profile's agents and terminals start with `KELPIE_GH_ACCOUNT=<account>`; for the `gh` they run to act as it too, add this to your shell setup, `~/.zshrc`, or for bash `~/.bashrc` with your `~/.bash_profile` reading it, as agents start in a login shell (the GitHub page has it to copy, and its Check my shell tries it):

  ```sh
  gh() {
    if [ -n "$KELPIE_GH_ACCOUNT" ] && [ "$1" != auth ]; then
      local t
      t=$(command gh auth token --hostname github.com --user "$KELPIE_GH_ACCOUNT") \
        || { echo "gh isn't signed in as $KELPIE_GH_ACCOUNT: gh auth login" >&2; return 1; }
      GH_TOKEN=$t command gh "$@"
    else
      command gh "$@"
    fi
  }
  ```

  Without it, gh there acts as gh's active account, and gh keeps one active sign-in for the whole machine: signing in to another account, anywhere, can switch it, and a second gh config folder (`GH_CONFIG_DIR`) doesn't keep them apart. So keep your main account the active one (`gh auth switch --user <login>`) and pick the others per profile. The function reaches agents started after you add it: a Claude already running, or a session resumed since, may still run its commands through the shell setup it read before, so start a new one. Git itself (push, fetch) signs in its own way, over SSH or a credential helper, and neither setting changes it.

### Optional

- **Claude's usage limits in the footer:** point Claude Code's status line at Kelpie's script, in the `settings.json` of each Claude config folder you use (`~/.claude`, and any other you run with `CLAUDE_CONFIG_DIR`):

  ```json
  "statusLine": { "type": "command", "command": "sh ~/.config/herdr-app/mods/kelpie/claude-statusline.sh" }
  ```

  It saves the limits for Kelpie and prints nothing, so it replaces a status line you already have. A word after the path names the account in the footer (`… claude-statusline.sh Work`). With `HERDR_APP_HOME`, use that folder in the path.
- **The Web panel:** run `terminal-browser config set render.presenter patched` once, for its images to draw in place.
- **Kelpie's Claude Code plugin:** lets Claude set up a profile with you ("Let me configure it for you" in the profile dialog, which offers to install it), and show you where a story says something: ask the Claude you're talking to "where does the story say…?", and it opens the story in Kelpie with the passage marked in its description, instead of only quoting it. It also connects Claude to Next: any Claude can read your queue ("what's on my plate?") and add something it needs from you, such as a choice or a plan to read, which shows in Next under its name; What next? hands its suggestions in through it too, so it needs the plugin as well. Install it on each Claude account a profile uses; in Claude Code, from anywhere:

  ```
  /plugin marketplace add <path to your Kelpie clone>
  /plugin install kelpie@kelpie
  ```

  It needs `python3` and Herdr's `herdr-app` on your `PATH`, and shows stories of the profile Kelpie has on screen (a story's own description; not a subtask's yet).
- **Changing a skin's art:** the art is already built; after editing it, rebuild with `python3 mods/kelpie/skins/<name>/build.py` (needs pillow).

## Try the demo

```sh
herdr-app do kelpie.demo
```

With a Kelpie layout picked, this adds a profile called Acme, with a made-up sprint, pull requests and agents in every state, and opens its stories as spaces. Nothing reaches Jira, GitHub or Claude. Its agents are a stand-in script, and its links can't reach anyone. What it shows comes from `mods/kelpie/demo/demo.json`: edit it and press Refresh to set up another situation.

To see the same stories on a GitHub Project instead of Jira, open the demo with that board (`kelpie.demo` puts Jira back):

```sh
herdr-app do kelpie.demo-github
```

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
