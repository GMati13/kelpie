// A Linear team as a profile's board (board.js for boardOf() kind "linear"): its issues dressed as
// Jira's, in the shape board.js's header describes, so the story list, build() and every view read
// them as they read Jira's, and the board's other questions (a description, a look-up, a move).
//   The scope is the team's active cycle; a team that runs cycles with none active shows none, and
//   one without cycles is the board as a whole, like a Kanban board (open work and work completed in
//   the last 14 days). Your work: the team's issues assigned to you (Linear's `isMe`, Jira's
//   currentUser()). A story is such an issue's parent (one level, as Jira's), else the issue; its
//   sub-issues are its subtasks, in whichever team. Keys are Linear's own identifiers (ENG-123),
//   checked against the key pattern before they leave here. Columns are the team's workflow states,
//   Linear's board order (backlog, unstarted, started, completed), each by its position; canceled
//   and triage states aren't columns (an issue in one is done, or not started).
// Everything goes through linear.sh, which holds the sign-in. Every query is a constant with its own
// operation name; every value (the team's key, ids, cursors) goes as a variable, never into its text.

import { exec } from "herdr";
import { markdownBlocks, adfText } from "./adf.js";
import { modFile, platform } from "./ui.js";

const PAGES = 10; // up to 1000 of your issues
const IDS = 100; // stories asked for at once
const KANBAN_DAYS = 14;
// A key as every key finder takes it (stories.js KEY, sessions.py): Linear's identifiers are one.
const KEY = /^[A-Z][A-Z0-9]+-\d+$/;
// Linear's ids (UUIDs) and cursors, before one goes into a variable.
const ID = /^[A-Za-z0-9_=-]{1,100}$/;
// The team's key as Linear shows it in its addresses (config.js parseLinear()).
const TEAM = /^[A-Z][A-Z0-9]{1,19}$/;

// What Kelpie reads of every issue: enough to dress it as Jira's.
const ISSUE = `id identifier number title url sortOrder completedAt canceledAt
  state { id name type }
  assignee { id name displayName avatarUrl }
  labels(first: 10) { nodes { name color } }
  parent { id identifier }`;
export const QUERIES = Object.freeze({
  // The team: its workflow states, whether it runs cycles and the one running, and who you are.
  team: `query KelpieLinearTeam($key: String!) { viewer { id } teams(filter: { key: { eq: $key } }) { nodes { id key name cyclesEnabled activeCycle { id name number } states { nodes { id name type position } } } } }`,
  // A page of issues by a filter Kelpie builds (linear.js only, from checked ids).
  issues: `query KelpieLinearIssues($filter: IssueFilter!, $after: String) { issues(filter: $filter, first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${ISSUE} } } }`,
  // Stories by id, each with its sub-issues.
  stories: `query KelpieLinearStories($filter: IssueFilter!) { issues(filter: $filter, first: 100) { nodes { ${ISSUE} children(first: 50) { nodes { ${ISSUE} } } } } }`,
  // One issue by its key: its title, description and parent (the review prompt's, a look-up's).
  issue: `query KelpieLinearIssue($id: String!) { issue(id: $id) { identifier title description parent { identifier title } } }`,
  // An issue moved to another of its team's states.
  move: `mutation KelpieLinearMove($id: String!, $state: String!) { issueUpdate(id: $id, input: { stateId: $state }) { success } }`,
});

// Sign-in is a Linear personal API key: printed by the profile's token command when it has one, else
// kept as the password of its Keychain item (macOS).
const KEY_WHERE = "a Linear personal API key (Linear's Settings → Security & access → Personal API keys)";
function keyHelp(cfg) {
  if (cfg.tokenCommand) return `Check the token command in this profile: it should print ${KEY_WHERE}.`;
  if (platform() !== "macos") return `There's no Keychain here: give this profile a token command that prints ${KEY_WHERE}.`;
  return `Check the Keychain item "${cfg.keychain ?? ""}" in this profile: its password should be ${KEY_WHERE}.`;
}

// One question through linear.sh, answered as its data, or an error in plain words. The token
// command goes as an argument; the key it prints never leaves linear.sh's pipes.
export async function linear(cfg, query, variables = {}) {
  const signIn = cfg.tokenCommand ? ["--token-command", cfg.tokenCommand] : [];
  const out = await exec("sh", [modFile("linear.sh"), ...signIn, cfg.keychain ?? "", JSON.stringify({ query, variables })]);
  let r;
  try { r = JSON.parse(out.stdout || "{}"); } catch { r = {}; }
  if (r.error === "command") throw new Error(`The token command failed or printed nothing. ${keyHelp(cfg)}`);
  if (r.error === "invalid") throw new Error("The Linear API key holds a quote, backslash or line break, which a sign-in can't carry. Make a new key and save it again.");
  if (r.error === "missing") throw new Error(`No Linear sign-in${cfg.tokenCommand ? "" : platform() === "macos" ? " in the Keychain" : ""}. ${keyHelp(cfg)}`);
  if (r.error === "usage") throw new Error("Kelpie asked Linear something it doesn't send.");
  const errors = Array.isArray(r.body?.errors) ? r.body.errors : [];
  if (r.code === 401 || r.code === 403 || errors.some((e) => e?.extensions?.code === "AUTHENTICATION_ERROR")) throw new Error(`Linear didn't accept the sign-in. ${keyHelp(cfg)}`);
  if (r.code === 429 || errors.some((e) => e?.extensions?.code === "RATELIMITED")) throw new Error("Linear's limit for this API key is used up for now: Kelpie tries again on the next load.");
  if (r.code < 200 || r.code > 299 || errors.length || !r.body?.data) {
    const said = errors.map((e) => e?.extensions?.userPresentableMessage ?? e?.message).filter((m) => typeof m === "string").join(" ").slice(0, 300);
    throw new Error(said || `Linear answered ${r.code || "nothing"}.`);
  }
  return r.body.data;
}

// What a Linear state's type means to Kelpie, as Jira's status categories do.
export const linearCategory = (type) => (type === "started" ? "indeterminate" : type === "completed" || type === "canceled" ? "done" : "new");
// Linear's board order of state types; triage and canceled aren't columns.
const COLUMN_TYPES = ["backlog", "unstarted", "started", "completed"];

// The team the profile names, checked: { id, key, name, cycles, cycle, states, viewer }.
async function team(cfg) {
  const key = String(cfg?.team ?? "");
  if (!TEAM.test(key)) throw new Error("The profile's Linear team has no valid key: set its address again in the profile.");
  const data = await linear(cfg, QUERIES.team, { key });
  const t = data.teams?.nodes?.find((x) => x?.key === key);
  if (!t || !ID.test(t.id ?? "")) throw new Error(`Linear has no team ${key} that your API key can read.`);
  const cycle = t.activeCycle && ID.test(t.activeCycle.id ?? "") ? t.activeCycle : null;
  return { id: t.id, key, name: t.name ?? key, cycles: Boolean(t.cyclesEnabled), cycle, states: t.states?.nodes ?? [], viewer: data.viewer?.id ?? null };
}

// Every issue a filter finds, page by page.
async function issues(cfg, filter) {
  const out = [];
  let after = null;
  for (let page = 0; page < PAGES; page++) {
    const data = await linear(cfg, QUERIES.issues, { filter, ...(after ? { after } : {}) });
    out.push(...(data.issues?.nodes ?? []).filter((i) => i?.id));
    const next = data.issues?.pageInfo;
    if (!next?.hasNextPage || !ID.test(next.endCursor ?? "")) break;
    after = next.endCursor;
  }
  return out;
}
// Stories by id, IDS a query, each with its sub-issues, in the order asked.
async function stories(cfg, ids) {
  const out = [];
  for (let at = 0; at < ids.length; at += IDS) {
    const chunk = ids.slice(at, at + IDS);
    const data = await linear(cfg, QUERIES.stories, { filter: { id: { in: chunk } } });
    const got = new Map((data.issues?.nodes ?? []).filter((i) => i?.id).map((i) => [i.id, i]));
    out.push(...chunk.map((id) => got.get(id)).filter(Boolean));
  }
  return out;
}

// An issue dressed as Jira's (board.js's header), or null when its identifier isn't a key.
function dress(i, parentKey = null) {
  const key = String(i?.identifier ?? "");
  if (!KEY.test(key)) return null;
  const parent = parentKey ?? (KEY.test(i.parent?.identifier ?? "") ? i.parent.identifier : null);
  const who = i.assignee;
  return {
    key, url: typeof i.url === "string" ? i.url : null,
    fields: {
      summary: i.title ?? "",
      // Linear's issues have no type of the board's: this one is Kelpie's own, never shown as a tag.
      issuetype: { name: parent ? "Sub-issue" : "Issue", subtask: Boolean(parent), madeUp: true },
      status: i.state ? { id: i.state.id ?? null, name: i.state.name ?? "", statusCategory: { key: linearCategory(i.state.type) } } : { id: null, name: "No status", statusCategory: { key: "new" } },
      parent: parent ? { key: parent } : null,
      // Linear's colours are "#rrggbb": cleaned and checked where they're kept (labelsOf() in stories.js).
      labels: (i.labels?.nodes ?? []).filter(Boolean).map((l) => ({ name: l.name, color: String(l.color ?? "").replace(/^#/, "") })),
      ...(who ? { assignee: { displayName: who.name || who.displayName || "", avatarUrls: { "48x48": who.avatarUrl ?? null } } } : {}),
    },
  };
}

// The board's raw load, as board.js's header describes it.
export async function loadLinear(board, keep = {}) {
  const cfg = board.cfg;
  const t = await team(cfg);
  const columns = t.states.filter((s) => COLUMN_TYPES.includes(s?.type) && ID.test(s.id ?? ""))
    .sort((a, b) => COLUMN_TYPES.indexOf(a.type) - COLUMN_TYPES.indexOf(b.type) || (a.position ?? 0) - (b.position ?? 0))
    .map((s) => ({ name: s.name, statuses: [s.id], category: linearCategory(s.type) }));

  // The scope: the active cycle, nothing while none runs, or the whole board without cycles.
  const yours = { team: { id: { eq: t.id } }, assignee: { isMe: { eq: true } } };
  let sprints, filter;
  if (t.cycles) {
    sprints = t.cycle ? [{ id: t.cycle.id, name: t.cycle.name || `Cycle ${t.cycle.number}` }] : [];
    filter = t.cycle ? { ...yours, cycle: { id: { eq: t.cycle.id } } } : null;
  } else {
    sprints = [{ id: null, name: t.name, kanban: true }];
    const since = new Date(Date.now() - KANBAN_DAYS * 864e5).toISOString();
    filter = { and: [yours, { or: [{ completedAt: { null: true }, canceledAt: { null: true } }, { completedAt: { gt: since } }] }] };
  }
  const mineRaw = filter ? (await issues(cfg, filter)).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) : [];
  const mine = mineRaw.map((i) => dress(i)).filter(Boolean);

  // The stories: your issues' parents, else the issues themselves, in the board's order.
  const ids = [];
  for (const i of mineRaw) {
    const id = i.parent?.id ?? i.id;
    if (ID.test(id ?? "") && !ids.includes(id)) ids.push(id);
  }
  const parents = [], children = [], seen = new Set();
  const add = (list, own = () => {}) => {
    for (const s of list) {
      const story = dress({ ...s, parent: null });
      if (!story || seen.has(story.key)) continue;
      seen.add(story.key);
      parents.push(story);
      own(s, story);
      for (const c of s.children?.nodes ?? []) {
        const child = c && dress(c, story.key);
        if (child && !seen.has(child.key)) { seen.add(child.key); children.push(child); own(c, child); }
      }
    }
  };
  add(await stories(cfg, ids));

  // Then the stories `keep` names (something of them is still here) that your issues left out
  // (reassigned since, or out of the cycle): the team's issues by number, a sub-issue's story taken
  // instead, after the board's own. A key Linear doesn't find is skipped; any other failure fails the
  // load. Those of them assigned to you are yours.
  const numbers = [...new Set(keep.keys ?? [])].filter((k) => KEY.test(k) && !seen.has(k) && k.slice(0, k.lastIndexOf("-")) === t.key)
    .map((k) => Number(k.slice(k.lastIndexOf("-") + 1)));
  const before = parents.length;
  if (numbers.length) {
    const found = await issues(cfg, { team: { id: { eq: t.id } }, number: { in: numbers } });
    const more = [...new Set(found.map((i) => i.parent?.id ?? i.id))].filter((id) => ID.test(id ?? "") && !ids.includes(id));
    add(await stories(cfg, more), (raw, dressed) => { if (t.viewer && raw.assignee?.id === t.viewer) mine.push(dressed); });
  }
  const workspace = cfg.workspace ?? "";
  return {
    site: workspace ? `https://linear.app/${workspace}` : "https://linear.app", columns, sprints, mine, parents, children,
    kept: parents.slice(before).map((i) => i.key), linear: { team: t.id, key: t.key },
  };
}

// The issue the list loaded under a key, or null.
const loaded = (data, key) => [...(data?.parents ?? []), ...(data?.children ?? [])].find((i) => i.key === key) ?? null;

// A ticket's page: the one the load gave it, else made from the workspace and its key.
export function linearUrl(board, data, key) {
  const url = loaded(data, key)?.url;
  if (typeof url === "string" && url.startsWith("https://linear.app/")) return url;
  const ws = board?.cfg?.workspace;
  return ws && KEY.test(key ?? "") ? `https://linear.app/${ws}/issue/${key}` : null;
}

// One issue by key, as Linear answers it, or null when it doesn't know it.
async function askIssue(board, key) {
  if (!KEY.test(key ?? "")) throw new Error(`${key} isn't a ticket key.`);
  return (await linear(board.cfg, QUERIES.issue, { id: key })).issue ?? null;
}

// A ticket's description, as the reader's blocks (Linear writes Markdown).
export async function linearDescription(board, key) {
  return markdownBlocks((await askIssue(board, key))?.description ?? "");
}

// A ticket's title, its parent's key and its description as text (the review prompt's).
export async function linearText(board, key) {
  const i = await askIssue(board, key);
  if (!i) throw new Error(`Linear has no ${key}.`);
  const parent = KEY.test(i.parent?.identifier ?? "") ? i.parent.identifier : null;
  return { summary: i.title ?? "", parent, text: adfText(markdownBlocks(i.description ?? "")) };
}

// A ticket the list doesn't have: { key, summary, story }, `story` a sub-issue's parent.
export async function linearLookUp(board, key) {
  const i = await askIssue(board, key).catch(() => null);
  if (!i || !KEY.test(i.identifier ?? "")) return null;
  const p = KEY.test(i.parent?.identifier ?? "") ? { key: i.parent.identifier, summary: i.parent.title ?? "" } : null;
  return { key: i.identifier, summary: i.title ?? "", story: p };
}

// Where a ticket can go: the team's states (the loaded columns) but the one it's in. A state is its
// own move, so `toId` is its id too (board.js doneOption() and stories.js MOVED read it).
export function linearOptions(data, key) {
  const now = loaded(data, key)?.fields?.status?.id;
  return (data?.columns ?? []).map((c) => ({ id: c.statuses?.[0], toId: c.statuses?.[0], name: c.name, to: c.name, category: c.category ?? null }))
    .filter((o) => o.id && o.id !== now);
}

// Moves an issue to one of its team's states, on the person's own click (its chip, Move to Done's
// button), never on an agent's word: the key and the state are checked, and the state must be one of
// the loaded columns'.
export async function linearMove(board, data, key, option) {
  if (!KEY.test(key ?? "")) throw new Error(`${key} isn't a ticket key.`);
  if (!ID.test(option?.id ?? "") || !(data?.columns ?? []).some((c) => c.statuses?.[0] === option.id)) throw new Error("that isn't one of the team's states.");
  const r = await linear(board.cfg, QUERIES.move, { id: key, state: option.id });
  if (r.issueUpdate?.success === false) throw new Error("Linear didn't take the move.");
}
