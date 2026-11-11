---
name: configure-profile
description: Set up a Kelpie profile with the person — its folder, the Claude and GitHub accounts it runs on, its board (a Jira board and sign-in, or a GitHub Project and its ticket keys), GitHub owner, Web start page, agent prompts, button messages and story commands — and save it through Kelpie's own tools. Use this whenever a message says "Configure my Kelpie profile" (Kelpie's "Let me configure it for you" sends that, naming the profile and a scope), and whenever the person asks to set up, change, fix or check anything in a Kelpie profile, connect Kelpie to Jira, a GitHub Project or GitHub, or write a leftovers, clean-up or status command for their stories.
---

# Configuring a Kelpie profile

Kelpie is a Herdr layout built around **profiles**: one per area of work (a team, a client, personal projects). The person pressed **Let me configure it for you** in Kelpie's profile dialog, or asked you directly. The message names the **profile** (name and id) and a **scope**: everything (`all`) or one page or setting (see [Scopes](#scopes)).

Your job: find the right values *with the person*, check them where you can, save them, and say what changed. Do only the scope you were given; at the end, mention anything else that looks unset or wrong.

The Kelpie plugin gives you the tools for this: `get_profile` reads what's saved, `save_profile` saves a change (Kelpie checks it as its dialog's Save would), `save_status` reads Kelpie's answer again, and `open_profile_page` opens the profile dialog on a page. They're the only way to change a profile: Herdr owns the file profiles live in and would overwrite an edit made around it.

## Ground rules

- **Talk first, save second.** Look around and propose values, then save once the person agrees. Saving a page at a time is fine.
- **Secrets never pass through you.** Never ask for, read, print, store or pass on an API token, a password or a token command's output. Sign-in is a Keychain item the person fills in in a terminal of their own, or a token command (one that prints the token, like `op read …`) that only Kelpie runs; don't run one yourself. That way a token never lands in a transcript. If the person pastes one anyway, don't repeat it, save it or pass it to any tool: tell them it's in this conversation now, so they should revoke it and make a new one, and store the new one the way below.
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
| Jira | Optional, the profile's **board**, or a GitHub Project instead (never both). A Jira Cloud board: the sidebar lists the person's **stories** (their issues in the active sprints, or a Kanban board's open work), and starting one opens a Herdr space named after its key with an agent in it. |
| GitHub Project | Optional, the other kind of board. A Project on github.com whose issues are the tickets: the person's issues in its current iteration (or all its open work) are the stories, their sub-issues the subtasks, its Status options the columns. Read and moved with the person's own GitHub sign-in, so there's no sign-in to set up here. |
| GitHub | Optional. An owner (organisation or user): the sidebar lists the person's open pull requests and the ones waiting on their review, attached to stories by the ticket key in their titles. Optionally the GitHub account Kelpie acts as for it, for people signed in to more than one. |
| Web | The Web panel's start page. Each profile has its own browser, with its own sign-ins. |
| Prompts | The first message each kind of agent gets: on a ticket, an orchestrator, a review, a merge, an approval request, What next?. Each has a default. |
| Messages | What the pull request and review buttons (Fix checks, Merge, Approve…) send to an agent that's already working. Each has a default. |
| Story commands | Optional shell commands for a story: a leftovers check and a clean-up for finished stories, a status line for stories in progress. |

The **Desk** is the profile's space for work without a ticket; that's usually where you are.

## Reading and saving

- `get_profile` with the id shows what's saved; without, every profile's id, name and folder. Fields that aren't in the dialog (`sources`, `seen`) are old or internal: leave them.
- `save_profile` takes `id` and `set`, only what changes:
  - Top-level keys: `name`, `folder`, `jira`, `project`, `github`, `commands`, `prompts`, `notify`, `claude`, `web`; nothing else.
  - `name` and `folder` replace the old value. A section given as an object is **merged**: keys you leave out stay. A key set to `null` is removed; a section set to `null` is removed whole (disconnecting Jira, say).
  - Values are strings, except `jira.board` and `project.number` (numbers), `notify.pulls` and either board's `solo` and `moveToDone` (true/false) and `null`s. Keys that look like secrets are refused.
  - `jira.url` must be a Jira Cloud board (`https://<name>.atlassian.net/…/boards/<n>`): `jira.site` and `jira.board` are filled in from it. A Jira section needs `keychain`, or `tokenCommand` with `email`; the email takes no quotes, backslashes or spaces. `project.url` must be a GitHub Project's address (`https://github.com/users/<login>/projects/<n>` or `https://github.com/orgs/<org>/projects/<n>`; a view after it is fine): `project.owner`, `project.ownerType` and `project.number` are filled in from it, so send the address alone. `project.prefixes` is `owner/repo=PREFIX`, several separated by commas. A `github` section needs `owner`. `web.home` starts with `https://` or `http://`.
  - **One board.** A profile has `jira` or `project`, never both: a change that leaves both is refused. To move from one to the other, set the old one to `null` in the same change, and carry over what the person wants to keep (`prompt`, `orchestrator`, `handover`, `solo`, `moveToDone`) into the new section, as the profile dialog does.
  - A prompt or message equal to its default needn't be saved: `null` goes back to the default.
  - An id that doesn't exist yet makes a new profile; it needs `name` and `folder`.
- **Some changes wait for the person's yes.** Whatever can run a command or steer agents (`commands`, `prompts`, either board's `prompt` and `orchestrator`, the `github` prompts and `github.account`, `claude`, `jira.tokenCommand`), decide where the Jira sign-in goes or which one (`jira.url`, `jira.email`, `jira.keychain`), decide which tickets show and the keys made from them (`project.url`, `project.owner`, `project.ownerType`, `project.number`, `project.prefixes`: keys go into story commands and folder names), or open a page (`web`) is shown to the person in Kelpie, and only their click saves it. The rest (`name`, `folder`, `github.owner`, either board's `handover`, `solo` and `moveToDone`, `notify`) is saved at once. `save_profile` then says it's waiting: tell them to look at Kelpie, and call `save_status` after they've answered. Nothing else in that change is saved meanwhile, so send other settings in a change of their own. You can't confirm it for them, and shouldn't try: that click is what keeps a misled agent from changing what runs on their machine.
- If a tool says Kelpie can't be reached, Herdr isn't showing a Kelpie layout: ask the person to show it, then try again.

## Scopes

| Scope | Covers |
|---|---|
| `all` | Everything, in the order below |
| `general` | Name, folder |
| `agents` | The accounts agents run on: Claude account |
| `claude` | Claude account only |
| `jira` | Jira: board, sign-in, your part (the handover column) |
| `jira-signin` | Jira sign-in only |
| `project` | GitHub Project: address, ticket keys, your part (the handover column) |
| `handover` | Your part on the board (the handover column) only, whichever board it is |
| `github` | Owner, GitHub account, pull request notifications |
| `web` | Start page |
| `prompts` | The prompts |
| `messages` | The button messages |
| `commands` | Leftovers check, clean-up, status |
| `leftovers` / `cleanUp` / `status` | That story command only |

## Setting up, from A to Z

For `all`, go in this order, skipping what the person doesn't use. Ask early where this work's tickets live (a Jira board, a GitHub Project, or neither) and whether they use GitHub for its pull requests: a profile has one board at most, and without one the sidebar lists the profile's spaces and agents instead of stories.

### 1. General

- **Name** (`name`): what this work is called, e.g. the team or client. Short.
- **Folder** (`folder`): an absolute path. Does the current one hold the work's repos (git clones, directly or one level down)? Too broad (the home folder) makes every space this profile's; too narrow misses repos. Suggest the closest folder holding all of them.

### 2. Agents

The accounts the profile's agents run on, a section each on the dialog's Agents page (`open_profile_page` with `agents`). For now that's Claude's; the GitHub account is on the GitHub page (below), as it goes with the owner.

- **Claude account** (`claude.config`, scope `claude`; the page also guides adding an account): the candidates are the `~/.claude*` folders with a `settings.json` or `projects/` (`ls -d ~/.claude*`). No `claude` section means Claude's own `~/.claude`. Ask which account this work runs on; it affects new agents only, resumed sessions keep theirs. With several accounts, a folder of each (`CLAUDE_CONFIG_DIR=~/.claude-work claude`, signed in once) is what makes them pickable here; the README's "Several accounts" guides both this and the GitHub account. The Kelpie plugin must be installed on that account too, for this setup to work from it.

### 3. The board: Jira or a GitHub Project

One or the other, both on the profile dialog's Board page (`open_profile_page` with `board`; `jira` or `project` open it too, `project` on the GitHub Project's form when the profile has no Jira). If they use neither, skip to GitHub.

#### Jira

Jira Cloud only (`https://<name>.atlassian.net`). Server and Data Center sign in differently: say so and stop if that's what they use.

- **Board** (`jira.url`): the board's address as the browser shows it, ending in `/boards/<number>` (e.g. `https://acme.atlassian.net/jira/software/c/projects/ABC/boards/12`). Ask them to paste it.
- **Sign-in** (scope `jira-signin`): an API token, which the person makes at id.atlassian.com → Security → API tokens. Two ways to keep it:
  - **macOS Keychain** (`jira.keychain`, a name of their choosing, e.g. `jira-acme`; the item's account is their Jira email). Give them this to run **in a terminal of their own**, with their item name and email. It reads the token hidden, as `security`'s own prompt cuts tokens at 128 characters and Atlassian's are longer:
    ```sh
    read -rs "t?Jira token: " && printf 'add-generic-password -U -s "<item>" -a "<email>" -w %s\n' "$t" | security -i; unset t; echo
    ```
    That's zsh; in bash, `read -rsp "Jira token: " t` instead of `read -rs "t?…"`.
  - **A token command** (`jira.tokenCommand` and `jira.email`): one that prints the token from a password manager (`op read op://…`, `pass show …`, `secret-tool lookup …`). For systems without the Keychain, or when it's kept there already. Set, it wins over the Keychain item.
- **Check it** in Kelpie, not yourself: once the sign-in is in place (saved, or stored by the person in their own terminal), ask them to press Check on the Board page (`open_profile_page` with `jira`), rather than only offering to: it's the step that tells them it works. It signs in with what they stored and says whether it worked and which board it found.

#### GitHub Project

For work tracked as GitHub issues on a GitHub Project (a Project on github.com). The Project's issues become Kelpie's tickets, so stories, subtasks, starting work and moving a ticket's status work as with Jira.

- **Address** (`project.url`): the Project's address as the browser shows it, `https://github.com/users/<login>/projects/<number>` or `https://github.com/orgs/<org>/projects/<number>` (a view after it, `/views/2`, is fine). Find it through your own GitHub access if you have it (the Projects of their organisation or their own), else ask them to open the Project and paste the address. The owner, its kind and the number come from it.
- **No sign-in of its own, and nothing secret.** Kelpie reads and moves the Project's tickets with the person's own GitHub CLI sign-in, as the profile's GitHub account (`github.account`, section 4; unset, the account gh has active). If they have more than one GitHub account, settle which one first: the Project must be visible to it.
- **Moving tickets needs gh's `project` scope**; `read:project` only reads. The Board page's Check says which the sign-in has and, when it's missing, shows the command to add it. The person runs it in a terminal of their own (it opens a browser to confirm), as it changes their GitHub sign-in: give it to them, don't run it yourself.
- **Ticket keys** (`project.prefixes`): an issue's key is its repo's prefix and its number (`WEB-42` for issue #42 of `acme/web`), and names its space and ticket folder, as a Jira key does. A repo's prefix is its name in capitals with everything but letters and digits dropped (`my-app` gives `MYAPP`). A prefix is a capital letter, then capitals or digits, 2 to 20 in all, and no two repos may share one. Set one only where the repo's own doesn't suit: too long, a name that makes none (digits only, a single letter), or two repos that would clash. Save only those, as `owner/repo=PREFIX, owner/repo=PREFIX`. After a Check, the Board page lists the Project's repos with the prefix each gives. Changing a prefix later changes the keys, so ticket folders and branches named after the old keys stop matching: say so if they already have some.
- **Where stories come from**: the Project's current iteration, from its first iteration field; with no iteration field, the whole board (open work, plus work closed in the last 14 days), like a Kanban board. A story is the parent of an issue assigned to the person, else that issue itself; its sub-issues are its subtasks. The Status options are the columns: a closed issue or the last option counts as done, the first option or one named like Backlog, Todo or Ready as not started, the rest as in progress. Pull requests attach by a key in their title or by GitHub's closing link ("closes #42"). The status chip sets the Project's Status; an issue that isn't on the Project can't be moved.
- **Check it** in Kelpie: ask the person to press Check on the Board page (`open_profile_page` with `project`). It reads the Project as their GitHub account and says what it found (its columns and repos), where its stories come from, and whether Kelpie can move its tickets. A Project without a Status field has no columns: they add one on GitHub.

#### Your part

- **Your part** (`jira.handover` or `project.handover`, in whichever board the profile has; scope `handover`): the board column from which the person's part of a ticket is done (usually the first testing or review column). A story whose subtasks assigned to them are all there or further right waits on others, so it sinks to the end of their list. Find the columns through your own access to the board if you have it (a Project's columns are its Status options), else ask: after a Check, the Board page lists them to choose from. Save the column's exact name. Unset, Kelpie picks the first column named like test, QA or verify, else the last. It's saved at once, no confirmation needed.
- **I work alone** (`jira.solo` or `project.solo`, `true` or `false`, beside the handover column; scope `handover`): whether the person is the only one working on the board. Set, the stories past their part aren't said to wait on others, as nobody else has them: the list puts them under "Built" instead, and Request approval isn't offered, as nobody on the team approves. Ask them rather than guess from who tickets are assigned to. Off (the default) means they work with a team. It's saved at once.
- **Move to Done** (`jira.moveToDone` or `project.moveToDone`, `true` or `false`; scope `handover`): whether stories offer Move to Done, a double check in the story's header and on each built story in the list that moves the person's subtasks, then the story, to the board's last column in one go. On unless set to `false`: turn it off when the person's team moves tickets to done some other way (a release, a reviewer), and ask rather than guess. It's saved at once.

### 4. GitHub

- **Owner** (`github.owner`): the organisation (or user) whose repositories hold the work; with a GitHub Project as the board, usually the Project's own owner. Find it through your own GitHub access if you have it (their organisations, where their pull requests are), else ask. Kelpie reads GitHub through the GitHub CLI signed in as the person (`gh auth login`, in a terminal of theirs); the GitHub page's Check button (`open_profile_page` with `github`) says whether it finds their pull requests.
- **GitHub account** (`github.account`, optional): which of the GitHub accounts the person's GitHub CLI is signed in to Kelpie uses for this profile: whose pull requests show, and who approves from the review header. Ask only when they have more than one (a work and a personal account, say): without it Kelpie follows the CLI's active account, which another sign-in on the machine can switch, and then their pull requests seem to vanish. Ask which account this work is under; the GitHub page lists the signed-in accounts to pick from. It's a GitHub login name, nothing secret. Kelpie's own lists use it at once. For the `gh` in its agents and terminals to act as it too, the person's shell setup needs one line at its end, which puts Kelpie's own `gh` first in `PATH` (agents and terminals start with `KELPIE_GH_ACCOUNT` and `KELPIE_GH_BIN` set; that `gh` asks for the account's token on each run). Because it's on `PATH`, it also reaches programs started there that run `gh` themselves (scripts, Makefiles, a team's own tools), and gh's sign-in status there names that account. After it's saved, open the GitHub page (`open_profile_page` with `github`): it shows the line to copy and a Check my shell button, which tries `gh` both in the shell and in a program started from it, and says what's wrong if either acts as someone else. The shell setup is the person's own: add the line there only if they ask you to, and then have them press Check my shell. Without it, `gh` in their agents acts as whichever account gh has active, which can be someone else. Things worth telling them:
  - If they added the `gh()` shell function Kelpie gave before, the line replaces it: the function reached only the `gh` typed in the shell, so programs that run `gh` still acted as the active account.
  - The line goes last, after anything else in their setup that changes `PATH`, so nothing puts gh's own folder before it again. A `GH_TOKEN` their setup exports wins over any account, so Kelpie leaves it alone; Check my shell says so.
  - The line reaches agents started after it was added. A Claude already running, or a session resumed since, may still run its commands through the shell setup it read before, so start a new one to pick it up.
  - It helps to keep their main account the one gh has active (`gh auth switch --user <login>`, in a terminal of theirs; each account signed in with `gh auth login`, all in gh's own config). Then anything the line doesn't reach still acts as their main account. A second gh config folder (`GH_CONFIG_DIR`) doesn't keep accounts apart: gh keeps one active sign-in per host for every folder, so signing in there can replace the main one.
- **Notifications** (`notify.pulls`, default true): a notification when one of their pull requests starts failing checks, gets changes requested, or becomes ready to merge.

### 5. Web

- **Start page** (`web.home`): what the profile's browser opens on, often the team's chat or a dashboard (a full `https://…` address); empty, a blank page. The Web panel needs `terminal-browser`; if `command -v terminal-browser` finds nothing, say so.

### 6. Story commands

All optional. Each runs through the person's shell in the profile's folder, with `{key}` replaced by a ticket key (`ABC-123`). The leftovers check and clean-up run **once per key of a story: its own and each of its subtasks'**, as work is often done under a subtask's key, so a command only ever deals with the key it's given: never look up a story's subtasks yourself. The status command gets the story's key.

First look at how the folder is laid out: clones, worktrees, folders per ticket (a folder named exactly after a key, one or two levels down, is a convention Kelpie already understands). Then propose a first draft from what you found, the command itself with `{key}` and a sample of the line it would print for a real key, and ask whether that's what should count: a concrete draft is quicker to say yes to, or to correct, than an open question. Write no script and save nothing until they agree. A script a command runs is part of that command: Kelpie asks the person before an agent's change to a command is saved, but it can't see a change to the script behind it, so changing one of their scripts (even to fix it, even when they asked you to sort it out) waits for their yes to the change you show them. Simple commands can be inline; longer ones belong in a script the person keeps (ask where). Try each on a real key before saving.

**What these commands print is shown as it comes**: Kelpie can't pick out what matters from a tool's raw output, so it never tries. It shows the lines in the clean-up dialog's list, a note after a clean-up, a line in the story header; it only tidies the leftovers check's lines (paths under the profile's folder relative, the home folder as `~`, runs of spaces as one). So:

- **Print for a person**: what it is, briefly (`worktrees/ABC-123`, `worktree with 3 repos`, `branch feature/x`, `dev server on :3000`); no table rows, ids, column padding, colour codes or progress output.
- When a tool prints more, keep only the useful part: its own output options first (`--format`, `--porcelain`, `--no-color`, a quiet flag), else `awk`, `cut` or `sed`. Send noise to `/dev/null`, but keep real errors where they help.
- Show the person a sample of the final lines before saving, and adjust the wording with them.

- **Leftovers check** (`commands.leftovers`): prints what a finished story (done, or every pull request merged) left behind (worktrees, branches, a ticket folder), **one line each, nothing when there's nothing**. It runs for each key of each finished story every couple of minutes with 10 seconds to finish, so it must be fast and read-only. While it prints something, the story shows a broom; each line becomes an item in the clean-up dialog's list. Unset, a folder named after one of the keys counts as a leftover.
- **Clean-up** (`commands.cleanUp`): removes what the check prints. The broom asks first, closes the story's space, then runs this for each key the check found something under, 25 seconds each. It must be safe: never delete uncommitted or unpushed work; say so instead. Its last line is what the person reads, so end with a short summary (`removed worktrees/ABC-123`, or why it refused). Afterwards the check runs again, so the broom goes once nothing's left.
- **Merged means its changes are in main, not its commits.** Pull requests are often squash- or rebase-merged, and work sometimes lands again through another branch, so a finished story's branch can hold commits main never got, though every change in them is there. `git branch --merged`, `git branch -d` and `git merge-base --is-ancestor` only see commits: they call that branch unmerged, a clean-up built on them keeps it, the leftovers check keeps printing it, and the broom never goes. So judge a branch by content, the same way in both commands (a branch the check calls merged must be one the clean-up removes):
  - merged when it's an ancestor of main, or main already has each of its patches (`git cherry <main> <branch>` prints no line starting `+`), or merging it into main would change nothing (`git merge-tree --write-tree <main> <branch>` succeeds and prints main's own tree, `git rev-parse '<main>^{tree}'`; Git 2.38 or later), which catches a squash;
  - look at the remote's main as well as the local one (`origin/main`, say): the local one is often behind, and the check mustn't fetch;
  - a command that fails (no such ref, an old Git) means not merged, never merged;
  - delete a branch that passes with `git branch -D`, since `-d` makes the commit-only check again. Anything else stays, and the line says why (`kept feature/x: 2 commits not in main`).
  Try it on one of their branches whose pull request was merged, and on one with work still to land, before saving.
- **A broom that stays** after cleaning up usually means the clean-up kept something, and its last line, which Kelpie shows in a note, says what and why. To find out more, run the leftovers check by hand on the key (it only reads; don't run the clean-up to see, it deletes) and read the command or script. The lasting fix is in the command; deleting what it kept by hand helps only this once. Propose the change and wait for a yes, as above.
- **Status** (`commands.status`): while a story has a space, the first line this prints shows in its header, refreshed every few minutes, with 4 seconds to run. Short and plain, read at a glance (`dev server running on :3000`).

### 7. Prompts

Change one only when the person wants agents to work differently: a slash command or skill they use for tickets, their merge or deploy steps, who approves. The profile dialog's Prompts page shows each default (`open_profile_page` with `prompts`). A line whose placeholders all come out empty is left out.

| Key | When it's sent | Placeholders |
|---|---|---|
| `jira.prompt` or `project.prompt` | An agent started on a ticket | `{key} {summary} {url} {type} {status} {parent} {subtasks}` |
| `jira.orchestrator` or `project.orchestrator` | Set, a story offers Start orchestrator: one agent running all its subtasks. No default | as above |
| `github.reviewPrompt` | Start review, with a checkout of the pull request | `{url} {repo} {number} {title} {author} {folder} {ticket} {summary} {description}` |
| `github.mergePrompt` | The Merge icon on a story's pull requests | `{ticket} {summary} {prs}` (a line per open pull request) |
| `github.approvalPrompt` | Request approval, while a pull request isn't approved | as merge; `{prs}` only the unapproved |
| `prompts.suggest` | What next? (the magic button under Next): a Claude in the background filling Next's queue | `{name} {snapshot} {board} {owner}`. It runs unattended; Kelpie adds how the picks come back (through its plugin) after this message, so the prompt needn't say it, and shouldn't ask for a JSON block or any other answer format |

The ticket prompts live in the board's section (`jira` or `project`, whichever the profile has), so they're kept only while a board is set; `github.*` ones only while GitHub is. For `prompts.suggest`, ask what kind of work the person picks up (frontend, say) and add it, so unassigned tickets of that kind are pointed out. Like every prompt, say what to look at or do, never how to reach the board or GitHub: each agent uses its own access.

### 8. Messages

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
| `picked` | Run all in Next: added after the ticket prompt for each of Claude's picks it starts. `{action}` what Claude suggests, `{why}` why now |

`prompts.configure` is the message that started you (`{name} {id} {scope} {about} {home}`); leave it alone unless asked.

## Finishing

Sum up in a few lines: what you saved (setting and value, never a secret), what you checked, and what's still open ("Jira sign-in: run the Keychain line, then press Check"). If you wrote scripts, say where. Suggest the person look over the profile dialog (`open_profile_page`).
