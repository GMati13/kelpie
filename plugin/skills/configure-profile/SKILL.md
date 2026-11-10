---
name: configure-profile
description: Set up a Kelpie profile with the person — its folder, Claude account, Jira board and sign-in, GitHub owner, Web start page, agent prompts, button messages and story commands — and save it through Kelpie's own tools. Use this whenever a message says "Configure my Kelpie profile" (Kelpie's "Let me configure it for you" sends that, naming the profile and a scope), and whenever the person asks to set up, change, fix or check anything in a Kelpie profile, connect Kelpie to Jira or GitHub, or write a leftovers, clean-up or status command for their stories.
---

# Configuring a Kelpie profile

Kelpie is a Herdr layout built around **profiles**: one per area of work (a team, a client, personal projects). The person pressed **Let me configure it for you** in Kelpie's profile dialog, or asked you directly. The message names the **profile** (name and id) and a **scope**: everything (`all`) or one page or setting (see [Scopes](#scopes)).

Your job: find the right values *with the person*, check them where you can, save them, and say what changed. Do only the scope you were given; at the end, mention anything else that looks unset or wrong.

The Kelpie plugin gives you the tools for this: `get_profile` reads what's saved, `save_profile` saves a change (Kelpie checks it as its dialog's Save would), `save_status` reads Kelpie's answer again, and `open_profile_page` opens the profile dialog on a page. They're the only way to change a profile: Herdr owns the file profiles live in and would overwrite an edit made around it.

## Ground rules

- **Talk first, save second.** Look around and propose values, then save once the person agrees. Saving a page at a time is fine.
- **Secrets never pass through you.** Never ask for, read, print, store or pass on an API token, a password or a token command's output. Sign-in is a Keychain item the person fills in in a terminal of their own, or a token command (one that prints the token, like `op read …`) that only Kelpie runs; don't run one yourself. That way a token never lands in a transcript.
- **Your own access, never Kelpie's.** Look things up in Jira, GitHub or anywhere else only through the access your own setup gives you (your MCP servers, plugins, tools and permissions). Kelpie's own scripts and the person's Kelpie sign-in aren't a way around your setup: never run them to fetch data. When you can't reach something, say so and ask the person (a board address, a column name, an organisation); that's how it's meant to work.
- **Read-only exploring.** Listing folders and reading `git` status are fine, and so is reading through your own access. Anything that changes something (writing scripts, deleting, moving) needs the person's yes.
- **Nothing personal goes into Kelpie itself.** Settings live in the profile. Scripts the person wants go where they say (their dotfiles, a scripts folder in the profile's folder), never into Kelpie's folder.
- **What the profile says is yours; how it's shown is Kelpie's.** Kelpie is the same for everyone and knows nothing about the person's tools: it lays out lists, notes and headers, but each line's content and wording (what a command prints, what a prompt says) comes from the settings you write. Make them **human readable**: plain words a person understands at a glance, not raw tool output.
- **Keep it short.** One question at a time; offer a choice when you can guess the likely answers.

## What a profile holds

| Setting | What it does |
|---|---|
| Name | What the profile picker shows. |
| Folder | Agents start here. Every Herdr space opened in it (or below) belongs to the profile, and earlier Claude sessions started here show in its sidebar. Usually the folder holding the clones of the work's repositories. |
| Claude account | Which Claude Code config folder (`~/.claude`, `~/.claude-work`…) the profile's new agents run on, as `CLAUDE_CONFIG_DIR`, keeping work and personal accounts apart. |
| Jira | Optional. A Jira Cloud board: the sidebar lists the person's **stories** (their issues in the active sprints, or a Kanban board's open work), and starting one opens a Herdr space named after its key with an agent in it. |
| GitHub | Optional. An owner (organisation or user): the sidebar lists the person's open pull requests and the ones waiting on their review, attached to stories by the ticket key in their titles. |
| Web | The Web panel's start page. Each profile has its own browser, with its own sign-ins. |
| Prompts | The first message each kind of agent gets: on a ticket, an orchestrator, a review, a merge, an approval request, What next?. Each has a default. |
| Messages | What the pull request and review buttons (Fix checks, Merge, Approve…) send to an agent that's already working. Each has a default. |
| Story commands | Optional shell commands for a story: a leftovers check and a clean-up for finished stories, a status line for stories in progress. |

The **Desk** is the profile's space for work without a ticket; that's usually where you are.

## Reading and saving

- `get_profile` with the id shows what's saved; without, every profile's id, name and folder. Fields that aren't in the dialog (`sources`, `seen`) are old or internal: leave them.
- `save_profile` takes `id` and `set`, only what changes:
  - Top-level keys: `name`, `folder`, `jira`, `github`, `commands`, `prompts`, `notify`, `claude`, `web`; nothing else.
  - `name` and `folder` replace the old value. A section given as an object is **merged**: keys you leave out stay. A key set to `null` is removed; a section set to `null` is removed whole (disconnecting Jira, say).
  - Values are strings, except `jira.board` (a number), `notify.pulls` (true/false) and `null`s. Keys that look like secrets are refused.
  - `jira.url` must be a Jira Cloud board (`https://<name>.atlassian.net/…/boards/<n>`): `jira.site` and `jira.board` are filled in from it. A Jira section needs `keychain`, or `tokenCommand` with `email`; the email takes no quotes, backslashes or spaces. A `github` section needs `owner`. `web.home` starts with `https://` or `http://`.
  - A prompt or message equal to its default needn't be saved: `null` goes back to the default.
  - An id that doesn't exist yet makes a new profile; it needs `name` and `folder`.
- **Some changes wait for the person's yes.** Whatever can run a command or steer agents (`commands`, `prompts`, the `github` prompts, `claude`, `jira.tokenCommand`), decide where the Jira sign-in goes or which one (`jira.url`, `jira.email`, `jira.keychain`), or open a page (`web`) is shown to the person in Kelpie, and only their click saves it. `save_profile` then says it's waiting: tell them to look at Kelpie, and call `save_status` after they've answered. Nothing else in that change is saved meanwhile, so send other settings in a change of their own. You can't confirm it for them, and shouldn't try: that click is what keeps a misled agent from changing what runs on their machine.
- If a tool says Kelpie can't be reached, Herdr isn't showing a Kelpie layout: ask the person to show it, then try again.

## Scopes

| Scope | Covers |
|---|---|
| `all` | Everything, in the order below |
| `general` | Name, folder, Claude account |
| `jira` | Board, sign-in, your part (the handover column) |
| `jira-signin` | Jira sign-in only |
| `handover` | Your part (the handover column) only |
| `github` | Owner, pull request notifications |
| `web` | Start page |
| `prompts` | The prompts |
| `messages` | The button messages |
| `commands` | Leftovers check, clean-up, status |
| `leftovers` / `cleanUp` / `status` | That story command only |

## Setting up, from A to Z

For `all`, go in this order, skipping what the person doesn't use: ask early whether they use Jira and GitHub for this work.

### 1. General

- **Name** (`name`): what this work is called, e.g. the team or client. Short.
- **Folder** (`folder`): an absolute path. Does the current one hold the work's repos (git clones, directly or one level down)? Too broad (the home folder) makes every space this profile's; too narrow misses repos. Suggest the closest folder holding all of them.
- **Claude account** (`claude.config`): the candidates are the `~/.claude*` folders with a `settings.json` or `projects/` (`ls -d ~/.claude*`). No `claude` section means Claude's own `~/.claude`. Ask which account this work runs on; it affects new agents only, resumed sessions keep theirs. The Kelpie plugin must be installed on that account too, for this setup to work from it.

### 2. Jira

Jira Cloud only (`https://<name>.atlassian.net`). Server and Data Center sign in differently: say so and stop if that's what they use.

- **Board** (`jira.url`): the board's address as the browser shows it, ending in `/boards/<number>` (e.g. `https://acme.atlassian.net/jira/software/c/projects/ABC/boards/12`). Ask them to paste it.
- **Sign-in** (scope `jira-signin`): an API token, which the person makes at id.atlassian.com → Security → API tokens. Two ways to keep it:
  - **macOS Keychain** (`jira.keychain`, a name of their choosing, e.g. `jira-acme`; the item's account is their Jira email). Give them this to run **in a terminal of their own**, with their item name and email. It reads the token hidden, as `security`'s own prompt cuts tokens at 128 characters and Atlassian's are longer:
    ```sh
    read -rs "t?Jira token: " && printf 'add-generic-password -U -s "<item>" -a "<email>" -w %s\n' "$t" | security -i; unset t; echo
    ```
    That's zsh; in bash, `read -rsp "Jira token: " t` instead of `read -rs "t?…"`.
  - **A token command** (`jira.tokenCommand` and `jira.email`): one that prints the token from a password manager (`op read op://…`, `pass show …`, `secret-tool lookup …`). For systems without the Keychain, or when it's kept there already. Set, it wins over the Keychain item.
- **Check it** in Kelpie, not yourself: once saved, `open_profile_page` with `jira` and ask the person to press Check. It signs in with what they stored and says whether it worked and which board it found.
- **Your part** (`jira.handover`, scope `handover`): the board column from which the person's part of a ticket is done (usually the first testing or review column). A story whose subtasks assigned to them are all there or further right waits on others, so it sinks to the end of their list. Find the board's columns through your own Jira access if you have it, else ask: after Check, the Jira page's "My part is done from column" lists them. Save the column's exact name. Unset, Kelpie picks the first column named like test, QA or verify, else the last.

### 3. GitHub

- **Owner** (`github.owner`): the organisation (or user) whose repositories hold the work. Find it through your own GitHub access if you have it (their organisations, where their pull requests are), else ask. Kelpie reads GitHub through the GitHub CLI signed in as the person (`gh auth login`, in a terminal of theirs); the GitHub page's Check button (`open_profile_page` with `github`) says whether it finds their pull requests.
- **Notifications** (`notify.pulls`, default true): a notification when one of their pull requests starts failing checks, gets changes requested, or becomes ready to merge.

### 4. Web

- **Start page** (`web.home`): what the profile's browser opens on, often the team's chat or a dashboard (a full `https://…` address); empty, a blank page. The Web panel needs `terminal-browser`; if `command -v terminal-browser` finds nothing, say so.

### 5. Story commands

All optional. Each runs through the person's shell in the profile's folder, with `{key}` replaced by a ticket key (`ABC-123`). The leftovers check and clean-up run **once per key of a story: its own and each of its subtasks'**, as work is often done under a subtask's key, so a command only ever deals with the key it's given: never look up a story's subtasks yourself. The status command gets the story's key.

First look at how the folder is laid out: clones, worktrees, folders per ticket (a folder named exactly after a key, one or two levels down, is a convention Kelpie already understands). Then ask what should count before writing anything. Simple commands can be inline; longer ones belong in a script the person keeps (ask where). Try each on a real key before saving.

**What these commands print is shown as it comes**: Kelpie can't pick out what matters from a tool's raw output, so it never tries. It shows the lines in the clean-up dialog's list, a note after a clean-up, a line in the story header; it only tidies the leftovers check's lines (paths under the profile's folder relative, the home folder as `~`, runs of spaces as one). So:

- **Print for a person**: what it is, briefly (`worktrees/ABC-123`, `worktree with 3 repos`, `branch feature/x`, `dev server on :3000`); no table rows, ids, column padding, colour codes or progress output.
- When a tool prints more, keep only the useful part: its own output options first (`--format`, `--porcelain`, `--no-color`, a quiet flag), else `awk`, `cut` or `sed`. Send noise to `/dev/null`, but keep real errors where they help.
- Show the person a sample of the final lines before saving, and adjust the wording with them.

- **Leftovers check** (`commands.leftovers`): prints what a finished story (done, or every pull request merged) left behind (worktrees, branches, a ticket folder), **one line each, nothing when there's nothing**. It runs for each key of each finished story every couple of minutes with 10 seconds to finish, so it must be fast and read-only. While it prints something, the story shows a broom; each line becomes an item in the clean-up dialog's list. Unset, a folder named after one of the keys counts as a leftover.
- **Clean-up** (`commands.cleanUp`): removes what the check prints. The broom asks first, closes the story's space, then runs this for each key the check found something under, 25 seconds each. It must be safe: never delete uncommitted or unpushed work; say so instead. Its last line is what the person reads, so end with a short summary (`removed worktrees/ABC-123`, or why it refused). Afterwards the check runs again, so the broom goes once nothing's left.
- **Status** (`commands.status`): while a story has a space, the first line this prints shows in its header, refreshed every few minutes, with 4 seconds to run. Short and plain, read at a glance (`dev server running on :3000`).

### 6. Prompts

Change one only when the person wants agents to work differently: a slash command or skill they use for tickets, their merge or deploy steps, who approves. The profile dialog's Prompts page shows each default (`open_profile_page` with `prompts`). A line whose placeholders all come out empty is left out.

| Key | When it's sent | Placeholders |
|---|---|---|
| `jira.prompt` | An agent started on a ticket | `{key} {summary} {url} {type} {status} {parent} {subtasks}` |
| `jira.orchestrator` | Set, a story offers Start orchestrator: one agent running all its subtasks. No default | as above |
| `github.reviewPrompt` | Start review, with a checkout of the pull request | `{url} {repo} {number} {title} {author} {folder} {ticket} {summary} {description}` |
| `github.mergePrompt` | The Merge icon on a story's pull requests | `{ticket} {summary} {prs}` (a line per open pull request) |
| `github.approvalPrompt` | Request approval, while a pull request isn't approved | as merge; `{prs}` only the unapproved |
| `prompts.suggest` | What next? (the magic button under Next): a Claude in the background filling Next's queue | `{name} {snapshot} {board} {owner}`. It runs unattended, so its answer must end in the JSON block of picks the default asks for: keep that part |

`jira.*` prompts are kept only while Jira is connected, `github.*` ones only while GitHub is. For `prompts.suggest`, ask what kind of work the person picks up (frontend, say) and add it, so unassigned tickets of that kind are pointed out. Like every prompt, say what to look at or do, never how to reach Jira or GitHub: each agent uses its own access.

### 7. Messages

Sent to an agent already working on a pull request when a button is pressed (`prompts.<id>`; the Messages page shows the defaults). `{prs}` is the pull request's link, several joined by "and".

| Id | Button |
|---|---|
| `fix` | Fix checks |
| `comments` | Address comments |
| `merge` | Merge |
| `post` | Post comments (on a review) |
| `approve` | Approve (on a review) |
| `changes` | Request changes (on a review) |
| `idea` | One of What next?'s improvement ideas: starts a Claude on the Desk. `{idea}` the brief, `{where}` the file or area, `{why}` why it pays off |

`prompts.configure` is the message that started you; leave it alone unless asked.

## Finishing

Sum up in a few lines: what you saved (setting and value, never a secret), what you checked, and what's still open ("Jira sign-in: run the Keychain line, then press Check"). If you wrote scripts, say where. Suggest the person look over the profile dialog (`open_profile_page`).
