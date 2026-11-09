// Profiles: the setup of a piece of work (a team or client, say), kept in Herdr's shared state
// ("kelpie.profiles", by profile id), so it survives restarts and doesn't depend on any space. A space
// belongs to the profile whose folder it is in (the deepest one). Each profile has:
//   name     what it's called
//   folder   where its agents start and whose Claude sessions show
//   jira     { url, site, board, keychain, tokenCommand, email, prompt, orchestrator, handover }: a Jira
//            Cloud board URL pasted in setup, the Keychain item whose account is the Jira email and
//            password the API token (macOS), or instead a shell command that prints the token, with the
//            email beside it (any system; jira.sh keeps the token in pipes), the task
//            template for agents started on a ticket (none: DEFAULT_PROMPT), an optional one for an agent
//            that runs a whole story through its subtasks (none: no "Start orchestrator"), and the board
//            column from which your part of a ticket is done (none: handoverFrom() picks one)
//   github   { owner }: an organisation or user whose pull requests show
//   commands { leftovers, cleanUp, status }: optional shell commands run in its folder for a story
//            ({key} is its key; cleanUp was saved as wrapUp before): one printing what a finished
//            story left behind (its worktrees, say; nothing printed: nothing to clean), one when a
//            finished story is cleaned up (removing them), one whose first line
//            the story header shows (a dev server's state, say). None: nothing runs
//   claude   { config }: the Claude config folder (an absolute path, one of the ~/.claude* folders) its
//            new agents run on, as CLAUDE_CONFIG_DIR. None: Claude's own default, ~/.claude, with
//            nothing set. Resumes keep each session's own folder (resumeArgv in ui.js)
//   sources  which views it shows ("stories", ...); `seen` lists the ones there were when it was saved
// In a profile with Jira, a story becomes a space of its own when work on it starts (stories.js).
// The older per-space setups ("kelpie.spaces") become profiles the first time they're read.

import { appHome, exec, hc, openOverlay, panes, setShared, shared, spaces, run } from "herdr";
import { MOD, modFile } from "./ui.js";

const PROFILES = "kelpie.profiles";
const OLD = "kelpie.spaces";
const CHOSEN = "kelpie.profile.chosen"; // { id, space }: a profile picked in the menu, and the space shown then
const OWNED = "kelpie.space.profile"; // { space id: profile id }: spaces opened from a profile's New space
const LAST = "kelpie.profile.last"; // { profile id: space id, or null when shown beside another's space }: where a switch goes back to

export const shownSpace = () => spaces().find((s) => s.active) ?? null;

// Where a space is now: its focused terminal's folder, else its first terminal's, else where it began.
export function liveFolder(space) {
  if (!space) return null;
  const tabs = new Set(space.tabs.map((t) => t.id));
  const mine = panes().filter((p) => tabs.has(p.tab) && p.cwd);
  return mine.find((p) => p.focused)?.cwd ?? mine[0]?.cwd ?? space.folder ?? null;
}

const slug = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "profile";
const base = (folder) => String(folder ?? "").replace(/\/+$/, "").split("/").pop();

export function profiles() {
  let all = shared(PROFILES);
  if (!all) {
    // From per-space setups: one profile per folder, named after it.
    all = {};
    for (const s of Object.values(shared(OLD) ?? {})) {
      if (!s?.folder) continue;
      const name = base(s.folder).replace(/^./, (c) => c.toUpperCase());
      const id = slug(name);
      if (!all[id]) all[id] = { ...s, id, name };
    }
    setShared(PROFILES, all);
  }
  return Object.values(all).sort((a, b) => a.name.localeCompare(b.name));
}

export const profileById = (id) => profiles().find((p) => p.id === id) ?? null;

const inside = (folder, root) => Boolean(folder && root) && (folder === root || folder.startsWith(root.replace(/\/+$/, "") + "/"));

// The profile a space belongs to: the deepest one whose folder holds the folder the space began in.
// Where that's in no profile's, where it is now (an agent's `cd` mustn't move a story's space to
// another profile).
export function profileOf(space) {
  if (!space) return null;
  const owner = (shared(OWNED) ?? {})[space.id];
  const all = profiles();
  if (owner) { const p = all.find((x) => x.id === owner); if (p) return p; }
  const deepest = (folder) => all.filter((p) => inside(folder, p.folder)).sort((a, b) => b.folder.length - a.folder.length)[0] ?? null;
  return (space.folder ? deepest(space.folder) : null) ?? deepest(liveFolder(space));
}

// The profile the sidebar shows: the shown space's. A profile picked in the menu (one with no space
// open, say) counts only while the space shown then still is: another space shown, and it's that
// space's profile again (or none). A picked profile since deleted counts as not picked.
export function shownProfile() {
  const space = shownSpace();
  const chosen = shared(CHOSEN);
  const picked = chosen?.id && chosen.space === (space?.id ?? null) ? profileById(chosen.id) : null;
  return picked ?? profileOf(space);
}
// A profile with Jira picked in the menu while another profile's (or no profile's) space is shown: its
// stories show, not that space's terminals. One without Jira has no screen of its own to show.
export function profileElsewhere() {
  const p = shownProfile();
  return Boolean(p?.jira) && p.id !== profileOf(shownSpace())?.id;
}
// When the shown space closes, Herdr shows another, maybe another profile's: the profile that was
// shown stays (as if picked in the menu), so closing a story's last tab doesn't move you elsewhere.
// Called by syncTracking() (stories.js), from the always-shown footer only, so a hidden copy never
// misses a close; the result is shared ("kelpie.profile.chosen") for the rest to read.
let last = null; // { space, profile } shown at the last call
export function keepProfileOnClose(baseline = false) {
  const space = shownSpace();
  if (baseline) { last = { space: space?.id ?? null, profile: shownProfile()?.id ?? null }; return; }
  const gone = last && last.space !== (space?.id ?? null) && !spaces().some((s) => s.id === last.space);
  if (gone) {
    const owned = shared(OWNED) ?? {};
    const open = new Set(spaces().map((s) => s.id));
    if (Object.keys(owned).some((id) => !open.has(id))) setShared(OWNED, Object.fromEntries(Object.entries(owned).filter(([id]) => open.has(id))));
  }
  if (gone && last.profile && profileOf(space)?.id !== last.profile) {
    // A profile without stories shows its next open space; one with stories keeps the closed story
    // previewed (syncTracking() in stories.js), so it's only picked.
    const p = profileById(last.profile);
    const next = p && !p.jira ? spacesOf(p).find((s) => s.id !== last.space) : null;
    if (next) { run("space.select", { id: next.id }); last = { space: next.id, profile: p.id }; return; }
    setShared(CHOSEN, { id: last.profile, space: space?.id ?? null });
  }
  last = { space: space?.id ?? null, profile: (gone && last.profile) || shownProfile()?.id || null };
  // Where each profile was last seen, for switchProfile() to go back to: its own space, or null when
  // it was picked beside another profile's.
  const p = shownProfile();
  if (p) {
    const at = space && profileOf(space)?.id === p.id ? space.id : null;
    const seen = shared(LAST) ?? {};
    if (seen[p.id] !== at) setShared(LAST, { ...seen, [p.id]: at });
  }
}

export const chooseProfile = (id) => setShared(CHOSEN, id ? { id, space: shownSpace()?.id ?? null } : null);

// Show a profile as its menu row does: where it was last seen (its space then, or picked beside
// another's when it has stories), else one of its spaces when it has one open (the shown space when
// that's already its own), else just picked, its stories beside the space shown.
export function switchProfile(p) {
  const own = spacesOf(p);
  const seen = (shared(LAST) ?? {})[p.id];
  const back = seen ? own.find((s) => s.id === seen) : null;
  if (back) { chooseProfile(null); if (back.id !== shownSpace()?.id) run("space.select", { id: back.id }); }
  else if (seen === null && p.jira && profileOf(shownSpace())?.id !== p.id) chooseProfile(p.id);
  else if (profileOf(shownSpace())?.id === p.id) chooseProfile(null);
  else if (own[0]) { chooseProfile(null); run("space.select", { id: own[0].id }); }
  else chooseProfile(p.id);
}

// Opens a tab (tab.new's args) as the space's last. Herdr puts a new tab right after the shown one,
// so tabs came out in no order you could predict; tab.new returns nothing, so this waits (up to 3 s)
// for the tab that wasn't there before (by name when it has one) and moves it to the end.
// Returns null, as run() does.
export function newTab(args) {
  const space = spaces().find((s) => s.id === args.space) ?? spaces().find((s) => s.active);
  const before = new Set((space?.tabs ?? []).map((c) => c.id));
  run("tab.new", args);
  if (space) tabToEnd(space.id, before, args.name).catch(() => {});
  return null;
}

async function tabToEnd(id, before, name) {
  for (let waited = 0; waited <= 3000; waited += 100) {
    const space = spaces().find((s) => s.id === id);
    if (!space) return;
    const made = space.tabs.find((c) => !before.has(c.id) && (!name || c.name === name));
    if (made) {
      if (made.index < space.tabs.length) run("tab.move", { id: made.id, index: space.tabs.length });
      return;
    }
    await exec("sleep", ["0.1"]).catch(() => {});
  }
}

// A new space for the shown profile, which stays the profile's wherever its terminals go (a personal
// space may well work in another profile's folder): space.new returns nothing, so the space that
// shows up next is noted as the profile's (shared "kelpie.space.profile"). It starts in the shown
// space's own folder when that space is the profile's, else in the profile's folder.
export async function newSpace() {
  const p = shownProfile(), space = shownSpace();
  const folder = space && profileOf(space)?.id === p?.id ? liveFolder(space) : p?.folder;
  const before = new Set(spaces().map((s) => s.id));
  run("space.new", folder ? { folder } : {});
  if (!p) return;
  for (let waited = 0; waited <= 3000; waited += 150) {
    const made = spaces().find((s) => !before.has(s.id));
    if (made) return setShared(OWNED, { ...(shared(OWNED) ?? {}), [made.id]: p.id });
    await exec("sleep", ["0.15"]).catch(() => {});
  }
}

// The Desk: one space per profile for work without a ticket, always offered at the top of its
// sidebar. Shared "kelpie.desk" maps each profile to its Desk's space id; a space of the profile named
// "Desk" counts too (after a restart that changed ids, say). It's noted as the profile's like a New
// space, so it stays the profile's wherever its terminals go. Closed (its last tab), it opens again
// from the sidebar or ⌥⌘D.
const DESK = "kelpie.desk"; // { profile id: space id }
export const DESK_NAME = "Desk";
export function deskOf(profile) {
  if (!profile) return null;
  const id = (shared(DESK) ?? {})[profile.id];
  return spaces().find((s) => s.id === id) ?? spacesOf(profile).find((s) => s.name === DESK_NAME) ?? null;
}
export const isDesk = (space) => Boolean(space) && deskOf(profileOf(space))?.id === space.id;

// Shows the profile's Desk, opening it in the profile's folder when it isn't open (its first tab a
// Claude agent with no task, on the profile's account). With `tab` ({ name, folder, argv, task }),
// that tab opens in it instead (a resumed session, say). Resolves to the Desk's space id, null when
// a new one didn't show up in time.
export async function openDesk(profile = shownProfile(), tab = null) {
  if (!profile) return null;
  // A story previewed over the Desk would hide its terminals.
  const previews = shared(PREVIEWS) ?? {};
  if (previews[profile.id]) setShared(PREVIEWS, { ...previews, [profile.id]: null });
  const desk = deskOf(profile);
  if (desk) {
    if (tab) newTab({ space: desk.id, ...tab, folder: tab.folder ?? profile.folder });
    if (!desk.active) run("space.select", { id: desk.id });
    return desk.id;
  }
  const first = tab ?? { argv: claudeArgv(profile) };
  const folder = first.folder ?? profile.folder;
  const before = new Set(spaces().map((s) => s.id));
  run("space.new", { name: DESK_NAME, ...(folder ? { folder } : {}), ...(first.name ? { tab: first.name } : {}), ...(first.argv ? { argv: first.argv } : {}), ...(first.task ? { task: first.task } : {}) });
  for (let waited = 0; waited <= 3000; waited += 150) {
    const made = spaces().find((s) => !before.has(s.id));
    if (made) {
      setShared(OWNED, { ...(shared(OWNED) ?? {}), [made.id]: profile.id });
      setShared(DESK, { ...(shared(DESK) ?? {}), [profile.id]: made.id });
      return made.id;
    }
    await exec("sleep", ["0.15"]).catch(() => {});
  }
  return null;
}

// The Claude account (config folder) a profile's new agents run on: its own choice, else none:
// Claude's own default, ~/.claude, with nothing set.
export const claudeConfigOf = (profile) => profile?.claude?.config || null;
// Claude's own folder, ~/.claude, chosen by name: no CLAUDE_CONFIG_DIR at all, as set it would read its
// global config (.claude.json) and sign-in from elsewhere.
export const isOwnClaude = (dir) => base(dir) === ".claude";
// The argv that starts a new Claude agent for a profile (any extra arguments after "claude").
export function claudeArgv(profile, ...args) {
  const dir = claudeConfigOf(profile);
  if (!dir) return ["claude", ...args];
  return ["env", ...(isOwnClaude(dir) ? ["-u", "CLAUDE_CONFIG_DIR"] : [`CLAUDE_CONFIG_DIR=${dir}`]), "claude", ...args];
}
// The argv of a plain terminal for a profile: the user's own login shell, started with the profile's
// Claude account already chosen (CLAUDE_CONFIG_DIR set, or cleared for Claude's own ~/.claude) and
// CLAUDE_ACCOUNT_CHOSEN=1, so a `claude` typed there runs on the profile's account whatever the folder
// (a shell function choosing by folder should leave either alone).
export function shellArgv(profile) {
  const dir = claudeConfigOf(profile);
  const account = dir && !isOwnClaude(dir) ? `CLAUDE_CONFIG_DIR='${dir.replace(/'/g, "'\\''")}'` : "-u CLAUDE_CONFIG_DIR";
  return ["/bin/sh", "-c", `exec env ${account} CLAUDE_ACCOUNT_CHOSEN=1 "\${SHELL:-/bin/sh}" -l`];
}
// The same folder however it was written: "" for Claude's own (unset, or ~/.claude), else the path.
export const claudeKey = (dir) => (!dir || isOwnClaude(dir) ? "" : String(dir).replace(/\/+$/, ""));
// The ~/.claude* config folders on this machine (ones with settings or sessions), as absolute paths.
export async function claudeFolders() {
  const script = 'for d in "$HOME"/.claude*; do [ -d "$d" ] && { [ -f "$d/settings.json" ] || [ -d "$d/projects" ]; } && printf "%s\\n" "$d"; done; true';
  return (await exec("sh", ["-c", script])).stdout.split("\n").filter(Boolean);
}

// The spaces of a profile.
export const spacesOf = (profile) => (profile ? spaces().filter((s) => profileOf(s)?.id === profile.id) : []);

// The setup that applies to a space: its profile's.
export function savedSetup(space) {
  return profileOf(space);
}

export function saveProfile(id, profile) {
  const all = { ...(shared(PROFILES) ?? {}) };
  if (profile) all[id] = { ...profile, id }; else delete all[id];
  setShared(PROFILES, all);
  if (!profile && shared(CHOSEN)?.id === id) setShared(CHOSEN, null);
  if (!profile && (shared(DESK) ?? {})[id]) { const desks = { ...shared(DESK) }; delete desks[id]; setShared(DESK, desks); }
}

export const newProfileId = (name) => {
  const taken = new Set(profiles().map((p) => p.id));
  let id = slug(name), n = 2;
  while (taken.has(id)) id = `${slug(name)}-${n++}`;
  return id;
};

// The Hub's sources, in its strip's order, and what each needs set up.
export const SOURCE_IDS = ["stories", "sprint", "pulls", "sessions"];

// Which sources a space's Hub shows: its saved choice, else the ones it's set up for (Sessions needs
// only a folder, so it's on by default). A source added after the choice was saved (not in its
// `seen`) follows the default until the space's setup is saved again.
const byDefault = (id, saved) => (id === "stories" || id === "sprint" ? Boolean(saved?.jira) : id === "pulls" ? Boolean(saved?.github) : true);
export function sourcesOf(saved) {
  if (!Array.isArray(saved?.sources)) return SOURCE_IDS.filter((id) => byDefault(id, saved));
  const seen = saved.seen ?? ["sprint", "pulls", "sessions"];
  return SOURCE_IDS.filter((id) => saved.sources.includes(id) || (!seen.includes(id) && byDefault(id, saved)));
}

// What applies to a space: its profile's setup, with the live folder when it's in no profile.
export function setupOf(space, profile = profileOf(space)) {
  return { saved: Boolean(profile), profile, folder: profile?.folder || liveFolder(space), jira: profile?.jira ?? null, github: profile?.github ?? null, sources: sourcesOf(profile) };
}

// A Jira board URL, as the browser shows it: https://<site>/jira/software/.../boards/<id>.
export function parseBoard(url) {
  const m = /^(https:\/\/[^/\s]+)\/.*\/boards\/(\d+)/.exec((url ?? "").trim());
  return m ? { site: m[1], board: Number(m[2]) } : null;
}

// What the story list loaded, by profile (stories.js shares it): { [profile id]: { key, data, at, error } }.
export const STORIES = "kelpie.stories.data";
// The story previewed, by profile (stories.js): { [profile id]: story key, or "review:<repo>#<n>" }.
export const PREVIEWS = "kelpie.stories.preview";
// The board columns the list last loaded for a profile ({ name, statuses: [status id] }, left to right).
export const loadedColumns = (profile) => (shared(STORIES) ?? {})[profile?.id]?.data?.columns ?? [];

// The board column (an index into its columns, left to right) from which your part of a ticket is
// done and it waits on others: the profile's choice (jira.handover, a column name), else the first
// column that sounds like testing, else the board's last. -1 with no columns known.
export function handoverFrom(columns, name) {
  if (!columns?.length) return -1;
  const chosen = name ? columns.findIndex((c) => c.name === name) : -1;
  if (chosen >= 0) return chosen;
  const testing = columns.findIndex((c) => /test|qa|verif/i.test(c.name));
  return testing >= 0 ? testing : columns.length - 1;
}

// The task an agent started on a Jira ticket gets: the space's own template (jira.prompt), else this.
// Placeholders: {key} {summary} {url} {type} {status} {parent} (the story's key and summary, or empty)
// {subtasks} (a story's subtasks, a line each: "KEY — title (status)"; empty for a subtask).
// With `template`, that one instead (the orchestrator prompt).
export const PROMPT_FIELDS = ["key", "summary", "url", "type", "status", "parent", "subtasks"];
export const DEFAULT_PROMPT = "Work on Jira {key}: {summary}\n{url}";

export function jiraTask(jira, fields, template = jira?.prompt?.trim() ? jira.prompt : DEFAULT_PROMPT) {
  return template.replace(/\{(\w+)\}/g, (all, name) => (PROMPT_FIELDS.includes(name) ? fields[name] ?? "" : all)).trim();
}

// The task a review agent starts with: the profile's own template (github.reviewPrompt), else this.
// Placeholders: {url} {repo} {number} {title} {author} {folder} (where the pull request is checked
// out; empty when it couldn't be) {ticket} {summary} {description} (the ticket its title names, its
// summary and description as text; empty without one). A line whose placeholders all came out empty
// is left out, so "Ticket {ticket}: {summary}" goes when there's no ticket.
export const REVIEW_FIELDS = ["url", "repo", "number", "title", "author", "folder", "ticket", "summary", "description"];
export const DEFAULT_REVIEW_PROMPT = [
  "Review pull request {repo}#{number} by {author}: {title}",
  "{url}",
  "It's checked out at its latest commit in this folder: {folder}",
  "",
  "Ticket {ticket}: {summary}",
  "{description}",
  "",
  "Read the change against its base branch, run the checks the repository has, and check it does what the ticket asks, when there is one. Then list your findings, most important first, each with file and line, and draft the review comments. Don't post anything to GitHub, approve or request changes until I say so.",
].join("\n");

export function reviewTask(github, fields) {
  return fillLines(github?.reviewPrompt?.trim() ? github.reviewPrompt : DEFAULT_REVIEW_PROMPT, REVIEW_FIELDS, fields);
}

// The task a merge agent starts with (a story's heading under Your pull requests): the profile's
// own template (github.mergePrompt), else this. Placeholders: {ticket} {summary} (the story) and
// {prs}, its open pull requests of yours, a line each: "repo#n: title (state) url". Lines whose
// placeholders all came out empty are left out, as for reviews.
export const MERGE_FIELDS = ["ticket", "summary", "prs"];
export const DEFAULT_MERGE_PROMPT = [
  "Get {ticket}: {summary} ready to merge and deploy.",
  "Its open pull requests:",
  "{prs}",
  "",
  "For each one, check whether it's ready to merge: checks pass, reviews approved, no unresolved comments, up to date with its base branch, no conflicts, and nothing in the change that looks risky. Say what blocks each one that isn't ready.",
  "Then write a merge and deploy plan: the order to merge them in (what depends on what across repositories), what to do before and after each merge, how to deploy and check it worked, and how to roll back. Don't merge, push, comment or deploy anything until I say so.",
].join("\n");

export function mergeTask(github, fields) {
  return fillLines(github?.mergePrompt?.trim() ? github.mergePrompt : DEFAULT_MERGE_PROMPT, MERGE_FIELDS, fields);
}

// The task Request approval starts with (shown on a story's heading under Your pull requests while one
// of its open pull requests isn't approved): the profile's own template (github.approvalPrompt), else
// this. The same placeholders as merge, {prs} only the pull requests not approved yet.
export const DEFAULT_APPROVAL_PROMPT = [
  "Get approval for {ticket}: {summary}.",
  "These pull requests aren't approved yet:",
  "{prs}",
  "",
  "For each one, find out what it's waiting on: who's been asked to review it and who has, unresolved comments, failing checks, or no reviewer at all.",
  "Then suggest who to ask (from the repository's CODEOWNERS and recent reviewers) and draft a short, friendly message asking them to review, with the links. Don't request reviews, comment or post anything until I say so.",
].join("\n");

export function approvalTask(github, fields) {
  return fillLines(github?.approvalPrompt?.trim() ? github.approvalPrompt : DEFAULT_APPROVAL_PROMPT, MERGE_FIELDS, fields);
}

// The messages a pull request's buttons send to its agent, each changeable in the profile dialog
// (prompts.<id>; the default isn't saved). {prs}: the pull requests' links ("a and b"); a review's
// is its one pull request. "idea" is what a What next? idea starts a Desk agent with ({idea} {where}
// {why}; stories.js startIdea()).
export const ASK_PROMPTS = [
  { id: "fix", label: "Fix checks", text: "The checks fail on {prs}. Find out why and fix them." },
  { id: "comments", label: "Address comments", text: "Address the review comments on {prs}." },
  { id: "merge", label: "Merge", text: "Merge {prs}." },
  { id: "post", label: "Post comments (review)", text: "Post your review comments on the pull request now, as one GitHub review with inline comments on the lines they're about (event COMMENT), using gh. Then tell me what you posted." },
  { id: "approve", label: "Approve (review)", text: "Approve the pull request now, using gh, with a short summary as the review's body, and any comments we agreed on inline in the same review. Then tell me what you posted." },
  { id: "idea", label: "Start an idea (What next?)", text: "An idea for making things better, found while nothing else needed doing:\n\n{idea}\n\nWhere: {where}\nWhy: {why}\n\nLook into it with me first: is it worth doing, and how big is it? Don't change anything until I say so; if we go ahead, a ticket for it may come first." },
  { id: "changes", label: "Request changes (review)", text: "Submit your review on the pull request now as Request changes, using gh, with your findings as inline comments on the lines they're about and a short summary as the body. Then tell me what you posted." },
];

export function askText(profile, id, fields = {}) {
  const template = profile?.prompts?.[id]?.trim() || ASK_PROMPTS.find((a) => a.id === id).text;
  return template.replace(/\{(\w+)\}/g, (all, name) => (name in fields ? String(fields[name]) : all)).trim();
}

// What next? (the magic button in the story list's Next place): a Claude run in the background
// (claude -p, no terminal, no saved session; stories.js brew()) that looks at where everything stands
// and answers with picks for Next's queue as a JSON block. Its message is prompts.suggest (the default
// isn't saved). Placeholders: {name} (the profile), {snapshot} (what the list knows: sprints, stories,
// pull requests, reviews, agents; stories.js suggestSnapshot), {board} (the Jira board's address),
// {owner} (GitHub). It says what to look at, never how to reach or sign in to it: the agent uses
// whatever access its own setup gives it (its MCP servers, plugins, tools, and the permissions its
// settings allow), and where that falls short it says so. A line whose placeholders all come out
// empty is left out.
export const SUGGEST_FIELDS = ["name", "snapshot", "board", "owner"];
export const SUGGEST_PROMPT = [
  "Help me choose what to work on next in \"{name}\". Nothing needs me right now: no agent waiting on me, no failing checks or requested changes, no review asked of me, nothing to clean up.",
  "",
  "You run unattended: nobody will read your messages or answer questions, only the JSON block at the end of your answer.",
  "",
  "## Where things stand",
  "",
  "A snapshot from when I asked. Use it as a starting point; where Jira or GitHub say otherwise, trust them.",
  "",
  "{snapshot}",
  "",
  "## Your task",
  "",
  "1. Check the live state, reading only, with the access you already have. If something is out of reach, skip it and work with the rest.",
  "   - Jira, board {board}: the current sprint, then the backlog.",
  "   - GitHub ({owner}): open pull requests, mine and my team's.",
  "2. Rank what I could do on this ladder. Don't offer a lower rung while a higher one has something real:",
  "   1. Finish my own sprint work: my tickets to do or in progress; anything of mine that's blocked, and what would unblock it.",
  "   2. Help the sprint land: unassigned sprint tickets that fit the work I do (judge it from my own tickets and pull requests), teammates' pull requests waiting for a review, tickets that look done but weren't moved.",
  "   3. Get ahead: backlog tickets likely to come next that fit my work, and unclear ones worth asking about now. If no sprint is running, look at the next planned sprint first, then the backlog.",
  "   4. Only when 1 to 3 have nothing real, make things better: in the repositories under this folder that I've worked in lately, find 2 or 3 small, concrete improvements worth doing (flaky or slow tests, TODO or FIXME notes worth doing, outdated or vulnerable dependencies, missing docs or types, CI warnings, a small refactor near recent work). Each specific: the file or area, and why it pays off.",
  "3. Pick 3 to 5, best first. Name each the way my sidebar shows it: a story, or a task without a parent, by its own key; a subtask by its parent story's key (say which subtask in why). One per story, never two for the same one. Improvements from rung 4 have no ticket: they're ideas.",
  "4. End your answer with the picks as one JSON block, nothing after it:",
  "   ```json",
  "   {\"items\": [",
  "     {\"key\": \"ABC-123\", \"action\": \"Pick up ABC-123: short title\", \"why\": \"one line on why now\"},",
  "     {\"url\": \"https://github.com/org/repo/pull/45\", \"action\": \"Review repo#45\", \"why\": \"...\"},",
  "     {\"idea\": \"what to do, as a short brief for an agent\", \"where\": \"repo/path\", \"action\": \"Speed up the slow auth tests\", \"why\": \"...\"}",
  "   ]}",
  "   ```",
  "   `action` is what my Next queue shows: a verb first, under 60 characters. `why` is one short line. Ideas only from rung 4, and only then.",
  "",
  "## Rules",
  "",
  "- Read only. Don't assign, move, comment, review, merge, push, edit files or start any work.",
].join("\n");

export function suggestText(profile, fields) {
  return fillLines(profile?.prompts?.suggest?.trim() || SUGGEST_PROMPT, SUGGEST_FIELDS, fields);
}

// Fills a prompt template's {placeholders} of `names`, dropping a line whose placeholders all came out
// empty (others are left as written).
function fillLines(template, names, fields) {
  return template.split("\n").flatMap((line) => {
    const used = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((n) => names.includes(n));
    if (used.length && used.every((n) => !String(fields[n] ?? "").trim())) return [];
    return [line.replace(/\{(\w+)\}/g, (all, name) => (names.includes(name) ? String(fields[name] ?? "") : all))];
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// "Let me configure it for you": a new Claude on the profile's Desk that reads the setup guide
// (guides/profile-setup.md, for agents: every setting, how to find and check its value, how to save
// it through kelpie.apply-profile) and sets up a scope with the person. Scopes: the guide's table.
export const CONFIGURE_SCOPES = {
  all: "everything, from A to Z",
  general: "General: name, folder, Claude account",
  jira: "Jira: board, sign-in, your part",
  "jira-signin": "Jira sign-in only",
  handover: "Jira: your part (the handover column) only",
  github: "GitHub: owner, notifications",
  web: "Web: start page",
  prompts: "Prompts",
  messages: "Messages",
  commands: "Story commands: leftovers check, clean-up, status",
  leftovers: "Story commands: leftovers check only",
  cleanUp: "Story commands: clean-up only",
  status: "Story commands: status only",
};
// The message it starts with (prompts.configure; the default isn't saved). Placeholders: {name} {id}
// (the profile), {scope} (its id) and {about} (what it covers), {guide} (the guide's path), {home}
// (Herdr's app folder).
export const CONFIGURE_PROMPT = [
  "Configure my Kelpie profile \"{name}\" (id {id}). Scope: {scope} ({about}). Herdr's home: {home}",
  "",
  "Read {guide} first and follow it: it explains every setting, how to find the right values with me, how to check them, and how to save them.",
].join("\n");

export function configureText(profile, scope) {
  const fields = { name: profile.name, id: profile.id, scope, about: CONFIGURE_SCOPES[scope] ?? scope, guide: modFile("guides/profile-setup.md"), home: appHome() };
  const template = profile.prompts?.configure?.trim() || CONFIGURE_PROMPT;
  return template.replace(/\{(name|id|scope|about|guide|home)\}/g, (_all, name) => fields[name]);
}

// Starts that Claude: a new tab on the profile's Desk (opening the Desk if it's closed), on the
// profile's account, in its folder, and shows it. With `agent` (one of the Desk's Claudes, not one
// waiting for an answer: the dialog offers only those), the message goes to it instead.
export function configureOnDesk(profile, scope = "all", agent = null) {
  const text = configureText(profile, scope);
  if (agent) {
    hc(["send", agent.address, text]).catch(() => {});
    run("space.select", { id: agent.space });
    run("pane.focus", { pane: agent.pane });
    return agent.space;
  }
  const name = scope === "all" ? "Configure" : `Configure ${scope}`;
  return openDesk(profile, { name, argv: claudeArgv(profile), task: text });
}

// kelpie.apply-profile: applies <home>/kelpie/profile-apply.json ({ id, set }), an agent's change to a
// profile, and writes what happened to profile-apply.result.json ({ ok, error | profile, at }). The
// guide documents the rules: known keys only, sections merged (a null key or section removed), strings
// only, no secrets, and the same checks as the dialog's Save.
const APPLY_KEYS = ["name", "folder", "jira", "github", "commands", "prompts", "notify", "claude", "web"];
const SECRET = /token$|^token|password|secret/i;
export async function applyProfileRequest() {
  const dir = `${appHome()}/kelpie`;
  const file = `${dir}/profile-apply.json`;
  let result;
  try {
    const read = await exec("cat", [file]);
    if (read.code) throw new Error(`No request at ${file}.`);
    const { id, set } = JSON.parse(read.stdout);
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error("id: a profile id, lowercase letters, digits and dashes.");
    if (!set || typeof set !== "object" || Array.isArray(set)) throw new Error("set: an object of settings.");
    result = { ok: true, profile: applyProfile(id, set) };
  } catch (e) {
    result = { ok: false, error: String(e?.message ?? e) };
  }
  const out = JSON.stringify({ ...result, at: new Date().toISOString() }, null, 2);
  await exec("sh", ["-c", 'mkdir -p "$1" && printf "%s\\n" "$2" > "$1/profile-apply.result.json" && rm -f "$3"', "sh", dir, out, file]).catch(() => {});
  return result;
}

function applyProfile(id, set) {
  const saved = profileById(id);
  const next = { ...(saved ?? {}) };
  for (const [key, value] of Object.entries(set)) {
    if (!APPLY_KEYS.includes(key)) throw new Error(`${key}: not a profile setting (${APPLY_KEYS.join(", ")}).`);
    if (key === "name" || key === "folder") {
      if (typeof value !== "string" || !value.trim()) throw new Error(`${key}: a non-empty string.`);
      next[key] = value.trim();
      continue;
    }
    if (value === null) { next[key] = null; continue; }
    if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${key}: an object, or null to remove it.`);
    const section = { ...(next[key] ?? {}) };
    for (const [k, v] of Object.entries(value)) {
      if (SECRET.test(k) && k !== "tokenCommand") throw new Error(`${key}.${k}: secrets aren't kept in a profile.`);
      const ok = v === null || typeof v === "string" || (key === "jira" && k === "board" && Number.isInteger(v)) || (key === "notify" && typeof v === "boolean");
      if (!ok) throw new Error(`${key}.${k}: a string${key === "notify" ? " or true/false" : ""}, or null to remove it.`);
      if (v === null) delete section[k]; else section[k] = typeof v === "string" ? v.trim() : v;
    }
    next[key] = Object.keys(section).length ? section : null;
  }
  if (!next.name || !next.folder) throw new Error(saved ? "name and folder can't be removed." : `No profile ${id}: a new one needs name and folder.`);
  if (next.jira) {
    const parsed = parseBoard(next.jira.url);
    if (!parsed) throw new Error("jira.url: a board's address, ending in /boards/<number>.");
    next.jira = { ...next.jira, ...parsed };
    if (!next.jira.keychain && !next.jira.tokenCommand) throw new Error("jira: needs keychain, or tokenCommand with email.");
    if (next.jira.tokenCommand && !next.jira.email) throw new Error("jira.email: needed with tokenCommand.");
  }
  if (next.github && !next.github.owner) throw new Error("github.owner: needed while GitHub is set (null removes GitHub).");
  if (next.web?.home && !/^https?:\/\//.test(next.web.home)) throw new Error("web.home: starts with https://.");
  if (next.claude && !next.claude.config) next.claude = null;
  saveProfile(id, next);
  return profileById(id);
}

// Runs one of a profile's commands (commands.leftovers, commands.cleanUp, commands.status) for a ticket key, in the
// profile's folder, through the user's shell. It gets `seconds` to finish, then it and whatever it
// started are stopped. Resolves to { code, out } (its output and errors together, trimmed; code 143
// when stopped); throws when it couldn't run.
export async function runCommand(profile, command, key, seconds, on = null) {
  const line = command.replace(/\{key\}/g, key);
  // Job control puts the command in a process group of its own, so the timer stops all of it; the
  // shell's own job notices are dropped (the command's errors still come, on stdout).
  const timed = 'exec 2>/dev/null; set -m; "${SHELL:-/bin/sh}" -c "$1" 2>&1 & p=$!; (sleep "$2"; kill -- -$p) >/dev/null 2>&1 & k=$!; wait $p; r=$?; kill $k 2>/dev/null; exit $r';
  const r = await exec("sh", ["-c", timed, "sh", line, String(seconds)], { cwd: profile.folder, ...(on ? { on } : {}) });
  return { code: r.code, out: (r.stdout ?? "").trim() };
}

// The profile dialog: a profile to edit (its id), or a new one (null), starting from a space's folder.
export function openProfile(id, { space, focus } = {}) {
  openOverlay({ mod: MOD, kind: "dialog", modal: true, width: 820, height: 0.85, props: { role: "setup", profile: id ?? null, space: space?.id ?? null, focus } });
}

// The setup of a space: its profile, or a new profile in its folder.
export function openSetup(space, focus) {
  openProfile(profileOf(space)?.id ?? null, { space, focus });
}
