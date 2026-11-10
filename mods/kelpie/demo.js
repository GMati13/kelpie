// Demo mode: a profile whose Jira board, GitHub and local helpers answer from a fixture
// (demo/demo.json) instead of the network, so Kelpie can be tried without either, and screenshots
// can be taken of every state on cue. `herdr-app do kelpie.demo` makes the profile (its `demo` flag,
// and the same flag on its jira and github sections, which is what the loaders check) and opens the
// fixture's spaces, whose tabs run demo/agent.sh: a stand-in that reports itself to Herdr as a Claude
// agent in the state the fixture asks for (OSC 7501) and draws a still screen. Edit the fixture and
// press Refresh to see another situation; run the command again to open spaces that were closed.
//   Only what Kelpie asks is answered: the board's configuration, active sprint, JQL searches (yours,
//   and `parent in (...)`), an issue's fields and transitions, a transition (kept until a reload of
//   the mod), pull request searches and files, uncommitted work, sessions and the footer's limits.
// Times in the fixture are relative ("-2h", "-3d", "+40m"), so the demo never looks stale.

import { agents, exec, readTextFile, run, setShared, shared, spaces } from "herdr";
import { modFile } from "./ui.js";
import { DESK_NAME, profileById, saveProfile, spacesOf } from "./config.js";

export const DEMO_ID = "demo";
export const isDemo = (x) => Boolean(x?.demo);

let FIXTURE = null; // the last fixture read, for the few readers that can't wait (the footer, argv)
const MOVED = {}; // key -> status name, after a transition in the demo

const UNITS = { m: 60e3, h: 3600e3, d: 864e5 };
const when = (v, now = Date.now()) => {
  const m = /^([+-]\d+(?:\.\d+)?)([mhd])$/.exec(String(v ?? ""));
  return m ? now + Number(m[1]) * UNITS[m[2]] : typeof v === "number" ? v : now;
};

export async function demoFixture() {
  const text = await readTextFile(modFile("demo/demo.json"));
  if (!text) throw new Error("The demo's fixture (mods/kelpie/demo/demo.json) is missing.");
  FIXTURE = JSON.parse(text);
  return FIXTURE;
}
export const demoNow = () => FIXTURE;

// --- Jira -------------------------------------------------------------------------------------

const statuses = (f) => f.board.columns.flatMap((c) => c.statuses);
const statusNamed = (f, name) => statuses(f).find((s) => s.name === name) ?? statuses(f)[0];
const jiraStatus = (s) => ({ id: s.id, name: s.name, statusCategory: { key: s.category } });
const issueById = (f) => new Map(f.issues.map((i) => [i.key, i]));

function fields(f, i, { withParent = true } = {}) {
  const subtask = Boolean(i.parent);
  const out = {
    summary: i.summary,
    issuetype: { name: i.type ?? (subtask ? "Sub-task" : "Story"), subtask },
    status: jiraStatus(statusNamed(f, MOVED[i.key] ?? i.status)),
  };
  // Yours are assigned to the fixture's own name; others name someone, or no one. A parent embedded in
  // a subtask names no one, as in Jira.
  const who = i.assignee ?? (i.mine ? f.profile.meName : null);
  if (who && withParent) out.assignee = { displayName: who };
  const parent = i.parent && issueById(f).get(i.parent);
  if (withParent && parent) out.parent = { key: parent.key, fields: fields(f, parent, { withParent: false }) };
  return out;
}
const asIssue = (f, i) => ({ key: i.key, fields: fields(f, i) });

// A description written as light Markdown (# headings, - and 1. lists, `code`, **bold**, blank lines
// between paragraphs) as Atlassian Document Format.
function inline(text) {
  const out = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push({ type: "text", text: text.slice(at, m.index) });
    const s = m[0];
    out.push(s.startsWith("`") ? { type: "text", text: s.slice(1, -1), marks: [{ type: "code" }] } : { type: "text", text: s.slice(2, -2), marks: [{ type: "strong" }] });
    at = m.index + s.length;
  }
  if (at < text.length) out.push({ type: "text", text: text.slice(at) });
  return out;
}
export function adfOf(markdown) {
  const content = [];
  for (const block of String(markdown ?? "").split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    const h = /^(#{1,3})\s+(.*)$/.exec(lines[0]);
    if (h && lines.length === 1) { content.push({ type: "heading", attrs: { level: h[1].length + 1 }, content: inline(h[2]) }); continue; }
    const bullet = lines.every((l) => /^\s*[-*]\s+/.test(l)), ordered = lines.every((l) => /^\s*\d+\.\s+/.test(l));
    if (bullet || ordered) {
      content.push({ type: bullet ? "bulletList" : "orderedList", content: lines.map((l) => ({ type: "listItem", content: [{ type: "paragraph", content: inline(l.replace(/^\s*(?:[-*]|\d+\.)\s+/, "")) }] })) });
      continue;
    }
    content.push({ type: "paragraph", content: inline(lines.join(" ")) });
  }
  return { type: "doc", version: 1, content };
}

// jira(cfg, ...args) for a demo profile: the answer jira.sh would print, from the fixture.
export async function demoJira(args) {
  const f = await demoFixture();
  const ok = (body) => ({ site: f.profile.site, code: 200, authed: true, body });
  const [what, a, b] = args;
  if (what === "search") {
    // `key in (…) OR parent in (…)`: the stories and their subtasks; `parent in (…)` alone: the subtasks.
    const parents = /parent in \(([^)]*)\)/.exec(a);
    const named = /key in \(([^)]*)\)/.exec(a);
    const among = (m, k) => Boolean(m) && m[1].split(",").map((s) => s.trim()).includes(k);
    const list = parents
      ? f.issues.filter((i) => among(named, i.key) || (i.parent && among(parents, i.parent)))
      : /assignee = currentUser\(\)/.test(a) ? f.issues.filter((i) => i.mine) : [];
    return ok({ issues: list.map((i) => asIssue(f, i)), isLast: true });
  }
  if (what === "transition") {
    const s = statuses(f).find((x) => x.id === String(b));
    if (!s) return { site: f.profile.site, code: 400, body: { errorMessages: ["No such transition in the demo."] } };
    MOVED[a] = s.name;
    return { site: f.profile.site, code: 204, authed: true, body: null };
  }
  if (what !== "get") return { site: f.profile.site, code: 400, body: { errorMessages: [`The demo doesn't answer ${what}.`] } };
  const path = String(a);
  if (/\/board\/\d+\/configuration$/.test(path)) return ok({ columnConfig: { columns: f.board.columns.map((c) => ({ name: c.name, statuses: c.statuses.map((s) => ({ id: s.id })) })) } });
  if (/\/board\/\d+\/sprint\?state=active$/.test(path)) return ok({ values: f.sprints });
  if (/\/board\/\d+$/.test(path)) return ok({ id: f.profile.board, name: f.board.name, type: "scrum" });
  const m = /\/issue\/([^/?]+)(\/transitions)?/.exec(path);
  const i = m && issueById(f).get(decodeURIComponent(m[1]));
  if (!i) return { site: f.profile.site, code: 404, body: { errorMessages: ["Issue does not exist in the demo."] } };
  if (m[2]) {
    const now = MOVED[i.key] ?? i.status;
    return ok({ transitions: statuses(f).filter((s) => s.name !== now).map((s) => ({ id: s.id, name: s.name, isAvailable: true, to: { name: s.name, statusCategory: { key: s.category } } })) });
  }
  return ok({ key: i.key, fields: { ...fields(f, i), description: adfOf(i.description) } });
}

// A Status move on the demo's GitHub Project (issues.js setStatus()): the issue takes the column's
// first status, as a transition to it does on the demo's Jira.
export async function demoMoveTo(key, column) {
  const c = (await demoFixture()).board.columns.find((x) => x.name === column);
  if (!c?.statuses?.length) throw new Error(`The demo has no column ${column}.`);
  MOVED[key] = c.statuses[0].name;
}

// --- GitHub -----------------------------------------------------------------------------------

const prUrl = (f, p) => `https://github.com/${f.profile.owner}/${p.repo}/pull/${p.number}`;
function asPull(f, p) {
  return {
    number: p.number, title: p.title, url: prUrl(f, p), isDraft: Boolean(p.draft), updatedAt: new Date(when(p.updated)).toISOString(),
    reviewDecision: APPROVED.has(prUrl(f, p)) ? "APPROVED" : p.review ?? null, viewerReview: APPROVED.has(prUrl(f, p)) ? "APPROVED" : null, author: { login: p.author ?? f.profile.me }, repository: { name: p.repo },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: p.checks ?? null } } }] },
  };
}
// pullBody() for a demo profile: the fixture's description of the pull request, if any.
export async function demoPullBody(url) {
  const f = await demoFixture();
  return f.pulls.find((x) => prUrl(f, x) === url)?.body ?? "";
}
// approvePull() for a demo profile: the pull request shows approved until the mod reloads.
const APPROVED = new Set();
export async function demoApprove(url) {
  const f = await demoFixture();
  if (!f.pulls.some((x) => prUrl(f, x) === url)) throw new Error("the demo has no such pull request.");
  APPROVED.add(url);
}
// searchPulls(q) for a demo profile: yours open, yours merged, or the ones waiting for your review.
export async function demoPulls(q) {
  const f = await demoFixture();
  const pick = /review-requested:@me/.test(q) ? (p) => p.reviewer && !p.merged
    : /is:merged/.test(q) ? (p) => !p.reviewer && p.merged
    : (p) => !p.reviewer && !p.merged;
  return f.pulls.filter(pick).map((p) => asPull(f, p));
}

const counted = (patch) => {
  const lines = String(patch ?? "").split("\n");
  return { add: lines.filter((l) => l.startsWith("+")).length, del: lines.filter((l) => l.startsWith("-")).length };
};
// A pull request's files, as `gh api …/pulls/<n>/files` lists them.
export async function demoPullFiles(url) {
  const f = await demoFixture();
  const p = f.pulls.find((x) => prUrl(f, x) === url);
  return (p?.files ?? []).map((x, n) => {
    const { add, del } = counted(x.patch);
    return { filename: x.path, previous_filename: x.from ?? null, status: x.status ?? "modified", additions: add, deletions: del, patch: x.patch, sha: `demo${p.number}${n}` };
  });
}
// A file's whole text, when the fixture has it: a pull request's (by its url), else uncommitted work's.
export async function demoBlob(url, path) {
  const f = await demoFixture();
  const files = url ? f.pulls.find((x) => prUrl(f, x) === url)?.files : (f.local ?? []).flatMap((r) => r.files);
  const file = files?.find((x) => x.path === path);
  if (typeof file?.text !== "string") throw new Error("the demo has only this file's diff");
  return file.text;
}

// --- Local helpers ------------------------------------------------------------------------------

const homeOf = async () => (await exec("sh", ["-c", 'printf %s "$HOME"'])).stdout;
const expand = (path, home) => String(path ?? "").replace(/^~(?=\/|$)/, home);

// changes.py for a demo profile: uncommitted work in the story's ticket folders.
export async function demoLocal(folder, keys) {
  const f = await demoFixture();
  return (f.local ?? []).filter((r) => keys.includes(r.key)).map((r) => ({
    repo: r.repo, path: `${folder}/${r.key}/${r.repo}`, branch: r.branch ?? r.key, key: r.key, ticket: true,
    files: r.files.map((x) => ({ path: x.path, status: x.status ?? "modified", patch: x.patch, ...counted(x.patch) })),
  }));
}
// sessions.py for a demo profile: earlier Claude sessions, newest first.
export async function demoSessions(folder) {
  const f = await demoFixture();
  return (f.sessions ?? []).map((s) => ({ id: s.id, title: s.title, cwd: folder, updated: when(s.updated), running: false, first: s.first ?? [], keys: s.first ?? [] }))
    .sort((a, b) => b.updated - a.updated);
}
// Whether the demo's browser plays sound (its globe turns into moving bars): the fixture's web.playing.
export const demoPlaying = () => Boolean(FIXTURE?.web?.playing);
// The footer's Claude account line for a demo profile.
export function demoAccounts() {
  const l = FIXTURE?.limits;
  if (!l) return [];
  const now = Date.now() / 1000;
  return [{ config: null, account: l.account ?? "Claude", model: l.model ?? null, at: now - 60,
    five_hour: { used_percentage: l.five, resets_at: when(l.fiveResets ?? "+2h") / 1000 }, seven_day: { used_percentage: l.week, resets_at: when(l.weekResets ?? "+3d") / 1000 } }];
}
// What next? for a demo profile: the fixture's picks, after a few seconds of brewing.
export async function demoSuggest() {
  const f = await demoFixture();
  await exec("sleep", ["4"]).catch(() => {});
  return f.suggest ?? [];
}

// --- Agents -----------------------------------------------------------------------------------

const AGENT = () => modFile("demo/agent.sh");
// A demo agent's argv: the stand-in, in a state, with a session name and the lines it shows.
export const demoAgentArgv = (state = "idle", title = "", lines = []) => ["sh", AGENT(), state, title, ...lines];

async function waitForSpace(name, before) {
  for (let waited = 0; waited <= 4000; waited += 150) {
    const made = spaces().find((s) => !before.has(s.id) && s.name === name);
    if (made) return made;
    await exec("sleep", ["0.15"]).catch(() => {});
  }
  return null;
}

// kelpie.demo: makes (or refreshes) the demo profile from the fixture and opens its spaces: every
// space the fixture lists that isn't open yet, its first tab with it and the rest after, then the
// paused agents it lists. Spaces already open are left as they are.
// The fixture's asks of agents (`asks`), as the plugin's add_to_next keeps them (stories.js addAsk):
// each from the agent of its `tab` (`terminalOf(tab)`, its terminal; left out while there's none, as
// an ask nobody waits on goes), a story's key linking to Jira.
export function demoAsks(f, terminalOf = () => null) {
  return (f.asks ?? []).flatMap((a, i) => {
    const terminal = terminalOf(a.tab);
    return terminal ? [{ id: `demo-${i}`, at: when(a.at ?? "-5m"), action: a.action, why: a.why ?? "", terminal, tab: a.tab,
      ...(a.key ? { key: a.key, url: `${f.profile.site}/browse/${a.key}` } : {}) }] : [];
  });
}

export async function setupDemo() {
  const f = await demoFixture();
  const home = await homeOf();
  const p = f.profile;
  const folder = expand(p.folder, home).replace(/\/+$/, "");
  await exec("mkdir", ["-p", folder]);
  const was = profileById(DEMO_ID);
  saveProfile(DEMO_ID, {
    ...(was ?? {}), name: p.name, folder, demo: true, claude: null,
    jira: { url: `${p.site}/jira/software/projects/${p.project}/boards/${p.board}`, site: p.site, board: p.board, demo: true, ...(p.handover ? { handover: p.handover } : {}) },
    github: { owner: p.owner, demo: true },
  });
  const owned = { ...(shared("kelpie.space.profile") ?? {}) };
  for (const s of f.spaces ?? []) {
    if (spaces().some((x) => x.name === s.name && owned[x.id] === DEMO_ID)) continue;
    const [first, ...rest] = s.tabs;
    const before = new Set(spaces().map((x) => x.id));
    const tab = (t) => ({ name: t.name, folder, argv: t.agent ? demoAgentArgv(t.agent, t.title ?? "", t.screen ?? []) : ["sh", AGENT(), "shell", "", ...(t.screen ?? [])] });
    const one = tab(first);
    run("space.new", { name: s.name, folder, tab: one.name, argv: one.argv });
    const made = await waitForSpace(s.name, before);
    if (!made) continue;
    owned[made.id] = DEMO_ID;
    setShared("kelpie.space.profile", { ...(shared("kelpie.space.profile") ?? {}), [made.id]: DEMO_ID });
    if (s.name === DESK_NAME) setShared("kelpie.desk", { ...(shared("kelpie.desk") ?? {}), [DEMO_ID]: made.id });
    for (const t of rest) { run("tab.new", { space: made.id, ...tab(t) }); await exec("sleep", ["0.3"]).catch(() => {}); }
  }
  const paused = {};
  for (const [key, list] of Object.entries(f.paused ?? {})) paused[key] = list.map((x, n) => ({ sessionId: x.id ?? `demo-paused-${key}-${n}`, cwd: folder, name: x.name ?? key, at: when(x.at ?? "-3h") }));
  setShared("kelpie.paused", { ...(shared("kelpie.paused") ?? {}), [DEMO_ID]: paused });
  setShared("kelpie.next.asks", { ...(shared("kelpie.next.asks") ?? {}), [DEMO_ID]: demoAsks(f, (tab) => agents().find((a) => a.tab_name === tab && owned[a.space] === DEMO_ID)?.address) });
  setShared("kelpie.profile.chosen", { id: DEMO_ID, space: spaces().find((s) => s.active)?.id ?? null });
}

// kelpie.demo-remove: undoes kelpie.demo. Closes the demo profile's spaces (ending their stand-in
// agents), deletes the profile and what's kept for it in shared state, and removes its folder, only
// when that's inside ~/.local/share/kelpie/demo (an edited fixture could name any folder).
const BY_PROFILE = ["kelpie.paused", "kelpie.next.asks", "kelpie.stories.data", "kelpie.stories.preview", "kelpie.next.suggested", "kelpie.next.brewing", "kelpie.profile.last", "kelpie.notify.prs"];
export async function removeDemo() {
  const p = profileById(DEMO_ID);
  for (const s of p ? spacesOf(p) : []) run("space.close", { id: s.id, confirmed: true });
  for (const key of BY_PROFILE) {
    const all = shared(key);
    if (all && typeof all === "object" && DEMO_ID in all) { const rest = { ...all }; delete rest[DEMO_ID]; setShared(key, rest); }
  }
  const owned = shared("kelpie.space.profile") ?? {};
  setShared("kelpie.space.profile", Object.fromEntries(Object.entries(owned).filter(([, id]) => id !== DEMO_ID)));
  const web = shared("kelpie.web");
  if (web?.slots?.[DEMO_ID] || web?.panels?.[DEMO_ID]) {
    const { [DEMO_ID]: _s, ...slots } = web.slots ?? {};
    const { [DEMO_ID]: _p, ...panels } = web.panels ?? {};
    setShared("kelpie.web", { ...web, slots, panels });
  }
  if (p) saveProfile(DEMO_ID, null);
  const home = await homeOf();
  const root = `${home}/.local/share/kelpie/demo/`;
  const folder = String(p?.folder ?? "").replace(/\/+$/, "");
  const rest = folder.slice(root.length);
  // Never the demo window's own Herdr home (CLAUDE.md, Demo), kept beside it.
  if (folder.startsWith(root) && rest && !rest.includes("..") && rest.split("/")[0] !== "herdr-app") await exec("rm", ["-rf", folder]).catch(() => {});
}

