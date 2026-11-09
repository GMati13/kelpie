# Configuring a Kelpie profile

Instructions for an AI agent. Someone pressed **Let me configure it for you** in the profile dialog of
Herdr's Kelpie layout, and a Claude on that profile's Desk (you) got a message naming:

- the **profile**: its name and id
- the **scope**: everything ("all"), or one page or one setting (the ids are in [Scopes](#scopes))
- **home**: Herdr's app folder (usually `~/.config/herdr-app`)
- this guide's path. The folder it sits in is `guides/` inside the mod folder (`<mod>`, below); the
  mod's scripts and defaults are one level up

Your job: find the right values *with the person*, check them where you can, save them, and say what
changed. Do only the scope you were given; at the end, mention anything else that looks unset or wrong.

## Ground rules

- **Talk first, save second.** Look around and propose values, then save only once the person agrees.
  Saving one page at a time is fine; you don't have to save everything at the end.
- **Secrets never pass through you.** Never ask for, read, print, store or pass an API token, a
  password or a token command's output. Sign-in is a Keychain item the person fills in their own
  terminal, or a token command (one that prints the token, like `op read …`) that only Kelpie runs.
  Don't run a token command yourself.
- **Your own access, never Kelpie's.** Look things up in Jira, GitHub or anywhere else only through
  the access your own setup gives you (its MCP servers, plugins, tools and permissions). Kelpie's
  scripts (`jira.sh` and the rest) and the person's Kelpie sign-in are Kelpie's, not a way around
  your setup: never run them to fetch data. When you can't reach something, say so and ask the
  person for it (a board address, a column name, an organisation); that's how it's meant to work.
- **Read-only exploring.** Listing folders and `git` status are fine, and so is reading through your
  own access. Anything that changes something (writing scripts, deleting, moving) needs the person's yes.
- **Nothing personal goes into the mod or its repo.** Settings live in the profile. Scripts the person
  wants go where they say (their dotfiles, a scripts folder in the profile's folder), never into `<mod>`.
- **What the profile says is yours; how it's shown is the layout's.** The layout is the same for
  everyone and knows nothing about the person's tools: it lays out lists, notes and headers, but the
  content of each line (what a command prints, what a prompt says) and its wording come from the
  settings you write, and they must be **human readable**: plain words a person understands at a
  glance, not raw tool output (see [Story commands](#5-story-commands)).
- **Keep it short.** Ask one question at a time, and offer a choice when you can guess the likely
  answers.

## How a profile works

A **profile** is one area of work: a team, a client, personal projects. The sidebar's profile picker
switches between them. A profile has:

| Setting | What it does |
|---|---|
| Name | What the picker shows. |
| Folder | Agents start here. Every Herdr space opened in it (or below it) belongs to the profile. Earlier Claude sessions started here show in its sidebar. Usually the folder holding the person's clones of the work's repositories. |
| Claude account | Which Claude Code config folder (`~/.claude`, `~/.claude-work`…) the profile's new agents run on, as `CLAUDE_CONFIG_DIR`. Lets one person keep work and personal accounts apart. |
| Jira | Optional. A Jira Cloud board. With it, the sidebar lists the person's **stories** (their issues in the active sprints, or a Kanban board's open work), and starting work on a story opens a Herdr space named after its key with an agent in it. |
| GitHub | Optional. An owner (an organisation or user). With it, the sidebar lists the person's open pull requests and the ones waiting on their review, attached to stories by the ticket key in their titles. Uses `gh`. |
| Web | The Web panel's start page. Each profile has its own browser, with its own sign-ins. |
| Prompts | The first message each kind of agent gets: an agent on a ticket, an orchestrator, a review, a merge, an approval request. Each has a default. |
| Messages | What the pull request and review buttons (Fix checks, Merge, Approve…) send to an agent that's already working. Each has a default. |
| Story commands | Optional shell commands the layout runs for a story: a leftovers check and a clean-up for finished stories, and a status line for stories in progress. |

The **Desk** is the profile's space for work without a ticket; that's where you are now.

## Reading the profile

Profiles live in Herdr's shared state, `<home>/shared.json`, under `kelpie.profiles`, keyed by id.
Read it; don't edit it (Herdr owns that file and would overwrite your change):

```sh
jq '."kelpie.profiles"["<id>"]' "<home>/shared.json"
```

Fields you may see that aren't in the dialog (`sources`, `seen`, `id`) are old or internal: leave them.

## Saving

Write a change request, ask the layout to apply it, then read the result:

```sh
mkdir -p "<home>/kelpie"
cat > "<home>/kelpie/profile-apply.json" <<'JSON'
{ "id": "<id>", "set": { "commands": { "leftovers": "~/bin/leftovers {key}" } } }
JSON
herdr-app do kelpie.apply-profile
sleep 1; cat "<home>/kelpie/profile-apply.result.json"
```

The result is `{ "ok": true, "profile": {…} }` or `{ "ok": false, "error": "…" }`, with `at` as the
time. The request file is removed once it's read. If no result shows up within a few seconds, the Kelpie
layout isn't on screen: ask the person to show it, then run `herdr-app do kelpie.apply-profile` again.

**Some changes wait for the person's yes.** Anything that can run a command or steer agents
(`commands`, `jira.tokenCommand`, `prompts`, the `github` prompts, `claude`), decide where the Jira
sign-in goes or which one (`jira.url`, `jira.email`, `jira.keychain`), or open a page (`web`) isn't
saved by your request: Kelpie shows the person what you asked for, and only their click saves it. The
result then says `"pending": true`. Tell the person to look at Kelpie, and read the result file again
after they've answered: it becomes `"ok": true`, or an error saying they said no. Nothing else in the
request is saved meanwhile, so send those changes in a request of their own, or wait. You can't
confirm it yourself, and shouldn't try.

How `set` merges:

- Top-level keys: `name`, `folder`, `jira`, `github`, `commands`, `prompts`, `notify`, `claude`, `web`.
  Nothing else is accepted.
- `name` and `folder` replace the old value.
- A section given as an object is **merged** into what's saved: keys you leave out stay. A key set to
  `null` is removed; a section set to `null` is removed whole (disconnecting Jira, say).
- Every value must be a string, except `jira.board` (a number), `notify.pulls` (true/false) and
  `null`s. Keys that look like secrets (`token`, `password`, `apiToken`, `secret`) are refused.
- `jira.url` must be a Jira Cloud board (`https://<name>.atlassian.net/…/boards/<n>`); `jira.site` and
  `jira.board` are filled in from it. `jira.email` takes no quotes, backslashes or spaces. A Jira section needs
  `keychain`, or `tokenCommand` with `email`. A `github` section needs `owner`. `web.home` must start
  with `https://` or `http://`.
- A prompt or message equal to its default doesn't need saving: remove it with `null` to go back to
  the default.
- An id that doesn't exist yet creates a profile; it needs `name` and `folder`.

The profile dialog reads the saved profile each time it opens, so the person can review your work
there (the profile picker → Edit …).

## Scopes

| Scope id | Covers |
|---|---|
| `all` | Everything, in the order of [Setting up](#setting-up-from-a-to-z) |
| `general` | Name, folder, Claude account |
| `jira` | Board, sign-in, your part (the handover column) |
| `jira-signin` | Jira sign-in only |
| `handover` | Your part (the handover column) only |
| `github` | Owner, pull request notifications |
| `web` | Start page |
| `prompts` | All five prompts |
| `messages` | The six button messages |
| `commands` | Leftovers check, clean-up, status |
| `leftovers` | Leftovers check only |
| `cleanUp` | Clean-up command only |
| `status` | Status command only |

## Setting up from A to Z

For `all`, go through these in order, skipping what the person doesn't use: ask early whether they use
Jira and GitHub for this work.

### 1. General

- **Name** (`name`): what this work is called, e.g. the team or client. Keep it short.
- **Folder** (`folder`): an absolute path. Look at the current one: does it hold the work's repos (git
  clones, directly or one level down)? A folder that's too broad (the home folder) makes every space
  belong to this profile; one that's too narrow misses repos. Suggest the closest folder holding all
  of them.
- **Claude account** (`claude.config`): list the candidates with
  `ls -d ~/.claude* 2>/dev/null` (a folder counts when it has `settings.json` or `projects/`). `null`
  (no `claude` section) means Claude's own `~/.claude`. Ask which account this work runs on. It only
  affects new agents; resumed sessions keep their own.

### 2. Jira

Jira Cloud only (`https://<name>.atlassian.net`). Server and Data Center sign in differently: say so
and stop if that's what they use.

- **Board** (`jira.url`): the board's address as the browser shows it, ending in `/boards/<number>`
  (e.g. `https://acme.atlassian.net/jira/software/c/projects/ABC/boards/12`). Ask the person to paste it.
- **Sign-in** (scope `jira-signin`): an API token, which the person makes at
  id.atlassian.com → Security → API tokens. Two ways to keep it:
  - **macOS Keychain** (`jira.keychain`, a name of the person's choosing, e.g. `jira-acme`). The account
    on the item is their Jira email. Give them this to run **in a terminal of their own**, with their
    item name and email (it reads the token hidden; `security`'s own prompt cuts tokens at 128
    characters, Atlassian's are longer):
    ```sh
    read -rs "t?Jira token: " && printf 'add-generic-password -U -s "<item>" -a "<email>" -w %s\n' "$t" | security -i; unset t; echo
    ```
    That line is for zsh; in bash, use `read -rsp "Jira token: " t` instead of `read -rs "t?…"`.
  - **A token command** (`jira.tokenCommand` and `jira.email`): a command that prints the token from a
    password manager: `op read op://…`, `pass show …`, `secret-tool lookup …`. For non-macOS systems, or
    when they keep it there already. A token command, when set, wins over the Keychain item.
- **Check it** in Kelpie, not yourself: once it's saved, open the profile's Jira page
  (`herdr-app do kelpie.edit-profile-jira`) and ask the person to press its Check button, which signs
  in with what they stored and says whether it worked and which board it found. Don't sign in for it.
- **Your part** (`jira.handover`, scope `handover`): the board column from which the person's part of a
  ticket is done (usually the first testing or review column). A story whose subtasks assigned to them
  are all in that column or further right waits on others, so it sinks to the end of their list.
  Find the board's columns through your own Jira access if you have it, else ask: after Check, the
  Jira page's "My part is done from column" lists them. Save the column's exact name. Unset, the layout picks the first column named like test,
  QA or verify, else the last.

### 3. GitHub

- **Owner** (`github.owner`): the organisation (or user) whose repositories hold the work. Find it
  through your own GitHub access if you have it (their organisations, where their pull requests are),
  else ask. Kelpie reads GitHub through the GitHub CLI, signed in as the person (`gh auth login`, in a
  terminal of theirs): the GitHub page's Check button says whether it finds their pull requests.
- **Notifications** (`notify.pulls`, default true): a notification when one of their pull requests
  starts failing checks, gets changes requested, or becomes ready to merge.

### 4. Web

- **Start page** (`web.home`): what the profile's browser opens on: often the team's chat
  or a dashboard (a full `https://…` address). Empty: a blank page. The Web panel needs
  `terminal-browser` installed; if `command -v terminal-browser` finds nothing, say so.

### 5. Story commands

All optional. Each runs through the person's shell in the profile's folder, with `{key}` replaced by
a ticket key (`ABC-123`). The leftovers check and clean-up run **once per key of a story: its own and
each of its subtasks'**, as work is often done under a subtask's key, so a command only ever deals with
the one key it's given: never look up a story's subtasks yourself. The status command gets the story's
key. First look at how the folder is laid out: clones, worktrees, folders per ticket (a folder named
exactly after a key, one or two levels down, is a convention the layout already understands). Then ask
what should count before writing anything. Simple commands can be inline; longer ones belong in a script
the person keeps (ask where). Try each on a real key before saving.

**What these commands print is yours to shape: its content and its wording.** The layout knows nothing
about the person's tools, so it can't pick out what matters from a tool's raw output and never tries:
it shows the lines as they come (a list in the clean-up dialog, a note after a clean-up, a line in the
story header). It only tidies the leftovers check's lines (paths under the profile's folder become
relative, the home folder becomes `~`, runs of spaces become one); the clean-up's result and the status
line are shown exactly as printed. So:

- **Human readable**: print for a person, not for a program: what it is, briefly (`worktrees/ABC-123`, `worktree with 3
  repos`, `branch feature/x`, `dev server on :3000`), with no table rows, ids, column padding, colour
  codes or progress output.
- When a tool prints more, keep only the useful part: its own output options first (a `--format`,
  `--porcelain`, `--no-color`, a quiet flag), else `awk`, `cut` or `sed`.
- Send noise you don't need to `/dev/null`, but keep real errors where they help the person.
- Show the person a sample of the final lines before saving, and adjust the wording with them.

- **Leftovers check** (`commands.leftovers`, scope `leftovers`): prints what a finished story (done, or
  every pull request merged) left behind (its worktrees, branches, ticket folder), **one human-readable line each, and
  nothing when there's nothing** for the key it's given. It runs for each key of each finished story
  every couple of minutes with 10 seconds to finish, so it must be fast and read-only. While it prints
  something for any of a story's keys, the story shows a broom. Unset, a folder named after one of its
  keys counts as a leftover. Each line becomes an item in the clean-up dialog's list of what will go
  (beside its key when that's a subtask's), so one leftover per line, said briefly.
- **Clean-up** (`commands.cleanUp`, scope `cleanUp`): removes what the check prints. Pressing the
  broom asks first, closes the story's space, then runs this for each key the check found something
  under, 25 seconds each. It must be safe: never delete uncommitted or unpushed work, say so instead.
  Its last line (each key's, when there are several) is the result the person reads, so end with a
  short summary (`removed worktrees/ABC-123`, or why it refused), not a tool's last progress line.
  Afterwards the check runs again, so the broom goes once nothing's left.
- **Status** (`commands.status`, scope `status`): while a story has a space, the first line this
  prints shows in its header (a dev server's state, say), refreshed every few minutes. It has 4 seconds.
  Keep that line short and plain: it's a status, read at a glance (`dev server running on :3000`).

### 6. Prompts

The defaults are in `<mod>/config.js` (`DEFAULT_PROMPT`, `DEFAULT_REVIEW_PROMPT`,
`DEFAULT_MERGE_PROMPT`, `DEFAULT_APPROVAL_PROMPT`). Change one only when the person wants agents to work
differently: a slash command or skill they use for tickets, their merge or deploy steps, who approves.
A line whose placeholders all come out empty is left out.

| Key | When it's sent | Placeholders |
|---|---|---|
| `jira.prompt` | An agent started on a ticket | `{key} {summary} {url} {type} {status} {parent} {subtasks}` |
| `jira.orchestrator` | Set, a story offers Start orchestrator: one agent running all its subtasks. No default | same as above |
| `github.reviewPrompt` | Start review, in a worktree of the pull request | `{url} {repo} {number} {title} {author} {folder} {ticket} {summary} {description}` |
| `github.mergePrompt` | The Merge icon on a story's pull requests | `{ticket} {summary} {prs}`: `{prs}` a line per open pull request |
| `github.approvalPrompt` | Request approval, while a pull request isn't approved | same as merge; `{prs}` only the unapproved |
| `prompts.suggest` | Conjure what's next, the magic button under Next: a Claude in the background filling Next's queue with suggestions (default `SUGGEST_PROMPT`) | `{name} {snapshot} {board} {owner}`: `{snapshot}` what the list knows, `{board}` the board's address. It runs in the background (`claude -p`), so its answer must end in the JSON block of picks the default asks for (keep that part). It says what to look at, never how to sign in: the agent uses its own access |

`jira.*` prompts are saved only while Jira is connected, and `github.*` ones only while GitHub is. For `prompts.suggest`, ask what kind of work the person picks up (frontend, say) and add it, so unassigned tickets of that kind are pointed out.

### 7. Messages

Sent to an agent already working on a pull request when a button is pressed (`prompts.<id>`; defaults
in `ASK_PROMPTS` in `<mod>/config.js`). `{prs}` is the pull request's link, several joined by "and".

| Id | Button |
|---|---|
| `fix` | Fix checks |
| `comments` | Address comments |
| `merge` | Merge |
| `post` | Post comments (on a review) |
| `approve` | Approve (on a review) |
| `changes` | Request changes (on a review) |
| `idea` | A click on one of What next?'s improvement ideas: starts a Claude on the Desk. `{idea}` Claude's brief, `{where}` the file or area, `{why}` why it pays off |

`prompts.configure` is the message that started you; leave it alone unless asked.

## Finishing

Sum up in a few lines: what you saved (setting and value, never a secret), what you checked, and what's
still open (e.g. "Jira sign-in: run the Keychain line, then I'll check it"). If you wrote scripts, say
where. Suggest reopening the profile dialog to review.
