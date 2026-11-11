// Your stories in the space's active sprint, the way you work them: each story with its subtasks,
// every pull request whose title carries one of their keys (across any repos), its checks and review,
// and the agent working on it (a tab named after the key). One sentence per story says what needs
// you; the stories that need you come first, and "Next" names the most urgent one. Otherwise the
// board's own order (its rank) holds, and a story whose part of yours is handed over (every subtask
// of yours at or past the profile's handover column) sinks to the end, drawn quieter.
//   A story is any issue of yours, or the parent of a subtask of yours. One with no subtasks
//   stands alone. Pull requests tied to no story of yours still show, as their own row.
//   Pause closes an agent's pane (its tab, when it's alone there) and keeps its Claude session
//   (shared "kelpie.paused", by profile and key); Resume opens a tab with the same name in the same
//   folder on `claude --resume`.

import { div } from "gpui-kit";
import { h_flex, v_flex, h_resizable, resizable_panel, Input, InputState, Scrollbar, TextView, VirtualListScrollHandle, v_virtual_list } from "gpui-base";
import { agents, appHome, exec, focused, hc, notify, openOverlay, panes, readTextFile, run, setAgentOrder, setShared, shared, spaces, layout } from "herdr";
import { CONTROL, ROW_CONTROL, INSET, MOD, SMALL, TEXT, TITLE, ago, avatar, capitalize, chip, chrome, countBadge, doneButton, mark, prState as prLook, progressBar, claudeSession, empty, groupHeader, icon, iconButton, menuButton, modFile, openExternal, own, primaryButton, resumeArgv, reveal, revealLabel, sessionTitle, stop, textButton, tint, sideHidden, buttonsRoom } from "./ui.js";
import { countShots } from "./shots.js";
import { REFRESH, Source, frame, needsSetup, notice } from "./source.js";
import { OTHERS, PREVIEWS, STORIES, askPlugin, boardOf, chooseProfile, claudeArgv, hasPlugin, deskOf, openDesk, handoverFrom, sunkWords, worksAlone, hasBoard, askText, suggestText, jiraTask, keepProfileOnClose, approvalTask, mergeTask, profileOf, profiles, reviewTask, runCommand, sendToClaude, setupOf, shownProfile, shownSpace, spaceProfiles, spacesOf, shellArgv, newTab } from "./config.js";
import { lozenge } from "./sprint.js";
import { boardSite, description as boardDescription, doneOption, loadBoard, lookUp, movable, moveStatus, statusOptions, ticketText, ticketUrl } from "./board.js";
import { approvePull, gh, pullBody, readPulls, searchPulls } from "./pulls.js";
import { adfLines, findPassage, markdownBlocks } from "./adf.js";
import { agentState, decor, skinFont, skinMeter, skinText, skinTheme, statusMark } from "./skins/index.js";
import { deskAgents, deskRows, goDeskAsking } from "./desk.js";
import { alpha, bands, mix, parseHex } from "./skins/common.js";
import { demoBlob, demoLocal, demoPullFiles, demoSessions, demoSuggest, isDemo } from "./demo.js";

const KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;
const KEYS = new RegExp(KEY.source, "g");
const MERGED_DAYS = 14; // merged pull requests stay in view this long
const open = openExternal;
const keyOf = (text) => KEY.exec(text ?? "")?.[1] ?? null;

// The board's projects, from the keys of the issues Jira gave ("ABC" of ABC-12).
const projectsOf = (data) => new Set([...(data.mine ?? []), ...(data.parents ?? []), ...(data.children ?? [])].map((i) => i.key.split("-")[0]));
// The ticket a title we didn't write names (a pull request's, a session's). A leading "[KEY]" counts
// whatever its project; elsewhere only a key of one of the board's projects does, so "UTF-8" or
// "SHA-256" in a title isn't taken for a ticket. With no project known yet, any key counts.
function keyIn(text, known) {
  const s = text ?? "";
  const tagged = keyOf(/^\s*\[([^\]]*)\]/.exec(s)?.[1]);
  if (tagged) return tagged;
  for (const [, k] of s.matchAll(KEYS)) if (!known?.size || known.has(k.split("-")[0])) return k;
  return null;
}
// The ticket a pull request belongs to: the key its title names, else the board's link to it (a
// GitHub Project's issue it closes, data.links), so a key in the title still wins.
const prKey = (p, data, known) => keyIn(p.title, known) ?? data?.links?.[p.url] ?? null;

// Starting, resuming and opening agents for a story takes a moment (a space is made, sessions are
// read) while the button still shows: a second click inside that time would start a second one, or a
// second space. So each story launches once at a time, and for a few seconds after, until the list
// has caught up. By story key (or any other name for what's launched), in shared state: the header,
// the details and the keys are separate copies, and any of them can start one. A launch that never
// finished (its copy reloaded, say) stops counting after LAUNCH_FOR; a failed one at once.
const LAUNCHING = "kelpie.launching"; // { [key]: { at, done } }
const LAUNCH_FOR = 30000;
const HOLD = 4000;
function markLaunch(key, entry) {
  const now = Date.now();
  const all = Object.fromEntries(Object.entries(shared(LAUNCHING) ?? {}).filter(([k, e]) => k !== key && now - e.at < LAUNCH_FOR));
  setShared(LAUNCHING, entry ? { ...all, [key]: entry } : all);
}
async function once(key, fn) {
  if (cleaningNow(key)) return;
  const was = (shared(LAUNCHING) ?? {})[key];
  const now = Date.now();
  if (was && now - was.at < LAUNCH_FOR && (!was.done || now - was.done < HOLD)) return;
  const at = now;
  markLaunch(key, { at, done: null });
  let ok = false;
  try { const r = await fn(); ok = true; return r; } finally { markLaunch(key, ok ? { at, done: Date.now() } : null); }
}

// What's busy on the board's tickets: a story being cleaned up or moved to done (by its key), one
// ticket's status moving (`move:<key>`), Clean up all (`all:<profile id>`). While it runs, every copy
// shows it (a spinner) and refuses what would clash with it: a second clean-up of a story once ran
// its clean-up command twice at once, closing its space and dropping its entries in a race. `keys`
// are the tickets whose status chips it locks, `step` what it's doing now, in words. Each entry ends
// by `until`, the whole run's own time limit, so a reload mid-run or a command that never returns
// can't keep a story locked.
const RUNS = "kelpie.busy"; // { [name]: { kind: "clean" | "done" | "move", keys, step, at, until } }
const CLEAN_EACH = 25; // seconds the clean-up command gets per key (cleanUp)
const BUSY_MARGIN = 60e3; // on top of a run's own limits: the checks before it, a slow board
const MOVE_FOR = 30e3; // one ticket's move, at most (a single chip's, each of Move to Done's)
// Nothing starts on a story while it's being cleaned up (its space is closing, its folders going):
// true then, after saying so.
const cleaningNow = (key) => busyOf(key)?.kind === "clean" && (say(`${key} is being cleaned up: wait for that to finish.`), true);
const busyAll = () => Object.entries(shared(RUNS) ?? {}).filter(([, e]) => Date.now() < e.until);
// Exported for the tests.
export const busyOf = (name) => busyAll().find(([n]) => n === name)?.[1] ?? null;
// What holds a ticket's chip: its own move, or a run on its story.
const ticketBusy = (key) => busyAll().map(([, e]) => e).find((e) => e.keys?.includes(key)) ?? null;
function setBusy(name, entry) {
  const all = Object.fromEntries(busyAll().filter(([n]) => n !== name));
  setShared(RUNS, entry ? { ...all, [name]: entry } : all);
}
// Takes `name` for a run (null when it's taken), changes what it says, and ends it: only the run that
// took it ends it (one whose time ran out may have been followed by another).
function takeBusy(name, entry, ms) {
  if (busyOf(name)) return null;
  const at = Date.now();
  setBusy(name, { ...entry, at, until: at + ms });
  return at;
}
function stepBusy(name, at, change) {
  const e = busyOf(name);
  if (e && e.at === at) setBusy(name, { ...e, ...change });
}
function endBusy(name, at) {
  if (busyOf(name)?.at === at) setBusy(name, null);
}
// What it's doing, for its spinner's tip and the header: its step, and how long it's taken once
// that's more than a few seconds.
const busyText = (e) => {
  const s = Math.floor((Date.now() - e.at) / 1000);
  return s < 5 ? e.step : `${e.step} (${s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`})`;
};
// Why a story can't be cleaned up or moved to done right now (busyOf its key), in words; null if it can.
const busyWhy = (key) => {
  const e = busyOf(key);
  return !e ? null : e.kind === "clean" ? `${key} is already being cleaned up.` : `${key} is moving to Done: wait for that to finish.`;
};
// A busy run's mark, in a button's place: the working spinner, what it's doing as its tip, and with
// `words` (the header) in words beside it too. Nothing to click.
function busyMark(t, id, e, { words = false, box = CONTROL } = {}) {
  return h_flex().id(id).flex_none().gap(6).items_center().tooltip(busyText(e))
    .child(div().flex().flex_none().size(box).items_center().justify_center().child(mark(t, "working", 14)))
    .when(words, (el) => el.child(div().flex_none().text_size(SMALL).text_color(t.dim).child(busyText(e))));
}

const checksOf = (p) => p.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null;
const failing = (p) => ["FAILURE", "ERROR"].includes(checksOf(p));
// Ready to merge: approved, and its checks passed or it has none (a repo without CI), as prState() says.
const ready = (p) => !p.merged && !p.isDraft && [null, "SUCCESS"].includes(checksOf(p)) && p.reviewDecision === "APPROVED";
const prName = (p) => `${p.repository.name}#${p.number}`;
// A pull request's state in a few words, for its line (prState's full words are its tooltip).
const PR_SHORT = { "pr-merged": "Merged", "pr-changes": "Changes requested", "pr-failing": "Checks failing", "pr-approved": "Approved",
  "pr-draft": "Draft", "pr-running": "Checks running", "pr-review": "In review" };
const ARMED_FOR = 5000; // how long a careful button stays armed (carefulButton)
// Pull requests you approved from Kelpie (url -> when, a day at most): until the stories load again
// after it, the header says Approved from this; after, from GitHub's own word (viewerReview, your
// latest review), so a later change request or a dismissed approval shows too.
const APPROVALS = "kelpie.approved";
const APPROVED_FOR = 24 * 3600e3;
const youApproved = (st, p) => {
  const at = shared(APPROVALS)?.[p.url];
  return at && Date.now() - at < APPROVED_FOR && !(st.at > at) ? true : p.viewerReview === "APPROVED";
};

// The agents in a profile's spaces, by key: one whose tab is named after a key counts for that key,
// any other in a story's space for the story. A blocked one outranks the rest.
const RANK = { blocked: 0, working: 1, done: 2, idle: 3 };
function profileAgents(profile) {
  const list = [];
  const all = spaces(), byId = new Map(all.map((s) => [s.id, s])), of = spaceProfiles(all);
  for (const agent of agents()) {
    const space = byId.get(agent.space);
    if (space && of.get(space.id)?.id === profile?.id) list.push({ agent, space });
  }
  return list;
}
function agentsByKey(profile) {
  const map = new Map();
  for (const { agent: a, space } of profileAgents(profile)) {
    const k = keyOf(a.tab_name) ?? keyOf(space.name);
    if (k && (!map.has(k) || RANK[a.status] < RANK[map.get(k).status])) map.set(k, a);
  }
  return map;
}

// A story becomes a space when work on it starts: the space is named after its key (short, so Herdr's
// own "Close space?" dialog has room for it), and found by it. Titles show in the sidebar and header.
const storyName = (it) => it.key;
function storySpaces(profile) {
  const map = new Map();
  for (const s of spacesOf(profile)) {
    const k = keyOf(s.name);
    if (k && !map.has(k)) map.set(k, s);
  }
  return map;
}

// Paused agents: { [profile id]: { [key]: [{ sessionId, cwd, name, at, config }] } }; `config` is
// the Claude config folder the session lives in when it isn't the default (another account).
const PAUSED = "kelpie.paused";
const pausedIn = (profile) => (shared(PAUSED) ?? {})[profile?.id] ?? {};
function savePaused(profile, key, list) {
  const all = { ...(shared(PAUSED) ?? {}) };
  const mine = { ...(all[profile.id] ?? {}) };
  if (list?.length) mine[key] = list; else delete mine[key];
  all[profile.id] = mine;
  setShared(PAUSED, all);
}

// The Claude session an agent runs (ui.js), with the config folder it lives in.
const sessionOf = (a) => claudeSession(a.address);

// Keeps each agent's session in the paused list, under its key (a session already there isn't
// added twice). Returns the ones kept and the keys that couldn't be (no Claude session found).
async function keepSessions(profile, list) {
  const kept = [], failed = [];
  for (const x of list) {
    const rec = await sessionOf(x.agent).catch(() => null);
    if (!rec) { failed.push(x.key); continue; }
    const others = (pausedIn(profile)[x.key] ?? []).filter((p) => p.sessionId !== rec.sessionId);
    savePaused(profile, x.key, [...others, { sessionId: rec.sessionId, cwd: rec.cwd, name: x.agent.tab_name, at: Date.now(), ...(rec.config ? { config: rec.config } : {}) }]);
    kept.push(x);
  }
  return { kept, failed };
}

// Closes each agent's pane, so other agents split into the same tab keep running; its tab goes when
// it was alone there. Closing a story space's last tab closes the space.
function closeAgents(list) {
  for (const { agent } of list) {
    const alone = panes().filter((p) => p.tab === agent.tab).length <= 1;
    if (alone) run("tab.close", { id: agent.tab, confirmed: true }); else run("pane.close", { pane: agent.pane });
  }
}

// Pauses each agent: keeps its session, then closes its pane. The story is paused, back in the list,
// once its space's last tab closed. Returns what couldn't be paused.
async function pause(profile, list) {
  const { kept, failed } = await keepSessions(profile, list);
  closeAgents(kept);
  return failed;
}

// Every agent in a story's space, by the key it counts for: its tab's, else the story's.
const spaceAgents = (it) => (it.space ? agents().filter((a) => a.space === it.space.id).map((agent) => ({ key: keyOf(agent.tab_name) ?? it.key, agent })) : []);

// Pauses a story: every agent in its space (several on one key too), each kept under its key, then
// closes the space, so a plain terminal left in it doesn't keep it open. When an agent couldn't be
// paused (no Claude session found), the space stays, with that agent; the others' panes close.
async function pauseWholeStory(profile, it) {
  const list = spaceAgents(it);
  say(`Pausing ${it.key}…`);
  const { kept, failed } = await keepSessions(profile, list);
  if (failed.length) {
    closeAgents(kept);
    say(`Couldn't pause ${failed.join(", ")}: no Claude session found, so the story's space stays open.`);
    return;
  }
  say(null);
  const id = it.space?.id;
  if (id && spaces().some((s) => s.id === id)) run("space.close", { id, confirmed: true });
}

// Why pausing a story asks first: an agent of it at work, or tabs with no agent (a terminal, say),
// which close with its space. "" when nothing.
function pauseWhy(it) {
  const space = it.space ? spaces().find((s) => s.id === it.space.id) : null;
  const agentTabs = new Set(agents().map((a) => a.tab));
  const plain = (space?.tabs ?? []).filter((c) => !agentTabs.has(c.id)).length;
  const working = spaceAgents(it).filter((x) => x.agent.status === "working").length;
  return [working && `${working === 1 ? "an agent is" : `${working} agents are`} working`, plain && `${plain === 1 ? "a tab" : `${plain} tabs`} with no agent close${plain === 1 ? "s" : ""} too`].filter(Boolean).join(", ");
}

// The latest Claude session started on each key (it said the key in its first message, or carries it
// in its title), when none of its agents is open: a closed tab can still be resumed.
function lastSessions(list, known) {
  const map = new Map();
  for (const s of list ?? []) {
    if (s.running) continue;
    for (const k of new Set([...(s.first ?? []), keyIn(s.title, known)].filter(Boolean))) if (!map.has(k)) map.set(k, s);
  }
  return map;
}

// Every earlier session on a key (it said the key in its first message, or names it in its title),
// newest first, for picking one to resume.
function sessionsFor(data, key) {
  const named = new RegExp(`(?<![A-Z0-9])${key}(?!\\d)`);
  return (data.sessions ?? []).filter((s) => !s.running && ((s.first ?? []).includes(key) || named.test(s.title ?? "")))
    .sort((a, b) => b.updated - a.updated);
}

// Waits (up to `ms`) for the story's space to show up after space.new, which returns nothing: a
// space named after its key that wasn't there before. Its id, or null if it never came.
async function spaceFor(profile, it, before, ms = 3000) {
  for (let waited = 0; ; waited += 150) {
    const made = storySpaces(profile).get(it.key) ?? spaces().find((s) => !before.has(s.id) && s.name === storyName(it));
    if (made) return made.id;
    if (waited >= ms) return null;
    await exec("sleep", ["0.15"]).catch(() => {});
  }
}

// Opens a tab for a story: in its space when work on it has started, else as the first tab of a new
// space for it. Shows that space; returns its id, null when a new space didn't show up in time.
async function launch(profile, it, { name, folder, argv, task }) {
  const tab = { name, folder: folder ?? profile.folder, ...(argv ? { argv } : {}), ...(task ? { task } : {}) };
  if (it.space) {
    newTab({ space: it.space.id, ...tab });
    run("space.select", { id: it.space.id });
    return it.space.id;
  }
  setPreview(profile, null);
  const before = new Set(spaces().map((s) => s.id));
  run("space.new", { name: storyName(it), folder: tab.folder, tab: name, ...(argv ? { argv } : {}), ...(task ? { task } : {}) });
  return spaceFor(profile, it, before);
}

const resumeSession = (profile, it, key, s, task) => launch(profile, it, { name: key, folder: s.cwd, argv: resumeArgv(s.id, s.config, profile?.github?.account), task });

// What's said when a story's new space didn't show up, so the agents after the first can't open in it.
const noSpace = (it, left) => say(`${it.key}'s new space didn't show up in time, so ${left.join(", ")} ${left.length === 1 ? "stays" : "stay"} paused: Resume again once it's there.`);

// Brings back a key's paused agents; a task goes to the first of them as its next message. Each
// leaves the paused list only once its tab opened, so a failed launch keeps its session. Returns the
// story's space id (made by the first launch when the story had none), for the next key's agents;
// null when that space didn't show up (the rest stay paused, and the note says so).
async function resume(profile, it, key, task, after = []) {
  const left = [...(pausedIn(profile)[key] ?? [])];
  let story = it;
  for (const [i, p] of [...left].entries()) {
    let id;
    try {
      id = await launch(profile, story, { name: p.name, folder: p.cwd, argv: resumeArgv(p.sessionId, p.config, profile?.github?.account), ...(i === 0 && task ? { task } : {}) });
    } catch {
      break;
    }
    left.splice(left.indexOf(p), 1);
    savePaused(profile, key, left);
    if (!id) {
      if (left.length || after.length) noSpace(it, [...(left.length ? [key] : []), ...after]);
      return null;
    }
    story = { ...it, space: { id } };
  }
  return story.space?.id ?? null;
}

// Brings back every paused key of a story, one after another: the first launch makes the story's
// space when it has none, and the rest open in it (they wait for it; none open without it).
async function resumeAll(profile, it, keys) {
  let story = it;
  for (const [i, k] of keys.entries()) {
    const id = await resume(profile, story, k, undefined, keys.slice(i + 1));
    if (!id && !story.space) return;
    if (id) story = { ...it, space: { id } };
  }
}

// What the ticket prompt fills in for a key of story `it`: the story's own fields (with its subtasks,
// a line each) or a subtask's (with its story as the parent). With `template`, that prompt instead
// of the ticket prompt (the orchestrator's).
function ticketTask(st, it, key, template) {
  const s = key === it.key && it.story ? it : it.subs.find((x) => x.key === key) ?? it;
  const board = boardOf(st.setup);
  return jiraTask(board, {
    key, url: ticketUrl(board, st.data, key) ?? "", summary: s.title || it.title, type: s.type, status: s.status,
    parent: it.story && key !== it.key ? `${it.key}: ${it.title}` : "",
    subtasks: s === it && it.story ? it.subs.map((x) => `${x.key} — ${x.title}${x.status ? ` (${x.status})` : ""}`).join("\n") : "",
  }, ...(template ? [template] : []));
}

// Who hears about a file or a screenshot of the story: the agent on its key, else any open agent of
// the story (one not waiting for you first), else the key itself, which ask() resumes or starts.
function sendKey(it, key) {
  const live = [it.agent && { key: it.key, agent: it.agent }, ...it.subs.map((s) => s.agent && { key: s.key, agent: s.agent })].filter(Boolean);
  if (live.some((x) => x.key === key)) return key;
  return (live.find((x) => x.agent.status !== "blocked") ?? live[0])?.key ?? key;
}

// A finished story: done on the board, or every pull request of it merged. It may leave things to
// clean up (cleanable()).
const finished = (it) => it.category === "done" || (allPrs(it).length > 0 && allPrs(it).every((p) => p.merged));
// What can be cleaned up here: a finished story, or one someone else has now (reassigned).
const letGo = (it) => finished(it) || Boolean(it.reassigned);
const storyKeys = (it) => [it.key, ...it.subs.map((s) => s.key)].filter((k, i, a) => a.indexOf(k) === i);

// What to ask an agent about some pull requests: one button each, by what they need.
// What a pull request's buttons ask its agent; the messages are the profile's (config.js askText).
const ASK = { fix: "Fix checks", comments: "Address comments", merge: "Merge" };
const askOf = (profile, kind, ps) => askText(profile, kind, { prs: ps.map((p) => p.url).join(" and ") });
const askFor = (p) => (p.merged ? null : failing(p) ? "fix" : p.reviewDecision === "CHANGES_REQUESTED" ? "comments" : ready(p) ? "merge" : null);

// Stories from what Jira and GitHub said, with the live and paused agents on their keys, in the
// board's order. Each pull request carries the key it attached by (`key`). `handover` is the profile's
// handover column (jira.handover; none: config.js picks one): a story is `sunk` once every subtask of
// yours is in it or a column right of it (a done status always counts), or, with no subtask of yours,
// once the story itself is. A task of yours with no subtasks goes by its own status the same way.
// `left`: the keys of finished stories the leftovers check found something under (leftStories()), so
// they stay listed to be cleaned up; `done`: instead of the list, the finished stories it leaves out
// (the sidebar's Done group); `all`: every story, finished or not (the leftovers check's, the pruning's).
function build(data, byAgent, paused = {}, started = new Map(), handover = null, { left = new Set(), done = false, all = false } = {}) {
  const known = projectsOf(data);
  const last = lastSessions(data.sessions, known);
  const lastOf = (k) => (byAgent.has(k) || paused[k] ? null : last.get(k) ?? null);
  const prs = new Map();
  for (const p of data.prs) {
    const k = prKey(p, data, known);
    if (k) prs.set(k, [...(prs.get(k) ?? []), { ...p, key: k }]);
  }
  const used = new Set();
  const take = (k) => { used.add(k); return prs.get(k) ?? []; };
  const kids = new Map();
  for (const c of data.children) {
    const p = c.fields?.parent?.key;
    if (p) kids.set(p, [...(kids.get(p) ?? []), c]);
  }
  const mine = new Set(data.mine.map((i) => i.key));
  const kept = new Set(data.kept ?? []);
  const columns = data.columns ?? [];
  const from = handoverFrom(columns, handover);
  const past = (category, statusId) => category === "done" || (from >= 0 && columns.findIndex((c) => c.statuses.includes(statusId)) >= from);
  // Where a ticket stands for the story row's bar: blocked (a status named so), to do, in progress,
  // in testing (the handover column), or past it (any later column, or done).
  const stage = (category, statusId, name) => {
    if (/block|on hold|imped/i.test(name ?? "")) return "blocked";
    const at = columns.findIndex((c) => c.statuses.includes(statusId));
    if (category === "done" || (from >= 0 && at > from)) return "past";
    if (from >= 0 && at === from) return "testing";
    return category === "new" ? "todo" : "doing";
  };
  // The board's usual type at each level (every story a Story, every subtask a Sub-task) says
  // nothing, so only other types are tags (tagsOf()).
  const usualStory = usualType(data.parents), usualSub = usualType(data.children);
  const item = (key, f) => {
    const children = kids.get(key) ?? [];
    const sub = (c) => ({
      key: c.key, title: c.fields?.summary ?? "", type: c.fields?.issuetype?.name, tags: tagsOf(c.fields, usualSub), status: c.fields?.status?.name,
      category: c.fields?.status?.statusCategory?.key, statusId: c.fields?.status?.id, mine: mine.has(c.key), assignee: c.fields?.assignee?.displayName ?? null, avatar: c.fields?.assignee?.avatar ?? null,
      stage: stage(c.fields?.status?.statusCategory?.key, c.fields?.status?.id, c.fields?.status?.name), prs: take(c.key), agent: byAgent.get(c.key) ?? null,
      paused: byAgent.has(c.key) ? null : paused[c.key] ?? null, last: lastOf(c.key),
    });
    const own = children.filter((c) => mine.has(c.key));
    // Kept only as something of it is here (data.kept, hereKeys()), with nothing of it yours any more:
    // reassigned, to the people its subtasks are assigned to, else the story's assignee.
    const names = (list) => [...new Set(list.map((c) => c.fields?.assignee?.displayName).filter(Boolean))];
    const gone = kept.has(key) && !mine.has(key) && !own.length;
    return {
      key, title: f?.summary ?? "", type: f?.issuetype?.name ?? "Issue", tags: tagsOf(f, usualStory), status: f?.status?.name, category: f?.status?.statusCategory?.key, assignee: f?.assignee?.displayName ?? null, avatar: f?.assignee?.avatar ?? null, mine: mine.has(key),
      reassigned: gone ? { to: names(children).length ? names(children) : names([{ fields: f }]) } : null,
      sunk: own.length ? own.every((c) => past(c.fields?.status?.statusCategory?.key, c.fields?.status?.id)) : past(f?.status?.statusCategory?.key, f?.status?.id),
      story: children.length > 0, subs: children.length ? children.map(sub) : [sub({ key, fields: f })],
      prs: children.length ? take(key) : [], agent: children.length ? byAgent.get(key) ?? null : null, space: started.get(key) ?? null,
      paused: children.length && !byAgent.has(key) ? paused[key] ?? null : null, last: children.length ? lastOf(key) : null,
    };
  };
  const items = data.parents.map((p) => item(p.key, p.fields));
  // Pull requests of yours for tickets that aren't among them (another sprint, someone else's ticket):
  // after the board's tickets, never sunk (no status of the board's to go by), no description.
  for (const [k, list] of prs) {
    if (used.has(k) || !list.some((p) => !p.merged)) continue;
    items.push({ key: k, title: list[0].title.replace(/^\s*\[[^\]]*\]\s*/, ""), type: "Pull request", pr: true, sunk: false, story: false, prs: [], agent: null, space: started.get(k) ?? null,
      subs: [{ key: k, title: "", prs: list, agent: byAgent.get(k) ?? null, paused: byAgent.has(k) ? null : paused[k] ?? null, last: lastOf(k) }] });
  }
  if (all) return items;
  return items.filter((it) => settled(it, left) === done);
}
// Finished stories leave the list once nothing of theirs is open (no pull request) and nothing's left
// to clean up: no space, no paused session, no leftovers found (`left`, the story keys with some). One
// with any of those stays, so its broom shows; the others go to the Done group, still reachable.
const settled = (it, left = new Set()) => it.category === "done" && !it.space && !it.subs.some((s) => s.prs.some((p) => !p.merged))
  && allPaused(it).length === 0 && !left.has(it.key);
// The keys of the profile's stories something of which is here: a space named after one, a paused
// agent on one, a story with an open pull request of yours in the last load (`prior`). The load asks
// the board for those it doesn't give as yours (board.js loadBoard()'s `keep`): a story reassigned to
// someone else stays listed, marked so, until it's cleaned up. Exported for the tests.
export function hereKeys(profile, prior) {
  const keys = new Set([...storySpaces(profile).keys(), ...Object.keys(pausedIn(profile))]);
  if (prior?.parents) for (const it of build(prior, new Map(), {}, new Map(), null, { all: true })) if (!it.pr && allPrs(it).some((p) => !p.merged)) keys.add(it.key);
  return [...keys].filter((k) => /^[A-Z][A-Z0-9_]*-\d+$/.test(k));
}
// Who has a reassigned story now (the people its subtasks are assigned to, else the story's assignee),
// in words: "Reassigned to Ana Lima", or with nobody "No longer assigned to you".
function reassignedWords(it) {
  const names = it.reassigned?.to ?? [];
  if (!names.length) return "No longer assigned to you";
  return `Reassigned to ${names.length > 2 ? `${names[0]} and ${names.length - 1} others` : names.join(" and ")}`;
}
// The finished stories the list leaves out, in the board's order, each { it, n } as the list's are:
// what the sidebar's Done group shows, previewed like a story not open (its details, its merged pull
// requests, its earlier sessions to resume). Only the sprint's (or, on a board without sprints, the
// last 14 days'), as that's all the load holds.
const doneIn = (data, profile, handover) => build(data, agentsByKey(profile), pausedIn(profile), storySpaces(profile), handover, { left: leftStories(profile), done: true }).map((it) => ({ it, n: need(it) }));

// Where the board's current work is, for a sentence: "in Sprint 24", or on a board without sprints
// "on <its name>".
const sprintsWord = (data) => (data.sprints[0]?.kanban ? `on ${data.sprints[0].name}` : `in ${data.sprints.map((x) => x.name).join(" and ")}`);
// Why "To do" is empty: no sprint running, nothing of yours in it at all (Exported for the tests),
// or every story of yours already started.
export function noneToDo(data, items) {
  if (!data.sprints.length) return "No sprint running right now.";
  return items.length ? "Nothing left to start." : `Nothing ${sprintsWord(data)} is yours yet: tickets assigned to you show here.`;
}
// Whether a story is under way, for the sidebar's groups: started on the board (its own status or any
// subtask's past to do), or live here (a space, an agent, a paused session, a pull request). The groups
// go by the board, so a story worked on elsewhere, with no space here, is still in progress; whether
// it has a space here is the row's own mark. An earlier session alone (a sketch, say) leaves a story
// to do, its Resume still offered. (Exported for the tests.)
export const underWay = (it) => (Boolean(it.category) && it.category !== "new") || it.subs.some((s) => Boolean(s.category) && s.category !== "new")
  || Boolean(it.space) || allAgents(it).length > 0 || allPaused(it).length > 0 || allPrs(it).length > 0;

const allPrs = (it) => [...it.prs, ...it.subs.flatMap((s) => s.prs)];
// Open pull requests first, then the merged, each the most recently changed first.
const prOrder = (list) => list.slice().sort((a, b) => Number(Boolean(a.merged)) - Number(Boolean(b.merged)) || String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
const allAgents = (it) => [it.agent, ...it.subs.map((s) => s.agent)].filter(Boolean);
const allPaused = (it) => [it.paused && it.key, ...it.subs.map((s) => s.paused && s.key)].filter(Boolean);
// Whether work on the story has begun: a space, an agent, a session or a pull request of its own.
const begun = (it) => Boolean(it.space) || allAgents(it).length > 0 || allPaused(it).length > 0 || allPrs(it).length > 0 || Boolean(it.last) || it.subs.some((s) => s.last);
// Paused: something of it is paused and nothing of it runs.
const isPaused = (it) => !allAgents(it).length && allPaused(it).length > 0;

// Assignees' pictures. Jira gives each person's avatar as a link; Herdr draws images only from its own
// folder, so each is downloaded once (avatar.sh) into art/<mod>/avatars, named after its link, and
// drawn from there, with the initials until it's there or when it can't be had. Only links to
// Gravatar, GitHub's avatar host (a Project's assignees) and Atlassian's public avatar host count:
// the Jira site's own need a sign-in, and nothing here signs in (those keep the initials). Shared `kelpie.avatars`: { [name]: { file, at } or { failed: at } }.
const AVATARS = "kelpie.avatars";
const AVATAR_RETRY = 24 * 60 * 60 * 1000; // a picture that failed is tried again a day later
const AVATAR_HOST = /^https:\/\/(secure\.gravatar\.com|avatars\.githubusercontent\.com|avatar-management--avatars\.[a-z0-9-]+\.prod\.public\.atl-paas\.net)\/[A-Za-z0-9._~%/?=&+-]*$/;
// Exported for the tests.
export const avatarUrl = (u) => typeof u === "string" && u.length < 1000 && AVATAR_HOST.test(u);
const avatarName = (url) => `${fnv(url)}${fnv(`${url.length}:${url}`)}`;
// The picture's path from Herdr's home, once downloaded.
function avatarFile(url) {
  if (!avatarUrl(url)) return null;
  const e = (shared(AVATARS) ?? {})[avatarName(url)];
  return e?.file ? `art/${MOD}/avatars/${e.file}` : null;
}
// Downloads the pictures of a load's assignees that aren't there yet, one after another, in the
// background (the list calls it after a fresh load). Exported for the tests.
export async function fetchAvatars(data) {
  const urls = [...new Set([...(data.parents ?? []), ...(data.children ?? [])].map((i) => i.fields?.assignee?.avatar).filter(avatarUrl))];
  for (const url of urls) {
    const name = avatarName(url), e = (shared(AVATARS) ?? {})[name];
    if (e?.file || (e?.failed && Date.now() - e.failed < AVATAR_RETRY)) continue;
    const r = await exec("sh", [modFile("avatar.sh"), `${appHome()}/art/${MOD}/avatars`, name, url]).catch(() => null);
    const file = r?.code === 0 ? String(r.stdout ?? "").trim() : "";
    const ok = /^[0-9a-z]+\.(png|jpg|gif|webp)$/.test(file) && file.startsWith(`${name}.`);
    setShared(AVATARS, { ...(shared(AVATARS) ?? {}), [name]: ok ? { file, at: Date.now() } : { failed: Date.now() } });
  }
}

// Who a ticket is assigned to, as an avatar (their picture, else initials) with their name in its tooltip.
const assigned = (t, id, who, mine, url = null) => div().id(id).flex_none()
  .child(avatar(t, who, 18, who ? `Assigned to ${who}${mine ? " (you)" : ""}` : "Unassigned", who ? avatarFile(url) : null));

// Where its subtasks are, from Jira and their pull requests.
function progress(it) {
  if (!it.story) {
    const open = it.subs[0].prs.filter((p) => !p.merged).length;
    return open ? `${open === 1 ? "PR" : `${open} PRs`} in review` : it.subs[0].prs.length ? "Merged" : "No PR yet";
  }
  const n = { review: 0, doing: 0, todo: 0, done: 0 };
  for (const s of it.subs) {
    if (s.category === "done") n.done++;
    else if (s.prs.some((p) => !p.merged)) n.review++;
    else if (s.category === "indeterminate") n.doing++;
    else n.todo++;
  }
  return [`${it.subs.length} subtask${it.subs.length === 1 ? "" : "s"}`, n.review && `${n.review} in review`, n.doing && `${n.doing} in progress`, n.todo && `${n.todo} to do`, n.done && `${n.done} done`].filter(Boolean).join(" · ");
}

// A story's state at a glance, after its key in the list: its agents (a spinner while working, a pulse
// while one waits for you), its open pull requests by the most urgent one's state, and its subtasks
// assigned to you as a bar by where they stand (past testing green, in testing blue, in progress
// amber, blocked red, to do grey; none when none is yours). Each says itself in a tooltip.
// Open pull requests as one mark: the most urgent state among them (changes requested, failing
// checks, approved, running, in review, draft) and a tooltip with each one's state.
const PR_URGENCY = ["pr-changes", "pr-failing", "pr-approved", "pr-running", "pr-review", "pr-draft"];
function prSummary(t, open) {
  const states = open.map((p) => prLook(t, p, checksOf(p)));
  const worst = states.slice().sort((a, b) => PR_URGENCY.indexOf(a[0]) - PR_URGENCY.indexOf(b[0]))[0];
  return [worst, open.map((p, i) => `${prName(p)}: ${states[i][1]}`).join("\n")];
}

// A story's subtasks assigned to you, by where they stand, and its tooltip ("2 of 3 past testing…").
function subStages(t, it) {
  const n = { past: 0, testing: 0, doing: 0, blocked: 0, todo: 0 };
  const yours = it.subs.filter((s) => s.mine);
  for (const s of yours) n[s.stage ?? "todo"]++;
  const tip = [`Your subtasks: ${n.past} of ${yours.length} past testing`, n.testing && `${n.testing} in testing`, n.doing && `${n.doing} in progress`,
    n.blocked && `${n.blocked} blocked`, n.todo && `${n.todo} to do`].filter(Boolean).join(" · ");
  const parts = [{ n: n.past, color: t.done }, { n: n.testing, color: t.ansi4 ?? t.accent }, { n: n.doing, color: t.working },
    { n: n.blocked, color: t.blocked }, { n: n.todo, color: t.dim }];
  return { parts, tip: `${tip}\nAll: ${progress(it)}`, total: yours.length };
}

// The same as a thin line under a story row's text, a segment per subtask of yours, so the key line
// keeps its room for the marks and labels (#53); its words are its tooltip.
// A story row's title line, set so its actions sit centred on it and above the key line (rowActions()).
const ROW_TITLE = 20;
const ACTIONS_TOP = 7 + ROW_TITLE / 2 - ROW_CONTROL / 2;

function subsLine(t, it) {
  if (!it.story) return null;
  const { parts, tip, total } = subStages(t, it);
  if (!total) return null;
  const segs = parts.flatMap((p) => Array.from({ length: p.n }, () => p.color));
  return h_flex().id(`b-subs-${it.key}`).w_full().h(2).mt(3).gap(2).tooltip(tip)
    .children(segs.map((c, i) => div().flex_1().h_full().rounded(1).bg(i < parts[0].n ? c : alpha(c, 0.45))));
}

// `bar: false` leaves the subtasks' bar out, for rows that draw it as subsLine().
function storyBadges(t, it, { bar = true } = {}) {
  const out = [];
  const live = allAgents(it);
  const ask = live.filter((a) => a.status === "blocked").length, busy = live.filter((a) => a.status === "working").length;
  if (ask) out.push(countBadge(t, `b-ask-${it.key}`, "needs-you", ask, `${ask === 1 ? "An agent needs" : `${ask} agents need`} you`, t.working));
  if (busy) out.push(countBadge(t, `b-busy-${it.key}`, "working", busy, `${busy === 1 ? "An agent is" : `${busy} agents are`} working`, t.accent));
  if (!ask && !busy && isPaused(it)) out.push(countBadge(t, `b-paused-${it.key}`, "paused", allPaused(it).length, "Paused: Resume picks it up"));
  const open = allPrs(it).filter((p) => !p.merged);
  if (open.length) {
    const [worst, tip] = prSummary(t, open);
    out.push(countBadge(t, `b-pr-${it.key}`, worst[0], open.length, tip, worst[2]));
  } else if (allPrs(it).length) out.push(countBadge(t, `b-pr-${it.key}`, "pr-merged", 1, "Every pull request merged"));
  if (it.story && bar) {
    const { parts, tip } = subStages(t, it);
    out.push(progressBar(t, `b-subs-${it.key}`, parts, tip));
  }
  return out.filter(Boolean);
}

// --- Labels: what kind of work a ticket is, read on its row (#53) ---------------------------------

// A ticket's labels as they're kept: GitHub's {name, color}, Jira's plain names. Both are strangers'
// text: names cleaned of control characters and cut, a colour kept only as six hex digits, ten at most.
const LABELS_KEPT = 10;
const tagName = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
export function labelsOf(f) { // exported for the tests
  const out = [];
  for (const l of Array.isArray(f?.labels) ? f.labels : []) {
    const name = tagName(typeof l === "string" ? l : l?.name);
    if (!name || out.some((x) => x.name === name)) continue;
    const color = typeof l === "object" && /^[0-9a-f]{6}$/i.test(l?.color ?? "") ? l.color.toLowerCase() : null;
    out.push(color ? { name, color } : { name });
    if (out.length >= LABELS_KEPT) break;
  }
  return out;
}

// The type most of a level's tickets have: the one that says nothing on a row.
function usualType(list) {
  const n = new Map();
  for (const i of list ?? []) { const k = i.fields?.issuetype?.madeUp ? null : i.fields?.issuetype?.name; if (k) n.set(k, (n.get(k) ?? 0) + 1); }
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// A ticket's tags: its type when that says something (a bug always, else any but the level's usual
// one; a GitHub Project's made-up Issue/Sub-issue then never shows), then its labels. A bug reads as a
// bug on every board: Jira's Bug type and a label named like it are one tag, first, in the theme's red.
// The whole name is the word, or the word after a group ("type: bug", "kind/bug"): "not-a-bug" or
// "bug-bash" aren't bugs.
const BUGGY = /^(?:[a-z]+\s*[:/]\s*)?(?:bugs?|defects?|incidents?)$/i;
export function tagsOf(f, usual = null) { // exported for the tests
  const out = [];
  // Kelpie's own Issue/Sub-issue for a GitHub Project's issues (project.js) is no type of the board's.
  const type = f?.issuetype?.madeUp ? null : tagName(f?.issuetype?.name) || null;
  if (type && (BUGGY.test(type) || type !== usual)) out.push({ name: type, from: "type", bug: BUGGY.test(type) });
  for (const l of labelsOf(f)) {
    const bug = BUGGY.test(l.name);
    if (bug && out.some((x) => x.bug)) continue;
    out.push({ ...l, from: "label", bug });
  }
  return out.sort((a, b) => Number(b.bug) - Number(a.bug));
}

// A colour readable on the theme's background (a repo's pale or dark label colour, on a dark or a
// light theme): moved toward the foreground until it stands out enough, as WCAG measures contrast.
const luminance = (hex) => {
  const c = parseHex(hex);
  if (!c) return null;
  const [r, g, b] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrast(a, b) { // exported for the tests
  const x = luminance(a), y = luminance(b);
  return x === null || y === null ? 21 : (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const TAG_CONTRAST = 4;
export function legible(t, hex) { // exported for the tests
  for (let i = 0; i <= 10; i++) {
    const c = i ? mix(hex, t.foreground, i / 10) : hex;
    if (contrast(c, t.background) >= TAG_CONTRAST) return c;
  }
  return t.foreground;
}

// A bug in the theme's red; a label in its repo's colour, made readable; one without (Jira's) in a
// colour of the theme that's always the same for its name. Red is kept for bugs.
// Worked out once per theme and tag, not on every render: Herdr's script engine is slow, and a render
// that runs too long is cut off (a sidebar of labelled stories was, in tagColor()). A plain cache, the
// same answer for every copy of the mod, so a module variable is fine here.
const TAG_COLORS = new Map();
export function tagColor(t, tag) { // exported for the tests
  if (tag.bug) return t.blocked;
  const hues = [t.ansi4, t.ansi5, t.ansi6, t.ansi2, t.ansi3, t.accent].filter(Boolean);
  const key = [t.background, t.foreground, t.muted, ...hues, tag.color ?? "", tag.name].join("|");
  let c = TAG_COLORS.get(key);
  if (c) return c;
  if (tag.color) c = legible(t, `#${tag.color}`);
  else {
    // FNV-1a: the simpler (h * 31 + c) put frontend, design and accessibility on one colour.
    let h = 0x811c9dc5;
    for (const ch of tag.name.toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    c = hues.length ? hues[h % hues.length] : t.muted;
  }
  if (TAG_COLORS.size > 500) TAG_COLORS.clear();
  TAG_COLORS.set(key, c);
  return c;
}

// A ticket's tags, small and quiet beside its key line: a tinted word each, the first `max`, then
// "+n" with the rest in its tooltip. They give way before anything else on the line.
const tagTip = (x) => `${x.from === "type" ? "Type" : "Label"}: ${x.name}`;
// `whole`: words never squeezed (the story list's, where the key line keeps them room), only a name
// past 110px cut.
function tagRow(t, tags, id, max = 2, { whole = false } = {}) {
  if (!tags?.length) return null;
  const shown = tags.slice(0, max), rest = tags.slice(max);
  return h_flex().id(id).when(whole, (el) => el.flex_none()).when(!whole, (el) => el.flex_shrink(1).min_w(0).overflow_hidden()).gap(TAG_GAP).items_center()
    .children(shown.map((x, i) => tagChip(t, x, `${id}-${i}`, { whole })))
    .when(rest.length > 0, (el) => el.child(tagMore(t, rest, `${id}-more`)));
}
// One tag: a tinted word, a name past TAG_MAX cut with an ellipsis; `whole` never squeezed by its line,
// `w` cut to that width (the one that didn't fit whole, fitTags()).
const TAG_GAP = 4, TAG_MAX = 110;
function tagChip(t, x, id, { whole = false, w = null } = {}) {
  const c = tagColor(t, x);
  return skinFont(div().id(id).when(whole || w !== null, (el) => el.flex_none()).when(!whole && w === null, (el) => el.flex_shrink(1).min_w(0))
    .when(w !== null, (el) => el.w(w)).max_w(TAG_MAX).h(15).px(5).rounded(4).truncate()
    .bg(alpha(c, 0.14)).text_color(c), "label", SMALL - 1).tooltip(tagTip(x)).child(x.name);
}
// "+n", the rest of the tags in its tooltip.
const tagMore = (t, rest, id) => div().id(id).flex_none().text_size(SMALL - 1).text_color(t.dim)
  .tooltip(rest.map(tagTip).join("\n")).child(`+${rest.length}`);

// How many of a row's tags fit the room its line leaves, whole, with "+n" for the rest when any are
// left: as many as fit, never by count (#53). When not even the first fits whole it's cut to what's left
// (`cut`, with an ellipsis) if that still reads (TAG_MIN); else only "+n" shows (`more`), or nothing.
// Widths as drawn at zoom 1: the tags' own (`widths`), "+n"'s (`moreW`), the room (`room`).
const TAG_MIN = 34;
export function fitTags(widths, room, moreW, gap = TAG_GAP) { // exported for the tests
  const n = widths.length;
  if (!n || !(room > 0)) return { n: 0, cut: null, more: false };
  for (let k = n; k >= 1; k--) {
    const need = widths.slice(0, k).reduce((a, b) => a + b, 0) + gap * (k - 1) + (k < n ? gap + moreW : 0);
    if (need <= room) return { n: k, cut: null, more: k < n };
  }
  const cut = Math.floor(room - (n > 1 ? gap + moreW : 0));
  if (cut >= TAG_MIN) return { n: 1, cut: Math.min(cut, TAG_MAX), more: n > 1 };
  return { n: 0, cut: null, more: room >= moreW };
}

// What a story needs from you, most urgent first: [rank, sentence, colour name]. Up to NEEDS_YOU it
// waits on you: an agent asking, checks failing, changes requested, ready to merge.
const NEEDS_YOU = 3;
function need(it) {
  if (it.review) return [REVIEW_RANK, `Review requested${it.review.author?.login ? ` by ${it.review.author.login}` : ""}`, "accent"];
  const prs = allPrs(it).filter((p) => !p.merged);
  const blocked = allAgents(it).filter((a) => a.status === "blocked");
  const where = (p) => (it.story ? ` on ${p.key}` : "") + ` (${prName(p)})`;
  const pre = isPaused(it) ? "Paused · " : "";
  if (blocked.length) {
    const own = it.subs.find((s) => s.agent === blocked[0]);
    return [0, it.story && own ? `${own.key}'s agent needs you` : "Agent needs you", "working"];
  }
  // Changes requested before failing checks: a reviewer waits on you.
  const changes = prs.find((p) => p.reviewDecision === "CHANGES_REQUESTED");
  if (changes) return [1, `${pre}Changes requested${where(changes)}`, "working"];
  const fail = prs.find(failing);
  if (fail) return [2, `${pre}Checks failing${where(fail)}`, "blocked"];
  const done = prs.filter(ready);
  if (done.length) return [3, pre + (done.length === prs.length ? `Approved, ${done.every((p) => checksOf(p)) ? "checks pass" : done.some((p) => checksOf(p)) ? "checks pass or none" : "no checks"} · ready to merge` : `${done.map(prName).join(", ")} ready to merge`), "done"];
  // One of your pull requests with no ticket, waiting on nothing of yours: where it stands.
  if (it.pull) return [6, pullWords(it.pull), "dim"];
  // A story someone else has now says so first, and that it waits for its clean-up.
  const gone = it.reassigned ? `${reassignedWords(it)} · ` : "";
  if (isPaused(it)) return [7, `${gone}Paused · ${progress(it)}`, "dim"];
  if (allAgents(it).some((a) => a.status === "working")) return [5, `${gone}Agent working · ${progress(it)}`, "accent"];
  return [6, gone ? `${gone}clean up once you're done with it` : progress(it), "dim"];
}

// A pull request waiting for your review: after what needs you on your own stories.
const REVIEW_RANK = 4;
// Where a pull request needing nothing of you stands, in words.
const pullWords = (p) => (p.isDraft ? "Draft" : ["PENDING", "EXPECTED"].includes(checksOf(p)) ? "Checks running"
  : p.reviewDecision === "APPROVED" ? "Approved" : "Waiting for review");

// What needs you, in the order Next and cmd-shift-j go through it: the stories that need you, most
// urgent first (the list's order among equals), then the reviews waiting for you.
const needQueue = (items, reviews) => [...items.filter((x) => x.n[0] <= NEEDS_YOU).sort((a, b) => a.n[0] - b.n[0]).map((x) => x.it), ...reviews];
// The same with what agents asked of you in between (asksIn()), then the Desk while one of its agents
// waits for you (an item { key: "desk", desk }), and
// last one item for every finished story with something to clean up ({ key: "clean", clean:
// [stories] }: Clean up all, so it's one press however many there are), then what the What next?
// agent suggested (suggestedIn()). With nothing in it, Next's place holds the What next? button
// (StoryList magic()).
const DESK_ITEM = { key: "desk", desk: true };
const needQueueOf = (profile, items, reviews = []) => {
  const needs = [...needQueue(items, []), ...asksIn(profile, items), ...reviews, ...(deskAgents(profile).some((a) => a.status === "blocked") ? [DESK_ITEM] : [])];
  const dirty = items.map((x) => x.it).filter((it) => cleanable(profile, it).length && !busyOf(it.key));
  const clean = dirty.length ? [{ key: "clean", clean: dirty }] : [];
  return [...needs, ...clean, ...suggestedIn(profile, items, new Set(needs.map((x) => x.key)))];
};

// What agents asked of you (the plugin's add_to_next, addAsk()), by profile: a list of { id, at,
// action, why, key, url, terminal, tab, rest }, `terminal` the asking agent's, when known. In the queue
// each is { key: "ask:<id>", ask, it }, `it` its story while the list has it. It goes when it's clicked
// or dismissed, after a day, once its agent's terminal is gone (nobody's left waiting for it), or once
// its agent was answered (answered(), settleAsks()).
const ASKS = "kelpie.next.asks";
const ASK_FOR = 24 * 3600 * 1000;
const ASK_MAX = 10; // per profile
const ASK_EACH = 3; // per agent
// An agent asks at the end of a turn, so it's working when the ask comes in. Seen at rest after that
// (done or idle: its turn ended; `rest`), then working again, it started a new turn: someone answered
// it, in its own tab or anywhere. A permission prompt (blocked) is the same turn going on, not an end.
const RESTING = new Set(["done", "idle"]);
const answered = (ask, status) => Boolean(ask.rest) && status === "working";
function asksIn(profile, items) {
  const list = (shared(ASKS) ?? {})[profile?.id] ?? [];
  if (!list.length) return [];
  const live = new Map(agents().map((a) => [a.address, a.status]));
  return list.filter((a) => Date.now() - a.at < ASK_FOR && (!a.terminal || (live.has(a.terminal) && !answered(a, live.get(a.terminal)))))
    .map((a) => ({ key: `ask:${a.id}`, ask: a, it: a.key ? items.find((x) => x.it.key === a.key)?.it ?? null : null }));
}
// Notes each ask whose agent is at rest, and drops each whose agent was answered since (answered()),
// for every profile. Run by the copy that follows what's shown (syncTracking()), as agents change
// state whatever's on screen; written only when something changed. Exported for the tests.
export function settleAsks() {
  const all = shared(ASKS);
  if (!all) return;
  const live = new Map(agents().map((a) => [a.address, a.status]));
  let changed = false;
  const next = Object.fromEntries(Object.entries(all).map(([id, list]) => [id, (list ?? []).flatMap((a) => {
    const status = a.terminal ? live.get(a.terminal) : undefined;
    if (answered(a, status)) { changed = true; return []; }
    if (!a.rest && RESTING.has(status)) { changed = true; return [{ ...a, rest: true }]; }
    return [a];
  })]));
  if (changed) setShared(ASKS, next);
}
function dismissAsk(profile, id) {
  const all = shared(ASKS) ?? {};
  if (all[profile?.id]) setShared(ASKS, { ...all, [profile.id]: all[profile.id].filter((a) => a.id !== id) });
}
// The agent that asked, while it runs.
const askerOf = (ask) => (ask?.terminal ? agents().find((a) => a.address === ask.terminal) ?? null : null);
// A link an agent's ask may open: GitHub, or the profile's own Jira site. Anything else (a page an
// agent was misled into offering) isn't taken.
function askLink(profile, url, site) {
  if (!/^https:\/\/[^\s"'<>]+$/.test(url)) return false;
  return url.startsWith("https://github.com/") || Boolean(site && url.startsWith(`${site.replace(/\/+$/, "")}/`));
}
// An agent's ask, checked: `action` what to do (a few words), `why` a line, `key` a ticket (a
// subtask becomes its story, as Next lists stories), `url` a link (askLink()), `terminal` the asking
// agent's (from its environment, by the plugin). Kept per profile; the newest ASK_EACH per agent and
// ASK_MAX in all, the same action from one agent replacing the last. Exported for the tests.
export function addAsk(profile, { action, why, key, url, terminal } = {}) {
  const data = (shared(DATA) ?? {})[profile.id]?.data;
  const board = boardOf(profile);
  const site = boardSite(board, data);
  const act = passageText(action, 80), because = passageText(why, 300);
  if (act.length < 3) throw new Error("action: what you ask the person to do, a few words.");
  let k = "";
  if (key != null && key !== "") {
    k = passageText(key, 40).toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(k)) throw new Error("key: a ticket key, like ABC-12.");
    k = new Map((data?.children ?? []).map((c) => [c.key, c.fields?.parent?.key])).get(k) ?? k;
  }
  let link = "";
  if (url != null && url !== "") {
    link = passageText(url, 500);
    if (!askLink(profile, link, site)) throw new Error("url: a GitHub link, or a link to this profile's board.");
  }
  if (!link && k && site) link = ticketUrl(board, data, k);
  const term = typeof terminal === "string" && /^[\w-]{1,40}$/.test(terminal) ? terminal : "";
  const asker = term ? agents().find((a) => a.address === term) : null;
  const now = Date.now();
  const all = shared(ASKS) ?? {};
  let list = (all[profile.id] ?? []).filter((a) => now - a.at < ASK_FOR && !(term && a.terminal === term && a.action === act));
  const ask = { id: String(now) + (list.some((a) => a.id === String(now)) ? `-${list.length}` : ""), at: now, action: act, why: because,
    ...(k ? { key: k } : {}), ...(link ? { url: link } : {}), ...(term ? { terminal: term } : {}), ...(asker?.tab_name ? { tab: passageText(asker.tab_name, 60) } : {}),
    ...(RESTING.has(asker?.status) ? { rest: true } : {}) };
  if (term) { const mine = list.filter((a) => a.terminal === term); if (mine.length >= ASK_EACH) { const drop = new Set(mine.slice(0, mine.length - ASK_EACH + 1).map((a) => a.id)); list = list.filter((a) => !drop.has(a.id)); } }
  list = [...list, ask].slice(-ASK_MAX);
  setShared(ASKS, { ...all, [profile.id]: list });
  return ask;
}

// Suggested: what the What next? Claude picked for Next (brew(), applyPicks()), by
// profile: { at, items: [{ key, title, action, why, url, from }] }; `key` a story key (a subtask's
// became its story's) or "pr:<repo>#<n>". Kept a day. In the queue each is { key: "suggest:<key>",
// suggest, it }, `it` its story while the list has it; it drops out once that story is finished,
// handed over, or already needs you, or when dismissed (its ✕ in the queue).
const SUGGESTED = "kelpie.next.suggested";
const SUGGEST_FOR = 24 * 3600 * 1000;
function suggestedIn(profile, items, needs = new Set()) {
  const e = (shared(SUGGESTED) ?? {})[profile?.id];
  if (!e || Date.now() - e.at > SUGGEST_FOR) return [];
  return (e.items ?? []).flatMap((s) => {
    const it = items.find((x) => x.it.key === s.key)?.it ?? null;
    // A pull request picked ("pr:<repo>#<n>") that's already in the queue as a review or a lone pull
    // request of yours is there already: not again as a pick.
    const pr = s.key.startsWith("pr:") ? s.key.slice(3) : null;
    if (needs.has(s.key) || (pr && (needs.has(`review:${pr}`) || needs.has(`pull:${pr}`))) || (it && (finished(it) || sunk(it)))) return [];
    return [{ key: `suggest:${s.key}`, suggest: s, it }];
  });
}
function dismissSuggestion(profile, key) {
  const all = shared(SUGGESTED) ?? {};
  const e = all[profile?.id];
  if (e) setShared(SUGGESTED, { ...all, [profile.id]: { ...e, items: (e.items ?? []).filter((s) => s.key !== key) } });
}
// What a queue item says, in Next and in the queue list.
const queueLabel = (x) => (x.desk ? "Desk: an agent needs you"
  : x.ask ? x.ask.action
  : x.clean ? (x.clean.length === 1 ? `${x.clean[0].key}: ${finished(x.clean[0]) ? "finished" : "reassigned"}, clean up` : `${x.clean.length} ${x.clean.every(finished) ? "finished " : ""}stories: clean up all`)
  : x.suggest ? x.suggest.action
  : `${lonePr(x) ? prName(lonePr(x)) : x.key}: ${need(x)[1]}`);
// Its second line: what it is (the story's title, who asked for the review), or why Claude picked it.
const queueDetail = (x) => (x.desk ? "Its agent is waiting for your answer"
  : x.ask ? [askerOf(x.ask)?.tab_name ?? x.ask.tab, x.ask.why || x.it?.title].filter(Boolean).join(" · ")
  : x.clean ? x.clean.map((it) => it.key).join(", ")
  : x.suggest ? x.suggest.why || x.suggest.title
  : x.review ? `${x.review.author?.login ? `${x.review.author.login} · ` : ""}${x.title}`
  : x.title);
// Its mark: the story's state, as the list draws it; the broom for the clean-up; the sparkles for
// Claude's picks.
function queueMark(t, x, size = 16) {
  const box = (el) => div().flex().flex_none().size(size).items_center().justify_center().child(el);
  if (x.desk || x.ask) return mark(t, "needs-you", size);
  if (x.clean) return box(icon(own("brush-cleaning"), size - 3).text_color(t.dim));
  if (x.suggest?.idea) return box(icon(own("lightbulb"), size - 3).text_color(t.accent));
  if (x.suggest) return box(icon(own("sparkles"), size - 3).text_color(t.accent));
  if (x.review) return mark(t, "review", size);
  return mark(t, storyState(x), size);
}
// Where a click on it goes, when that's off Herdr (a pick the list doesn't have opens on the web).
const queueAway = (x) => Boolean((x.suggest && !x.it && !x.suggest.idea) || (x.ask && !x.it && x.ask.url));
// One item of the queue, folded Next and the open queue drawing it alike: its mark, what to do, and
// under it what it is or why (muted, one line); ↗ when a click opens the web. `on`: the item on
// screen, lit; `card`: folded Next's main row, which with `on` says you're on it. The item Next goes
// to has no mark of its own: unfolded it's the row after the lit one (a "Next" tag beside the
// header's "Next" only confused).
function queueRow(t, x, on, go, { card = false } = {}) {
  const detail = [card && on ? "You're on it" : "", queueDetail(x)].filter(Boolean).join(" · ");
  return h_flex().id(`queue-${card ? "next" : x.key}`).flex_none().px(10).py(6).gap(10).items_start().rounded(7).cursor_pointer()
    .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover))).on_click(go)
    .child(div().flex_none().mt(1).child(queueMark(t, x, 16)))
    .child(v_flex().flex_1().min_w(0).gap(1)
      .child(h_flex().min_w(0).gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(TEXT).font_medium().child(queueLabel(x)))
        .when(queueAway(x), (el) => el.child(icon(own("external-link"), 12).text_color(t.dim))))
      .when(Boolean(detail), (el) => el.child(div().truncate().text_size(SMALL).text_color(t.muted).child(detail))));
}
// An agent's ask or a pick of Claude's gets an ✕ to drop it, folded or not: a queue of one has no
// open list to drop it from (#64).
function withDrop(t, profile, x, row) {
  if (!x.suggest && !x.ask) return row;
  const drop = () => (x.ask ? dismissAsk(profile, x.ask.id) : dismissSuggestion(profile, x.suggest.key));
  return row.child(div().id(`queue-drop-${x.key}`).flex().flex_none().size(20).items_center().justify_center().rounded(5)
    .text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
    .tooltip(x.ask ? "Drop this request" : "Drop this suggestion").on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); drop(); })
    .child(icon(chrome("x"), 12)));
}
// Folded Next's smaller line under its main row: where ⌘⇧J goes when that isn't the main row's item
// (the main row is on screen, or another item of the queue is): its mark and what to do, one line.
function queueThen(t, x, go) {
  return h_flex().id("queue-then").flex_none().px(10).py(3).gap(8).items_center().rounded(6).cursor_pointer()
    .text_size(SMALL).text_color(t.muted).hover((s) => s.bg(t.hover)).on_click(go)
    .tooltip(`${queueAway(x) ? "Opens on the web" : "Go there"} ⌘⇧J`)
    .child(div().flex_none().text_color(t.dim).child("Then"))
    .child(div().flex_none().child(queueMark(t, x, 12)))
    .child(div().flex_1().min_w(0).truncate().child(queueLabel(x)))
    .when(queueAway(x), (el) => el.child(icon(own("external-link"), 12).text_color(t.dim)))
    .child(div().flex_none().text_color(t.dim).child("⌘⇧J"));
}
// Whether a queue item is the one on screen: its key, or for a pick or an agent's ask, its story's.
const queueShown = (x, shownKey) => Boolean(shownKey) && (x.key === shownKey || (Boolean(x.suggest || x.ask) && x.it?.key === shownKey));
// The one after the item shown, wrapping around; the first when the one shown isn't in it.
const nextIn = (queue, shownKey) => queue[(queue.findIndex((x) => x.key === shownKey) + 1) % queue.length] ?? null;

// Sunk, as drawn: handed over and nothing of it waiting on you.
const sunk = (it, n = need(it)) => it.sunk && n[0] > NEEDS_YOU;

// A story's state in one word, for skins (skins/index.js statusMark): what it needs from you first,
// then what its agents do, then whether it's handed over, open or not.
export function storyState(it, n = need(it)) {
  const r = n[0];
  if (r === 0) return "needs-you";
  if (r === 1) return "changes";
  if (r === 2) return "failing";
  if (r === 3) return "done";
  if (r === REVIEW_RANK) return "review";
  if (r === 5) return "working";
  if (r === 7) return "paused";
  if (sunk(it, n)) return "waiting";
  return it.space ? "idle" : "not-open";
}
// What a story block tells the skin about itself (skins/index.js blockDecor).
const storyBlock = (role, it) => ({ role, now: new Date(), story: it ?? null, state: it ? storyState(it) : null,
  working: Boolean(it) && allAgents(it).some((a) => a.status === "working") });

// The list's order: what needs you, then the rest, then what's sunk; each in the board's order (the
// order build() keeps), so a story only moves when what it needs from you changes. With `n`, its need.
function ordered(items) {
  const tier = (x) => (x.n[0] <= NEEDS_YOU ? 0 : sunk(x.it, x.n) ? 2 : 1);
  return items.map((it, i) => ({ it, n: need(it), i })).sort((a, b) => tier(a) - tier(b) || a.i - b.i);
}

const CHECKS = { SUCCESS: ["Checks pass", "done"], FAILURE: ["Checks failing", "blocked"], ERROR: ["Checks failing", "blocked"], PENDING: ["Checks running", "working"], EXPECTED: ["Checks running", "working"] };
const REVIEW = { APPROVED: ["Approved", "done"], CHANGES_REQUESTED: ["Changes requested", "blocked"], REVIEW_REQUIRED: ["Review waiting", "muted"] };
const AGENT = { blocked: ["Needs you", "working"], working: ["Working", "accent"], done: ["Done", "done"], idle: ["Idle", "muted"] };

// Several copies show stories (the sidebar list, the story header, the story view, the tab bar), and
// each copy runs in its own JavaScript context. So the list alone loads, and puts a trimmed copy of
// what it loaded in shared state ("kelpie.stories.data", by profile); the others read that. The
// selection, the view and the changes/screenshot counts are shared the same way.
const CACHE = {};
const BUSY = new Set();
const STARTED = {};
const AGAIN = new Set(); // profile keys asked to load again while their load ran (Source.load)
const DATA = STORIES; // { [profile id]: { key, data, at, error } }
const COUNTS = "kelpie.stories.counts"; // { [story key]: { files, shots, repo } }
const setCounts = (key, fields) => { const all = shared(COUNTS) ?? {}; setShared(COUNTS, { ...all, [key]: { ...(all[key] ?? {}), ...fields } }); };
// What the Screenshots view (a kelpie-artifacts block, layout id "story-shots") shows: the shown story's
// Claude sessions, { key, ids, keys: { [id]: subtask key }, terminals: { [id]: agent terminal }, on,
// started }. Only `key` until they're known (mods/kelpie-artifacts/main.js reads it).
const ARTIFACTS = "kelpie.artifacts.sessions";
const FULL_EVERY = 30 * 1000; // an agent finishing reloads Jira and GitHub at most this often
const QUICK_EVERY = 20 * 1000; // while something is in flight, its pull requests are read again this often
// Pull requests read again here (quickPulls()) by url, { pr, at }: newer than what a load that began
// before brings, as the search lags behind a merge or new checks. A merge read here stays until a
// load shows it; a closed one leaves the lists. 10 minutes at most.
const FRESH = {};
const FRESH_FOR = 10 * 60 * 1000;
const freshNow = (url) => { const f = FRESH[url]; return f && Date.now() - f.at < FRESH_FOR ? f : null; };
function withFresh(data) {
  if (!data?.prs || !Object.keys(FRESH).some(freshNow)) return data;
  const swap = (list, open) => (list ?? []).flatMap((p) => {
    const f = freshNow(p.url);
    // A review keeps the shape the load gives it (no `merged`), so an unchanged read changes nothing.
    return !f ? [p] : f.pr.closed || (open && f.pr.merged) ? [] : [open ? { ...f.pr, merged: p.merged } : f.pr];
  });
  return { ...data, prs: swap(data.prs, false), reviews: swap(data.reviews, true) };
}
// A fresh load's answer, the load having begun at `began`: what was read again before it began is
// forgotten (the load is as new), but a merge it doesn't show yet; what was read since stays put in.
// Exported for the tests.
export function settlePulls(data, began) {
  for (const [url, f] of Object.entries(FRESH)) {
    const was = (data?.prs ?? []).find((p) => p.url === url);
    if (!freshNow(url) || (f.at < began && !(f.pr.merged && was && !was.merged))) delete FRESH[url];
  }
  return withFresh(data);
}
// Puts a change into a profile's loaded stories: the shared copy every view reads, and the list's own.
// Written only when it changes something, as every copy draws again on a write (the quick read runs
// every 20 s while something is in flight).
function patchLoaded(profile, fn) {
  const all = shared(DATA) ?? {}, e = all[profile?.id];
  const next = e?.data ? fn(e.data) : null;
  if (next && next !== e.data && JSON.stringify(next) !== JSON.stringify(e.data)) setShared(DATA, { ...all, [profile.id]: { ...e, data: next } });
  for (const [k, c] of Object.entries(CACHE)) {
    let id = null;
    try { id = JSON.parse(k)[0]; } catch {}
    if (c?.data && id === profile?.id) CACHE[k] = { ...c, data: fn(c.data) };
  }
}
const sharedData = (ctx) => { const e = (shared(DATA) ?? {})[ctx.profile?.id]; return e && e.key === ctx.key ? e : null; };

// Only what the views use, so the shared copy stays small.
const status = (f) => (f?.status ? { id: f.status.id, name: f.status.name, statusCategory: { key: f.status.statusCategory?.key } } : null);
const issue = (i) => ({ key: i.key, ...(i.url ? { url: i.url } : {}), ...(i.item !== undefined ? { item: i.item } : {}), fields: { summary: i.fields?.summary, issuetype: i.fields?.issuetype ? { name: i.fields.issuetype.name, subtask: i.fields.issuetype.subtask, ...(i.fields.issuetype.madeUp ? { madeUp: true } : {}) } : null, status: status(i.fields), parent: i.fields?.parent ? { key: i.fields.parent.key } : null,
  ...((labels) => (labels.length ? { labels } : {}))(labelsOf(i.fields)),
  ...(i.fields?.assignee?.displayName ? { assignee: { displayName: i.fields.assignee.displayName, ...(avatarUrl(i.fields.assignee.avatarUrls?.["48x48"]) ? { avatar: i.fields.assignee.avatarUrls["48x48"] } : {}) } } : {}) } });
const pull = (p) => ({ ...(p.id ? { id: p.id } : {}), number: p.number, title: p.title, url: p.url, isDraft: p.isDraft, updatedAt: p.updatedAt, reviewDecision: p.reviewDecision, merged: p.merged,
  ...(p.headRefOid ? { headRefOid: p.headRefOid } : {}), ...(p.viewerReview ? { viewerReview: p.viewerReview } : {}),
  author: p.author ? { login: p.author.login } : null, repository: { name: p.repository?.name }, commits: { nodes: [{ commit: { statusCheckRollup: { state: checksOf(p) } } }] } });
const session = (x) => ({ id: x.id, title: x.title, cwd: x.cwd, updated: x.updated, running: x.running, first: x.first, ...(x.config ? { config: x.config } : {}) });

// The story shown: the shown space's (when it is a story's space), else the one previewed from the
// list (not opened yet), or a pull request waiting for your review. Previews by profile, in shared
// state. Another story previewed always opens on its Overview, never on a view left from the last one.
const PREVIEW = PREVIEWS; // { [profile id]: story key, or a review's "review:<repo>#<n>" }
const previewIn = (profile) => (shared(PREVIEW) ?? {})[profile?.id] ?? null;
function setPreview(profile, key) {
  if (!profile || previewIn(profile) === (key ?? null)) return;
  setShared(PREVIEW, { ...(shared(PREVIEW) ?? {}), [profile.id]: key ?? null });
  if (key) setShared(VIEW, { ...(shared(VIEW) ?? {}), [`preview:${profile.id}`]: LONE_KEY.test(key) ? "changes" : "start" });
}

// A pull request waiting for your review, as an item the story views can show: previewed from the
// list, its files in the Changes view, "Start review" its main action. Not a story: no subtasks, no
// space of its own (its agent goes to the Reviews space).
const reviewItem = (p) => ({
  key: `review:${prName(p)}`, review: p, title: p.title.replace(/^\s*\[[^\]]*\]\s*/, ""), type: "Review", pr: true, sunk: false, story: false,
  prs: [p], agent: null, space: null, subs: [],
});
const reviewsOf = (data) => (data?.reviews ?? []).map(reviewItem);
// An open pull request of yours that names no ticket of the board: shown on its own as a review is
// (its files under Changes, what it needs as the header's main action). Its agents are the Desk's, a
// tab "PR <repo>#<n>" each (reviewTab finds it).
const pullItem = (p) => ({
  key: `pull:${prName(p)}`, pull: p, title: p.title.replace(/^\s*\[[^\]]*\]\s*/, ""), type: "Pull request", pr: true, sunk: false, story: false,
  prs: [p], agent: null, space: null, subs: [],
});
const pullsOf = (data) => {
  const known = projectsOf(data ?? {});
  return (data?.prs ?? []).filter((p) => !p.merged && !prKey(p, data, known)).map(pullItem);
};
// The pull request an item is, when it's shown on its own (a review, or one of yours with no ticket).
const lonePr = (it) => it?.review ?? it?.pull ?? null;
// The preview keys of those (reviewItem, pullItem).
const LONE_KEY = /^(review|pull):/;
// Every item shown on its own: the reviews, then your pull requests with no ticket.
const loneOf = (data) => [...reviewsOf(data), ...pullsOf(data)];
// The item a key names among the stories (each { it }) and the reviews.
const findItem = (items, reviews, key) => (key ? items.find((x) => x.it.key === key)?.it ?? reviews.find((r) => r.key === key) ?? null : null);

// What the main area shows for the story: "agent" (its space's terminals), "changes", "shots", or
// "start" (a story not started: how to start or resume it). By story space, or by profile for a preview.
const VIEW = "kelpie.view";
const viewKey = (profile, it) => (it?.space ? it.space.id : `preview:${profile?.id}`);
// A pull request shown on its own has no Overview (it's no story of yours): it's always on Changes.
const viewOf = (profile, it) => {
  const mode = (shared(VIEW) ?? {})[viewKey(profile, it)] ?? (it?.space ? "agent" : "start");
  return mode === "start" && lonePr(it) ? "changes" : mode;
};
export function setView(profile, it, mode) {
  // Only the shared view changes here: syncStories (work.js) picks the stack's child from it. Selecting
  // here too raced it, as another copy that hadn't seen the new view yet switched back.
  setShared(VIEW, { ...(shared(VIEW) ?? {}), [viewKey(profile, it)]: mode });
}
// The main stack's child for a view: the terminals, the Screenshots view, or the story's own view.
export const stackChild = (mode) => (mode === "agent" ? "main" : mode === "shots" ? "story-shots" : "story-view");
const EXTRA = {};
const PICKED = { file: {}, more: new Set(), opened: new Set() };
const SHOTS = {}; // story key -> { list, at, loading }: its sessions, for the Screenshots view

// Diff files you have looked at, ticked in the list: by "<repo or PR>:<path>:<hash of its patch>", so
// the ticks survive restarts and a file that changes again shows unticked. Each holds its story's
// key; entries of stories no longer listed are dropped.
const VIEWED = "kelpie.viewed"; // { [file id]: story key }
// Two #rrggbb colours mixed (share of the second); anything else returns the first.
function mixColor(a, b, f) {
  const p = (h) => (/^#[0-9a-f]{6}/i.test(h ?? "") ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null);
  const x = p(a), y = p(b);
  if (!x || !y) return a;
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * f).toString(16).padStart(2, "0")).join("")}`;
}
// Hashing a whole patch is slow in the mod's engine (a lockfile's is hundreds of KB, and the view
// asks for each file's several times a frame), so each patch's hash is kept once worked out.
const HASHES = new Map();
function patchHash(text) {
  const known = HASHES.get(text);
  if (known !== undefined) return known;
  const h = fnv(text);
  if (HASHES.size > 4000) HASHES.clear();
  HASHES.set(text, h);
  return h;
}
function fnv(text) {
  let h = 0x811c9dc5; // FNV-1a: short, and enough to tell two versions of a patch apart
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}
const viewedId = (f) => `${f.id}:${patchHash(f.patch ?? "")}`;
const hashed = (text) => HASHES.has(text);

// What happened to a file, from GitHub's status or the local diff's own lines: added, removed,
// renamed or modified (copied and changed count as added and modified).
const FILE_STATUS = new Map();
function fileStatus(status, patch) {
  const p = patch ?? "";
  let by = FILE_STATUS.get(p);
  if (!by) { if (FILE_STATUS.size > 4000) FILE_STATUS.clear(); FILE_STATUS.set(p, (by = {})); }
  return (by[status] ??= statusOf(status, p));
}
function statusOf(status, patch) {
  const p = patch ?? "";
  if (status === "removed" || /^deleted file mode/m.test(p)) return "removed";
  if (status === "added" || status === "copied" || /^new file mode/m.test(p)) return "added";
  if (status === "renamed" || /^rename from /m.test(p)) return "renamed";
  return "modified";
}
// A file's status as one letter in the file list, coloured; modified, the usual case, stays dim.
const STATUS = { added: ["A", "done", "Added"], removed: ["D", "blocked", "Deleted"], renamed: ["R", "accent", "Renamed"], modified: ["M", "dim", "Modified"] };

// GitHub's five squares: how a file's changed lines split between added and removed.
function changeSquares(add, del) {
  const total = add + del;
  if (!total) return Array(5).fill("none");
  const a = Math.round((add / total) * 5), d = Math.min(5 - a, Math.round((del / total) * 5));
  return [...Array(a).fill("add"), ...Array(d).fill("del"), ...Array(5 - a - d).fill("none")];
}

// A patch as rows to draw, GitHub's way and a bit more: each line with its old and new numbers and
// its own text (the +/- moved to a gutter), hunk headers saying how many lines they skip and which
// function they're in, and in a changed line that pairs with a removed one, the words that changed.
// Parsed once per patch, as the view redraws often. Every patch of the story shown stays parsed (up to
// DIFFS_KEEP characters of patches, the oldest going first): parsing a big pull request takes longer
// than Herdr gives a render, so it's spread over several (PARSE_FOR) and none is parsed twice.
const DIFFS = new Map(); // patch -> rows
const DIFFS_KEEP = 8e6;
let diffsSize = 0;
// Runs of removed then added lines still to be marked, by the rows they're in: marking what changed
// in a line is a token LCS per pair tried, by far the slowest part of reading a patch, and a file of
// long changed lines took longer than a whole render, so it's done apart, a removed line at a time,
// until the time a render gives it (markWords), and goes on where it stopped.
const UNMARKED = new WeakMap(); // rows -> [{ dels, adds, d (next removed line), j (first added line left) }]
// Read and marked: a patch's rows ready to show.
const parsed = (patch) => DIFFS.has(patch) && !UNMARKED.has(DIFFS.get(patch));
// A patch's rows (parsed once, kept), marked until `until` (a Date.now() time; by default, all).
function diffRows(patch, until = Infinity) {
  const rows = DIFFS.get(patch) ?? readPatch(patch);
  markWords(rows, until);
  return rows;
}
// Marks what changed in each pair of a run (removed line, added line), until `until`: false when
// time ran out first, the rest kept for the next call. Each removed line pairs with whichever of the
// next few added lines it has most in common with (so a line added above its new version doesn't
// steal the match), in order.
function markWords(rows, until = Infinity) {
  const runs = UNMARKED.get(rows);
  if (!runs) return true;
  const kept = (text, marks) => 1 - marks.reduce((n, [a, b]) => n + b - a, 0) / Math.max(1, text.length);
  while (runs.length) {
    const run = runs[0];
    while (run.d < run.dels.length) {
      if (Date.now() > until) return false;
      const d = run.dels[run.d++];
      let best = null;
      for (let k = run.j; k < Math.min(run.adds.length, run.j + 4); k++) {
        const w = wordChanges(d.text, run.adds[k].text);
        const score = w ? kept(d.text, w[0]) + kept(run.adds[k].text, w[1]) : -1;
        if (w && (!best || score > best.score)) best = { k, w, score };
      }
      if (best) { d.marks = best.w[0]; run.adds[best.k].marks = best.w[1]; run.j = best.k + 1; }
    }
    runs.shift();
  }
  UNMARKED.delete(rows);
  return true;
}
// Reads a patch into rows, its runs of changes left to markWords.
function readPatch(patch) {
  const rows = [], runs = [];
  let o = 1, n = 1, inHunk = false, block = [], gap = 0, whole = false, cut = false;
  const flush = () => {
    const dels = block.filter((r) => r.kind === "del"), adds = block.filter((r) => r.kind === "add");
    if (dels.length && adds.length) runs.push({ dels, adds, d: 0, j: 0 });
    block = [];
  };
  for (const raw of patch.replace(/\n$/, "").split("\n")) {
    const l = raw.replace(/\t/g, "    ");
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(l);
    if (h) {
      flush();
      const from = n;
      o = Number(h[1]); n = Number(h[3]); inHunk = true;
      // A new or deleted file is all one hunk: nothing of it is left hidden after it.
      whole = o === 0 || n === 0;
      rows.push({ kind: "hunk", gap: gap++, skipped: Math.max(0, n - from), from, at: n, delta: n - o, context: h[5].trim() });
      continue;
    }
    const c = l[0];
    if (inHunk && (c === "+" || c === "-" || c === " " || l === "")) {
      const kind = c === "+" ? "add" : c === "-" ? "del" : "ctx";
      const row = { kind, text: l.slice(1), old: kind === "add" ? null : o++, new: kind === "del" ? null : n++ };
      if (kind === "ctx") flush();
      else { if (kind === "del" && block.some((r) => r.kind === "add")) flush(); block.push(row); }
      rows.push(row);
    } else {
      flush();
      // "\ No newline at end of file", git's mode and rename lines, or a note in place of a diff.
      if (l.startsWith("… cut here")) cut = true;
      rows.push({ kind: "note", text: c === "\\" ? l.slice(1).trim() : l });
    }
  }
  flush();
  // The lines after the last hunk, to the end of the file: how many is known once the file is read.
  if (gap && !whole && !cut) rows.push({ kind: "hunk", gap, trailing: true, skipped: null, from: n, at: null, delta: n - o, context: "" });
  if (!rows.some((r) => r.kind !== "note" || r.text)) rows.splice(0, rows.length, { kind: "note", text: "No lines changed: renamed, or only its mode changed." });
  for (const old of DIFFS.keys()) {
    if (diffsSize + patch.length <= DIFFS_KEEP) break;
    DIFFS.delete(old); diffsSize -= old.length;
  }
  DIFFS.set(patch, rows); diffsSize += patch.length;
  if (runs.length) UNMARKED.set(rows, runs);
  return rows;
}

// The Changes view's own state, kept across redraws: whether it shows every file on one page,
// files folded or unfolded by hand, the gaps between hunks opened, and each file's text for opening
// them (by file and version, so a changed file starts over). `version` changes with any of it.
const DIFF = { all: true, folds: {}, open: {}, text: {}, version: 0 };
// How long a render may spend parsing and hashing patches (changesBody): a big pull request's take
// longer than Herdr gives a render, so the rest waits for the next one, which a timer asks for.
const PARSE_FOR = 30;
// The diff as list items (Herdr's virtual list takes 10 000 at most): up to CHUNK code lines in one,
// and the lines drawn when the list first asks for every item, before it knows its height.
const CHUNK = 30, DRAW_FIRST = 200;
// Lockfiles, minified and generated files start folded: they bury the changes worth reading.
const FOLD_FILES = /(^|\/)(yarn\.lock|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|go\.sum|uv\.lock)$|\.min\.(js|css)$|\.(snap|map)$/i;
const fileKey = (f) => `${f.id}:${f.sha ?? patchHash(f.patch ?? "")}`;
const isFolded = (f) => DIFF.folds[fileKey(f)] ?? (FOLD_FILES.test(f.path) || f.add + f.del > 1500);

// A file's rows with the gaps opened so far: the lines read from the file go in at the top of a
// gap (going on from the hunk above) or at its bottom (leading into the hunk below), and the band
// between them stays while anything is still hidden. A gap's lines are the same on both sides, so
// their old numbers are the new ones less how far the hunk next to them has moved.
function fileRows(f) {
  const key = fileKey(f), text = DIFF.text[key], lines = text?.lines, open = DIFF.open[key] ?? {};
  const out = [];
  const same = (n, delta) => ({ kind: "ctx", text: lines[n - 1] ?? "", old: n - delta, new: n });
  for (const r of diffRows(f.patch ?? "")) {
    if (r.kind !== "hunk") { out.push(r); continue; }
    const hidden = r.trailing ? (lines ? Math.max(0, lines.length - r.from + 1) : null) : r.skipped;
    const g = open[r.gap] ?? { top: 0, bottom: 0 };
    const top = lines ? Math.min(g.top, hidden) : 0;
    const bottom = lines && !r.trailing ? Math.min(g.bottom, hidden - top) : 0;
    for (let n = r.from; n < r.from + top; n++) out.push(same(n, r.delta));
    const left = hidden === null ? null : hidden - top - bottom;
    // A hunk with nothing above it still gets its band, for the function it's in.
    if (left !== 0 || (hidden === 0 && !r.trailing)) out.push({ ...r, left, loading: Boolean(text?.loading), error: text?.error ?? null });
    if (!r.trailing) for (let n = r.at - bottom; n < r.at; n++) out.push(same(n, r.delta));
  }
  return out;
}

// The changed stretches of two versions of a line, as [start, end] ranges in each, by words; null
// when the lines have too little in common to be worth marking (a rewritten line reads as one).
function wordChanges(a, b) {
  const split = (s) => s.match(/\w+|\s+|[^\w\s]/g) ?? [];
  const x = split(a), y = split(b);
  if (!x.length || !y.length || x.length * y.length > 40000) return null;
  // Longest common subsequence of the tokens, from the end so it can be walked forwards.
  const w = y.length + 1, L = new Uint16Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) {
    L[i * w + j] = x[i] === y[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
  }
  const keepX = new Array(x.length).fill(false), keepY = new Array(y.length).fill(false);
  for (let i = 0, j = 0; i < x.length && j < y.length;) {
    if (x[i] === y[j]) { keepX[i++] = true; keepY[j++] = true; }
    else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) i++;
    else j++;
  }
  const same = x.reduce((s, t, i) => s + (keepX[i] && t.trim() ? t.length : 0), 0);
  if (same < 0.4 * Math.min(a.trim().length, b.trim().length)) return null;
  const ranges = (toks, keep) => {
    const out = [];
    let at = 0;
    toks.forEach((t, i) => {
      if (!keep[i]) {
        const prev = out[out.length - 1];
        if (prev && prev[1] === at) prev[1] += t.length; else out.push([at, at + t.length]);
      }
      at += t.length;
    });
    // Spaces between two changed words join them (even spaces both versions share); a change of
    // spaces alone isn't marked.
    const text = toks.join("");
    const joined = [];
    for (const r of out) {
      const prev = joined[joined.length - 1];
      if (prev && !/\S/.test(text.slice(prev[1], r[0]))) prev[1] = r[1]; else joined.push([...r]);
    }
    return joined.filter(([s, e]) => /\S/.test(text.slice(s, e)));
  };
  return [ranges(x, keepX), ranges(y, keepY)];
}

// Light syntax colours, enough to read code by: comments, strings, numbers and keywords, by the
// file's extension. A line is read alone, so a comment or string spanning lines is only caught by
// its own line's look (a line starting with * or /* reads as a comment).
const KEYWORDS = new Set(("abstract as async await break case catch class const continue def default defer del delete do elif else enum "
  + "export extends false final finally fn for from func function go if impl implements import in instanceof interface is lambda let "
  + "match mod module mut new nil none not null of or and override package pass private protected pub public raise return self "
  + "static struct super switch then this throw throws trait true try type typeof undefined use val var void when where while with yield "
  + "True False None fi done esac local echo").split(" "));
const HASH_COMMENT = /\.(py|sh|bash|zsh|rb|ya?ml|toml|pl|r|conf|ini|mk|dockerfile)$|(^|\/)(Makefile|Dockerfile)$/i;
const SLASH_COMMENT = /\.(m?[jt]sx?|cjs|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|scala|dart|php|css|scss|less|json5?)$/i;
function syntaxOf(path) {
  const p = path ?? "";
  if (SLASH_COMMENT.test(p)) return { line: "//", block: true };
  if (HASH_COMMENT.test(p)) return { line: "#", block: false };
  if (/\.(sql|lua|hs)$/i.test(p)) return { line: "--", block: false };
  return null; // prose, markup and unknown files stay plain
}
function syntaxSpans(text, lang) {
  if (!lang) return [];
  if (lang.block && /^\s*(\/\*|\*)/.test(text)) return [[0, text.length, "comment"]];
  const out = [];
  const re = lang.line === "#" ? /(#.*$)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)|(\b\d[\w.]*\b)|([A-Za-z_]\w*)/g
    : lang.line === "--" ? /(--.*$)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)|(\b\d[\w.]*\b)|([A-Za-z_]\w*)/g
    : /(\/\/.*$|\/\*.*?(?:\*\/|$))|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b\d[\w.]*\b)|([A-Za-z_$][\w$]*)/g;
  for (let m; (m = re.exec(text));) {
    const kind = m[1] ? "comment" : m[2] ? "string" : m[3] ? "number" : KEYWORDS.has(m[4]) ? "keyword" : null;
    if (kind) out.push([m.index, m.index + m[0].length, kind]);
  }
  return out;
}
// A line cut where its colour or change mark changes: [text, syntax kind or null, changed].
function lineSegments(text, spans, marks) {
  const cuts = new Set([0, text.length]);
  for (const [s, e] of spans) { cuts.add(s); cuts.add(e); }
  for (const [s, e] of marks ?? []) { cuts.add(s); cuts.add(e); }
  const at = [...cuts].filter((c) => c >= 0 && c <= text.length).sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < at.length - 1; i++) {
    const s = at[i], e = at[i + 1];
    const kind = spans.find(([a, b]) => a <= s && e <= b)?.[2] ?? null;
    const changed = (marks ?? []).some(([a, b]) => a <= s && e <= b);
    const prev = segs[segs.length - 1];
    if (prev && prev[1] === kind && prev[2] === changed) prev[0] += text.slice(s, e);
    else segs.push([text.slice(s, e), kind, changed]);
  }
  return segs;
}

// The ticket keys any profile's last load knows (its stories, their subtasks, its pull requests'
// keys): what's kept by story key (ticks, counts) stays while one of them still has it.
function knownKeys() {
  const keys = new Set();
  for (const e of Object.values(shared(DATA) ?? {})) {
    const d = e?.data;
    if (!d) continue;
    const known = projectsOf(d);
    for (const i of [...(d.parents ?? []), ...(d.children ?? [])]) keys.add(i.key);
    for (const p of d.prs ?? []) keys.add(prKey(p, d, known) ?? `pull:${prName(p)}`);
    // Items shown on their own keep theirs by their own key.
    for (const p of d.reviews ?? []) keys.add(`review:${prName(p)}`);
  }
  return keys;
}

// After each fresh load (the list's), what shared state keeps of what's gone goes: views of closed
// spaces, ticks and counts of keys no profile lists, the profile's paused agents on keys it no longer
// lists, and what was seen of deleted profiles' pull requests. Paused agents are only dropped from a
// load that saw a sprint and every pull request, so a gap between sprints or GitHub failing for a
// moment loses nothing.
function pruneShared(profile, data) {
  const write = (key, all, kept) => { if (Object.keys(kept).length !== Object.keys(all).length) setShared(key, kept); };
  const keep = (key, test) => { const all = shared(key) ?? {}; write(key, all, Object.fromEntries(Object.entries(all).filter(test))); };
  const live = new Set(spaces().map((s) => s.id));
  keep(VIEW, ([id]) => id.startsWith("preview:") || live.has(id));
  const keys = knownKeys();
  keep(VIEWED, ([, key]) => keys.has(key));
  keep(COUNTS, ([key]) => keys.has(key));
  const ids = new Set(profiles().map((p) => p.id));
  keep(PR_SEEN, ([id]) => ids.has(id));
  keep(PR_FOLDS, ([id]) => ids.has(id));
  keep(DONE_OPEN, ([id]) => ids.has(id));
  keep(DONE_CLEAN, ([id]) => ids.has(id));
  if (!data.sprints?.length || data.prError) return;
  const listed = new Set(build(data, new Map(), {}, storySpaces(profile), null, { all: true }).flatMap(storyKeys));
  const all = shared(PAUSED) ?? {};
  const mine = all[profile.id] ?? {};
  const kept = Object.fromEntries(Object.entries(mine).filter(([k]) => listed.has(k)));
  if (Object.keys(kept).length !== Object.keys(mine).length) setShared(PAUSED, { ...all, [profile.id]: kept });
}

// What a cleaned-up story leaves behind in shared state: its paused agents, its space's view, the
// counts of its changes and screenshots.
function forgetStory(profile, it) {
  const keys = storyKeys(it);
  const paused = { ...(shared(PAUSED) ?? {}) };
  if (paused[profile.id]) { paused[profile.id] = Object.fromEntries(Object.entries(paused[profile.id]).filter(([k]) => !keys.includes(k))); setShared(PAUSED, paused); }
  if (it.space) { const view = { ...(shared(VIEW) ?? {}) }; delete view[it.space.id]; setShared(VIEW, view); }
  const counts = { ...(shared(COUNTS) ?? {}) };
  for (const k of keys) delete counts[k];
  setShared(COUNTS, counts);
}

// The profile's status command's first line, by story key, refreshed with the stories (Refresh) and
// every few minutes, while the story has a space.
const STATUSES = {}; // key -> { line, full, error, at, seen, loading }
const STATUS_EVERY = 3 * 60 * 1000;
const STATUS_SECONDS = 4;
const RENAMED = new Set();

// Ticket descriptions, by key: loaded when first shown (the list's search doesn't carry them), and
// again after the stories reload once it's a few minutes old, or on Refresh. Each copy (the header,
// the story view) keeps its own.
const DESCRIPTIONS = {}; // key -> { blocks, at, loading, error }
const MOVES = {}; // key -> { list: [{ id, name, to, category }], at, loading, error }: where its status can go
const MOVED = {}; // key -> { status, category, id, at }: a status just set here, shown until the stories catch up
const MOVED_FOR = 10 * 60 * 1000; // a move the board's answers still don't show is kept this long at most
const movedNow = (key) => { const m = MOVED[key]; return m && Date.now() - m.at < MOVED_FOR ? m : null; };
// The loaded stories with the moves made here put in: the list's groups, order, progress and Next
// follow a move at once, not only its chip, and don't wait for a load (whose search lags).
function withMoved(data) {
  if (!data?.parents || !Object.keys(MOVED).some(movedNow)) return data;
  const fix = (i) => {
    const m = movedNow(i.key);
    if (!m || i.fields?.status?.name === m.status) return i;
    return { ...i, fields: { ...i.fields, status: { id: m.id ?? i.fields?.status?.id ?? null, name: m.status, statusCategory: { key: m.category ?? null } } } };
  };
  return { ...data, parents: data.parents.map(fix), children: (data.children ?? []).map(fix) };
}
// A fresh load's answer: a move it shows is settled and forgotten; one it doesn't show yet (Jira's
// search lags behind a move) stays put into it, so the list doesn't fall back to the old status.
// Exported for the tests.
export function settleMoved(data) {
  const issues = [...(data?.parents ?? []), ...(data?.children ?? [])];
  for (const key of Object.keys(MOVED)) {
    if (!movedNow(key) || issues.some((i) => i.key === key && i.fields?.status?.name === MOVED[key].status)) delete MOVED[key];
  }
  return withMoved(data);
}
// A ticket moved here (its chip, Move to Done): noted, and put into the profile's loaded stories, the
// shared copy every view reads and the list's own. `o` is the option moved to; its status id is a
// Project option's own id, a Jira transition's `toId`. Exported for the tests.
export function noteMoved(profile, key, o, board) {
  MOVED[key] = { status: o.to, category: o.category ?? null, id: (board?.kind === "project" ? o.id : o.toId) ?? null, at: Date.now() };
  delete MOVES[key];
  patchLoaded(profile, withMoved);
}
const DESC_EVERY = 5 * 60 * 1000;
// Descriptions read like an article ("calm reader"): body text at 14 on a 24px line, no wider than
// about 64 characters, in a centred column with room on every side; the opening paragraph (usually
// the user story) a little larger as a lead; headings as small accent labels in capitals, with space
// above them; lists indented with their markers.
const DOC = { size: 14, width: 540, perLine: 68, label: 11, lead: 16, leadLine: 26, mono: 12 };
const LINE = 24; // a description's line height, for the lines a folded one shows
const FOLDED = 12;
// The widest the subtask rows (and the story's pull requests) get, so a row's end stays within an
// eye's sweep of its start on a wide screen: wider read and aimed badly.
const ROWS = 760;
// Where a subtask's title starts in its row (the avatar, the key's 84, the gaps): its description
// and pull requests line up under it.
const SUB_INDENT = 18 + 10 + 84 + 10;
// `top` (a see-through colour, like the theme's hover) laid over `base`, as one solid colour.
function solidOver(base, top) {
  const a = /^#[0-9a-f]{8}$/i.test(top) ? parseInt(top.slice(7, 9), 16) / 255 : 1;
  return mix(base, alpha(top, 1), a);
}

// A paragraph's runs. Plain text is one string, which wraps by itself; with bold, code or links in it,
// it's laid out a word at a time (a word keeps each of its runs' looks), so it still wraps like text.
// A run of rich text, selectable so it can be copied: Herdr selects text only in a TextView, so
// the runs become HTML (bold, italic, code, links, breaks); size and colour come from the holder.
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function inline(t, id, runs, color = tint(t.foreground, "c4")) {
  // TextView drops <br>, so each line is a TextView of its own.
  const lines = [[]];
  for (const r of runs) {
    if (r.br) lines.push([]);
    else lines[lines.length - 1].push(r);
  }
  const html = (line) => line.map((r) => {
    let h = esc(r.text);
    if (r.italic) h = `<i>${h}</i>`;
    if (r.bold) h = `<b>${h}</b>`;
    if (r.link) h = `<a href="${esc(r.link)}">${h}</a>`;
    return h;
  }).join("");
  const text = (key, line) => TextView.html(key, `<span>${html(line)}</span>`).selectable(true).text_color(color);
  // TextView's own code background is nearly the page's, so a line with inline code flows word by
  // word (each word selectable on its own), its code in a box of ours.
  // A short line's height (18 of the text's 24) set 3 down, so the box sits on the text's line. Code
  // with spaces may wrap inside its box, as wide as the column at most.
  const code = (key, r) => div().px(4).my(3).rounded(4).bg(tint(t.foreground, "1c"))
    .map((el) => (/\s/.test(r.text.trim()) ? el.min_w(0).max_w_full() : el.flex_none()))
    .child(skinFont(text(key, [{ ...r, code: false }]).font_family("JetBrains Mono"), "mono").text_size(DOC.mono).line_height("18px").text_color(t.foreground));
  return v_flex().min_w(0).children(lines.map((line, n) => {
    if (!line.length) return div().child(" ");
    if (!line.some((r) => r.code || r.mark)) return text(`${id}-text-${n}`, line);
    const words = [];
    let joined = false; // the last word ran on without a space
    for (const r of line) {
      for (const part of (r.code ? [r.text] : r.text.split(/(\s+)/))) {
        if (!part) continue;
        if (!r.code && /^\s+$/.test(part)) { joined = false; continue; }
        if (joined && words.length) words[words.length - 1].push({ ...r, text: part }); else words.push([{ ...r, text: part }]);
        joined = true;
      }
    }
    let k = 0;
    const seg = (r) => (r.code ? code(`${id}-w-${n}-${k++}`, r) : div().flex_none().child(text(`${id}-w-${n}-${k++}`, [r]).when(Boolean(r.mark), (el) => el.text_color(t.foreground))));
    const word = (w) => (w.length === 1 ? seg(w[0]) : h_flex().flex_none().children(w.map(seg)));
    if (!line.some((r) => r.mark)) return h_flex().flex_wrap().gap_x(4).gap_y(2).children(words.map(word));
    // A passage pointed to (findPassage) is marked as one run: the space after a marked word is inside
    // its mark when the next word is marked too, so the words flow with no gaps in it.
    const marked = (w) => Boolean(w?.some((r) => r.mark));
    return h_flex().flex_wrap().gap_y(2).children(words.map((w, i) => {
      if (!marked(w)) return div().flex_none().pr(4).child(word(w));
      const on = marked(words[i + 1]);
      return div().flex_none().when(!on, (el) => el.pr(4)).child(h_flex().flex_none().pl(marked(words[i - 1]) ? 0 : 3).pr(on ? 4 : 3).bg(tint(t.accent, "40"))
        .when(!marked(words[i - 1]), (el) => el.rounded_l(3)).when(!on, (el) => el.rounded_r(3)).child(word(w)));
    }));
  }));
}

// A description's blocks (adf.js) as the views draw them.
// `lead`: the first block, when it's a paragraph, is drawn as the lead (only the top level of a
// ticket's own description asks for it).
function blocksView(t, id, list, gap = 14, lead = false, color = undefined) {
  return v_flex().gap(gap).children(list.map((b, i) => {
    const bid = `${id}-${i}`;
    if (b.kind === "h") {
      // A skin may change a heading's words (skinText): then it's one plain run.
      const plain = b.runs.map((r) => r.text).join("").toUpperCase();
      const said = skinText(plain, "heading");
      return skinFont(inline(t, bid, said === plain ? b.runs.map((r) => ({ ...r, text: r.text.toUpperCase() })) : [{ text: said }], t.accent)
        .when(i > 0, (el) => el.pt(14)).font_semibold().text_color(t.accent), "heading", DOC.label).line_height("18px");
    }
    if (b.kind === "code") return skinFont(v_flex().id(bid).px(14).py(12).rounded(8).bg(t.raised).overflow_x_scrollbar().font_family("JetBrains Mono"), "mono").text_size(DOC.mono).line_height("20px")
      .child(TextView.html(`${bid}-text`, `<pre>${esc(b.text)}</pre>`).selectable(true));
    if (b.kind === "quote") return div().pl(14).border_l_2().border_color(t.input).text_color(t.muted).child(blocksView(t, bid, b.blocks, 14, false, t.muted));
    // An item's marker in a column of its own, so wrapped lines and nested lists indent under its text.
    if (b.kind === "list") return v_flex().gap(8).children(b.items.map((item, n) => h_flex().items_start()
      .child(div().flex_none().w(b.ordered ? 28 : 22).text_color(t.dim).child(b.ordered ? `${(b.start ?? 1) + n}.` : "•"))
      .child(div().flex_1().min_w(0).child(blocksView(t, `${bid}-${n}`, item, 8, false, color)))));
    if (lead && i === 0 && b.kind === "p") return skinFont(inline(t, bid, b.runs, tint(t.foreground, "e0")).pb(6).text_color(tint(t.foreground, "e0")), "lead", DOC.lead).line_height(`${DOC.leadLine}px`);
    return inline(t, bid, b.runs, color);
  }));
}

// The story header is two blocks: "story-head", its title row alone (a fixed height, so the title
// never moves), and "story-body" under it (the note, the description, the subtasks), which Herdr
// sizes. Folding hides the body, for every story and across restarts (shared state); work.js keeps
// the blocks in step, and a story not started shows its body anyway (it has nothing else to show).
const HEAD_FOLDED = "kelpie.storyhead.folded";
// The sidebar's pull request groups folded by hand (profile id -> "<list>:<story key>" -> true).
const PR_FOLDS = "kelpie.pulls.folded";
// The sidebar's Done group unfolded by hand (profile id -> true); folded otherwise.
const DONE_OPEN = "kelpie.done.open";
// Move to Done's "Clean up afterwards", as last chosen (profile id -> true); off otherwise.
const DONE_CLEAN = "kelpie.done.clean";
export const headFolded = () => Boolean(shared(HEAD_FOLDED));
function foldHead(shut) {
  setShared(HEAD_FOLDED, shut);
  run(shut ? "layout.hide" : "layout.show", { id: "story-body" });
}

// A passage of a story's description someone pointed to (Claude, asked where a ticket says something):
// { profile, key, quote, note, at }. Shown in the story's details (StoryBody.reader) until Back to the
// story, another story, or PASSAGE_FOR.
const PASSAGE = "kelpie.passage";
const PASSAGE_FOR = 60 * 60 * 1000;
function passageFor(profile, key) {
  const p = shared(PASSAGE);
  return p && p.profile === profile?.id && p.key === key && Date.now() - p.at < PASSAGE_FOR ? p : null;
}
// What Next pointed at when it opened a story (goNext): the step the story needs from you, by
// profile: { key, kind, at }, `kind` one of POINT_KINDS. While the story still needs that step
// (pointFor), it's marked as a passage is: a bar over the details saying what to do (pointBar), the
// header's button for it lit, and the pull request lines it acts on tinted. Taking the step, the
// bar's ✕, Next pointing elsewhere or POINT_FOR ends it. Only Next points (not yet agents).
const POINT = "kelpie.point";
const POINT_FOR = 60 * 60 * 1000;
const POINT_GLINT = 5000; // how long the box's glint runs when it comes in (two passes), then it rests
// need()'s ranks of what needs you, as the step each asks for.
const POINT_KINDS = { 0: "peek", 1: "comments", 2: "fix", 3: "merge" };
const pointKind = (it) => (lonePr(it) ? null : POINT_KINDS[need(it)[0]] ?? null);
// Exported for the tests.
export function pointFor(profile, it) {
  const p = (shared(POINT) ?? {})[profile?.id];
  return p && it && p.key === it.key && Date.now() - p.at < POINT_FOR && p.kind === pointKind(it) ? p : null;
}
// Exported for the tests.
export function setPoint(profile, it) {
  const kind = pointKind(it);
  setShared(POINT, { ...(shared(POINT) ?? {}), [profile.id]: kind ? { key: it.key, kind, at: Date.now() } : null });
  // The bar is in the details: they unfold, as they do for a passage.
  if (kind && headFolded()) foldHead(false);
}
function clearPoint(profile, key) {
  const all = shared(POINT) ?? {};
  if (all[profile?.id] && (!key || all[profile.id].key === key)) setShared(POINT, { ...all, [profile.id]: null });
}

// Shows the story `key` of the shown profile with `quote` found and marked in its description; false
// when the list doesn't hold that story. Its details unfold, as they're what's shown.
export function showPassage({ key, quote, note = "" }) {
  const s = storyItems();
  const it = s && [...s.items, ...s.done].find((x) => x.it.key === key)?.it;
  if (!it) return false;
  setShared(PASSAGE, { profile: s.st.profile.id, key, quote, note, at: Date.now() });
  if (headFolded()) foldHead(false);
  selectStory(s.st.profile, it);
  return true;
}

// kelpie.show-passage: a request to show a passage, from `<home>/kelpie/passage.json` ({ key, quote,
// note }), as any program can run the command. It only moves what's shown, so nothing waits for a
// yes; values are checked (a ticket key, text of sensible length, no control characters) and the
// outcome goes to passage.result.json beside it, the request removed.
const passageText = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
export function showPassageRequest() {
  return answerRequest("passage", (req) => {
    const key = passageText(req?.key, 40).toUpperCase(), quote = passageText(req?.quote, 2000), note = passageText(req?.note, 200);
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) throw new Error("key: a ticket key, like ABC-12.");
    if (quote.length < 3) throw new Error("quote: the passage's words, as the description has them.");
    return showPassage({ key, quote, note }) ? { ok: true } : { ok: false, error: `${key} isn't a story in the shown profile's list.` };
  });
}

// A request from the plugin (plugin/server.py): `<home>/kelpie/<name>.json` read and handed to
// `handle`, whose result (or the error it throws) goes to <name>.result.json, the request removed.
async function answerRequest(name, handle) {
  const dir = `${appHome()}/kelpie`;
  const file = `${dir}/${name}.json`;
  let result;
  try {
    const read = await exec("cat", [file]);
    if (read.code) throw new Error(`No request at ${file}.`);
    result = await handle(JSON.parse(read.stdout));
  } catch (e) {
    result = { ok: false, error: String(e?.message ?? e) };
  }
  const out = JSON.stringify({ ...result, at: new Date().toISOString() }, null, 2);
  await exec("sh", ["-c", 'mkdir -p "$1" && printf "%s\\n" "$2" > "$1/$4.result.json" && rm -f "$3"', "sh", dir, out, file, name]).catch(() => {});
  return result;
}

// Which profile a plugin request is about: the one What next? started it for (`profile`, from its
// environment), else the asking agent's (`terminal`: its space's profile), else the one shown.
function requestProfile(req) {
  const named = typeof req?.profile === "string" ? profiles().find((p) => p.id === req.profile) : null;
  if (named) return named;
  const agent = typeof req?.terminal === "string" ? agents().find((a) => a.address === req.terminal) : null;
  const space = agent && spaces().find((x) => x.id === agent.space);
  return (space && profileOf(space)) || shownProfile();
}
// A profile's stories and reviews as the list has them (storyItems(), for any profile).
function itemsFor(profile) {
  const data = (shared(DATA) ?? {})[profile?.id]?.data;
  if (!hasBoard(profile) || !data) return null;
  return { data, items: ordered(build(data, agentsByKey(profile), pausedIn(profile), storySpaces(profile), boardOf(profile).handover, { left: leftStories(profile) })), reviews: reviewsOf(data) };
}
const profileHasNext = (profile) => {
  if (!profile) throw new Error("No Kelpie profile is shown.");
  if (!hasBoard(profile)) throw new Error(`The profile ${profile.name} has no board, so Kelpie shows no Next queue for it.`);
  return profile;
};

// kelpie.get-next (the plugin's get_next): the profile's Next queue, as Next lists it, for an agent
// to read: { ok, profile, items: [{ kind, key, action, detail, url }] }.
export function getNextRequest() {
  return answerRequest("next-get", (req) => {
    const profile = profileHasNext(requestProfile(req));
    const s = itemsFor(profile);
    if (!s) throw new Error(`${profile.name}'s stories haven't loaded yet.`);
    const kind = (x) => (x.desk ? "desk" : x.clean ? "clean" : x.ask ? "agent-ask" : x.suggest ? (x.suggest.idea ? "idea" : "suggestion") : x.review ? "review" : "story");
    const keyOfItem = (x) => (x.clean ? x.clean.map((it) => it.key).join(", ") : x.ask ? x.ask.key : x.suggest ? (x.suggest.idea ? "" : x.suggest.key.replace(/^pr:/, "")) : x.review ? prName(x.review) : x.desk ? "" : x.key);
    const urlOf = (x) => (x.ask ? x.ask.url : x.suggest ? x.suggest.url : x.review ? x.review.url : !x.desk && !x.clean && x.key && !lonePr(x) ? ticketUrl(boardOf(profile), s.data, x.key) : lonePr(x)?.url);
    const items = needQueueOf(profile, s.items, s.reviews).map((x) => Object.fromEntries(Object.entries({ kind: kind(x), key: keyOfItem(x), action: queueLabel(x), detail: queueDetail(x), url: urlOf(x) }).filter(([, v]) => v)));
    return { ok: true, profile: profile.name, items };
  });
}
// kelpie.add-next (the plugin's add_to_next): an agent asks the person for something (addAsk()).
// It only adds a line to Next, which the person may take or drop, so nothing waits for a yes.
export function addNextRequest() {
  return answerRequest("next-add", (req) => {
    const profile = profileHasNext(requestProfile(req));
    const ask = addAsk(profile, { action: req?.action, why: req?.why, key: req?.key, url: req?.url, terminal: req?.terminal });
    return { ok: true, profile: profile.name, ask: { action: ask.action, ...(ask.key ? { key: ask.key } : {}) } };
  });
}
// kelpie.suggest-next (the plugin's suggest_next): Claude's picks for Next, checked by applyPicks()
// and replacing the profile's earlier ones. What next? hands its picks in this way.
const PICKS_IN = 20;
export function suggestNextRequest() {
  return answerRequest("next-suggest", async (req) => {
    const profile = profileHasNext(requestProfile(req));
    if (!Array.isArray(req?.items)) throw new Error("items: a list of picks.");
    const { kept, dropped } = await applyPicks(profile, req.items.slice(0, PICKS_IN));
    return { ok: true, profile: profile.name, kept: kept.map((k) => (k.idea ? `idea: ${k.action}` : `${k.key.replace(/^pr:/, "")}: ${k.action}`)), dropped };
  });
}

// What the last action said (pausing, asking, cleaning up), shown under the story's title row. In
// shared state, as the buttons sit in several copies (the title row, the details, the changes); it
// goes after a few minutes.
const NOTE = "kelpie.stories.note"; // { text, full, at }
const NOTE_FOR = 5 * 60 * 1000;
const noteNow = () => { const n = shared(NOTE); return n && Date.now() - n.at < NOTE_FOR ? n : null; };
const say = (text, full = null) => setShared(NOTE, text ? { text, full, at: Date.now() } : null);

// Picking a story: a started one shows its space; one not started is previewed, from its details
// (work.js gives them the column).
// A story by key in the shown profile's list (its Done group too, or its reviews), shown as selectStory
// does: for the `kelpie.preview-<KEY>` command (scripts, tests). False when the list doesn't hold it (yet).
export function showStoryByKey(key) {
  const s = storyItems();
  const it = s && ([...s.items, ...s.done].find((x) => x.it.key === key)?.it ?? s.lone.find((r) => r.key === key));
  if (!it) return false;
  selectStory(s.st.profile, it);
  return true;
}

export function selectStory(profile, it) {
  if (it.space) { setPreview(profile, null); run("space.select", { id: it.space.id }); }
  else setPreview(profile, it.key);
}

// The story's ticket folder, when there is one: a folder named after one of its keys (the story's
// first), one or two levels under the profile's folder (<folder>/KEY, <folder>/worktrees/KEY), where
// teams keep a ticket's worktrees. The same folders changes.py reads.
async function ticketFolder(profile, it) {
  const script = 'root="$1"; shift; for k; do for d in "$root/$k" "$root"/*/"$k"; do [ -d "$d" ] && { printf %s "$d"; exit 0; }; done; done; true';
  const on = it.space ? spaces().find((s) => s.id === it.space.id)?.machine : null;
  return (await exec("sh", ["-c", script, "sh", profile.folder, ...storyKeys(it)], on ? { on } : {})).stdout.trim() || null;
}

// A name no tab in the list has: `base`, else `base 2`, `base 3`… (the lowest free), so a story's
// second terminal shows as "Terminal 2" in the tab bar.
const freeName = (base, tabs = []) => {
  const taken = new Set(tabs.map((c) => c.name));
  let n = 1;
  while (taken.has(n === 1 ? base : `${base} ${n}`)) n++;
  return n === 1 ? base : `${base} ${n}`;
};

// A plain shell for the story: a new tab on every press, as Claude's, in its space (made if needed):
// in its ticket folder when it has one, else in the repo on its branch when the changes found one.
// The main area goes back to the terminals, so the new one shows. Agents still start in the profile's
// folder. Only the first, which makes the space, goes through once(): a second press then would make a
// second space; with a space each press is its own tab.
// Exported for the tests.
export function openTerminal(profile, it) {
  if (lonePr(it) || cleaningNow(it.key)) return;
  const open = async () => {
    const folder = (await ticketFolder(profile, it).catch(() => null)) ?? (shared(COUNTS) ?? {})[it.key]?.repo ?? profile.folder;
    const tabs = it.space ? spaces().find((s) => s.id === it.space.id)?.tabs : [];
    return launch(profile, it, { name: freeName(`${it.key} terminal`, tabs), folder, argv: shellArgv(profile) });
  };
  if (!it.space) return once(it.key, open);
  setView(profile, it, "agent");
  return open();
}

// A plain Claude agent for the story, with no task: a new tab each time, in its space (made if
// needed), started in the profile's folder like every agent. Named "<KEY> claude", so it counts as the
// story's agent and the tab bar shows it as "Claude".
function openClaude(profile, it) {
  if (lonePr(it)) return;
  const name = `${it.key} claude`;
  once(it.key, () => launch(profile, it, { name, argv: claudeArgv(profile) }));
}

// Merge: the task (config.js mergeTask) asking an agent to check a story's open pull requests of
// yours are ready to merge and plan merging and deploying them.
// Request approval (approvalTask) the same, for the pull requests not approved yet. Each is a menu on
// the story itself, its header and its row in the list (Stories.taskMenu), and on the "No ticket"
// heading under Your pull requests for the Desk: a new agent, or the task sent to a Claude already open.
const STORY_TASKS = {
  merge: { task: mergeTask, tab: "merge", what: "merge" },
  approval: { task: approvalTask, tab: "approval", what: "approval request" },
};
// A story's open pull requests, for Merge, and those of them waiting on reviewers (not drafts, not
// approved), for Request approval.
const taskPrs = (it) => {
  const openPrs = allPrs(it).filter((p) => !p.merged);
  return { openPrs, unapproved: openPrs.filter((p) => !p.isDraft && p.reviewDecision !== "APPROVED") };
};
const storyTaskText = (kind, profile, it, prs) => STORY_TASKS[kind].task(profile.github, { ticket: it.key, summary: it.title, prs: prs.map((x) => `- ${x.name}: ${x.title} (${x.state}) ${x.url}`).join("\n") });

// Its agent for a story: in its space (made if needed), a tab "<KEY> <tab>" (so it counts as the
// story's agent). Its tab already open is shown instead.
function startStoryTask(kind, profile, it, prs) {
  const name = `${it.key} ${STORY_TASKS[kind].tab}`;
  const open = it.space ? spaces().find((s) => s.id === it.space.id)?.tabs.find((c) => c.name === name) : null;
  if (open) { run("space.select", { id: it.space.id }); run("tab.select", { id: open.id }); return; }
  once(it.key, () => launch(profile, it, { name, argv: claudeArgv(profile), task: storyTaskText(kind, profile, it, prs) }));
}

// Pull requests of yours that name no ticket are the Desk's: their agent opens there, a tab named
// "Merge" or "Approval" (shown instead when it's open). Their prompt has no ticket, so its lines
// naming one are left out (fillLines() in config.js).
const NO_TICKET = { key: "", title: "" };
function startDeskTask(kind, profile, prs) {
  const name = capitalize(STORY_TASKS[kind].tab);
  const open = deskOf(profile)?.tabs.find((c) => c.name === name);
  if (open) { openDesk(profile); run("tab.select", { id: open.id }); return; }
  openDesk(profile, { name, argv: claudeArgv(profile), task: storyTaskText(kind, profile, NO_TICKET, prs) });
}

// Or the same task sent to a Claude already open, as its next message, then shown. Not to one waiting
// for your answer: the message would land in its question.
function sendStoryTask(kind, profile, it, prs, agent) {
  if (agent.status === "blocked") return say(`${agent.tab_name} is waiting for your answer: answer it first.`);
  sendToClaude(agent.address, storyTaskText(kind, profile, it, prs))
    .then(() => { run("space.select", { id: agent.space }); run("pane.focus", { pane: agent.pane }); say(`Sent ${it.key ? `${it.key}'s` : "the"} ${STORY_TASKS[kind].what} to ${agent.tab_name}.`); })
    .catch((e) => say(`Couldn't send it to ${agent.tab_name}: ${String(e?.message ?? e)}`));
}

// A pull request as the Merge and Request approval tasks list it.
const prLine = (t, p) => ({ name: prName(p), title: p.title, url: p.url, state: prLook(t, p, checksOf(p))[1] });

// The Merge and Request approval menus' rows, the same on a story's row in the list and in its header,
// and on the "No ticket" heading under Your pull requests: a new agent with the task, or the task sent to one of the story's
// Claudes already open (in its space, or on one of its keys elsewhere; not another story's or
// profile's). `story` null: pull requests with no ticket, the Desk's, so its agents. Either way
// taking it ends what Next pointed at on the story.
const TASK_LOOK = { merge: { label: "Merge", glyph: "git-merge" }, approval: { label: "Request approval", glyph: "user-check" } };
function storyTaskRows(t, profile, story, kind, list) {
  const prs = list.map((p) => prLine(t, p));
  const names = new Map(spaces().map((s) => [s.id, s.name]));
  const desk = !story;
  const keys = desk ? [] : storyKeys(story);
  const open = desk ? deskAgents(profile) : agents().filter((a) => (story.space && a.space === story.space.id) || keys.includes(keyOf(a.tab_name)));
  const what = desk ? "pull requests without a ticket" : story.key;
  const took = () => { if (story) clearPoint(profile, story.key); };
  return [
    { header: `${TASK_LOOK[kind].label} for ${what} with` },
    { label: "New agent", hint: desk ? "on the Desk" : `in ${story.key}'s space`, action: () => { took(); desk ? startDeskTask(kind, profile, prs) : startStoryTask(kind, profile, story, prs); } },
    ...(open.length ? [{ header: desk ? "Or send it to the Desk's" : `Or send it to ${story.key}'s` }, ...open.map((a) => ({
      label: sessionTitle(a.title) ?? a.tab_name ?? "Claude",
      hint: `${names.get(a.space) ?? ""}${a.status === "blocked" ? " · waiting for you" : ""}`,
      action: () => { took(); sendStoryTask(kind, profile, story ?? NO_TICKET, prs, a); },
    }))] : []),
  ];
}

// Your pull requests with no ticket are the Desk's: an agent on one is a Desk tab "PR <repo>#<n>". What
// one needs goes to that agent (not while it waits for your answer), else opens one there with it as
// its first message.
const pullAgent = (p) => { const tab = reviewTab(p); return tab ? agents().find((a) => a.tab === tab.id) ?? null : null; };
function showPullAgent(p) {
  const a = pullAgent(p);
  if (!a) return false;
  run("space.select", { id: a.space });
  run("pane.focus", { pane: a.pane });
  return true;
}
function askPull(profile, p, kind) {
  const text = askOf(profile, kind, [p]);
  const a = pullAgent(p);
  if (!a) {
    openDesk(profile, { name: `PR ${prName(p)}`, argv: claudeArgv(profile), task: text });
    return say(`Asked a new agent on the Desk: ${ASK[kind].toLowerCase()} ${prName(p)}.`);
  }
  if (a.status === "blocked") return say(`${a.tab_name} is waiting for your answer: answer it first.`);
  sendToClaude(a.address, text).then(() => { showPullAgent(p); say(`Asked ${a.tab_name}: ${ASK[kind].toLowerCase()} ${prName(p)}.`); })
    .catch((e) => say(`Couldn't send it to ${a.tab_name}: ${String(e?.message ?? e)}`));
}

// Review agents gather in one space of the profile, "Reviews" (made on the first one), a tab per pull
// request. A pull request's tab already open is shown instead.
const REVIEWS = "Reviews";
const reviewTab = (p) => spaces().flatMap((s) => s.tabs).find((c) => c.name === `PR ${prName(p)}`) ?? null;
// A pull request checked out for review in a worktree of its own, worktrees/review-<repo>-<n> under
// the profile's folder, from the repository's clone at the folder's top or one level down, at the
// pull request's latest commit (detached: no branch is made, a fork's works too). Started again, the
// worktree moves to the latest commit, unless it has changes of its own (then it's left as it is).
// Prints "ok:<folder>", "dirty:<folder>" or "error:<why>".
const REVIEW_CHECKOUT = `root=$1 repo=$2 n=$3
clone=
for d in "$root/$repo" "$root"/*/"$repo"; do if [ -e "$d/.git" ]; then clone=$d; break; fi; done
[ -n "$clone" ] || { echo "error:no clone of $repo in $root"; exit 0; }
out=$(git -C "$clone" fetch --quiet origin "pull/$n/head" 2>&1) || { echo "error:couldn't fetch it: $out"; exit 0; }
sha=$(git -C "$clone" rev-parse FETCH_HEAD)
wt="$root/worktrees/review-$repo-$n"
if [ -e "$wt/.git" ]; then
  if [ -n "$(git -C "$wt" status --porcelain --untracked-files=no)" ]; then echo "dirty:$wt"; exit 0; fi
  out=$(git -C "$wt" checkout --quiet --detach "$sha" 2>&1) || { echo "error:$out"; exit 0; }
else
  mkdir -p "$root/worktrees"
  out=$(git -C "$clone" worktree add --quiet --detach "$wt" "$sha" 2>&1) || { echo "error:$out"; exit 0; }
fi
echo "ok:$wt"`;
async function checkoutReview(profile, p) {
  if (isDemo(profile)) return { folder: null, note: null };
  const r = await exec("sh", ["-c", REVIEW_CHECKOUT, "sh", profile.folder, p.repository.name, String(p.number)]).catch((e) => ({ stdout: `error:${String(e?.message ?? e)}` }));
  const line = (r.stdout ?? "").trim().split("\n").pop() ?? "";
  const [kind, ...rest] = line.split(":");
  const said = rest.join(":");
  if (kind === "ok") return { folder: said, note: null };
  if (kind === "dirty") return { folder: said, note: `${prName(p)}'s worktree has changes of its own: left at the commit it was on.` };
  return { folder: null, note: `Couldn't check ${prName(p)} out (${said || "no answer"}): its agent reads it from GitHub.` };
}

// The ticket a pull request's title names, with its summary and description as text, for the review
// prompt; only the key when Jira can't say more, nothing without a key. A subtask's story follows its
// own description ("Story KEY: summary" and the story's), as subtasks often say little themselves.
async function reviewTicket(profile, p) {
  const data = (shared(STORIES) ?? {})[profile.id]?.data;
  const ticket = data ? prKey(p, data, projectsOf(data)) : keyIn(p.title, null);
  const board = boardOf(profile);
  if (!ticket || !board) return ticket ? { ticket } : {};
  try {
    const f = await ticketText(board, ticket, data);
    const parent = f.parent ? await ticketText(board, f.parent, data).catch(() => null) : null;
    const story = parent ? [`Story ${f.parent}: ${parent.summary}`, parent.text].filter(Boolean).join("\n") : "";
    return { ticket, summary: f.summary, description: [f.text, story].filter(Boolean).join("\n\n") };
  } catch { return { ticket }; }
}

// Start review: the pull request checked out, its ticket looked up, then a Claude agent on it in the
// profile's Reviews space (a tab "PR <repo>#<n>"), started with the profile's review prompt.
export function startReview(profile, p) {
  const name = `PR ${prName(p)}`;
  setPreview(profile, null);
  const open = reviewTab(p);
  if (open) return run("tab.select", { id: open.id });
  return once(name, async () => {
    say(`Checking out ${prName(p)} for review…`);
    const [checkout, ticket] = await Promise.all([checkoutReview(profile, p), reviewTicket(profile, p)]);
    say(checkout.note);
    const task = reviewTask(profile.github, { url: p.url, repo: p.repository.name, number: p.number, title: p.title, author: p.author?.login ?? "", folder: checkout.folder ?? "", ...ticket });
    // The agent starts in the profile's folder, never in the checkout: it's someone else's code, and
    // Claude would take in its settings, hooks and instructions there. It reads the checkout by path.
    const tab = { name, folder: profile.folder, argv: claudeArgv(profile), task };
    const space = spacesOf(profile).find((s) => s.name === REVIEWS);
    if (!space) return run("space.new", { name: REVIEWS, folder: tab.folder, tab: name, argv: tab.argv, task: tab.task });
    newTab({ space: space.id, ...tab });
    run("space.select", { id: space.id });
  });
}

// What the review buttons ask the review agent. Posting is yours to choose: the agent drafted, these
// say what to do with it.

// Peek: the agent's terminal over the shown tab, to answer it without leaving the story shown.
function peekButton(t, id, agent) {
  return textButton(t, id, "Peek", () => run("terminal.peek", { terminal: agent.address }), { tip: `Answer ${agent.tab_name} here, without switching spaces` });
}

const focusAgent = (profile, it, a) => { run("space.select", { id: a.space }); run("pane.focus", { pane: a.pane }); setView(profile, it, "agent"); };

// Pull requests that change to failing checks, changes requested or ready to merge post a notification
// (Herdr already posts one for agents that need you or finished). What each was last seen as is kept in
// shared state, so the copies and a restart don't say it again; the first load after a start only
// takes note (it can't tell what changed while Herdr was closed). The profile can turn it off
// (notify.pulls).
const PR_SEEN = "kelpie.notify.prs"; // { [profile id]: { [pr url]: "fail" | "changes" | "ready" } }
// A notification's click can only run a command with no arguments, so one for a story with no space
// runs "kelpie.show-notified-<id>", and this keeps which story each id shows, for a day.
const NOTIFIED = "kelpie.notify.show"; // { [id]: { profile, key, at } }
const NOTIFIED_FOR = 24 * 60 * 60 * 1000;
let notifiedCount = 0;
function rememberNotified(profile, key) {
  const now = Date.now();
  const id = `${now.toString(36)}${notifiedCount++}`;
  const kept = Object.entries(shared(NOTIFIED) ?? {}).filter(([, n]) => n?.key && now - n.at < NOTIFIED_FOR);
  setShared(NOTIFIED, { ...Object.fromEntries(kept), [id]: { profile: profile.id, key, at: now } });
  return id;
}
const NOTED = new Set(); // profile ids loaded since this start
const PR_SAYS = { fail: ["Checks failing", "error"], changes: ["Changes requested", "warning"], ready: ["Ready to merge", "success"] };
const prState = (p) => (p.merged ? null : failing(p) ? "fail" : p.reviewDecision === "CHANGES_REQUESTED" ? "changes" : ready(p) ? "ready" : null);

function notifyPulls(ctx, data) {
  // Pull requests that didn't load aren't gone: nothing is compared until they load again.
  if (data.prError || !ctx.profile) return;
  const profile = ctx.profile;
  const first = !NOTED.has(profile.id);
  NOTED.add(profile.id);
  const all = shared(PR_SEEN) ?? {};
  const before = all[profile.id] ?? {};
  const now = {};
  const on = profile.notify?.pulls !== false;
  for (const it of build(data, new Map(), pausedIn(profile), storySpaces(profile), boardOf(ctx.setup)?.handover)) {
    for (const p of allPrs(it)) {
      const s = prState(p);
      if (!s) continue;
      now[p.url] = s;
      if (first || !on || before[p.url] === s) continue;
      // A started story's space is one click away; one not started is previewed by a quiet command
      // that names it, so an older notification still shows its own story.
      notify({
        title: `${PR_SAYS[s][0]} · ${p.key ?? it.key}`, body: `${prName(p)}: ${p.title}`, level: PR_SAYS[s][1],
        action: it.space ? { name: "space.select", args: { id: it.space.id } } : { name: `${MOD}.show-notified-${rememberNotified(profile, it.key)}` },
      });
    }
  }
  if (JSON.stringify(now) !== JSON.stringify(before)) setShared(PR_SEEN, { ...all, [profile.id]: now });
}

// agent.next / agent.prev (cmd-] / cmd-[) walk the profile's agents in the list's order: the blocked
// agents of the stories that need you first, then each story's agents as the list has them. Agents of
// no story (and other profiles') come after, as Herdr appends what's missing.
let agentOrder = null;
function orderAgents(profile, items) {
  const at = new Map(); // key -> [list position, needs you]
  items.forEach(({ it, n }, i) => { for (const k of storyKeys(it)) if (!at.has(k)) at.set(k, [i, n[0] <= NEEDS_YOU]); });
  const list = profileAgents(profile).map(({ agent, space }, j) => {
    const [i, urgent] = at.get(keyOf(agent.tab_name) ?? keyOf(space.name)) ?? [items.length, false];
    return { address: agent.address, first: urgent && agent.status === "blocked" ? 0 : 1, i, j };
  }).sort((a, b) => a.first - b.first || a.i - b.i || a.j - b.j);
  const order = list.map((x) => x.address);
  if (order.join(" ") === agentOrder) return;
  agentOrder = order.join(" ");
  setAgentOrder(order);
}

export class Stories extends Source {
  constructor() {
    super("stories", 2 * 60 * 1000);
    this.cache = CACHE;
    this.busy = BUSY;
    this.started = STARTED;
    this.again = AGAIN;
    this.extra = EXTRA; // story key -> { groups, local, at, loading, error }
    this.shots = SHOTS;
    this.file = PICKED.file; // story key -> chosen file id
    this.descs = DESCRIPTIONS;
    this.statuses = STATUSES;
    this.more = PICKED.more; // keys whose description shows in full
    this.opened = PICKED.opened; // subtask keys whose description shows under them
  }

  keyOf(setup) {
    return [boardOf(setup)?.cfg ?? null, setup.github, setup.folder];
  }

  get flash() { return noteNow()?.text ?? null; }
  set flash(text) { say(text); }

  // Stories belong to the profile, whichever of its spaces is shown.
  context() {
    const space = shownSpace();
    const profile = shownProfile();
    const setup = setupOf(space, profile);
    return { space, profile, setup, key: JSON.stringify([profile?.id, this.keyOf(setup)]) };
  }

  ready(ctx) {
    return Boolean(ctx.profile && hasBoard(ctx.setup));
  }

  // Claude sessions under the folder, with the keys they were started on (sessions.py); null when
  // that failed.
  fetchSessions({ space, setup }) {
    if (isDemo(setup.profile)) return demoSessions(setup.folder).then((list) => list.map(session)).catch(() => null);
    return readTextFile(modFile("sessions.py"))
      .then((code) => exec("python3", ["-I", "-c", code, setup.folder, "200"], space?.machine ? { on: space.machine } : {}))
      .then((r) => (r.code === 0 ? JSON.parse(r.stdout).map(session) : null))
      .catch(() => null);
  }

  // Only the sessions again (the list's copy), merged into what's loaded: an agent's tab opening or
  // closing changes them, not what Jira or GitHub say. Asked for while a full load or another read
  // runs, it isn't dropped: that one read the sessions when it began, maybe before the tab changed,
  // so they're read again once it ends (`sessionsAgain`, state()).
  loadSessions(cx) {
    const ctx = this.context();
    if (!this.loader || !this.ready(ctx) || !this.cache[ctx.key]?.data) return;
    if (this.sessionsBusy || this.busy.has(ctx.key)) { this.sessionsAgain = true; return; }
    this.sessionsAgain = false;
    this.sessionsBusy = true;
    cx.spawn(async (cx) => {
      try {
        const sessions = await this.fetchSessions(ctx);
        const entry = this.cache[ctx.key];
        if (!sessions || !entry?.data || this.busy.has(ctx.key)) return;
        this.cache[ctx.key] = { ...entry, data: { ...entry.data, sessions } };
        this.loaded(ctx);
      } finally {
        this.sessionsBusy = false;
        cx.notify();
      }
    });
  }

  async fetch({ space, setup, key }) {
    const began = Date.now();
    const owner = setup.github?.owner;
    const demo = Boolean(setup.github?.demo);
    const account = setup.github?.account ?? null;
    const since = new Date(Date.now() - MERGED_DAYS * 864e5).toISOString().slice(0, 10);
    // GitHub failing (it does answer 502 now and then) mustn't hide the stories: they show without
    // their pull requests, and the frame says why.
    let prError = null;
    const pulls = owner
      ? Promise.all([searchPulls(`user:${owner} is:pr is:open author:@me`, { demo, account }), searchPulls(`user:${owner} is:pr is:merged author:@me merged:>=${since}`, { light: true, demo, account })])
        .catch((e) => { prError = `Pull requests didn't load: ${String(e?.message ?? e)}`; return [[], []]; })
      : Promise.resolve([[], []]);
    // What doesn't wait on Jira runs beside it.
    const reviewsP = owner ? searchPulls(`user:${owner} is:pr is:open review-requested:@me`, { demo, account }).catch(() => []) : Promise.resolve([]);
    const sessionsP = this.fetchSessions({ space, setup });
    // A GitHub Project's load also says which pull requests close its issues, which repo each key's
    // issues are in, and the Project itself (board.js); Jira's has none of those.
    // A story of yours stays while something of it is here, even once the board gives it to someone
    // else (hereKeys()): the board is asked for those by key too.
    const prior = this.cache?.[key]?.data ?? null;
    const keep = { keys: hereKeys(setup.profile, prior), projects: prior ? [...projectsOf(prior)] : [], repos: prior?.repos ?? {} };
    const { site, columns, sprints, mine, parents, children, links, repos, project, kept } = await loadBoard(boardOf(setup), keep);
    const [openPrs, mergedPrs] = await pulls;
    const reviews = await reviewsP;
    const sessions = (await sessionsP) ?? [];
    return settleMoved(settlePulls({
      site, columns, sprints, mine: mine.map((i) => ({ key: i.key })), parents: parents.map(issue), children: children.map(issue), prError,
      ...(links ? { links } : {}), ...(repos ? { repos } : {}), ...(project ? { project } : {}), ...(kept?.length ? { kept } : {}),
      sessions, reviews: reviews.map(pull),
      prs: [...openPrs.map((p) => pull({ ...p, merged: false })), ...mergedPrs.map((p) => pull({ ...p, merged: true }))],
    }, began));
  }

  // The quick read (the list's copy): its open pull requests and reviews read again by id, straight
  // away and in one small question, not the searches of a whole load; what they say now is put into
  // the loaded stories at once (FRESH). Asked for while one runs, it reads again once that ends.
  quickPulls(cx) {
    const ctx = this.context();
    if (!this.loader || !this.ready(ctx) || !ctx.setup.github?.owner) return;
    if (this.quickBusy) { this.quickAgain = true; return; }
    this.quickAgain = false;
    const data = this.cache[ctx.key]?.data;
    const ids = [...(data?.prs ?? []).filter((p) => !p.merged), ...(data?.reviews ?? [])].map((p) => p.id).filter(Boolean);
    if (!ids.length) return;
    this.quickBusy = true;
    cx.spawn(async (cx) => {
      try {
        const at = Date.now();
        const found = await readPulls(ids, { demo: Boolean(ctx.setup.github?.demo), account: ctx.setup.github?.account ?? null });
        for (const n of found) FRESH[n.url] = { pr: { ...pull({ ...n, merged: n.state === "MERGED" }), ...(n.state === "CLOSED" ? { closed: true } : {}) }, at };
        if (found.length) patchLoaded(ctx.profile, withFresh);
      } catch {
        // the next load or read brings it
      } finally {
        this.quickBusy = false;
        cx.notify();
      }
    });
  }

  // Something of the profile in flight, so its pull requests are worth reading every QUICK_EVERY:
  // checks running on one of yours, or one of its agents working (it may merge or push any moment).
  inFlight(ctx) {
    const data = this.cache[ctx.key]?.data;
    if ((data?.prs ?? []).some((p) => !p.merged && ["PENDING", "EXPECTED"].includes(checksOf(p)))) return true;
    const mine = new Set(spacesOf(ctx.profile).map((s) => s.id));
    return agents().some((a) => a.status === "working" && mine.has(a.space));
  }

  // The details only read what the list loads: no timer of their own, but for one that draws again
  // now and then, so the header's status line refreshes.
  init(cx) {
    this.seen = shared(REFRESH);
    cx?.timer?.every(60 * 1000, (cx) => cx.notify());
  }

  // The list shares what it loaded with the other copies, and why it failed, so a first load that
  // fails says so everywhere instead of gathering forever.
  loaded(ctx) {
    const entry = this.cache[ctx.key];
    if (!entry) return;
    const at = entry.error ? sharedData(ctx)?.at ?? 0 : entry.at; // a failed load keeps the older data's age
    setShared(DATA, { ...(shared(DATA) ?? {}), [ctx.profile.id]: { key: ctx.key, data: entry.data, at, error: entry.error } });
  }

  // Copies other than the list read the shared copy; they never load. The list starts from that copy
  // too (it survives restarts), so stories show at once while it refreshes them: one older than the
  // timer's interval (a restart, or a profile not shown for a while) loads now, not at the next tick.
  // A failed load counts as fresh, so this doesn't retry on every draw.
  state(cx) {
    if (this.loader) {
      const ctx = this.context();
      const e = sharedData(ctx);
      if (!this.cache[ctx.key] && e?.data) this.cache[ctx.key] = { data: e.data, error: null, at: e.at };
      if (this.cache[ctx.key] && Date.now() - this.cache[ctx.key].at > this.every) this.load(cx);
      if (this.quickAgain && !this.quickBusy) this.quickPulls(cx);
      if (this.sessionsAgain && !this.sessionsBusy && !this.busy.has(ctx.key)) this.loadSessions(cx);
      return super.state(cx);
    }
    const ctx = this.context();
    const e = sharedData(ctx);
    return { ...ctx, data: e?.data ?? null, error: e?.error ?? null, at: e?.at ?? 0, loading: !e };
  }

  load(cx, opts) {
    if (!this.loader) return;
    this.fullAt = Date.now();
    super.load(cx, opts);
  }

  // An agent finishing its turn may have pushed or opened a pull request, so Jira and GitHub load
  // again, but at most once a minute: a burst of agents finishing makes one load now and one more
  // when the minute is up.
  loadAfterAgent(cx) {
    if (!this.loader) return;
    this.quickPulls(cx);
    const wait = FULL_EVERY - (Date.now() - (this.fullAt ?? 0));
    if (wait <= 0) return this.load(cx, { again: true });
    if (this.trailing) return;
    this.trailing = true;
    cx.timer.after(wait, (cx) => { this.trailing = false; this.load(cx, { again: true }); });
  }

  // Pauses agents (by key) off the render: their sessions are read first, which takes a moment.
  pauseAll(st, list, cx) {
    if (!list.length) return;
    this.flash = `Pausing ${list.map((x) => x.key).join(", ")}…`;
    cx.notify();
    cx.spawn(async (cx) => {
      const failed = await pause(st.profile, list);
      this.flash = failed.length ? `Couldn't pause ${failed.join(", ")}: no Claude session found in ${failed.length === 1 ? "its tab" : "their tabs"}.` : null;
      cx.notify();
    });
  }

  // Pauses every agent in the story's space (several on one key too), each kept under its key, then
  // closes the space, so a plain terminal left in it doesn't keep it open. When an agent couldn't be
  // paused (no Claude session found), the space stays, with that agent; the others' panes close.
  pauseStory(st, it, cx) {
    cx.spawn(async (cx) => { await pauseWholeStory(st.profile, it); cx.notify(); });
  }

  // A button for what can't be taken back: when `careful`, its first click arms it ("Confirm …") and
  // a second within ARMED_FOR does it. It's armed only for what was shown when it was pressed (the
  // same ids are on every story's header, so another story shown would have inherited it), and a
  // timer disarms it, as nothing else may redraw the view.
  // With `filled`, it's the view's main action (primaryButton).
  carefulButton(t, id, label, careful, action, { tip, confirmTip, filled = false } = {}) {
    const armed = this.armed === id && this.armedFor === this.shownKey && Date.now() - this.armedAt < ARMED_FOR;
    return (filled ? primaryButton : textButton)(t, id, armed ? `Confirm ${label.toLowerCase()}` : label, (_e, cx) => {
      if (careful && !armed) {
        const at = (this.armedAt = Date.now());
        this.armed = id; this.armedFor = this.shownKey;
        cx.timer.after(ARMED_FOR, (cx) => { if (this.armedAt === at && this.armed === id) { this.armed = null; cx.notify(); } });
        cx.notify(); return;
      }
      this.armed = null;
      action(cx);
    }, { on: armed, tip: careful && !armed ? confirmTip ?? tip : tip });
  }

  // Clean up, a broom icon (the header's, and each row in the list), only while a finished story
  // leaves something to clean (cleanable()); it asks first in a dialog, which says what goes.
  // While it's being cleaned up, the working mark in its place (busyMark).
  cleanButton(t, st, it, id = "story-clean", { box = CONTROL } = {}) {
    const busy = busyOf(it.key);
    if (busy?.kind === "clean") return busyMark(t, id, busy, { box });
    return iconButton(t, id, own("brush-cleaning"), () => askCleanUp(st.profile, it), `Clean up ${it.key}: ${cleanable(st.profile, it).join(", ")}`, { box });
  }

  // Move to Done, a double check (the header's icons, and each Built / Waiting on others row in the
  // list), while something of the story is yours to move; it asks first in a dialog listing each ticket.
  // While it moves, the working mark in its place, with how far it got in the header (`words`).
  finishButton(t, st, it, id = "story-finish", { words = false, box = CONTROL } = {}) {
    const busy = busyOf(it.key);
    if (busy?.kind === "done") return busyMark(t, id, busy, { words, box });
    const done = doneName(st.data);
    return iconButton(t, id, own("check-check"), () => askMoveToDone(st, it),
      it.story ? `Move to ${done}: your subtasks of ${it.key}, then the story` : `Move ${it.key} to ${done}`, { box });
  }

  // A small menu (ui.js menuButton), its open state kept on this view.
  menuButton(t, id, label, rows, tip, opts = {}) {
    return menuButton(this, t, id, label, rows, { tip, ...opts });
  }

  // A shining box's size (borderGlint() needs it) and the zoom (from shineProbe()), kept on this
  // copy; redrawn only when one changes.
  shineSize(id, size, cx) {
    const was = this.shine?.[id];
    if (was && Math.abs(was.width - size.width) < 0.01) return;
    this.shine = { ...(this.shine ?? {}), [id]: { ...(was ?? {}), width: size.width } };
    cx.notify();
  }
  shineProbe(id) {
    return div().id(`${id}-zoom-probe`).absolute().top(0).left(0).w(100).h(0).on_size_change((size, cx) => {
      const zoom = size.width / 100, was = this.shine?.[id];
      if (!zoom || (was && Math.abs((was.zoom ?? 0) - zoom) < 0.001)) return;
      this.shine = { ...(this.shine ?? {}), [id]: { ...(was ?? {}), zoom } };
      cx.notify();
    });
  }

  // A ticket's status chip. A click lists the statuses Jira lets it move to (its workflow's
  // transitions, loaded when the menu opens); picking one moves it and loads the stories again. The
  // new status shows at once, for a minute or until the loaded data has it (Jira's search lags). A
  // GitHub Project's issue moves among the Project's Status options; one that isn't on the Project has
  // no Status there, so its chip is only the lozenge.
  statusChip(t, st, key, status, category, id, cx) {
    const moved = MOVED[key];
    const shown = moved && moved.status !== status && Date.now() - moved.at < MOVED_FOR ? moved : { status, category };
    // Moving (its own move, or Move to Done on it now): the working mark in the lozenge's place. Held
    // by a run on its story (waiting its turn in Move to Done, or a clean-up): the lozenge alone.
    const busy = ticketBusy(key);
    if (busy && (busy.kind === "move" || busy.on === key)) {
      return div().id(`${id}-more`).flex_none().p(2).tooltip(busy.kind === "move" ? busy.step : `Moving ${key} to Done…`).child(mark(t, "working", 14));
    }
    if (busy) return div().id(`${id}-more`).flex_none().p(2).tooltip(busyText(busy)).child(lozenge(t, shown.status, shown.category));
    if (!movable(boardOf(st.setup), key, st.data)) {
      return div().id(`${id}-more`).flex_none().p(2).tooltip("Not on the board's Project, so its status can't be changed here").child(lozenge(t, shown.status, shown.category));
    }
    const m = this.menu === id ? this.transitionsOf(st, key, cx) : MOVES[key];
    const list = (m?.list ?? []).filter((x) => x.to !== shown.status);
    const rows = !m || m.loading ? [{ header: "Loading…" }] : m.error ? [{ header: m.error }]
      : !list.length ? [{ header: "Nowhere else to move it." }]
      : [{ header: `Move ${key} to` }, ...list.map((x) => ({ label: x.to, hint: x.name.toLowerCase() !== x.to.toLowerCase() ? x.name : null, action: (cx) => this.move(st, key, x, cx) }))];
    return this.menuButton(t, id, "", rows, null, {
      width: 260, anchor: "top_right",
      trigger: (toggle, open) => div().id(`${id}-more`).flex_none().p(2).rounded(6).cursor_pointer().when(open, (el) => el.bg(t.selected))
        .hover((el) => el.bg(t.hover)).tooltip("Change the status").on_click(toggle).child(lozenge(t, shown.status, shown.category)),
    });
  }

  transitionsOf(st, key, cx) {
    const m = MOVES[key];
    if (m && (m.loading || Date.now() - m.at < (m.error ? 5000 : 60 * 1000))) return m;
    MOVES[key] = { loading: true, at: 0 };
    cx.spawn(async (cx) => {
      try {
        MOVES[key] = { list: await statusOptions(boardOf(st.setup), key, st.data), at: Date.now() };
      } catch (e) {
        MOVES[key] = { error: String(e?.message ?? e), at: Date.now() };
      }
      cx.notify();
    });
    return MOVES[key];
  }

  // One move per ticket at a time (busyOf `move:<key>`, its chip spinning meanwhile): a second pick
  // before the first answers is refused, as is one while a run on its story holds it.
  move(st, key, x, cx) {
    const held = ticketBusy(key);
    if (held) return say(`${key} ${{ move: "is still moving", done: "is moving to Done", clean: "is being cleaned up" }[held.kind]}: wait for that to finish.`);
    const at = takeBusy(`move:${key}`, { kind: "move", keys: [key], step: `Moving ${key} to ${x.to}…` }, MOVE_FOR);
    say(`Moving ${key} to ${x.to}…`);
    cx.spawn(async (cx) => {
      try {
        await moveStatus(boardOf(st.setup), key, x, st.data);
        noteMoved(st.profile, key, x, boardOf(st.setup));
        say(`${key} moved to ${x.to}.`);
        setShared(REFRESH, Date.now());
      } catch (e) {
        say(`Couldn't move ${key} to ${x.to}: ${String(e?.message ?? e)}`);
      }
      endBusy(`move:${key}`, at);
      cx.notify();
    });
  }

  // Earlier sessions on a key as menu rows (title and age, newest first): a click resumes that one.
  sessionRows(st, it, key, list) {
    return list.map((x) => ({ label: x.title || "Untitled session", hint: `${ago(x.updated)} ago`, tip: x.title || x.id,
      action: () => once(it.key, () => resumeSession(st.profile, it, key, x)) }));
  }

  // What can be done with the agent on a key of story `it`: show or pause the one running (one at
  // work asks first), resume a paused one or an earlier session, or start one with the profile's
  // ticket prompt. Agents start in the story's space; a story not started yet gets its space then.
  // The subtask rows' (the header has its own, headActions). With `calm` (a row at rest), only what
  // can't wait: Peek, while its agent asks something. The agent's state is the row's mark (agentSlot).
  agentButtons(t, st, it, id, key, agent, paused, last, { calm = false } = {}) {
    const b = (suffix, label, action, tip) => textButton(t, `${id}-${suffix}`, label, action, { tip });
    if (calm) return agent?.status === "blocked" ? [peekButton(t, `${id}-peek`, agent)] : [];
    if (agent) return [
      // An agent asking something can be answered from here, over the shown tab (the header has its own);
      // it takes Pause's place (Pause stays in the header and on its key).
      ...(agent.status === "blocked" ? [peekButton(t, `${id}-peek`, agent)] : []),
      b("show", "Show agent", () => { run("space.select", { id: agent.space }); run("pane.focus", { pane: agent.pane }); setView(st.profile, it, "agent"); }, `Show ${agent.tab_name}: ${AGENT[agent.status][0].toLowerCase()}`),
      ...(agent.status === "blocked" ? [] : [this.carefulButton(t, `${id}-pause`, "Pause", agent.status === "working", (cx) => this.pauseAll(st, [{ key, agent }], cx),
        { tip: "Close its tab and keep its Claude session to resume later", confirmTip: `${agent.tab_name} is working: click again to pause it anyway` })]),
    ];
    if (paused) return [b("resume", "Resume", () => once(it.key, () => resume(st.profile, it, key)), `Paused: bring back ${paused.length === 1 ? "its session" : `its ${paused.length} sessions`} where ${paused.length === 1 ? "it" : "they"} left off`)];
    const start = () => once(it.key, () => launch(st.profile, it, { name: key, argv: claudeArgv(st.profile), task: ticketTask(st, it, key) }));
    const word = it.space ? "agent" : "work";
    // One action, Resume: starting fresh and the other sessions (each with its age) are in the ▾
    // beside it, held to it as one split button.
    if (last) {
      const all = sessionsFor(st.data, key);
      const rows = [
        { label: it.space ? "New agent" : "Start fresh", tip: `Start a fresh Claude agent on ${key}`, action: start },
        { header: all.length > 1 ? `Resume one of ${all.length} sessions` : "Resume the session" }, ...this.sessionRows(st, it, key, all),
      ];
      return [h_flex().flex_none().items_center()
        .child(b("resume", "Resume", () => once(it.key, () => resumeSession(st.profile, it, key, last)), `Continue "${last.title || "the last session"}" (${ago(last.updated)} ago)`))
        .child(this.menuButton(t, id, "▾", rows, `Start fresh, or resume another session on ${key}`))];
    }
    return [b("start", `Start ${word}`, start, `Start a Claude agent on ${key}${it.space ? "" : ", in a new space for the story"}`)];
  }

  // A subtask's agent as a mark, in a slot of the same width on every row: working, waiting for you,
  // done or idle (a skin's mark, else Kelpie's), or paused; empty when it has none.
  agentSlot(t, s) {
    const a = s.agent;
    const m = a ? statusMark(t, agentState(a.status), { where: "sub", size: 8, color: t[AGENT[a.status][1]], agent: a }) ?? mark(t, agentState(a.status) ?? "idle", 14)
      : s.paused ? mark(t, "paused", 14) : null;
    return h_flex().id(`sub-mark-${s.key}`).flex_none().w(16).justify_center().items_center()
      .when(Boolean(m), (el) => el.tooltip(a ? `${a.tab_name}: ${AGENT[a.status][0].toLowerCase()}` : "Paused: its session is kept to resume").child(m));
  }

  // Whether a subtask row shows all its actions: while hovered (`this.hoverSub`, this copy's), and
  // while one of them is in use, so it doesn't vanish under the pointer on its way to the menu (its
  // ▾ open) or between the two clicks of Pause (armed).
  subAwake(key) {
    const id = `sub-agent-${key}`;
    return this.hoverSub === key || this.menu === id || (this.armed === `${id}-pause` && Date.now() - this.armedAt < ARMED_FOR);
  }

  // Sends a request to the agent on a key: typed into the open one, else as the first message of
  // its paused session or latest session brought back, else of a new agent. An agent waiting for an
  // answer gets nothing typed into it: what it asked comes first.
  ask(st, it, key, text, cx) {
    clearPoint(st.profile, it.key);
    const sub = it.subs.find((s) => s.key === key);
    const agent = sub?.agent ?? (key === it.key ? it.agent : null) ?? (sub && !sub.paused && !sub.last ? it.agent : null);
    if (agent) {
      if (agent.status === "blocked") { this.flash = `${agent.tab_name} is waiting for your answer: answer it first.`; cx.notify(); return; }
      sendToClaude(agent.address, text).then(() => { run("space.select", { id: agent.space }); run("pane.focus", { pane: agent.pane }); }).catch((e) => { this.flash = `Couldn't send it to ${agent.tab_name}: ${String(e?.message ?? e)}`; cx.notify(); });
    } else if (pausedIn(st.profile)[key]) once(it.key, () => resume(st.profile, it, key, text));
    else if (sub?.last ?? (key === it.key ? it.last : null)) once(it.key, () => resumeSession(st.profile, it, key, sub?.last ?? it.last, text));
    // A new agent knows nothing yet: the ticket prompt comes first.
    else once(it.key, () => launch(st.profile, it, { name: key, argv: claudeArgv(st.profile), task: `${ticketTask(st, it, key)}\n\n${text}` }));
    this.flash = `Asked ${key}'s agent: ${text.length > 70 ? text.slice(0, 70) + "…" : text}`;
    cx.notify();
  }

  // One button for what some pull requests need. Merging can't be undone, so it asks for a second
  // click first.
  askButton(t, st, it, id, kind, prs, filled = false) {
    const text = askOf(st.profile, kind, prs);
    const key = prs[0].key ?? it.key;
    return this.carefulButton(t, id, ASK[kind], kind === "merge", (cx) => this.ask(st, it, key, text, cx),
      { tip: text, confirmTip: `Click again to ask ${key}'s agent to ${kind} ${prs.map(prName).join(", ")}`, filled });
  }

  // A pull request's line: its state's mark and its title (the ticket key it starts with left out,
  // as the row it's under says it), then where it is, its state in a few words in its colour and how
  // long since it changed, and the button for what it needs, in columns that line up down the list
  // (column()). The whole line opens it; a merged one sits back.
  pr(t, p, st, it) {
    const [state, words, color] = prLook(t, p, checksOf(p));
    const kind = askFor(p);
    const name = prName(p);
    const title = String(p.title ?? "").replace(/^\s*(?:\[[^\]]*\]|[A-Z][A-Z0-9_]*-\d+)[\s:\u2014-]*/, "") || name;
    return h_flex().gap(10).items_center().min_w(0).text_size(SMALL)
      .child(h_flex().id(`pr-${name}`).flex_1().min_w(0).h(CONTROL).gap(8).items_center().cursor_pointer().rounded(6).hover((x) => x.text_color(t.accent))
        .text_color(p.merged ? t.muted : t.foreground).tooltip(`${words} · ${p.title}`).on_click(() => open(p.url))
        .child(div().flex_none().child(mark(t, state, 14)))
        .child(div().flex_1().min_w(0).truncate().text_size(TEXT).child(title))
        .child(this.column("pr-where", name, h_flex().flex_none().text_color(t.dim).child(name)))
        .child(this.column("pr-state", name, h_flex().flex_none().gap(6).items_center()
          .child(div().text_color(p.merged ? t.dim : color).child(PR_SHORT[state] ?? words))
          .when(Boolean(p.updatedAt), (el) => el.child(div().text_color(t.dim).child(ago(p.updatedAt)))))))
      // The button keeps a column of its own, empty on lines with none, so the columns before it line up.
      .child(this.column("pr-ask", name, h_flex().flex_none().items_center()
        .when(Boolean(kind), (el) => el.child(this.askButton(t, st, it, `ask-${kind}-${name}`, kind, [p])))));
  }

  // A story in the list: its title, then its key and what it needs. A sunk one is drawn quieter, as
  // it waits on others.
  row(t, it, on, cx, st = null) {
    const n = need(it);
    const [, line, color] = n;
    const quiet = sunk(it, n);
    const state = storyState(it, n);
    const busy = busyOf(it.key);
    const sign = statusMark(t, state, { where: "row", size: 8, color: t[color] });
    // The second line is the key and its badges; the sentence of what it needs is the row's tooltip.
    const badges = storyBadges(t, it, { bar: false }), subs = subsLine(t, it);
    const tasks = st && busy?.kind !== "clean" ? this.rowTasks(t, st, it) : [];
    const acts = [
      // Merge and Request approval for its pull requests, at hand without opening it (rowTasks); their
      // clicks stay off the row, as the broom's do.
      tasks.length > 0 && h_flex().id(`tasks-${it.key}`).flex_none().gap(2).on_mouse_down("left", stop).on_click(stop).children(tasks),
      // A built story's Move to Done (sunk: under Built / Waiting on others), at hand without opening
      // it; its clicks stay off the row, as the broom's do. While it moves, the working mark in its place.
      Boolean(st) && quiet && finishes(st?.setup) && (canMoveToDone(it) || busy?.kind === "done") && busy?.kind !== "clean"
        && div().id(`finish-${it.key}`).flex_none().on_mouse_down("left", stop).on_click(stop).child(this.finishButton(t, st, it, `finish-${it.key}-button`, { box: ROW_CONTROL })),
      // A finished story's broom, at hand without opening it; its clicks stay off the row. While it's
      // being cleaned up, the working mark in its place (it may have nothing left to clean by then).
      Boolean(st) && (cleanable(st?.profile, it).length > 0 || busy?.kind === "clean")
        && div().id(`clean-${it.key}`).flex_none().on_mouse_down("left", stop).on_click(stop).child(this.cleanButton(t, st, it, `clean-${it.key}`, { box: ROW_CONTROL })),
    ].filter(Boolean);
    // How many buttons that is (the pull requests' menus are one or two), for the room the title leaves.
    const buttons = acts.length - (tasks.length > 0 ? 1 : 0) + tasks.length;
    return decor("rowDecor", t, h_flex().id(`story-${it.key}`).flex_none().px(8).py(7).gap(10).items_start().rounded(8).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => selectStory(this.profile, it)).tooltip(line)
      .when(Boolean(st), (el) => el.on_hover((over, cx) => {
        const was = this.hoverRow;
        // The row left may report after the row entered: only its own leaving clears it.
        this.hoverRow = over ? it.key : was === it.key ? null : was;
        if (this.hoverRow !== was) cx.notify();
      }))
      .child(sign ? div().flex_none().mt(1).child(sign) : div().flex_none().mt(1).child(mark(t, state === "done" ? "ready" : state, 16)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        // A title line of a set height, so the actions laid over the row's corner (rowActions()) are
        // placed by numbers, not by a font's line; the title stops short of them.
        .child(skinFont(div(), "ui").h(ROW_TITLE).line_height(`${ROW_TITLE}px`).min_w(0).truncate().font_medium().when(quiet, (el) => el.text_color(t.muted))
          .when(buttons > 0, (el) => el.mr(buttons * ROW_CONTROL + (buttons - 1) * 2 + 6)).child(it.title))
        .child(h_flex().min_w(0).h(14).gap(8).items_center().text_size(SMALL).when(quiet, (el) => el.opacity(0.6))
          // It has a space on this machine: its key brighter, saying so in its tooltip (the groups go by
          // the board). A mark of its own took the room the labels need (#53).
          .child(it.space
            ? skinFont(div().id(`here-${it.key}`), "numbers").flex_none().text_color(t.muted).tooltip("Open here: it has a space on this machine").child(it.key)
            : skinFont(div(), "numbers").flex_none().text_color(t.dim).child(it.key))
          // Someone else has it now: who, as their avatar (the row's tooltip says it in words).
          .when(Boolean(it.reassigned), (el) => el.child(div().id(`gone-${it.key}`).flex_none()
            .child(avatar(t, it.reassigned.to[0] ?? null, 14, `${reassignedWords(it)}: kept here until you clean it up`))))
          .children(badges)
          // What kind of work it is, at the line's end in whole words: the marks before it keep their
          // places down the list.
          .when(Boolean(it.tags?.length), (el) => el.child(this.fittedTags(t, it.tags, `tags-${it.key}`, it.key))))
        // Where your subtasks stand, as a thin line under it; muted with the key line on a sunk row.
        .when(Boolean(subs), (el) => el.child(quiet ? subs.opacity(0.6) : subs)))
      .when(acts.length > 0, (el) => el.relative().child(this.rowActions(it, acts))),
      { selected: on, state, story: it, now: new Date() });
  }

  // A line's tags, as many as fit the room it leaves them (fitTags()), at its end: a list row's key line
  // and the story's title row. The room and each tag's width are measured as drawn (the room by the
  // zone itself, the tags and "+n" by hidden copies) and kept raw on this copy (`this.tagFit`); they're
  // turned into the layout's units at render with the zoom then known (a 100-wide probe), so which size
  // Herdr reports first doesn't matter. Until they're known the first two show, shrinking, so nothing
  // ever runs past the line.
  fittedTags(t, tags, id, at) {
    const m = (this.tagFit ??= { zoom: 100, room: {}, w: {}, more: 0 });
    const keep = (put) => (size, cx) => { if (put(size.width)) cx.notify(); };
    const raw = (get, set) => keep((w) => { const was = get(); if (was !== undefined && Math.abs(was - w) < 0.5) return false; set(w); return true; });
    const z = m.zoom / 100 || 1;
    const widths = tags.map((x) => m.w[`${x.from}:${x.name}`]);
    const known = m.room[at] !== undefined && m.more > 0 && widths.every((w) => w !== undefined);
    // "+n" was measured as "+2"; a count of two digits ("+10") takes a third more.
    const more = m.more / z * (String(tags.length).length + 1) / 2;
    const fit = known ? fitTags(widths.map((w) => w / z), m.room[at] / z, more) : null;
    const shown = fit ? tags.slice(0, fit.n) : tags.slice(0, 2);
    const rest = tags.slice(shown.length);
    const probes = div().absolute().top(0).left(0).invisible()
      .child(div().id(`${id}-zoom`).w(100).h(0).on_size_change(raw(() => m.zoom, (w) => { if (w) m.zoom = w; })))
      .child(h_flex().gap(TAG_GAP)
        .children(tags.map((x, i) => tagChip(t, x, `${id}-m${i}`, { whole: true })
          .on_size_change(raw(() => m.w[`${x.from}:${x.name}`], (w) => { m.w[`${x.from}:${x.name}`] = w; }))))
        .child(tagMore(t, [tags[0], tags[0]], `${id}-mmore`).on_size_change(raw(() => m.more, (w) => { m.more = w; }))));
    return h_flex().id(`${id}-zone`).relative().flex_1().min_w(0).h(15).gap(TAG_GAP).items_center().justify_end().overflow_hidden()
      .on_size_change(raw(() => m.room[at], (w) => { m.room[at] = w; }))
      .child(probes)
      .child(h_flex().id(id).flex_shrink(1).min_w(0).gap(TAG_GAP).items_center()
        .children(shown.map((x, i) => tagChip(t, x, `${id}-${i}`, fit ? (fit.cut !== null && i === 0 ? { w: fit.cut } : { whole: true }) : {})))
        .when(rest.length > 0 && (!fit || fit.more), (el) => el.child(tagMore(t, rest, `${id}-more`))));
  }

  // A story row's actions (two can show at once), compact (ROW_CONTROL) and centred on its title line,
  // laid over the row so a row is as high with them as without and the key line's labels and the
  // subtasks' line keep the row's whole width (#53). By the numbers (row()): the row's padding is 7
  // and its title line ROW_TITLE (20), so the title's middle is 17; buttons 22 high from ACTIONS_TOP (6)
  // have theirs there too and end at 28, above the key line (7 + 20 + 2 = 29; its tags, 15 high on a
  // 14 line, from 28.5), and 6 in from the row's top. Nothing is painted behind them: the title stops
  // short of them.
  rowActions(it, acts) {
    return h_flex().id(`actions-${it.key}`).absolute().top(ACTIONS_TOP).right(8).h(ROW_CONTROL).gap(2).items_center().children(acts);
  }

  // A story row's Merge and Request approval (the header's menus): Merge shows at rest while one of its
  // pull requests is ready to merge, so landing a story's work is one click from the list; on the row
  // hovered (`this.hoverRow`, this copy's) Merge shows for any open one, and Request approval while one
  // waits on reviewers, unless the person works alone (nobody to approve). A menu stays while it's
  // open, so it doesn't vanish on the pointer's way to it.
  rowTasks(t, st, it) {
    if (lonePr(it)) return [];
    const { openPrs, unapproved } = taskPrs(it);
    const id = (kind) => `${kind}-${it.key}`;
    const awake = (kind) => this.hoverRow === it.key || this.menu === id(kind);
    return [
      unapproved.length && !worksAlone(st.setup) && awake("approval") ? this.taskMenu(t, st, it, "approval", unapproved, id("approval"), false, ROW_CONTROL) : null,
      openPrs.length && (openPrs.some(ready) || awake("merge")) ? this.taskMenu(t, st, it, "merge", openPrs, id("merge"), false, ROW_CONTROL) : null,
    ].filter(Boolean);
  }

  // The header's title row, all of it when folded: the fold chevron, key, title, what it needs (coloured
  // as in the list) and its status.
  // The header's one row, folded or not, so nothing moves when it folds: chevron, key, title, state,
  // status, then what can be done (the main action filled) at the right.
  headRow(t, st, it, shut, cx) {
    const n = need(it);
    const [, line, color] = n;
    // A story not opened always shows its details (they're all there is), so it has no fold.
    const folds = viewOf(st.profile, it) !== "start";
    const lone = lonePr(it);
    const where = lone ? { label: prName(lone), tip: "Open on GitHub", url: lone.url } : { label: it.key, tip: boardOf(st.setup)?.kind === "project" ? "Open on GitHub" : `Open in ${boardOf(st.setup)?.name ?? "the board"}`, url: ticketUrl(boardOf(st.setup), st.data, it.key) };
    const { actions, tasks = [], clean, more } = this.headActions(t, st, it, cx);
    // A skin may draw the story's subtasks as a meter (none by default).
    const subMeter = it.story ? skinMeter(t, { kind: "subtasks", label: "Subtasks", done: it.subs.filter((s) => s.category === "done").length, total: it.subs.length }) : null;
    // As wide as the block, never wider: a long title truncates so the actions stay on screen.
    // Two parts: what can be done (right) keeps its size; the key, title and state (left) take what's
    // left, the title truncating first, so the actions and icons never leave the screen.
    return h_flex().flex_none().w_full().gap(8).items_center().min_w(0).overflow_hidden()
      .child(h_flex().id("story-head-text").flex_1().min_w(0).overflow_hidden().gap(8).items_center()
        .child(skinFont(div().id("story-key").flex_none().text_color(t.accent), "key", SMALL).cursor_pointer().tooltip(where.tip)
          .on_click(() => open(where.url)).child(skinText(where.label, "key")))
        // The progress line gives way first, then the title truncates (its tip carries both); the
        // meter and the status chip never shrink, so nothing is cut mid-word.
        .child(skinFont(div(), "title").id("story-title").min_w(0).flex_shrink(1).truncate().text_size(TITLE).font_semibold()
          .tooltip(line ? `${it.title}\n${line}` : it.title).child(it.title))
        .child(skinFont(div().id("story-need").min_w(0).flex_shrink(40).truncate().font_medium()
          .text_color(sunk(it, n) ? t.dim : color === "dim" ? t.muted : t[color]), "meta", SMALL).tooltip(line).child(skinText(line, "meta")))
        // What kind of work it is, in the room left before the assignee: as many whole tags as fit
        // (fittedTags()), so they give way before the title and never push the status off the line.
        .child(it.tags?.length ? this.fittedTags(t, it.tags, "story-tags", `head:${it.key}`) : div().flex_1())
        .when(Boolean(subMeter), (el) => el.child(div().flex_none().child(subMeter)))
        .when(!it.review && !it.pr && !lonePr(it), (el) => el.child(assigned(t, "story-assignee", it.assignee, it.mine, it.avatar)))
        .when(Boolean(it.status), (el) => el.child(it.review || it.pr ? div().flex_none().child(lozenge(t, it.status, it.category))
          : this.statusChip(t, st, it.key, it.status, it.category, "story-status-menu", cx))))
      .child(h_flex().flex_none().gap(6).items_center().ml(8).children(actions))
      // Then the routine ones, as icons after a thin line: reload, open in Jira (GitHub for a review),
      // More, and the fold.
      .child(div().w(1).h(16).mx(2).flex_none().bg(t.border))
      // Its width spelled out: measured from its parts it came out near zero on an open story (the
      // icons then drew over each other, under the actions, or past the edge).
      .child(h_flex().flex_none().min_w((2 + tasks.length + (clean ? 1 : 0) + (more ? 1 : 0) + (folds ? 1 : 0)) * (CONTROL + 2)).gap(2).items_center()
        .children(tasks)
        .when(Boolean(clean), (el) => el.child(clean))
        .child(iconButton(t, "story-refresh", own("refresh-cw"), () => setShared(REFRESH, Date.now()), "Refresh: load the stories again"))
        .child(iconButton(t, "story-open", own("external-link"), () => open(where.url), where.tip))
        .when(Boolean(more), (el) => el.child(more))
        .when(folds, (el) => el.child(iconButton(t, "story-fold", chrome(shut ? "chevron-right" : "chevron-down"), () => foldHead(!shut),
          `${shut ? "Show the story's details" : "Fold the header to this row"} ⌘⇧H`))));
  }

  // A story's Merge or Request approval menu (storyTaskRows), the same in its header and on its row in
  // the list: an icon, or with `filled` the header's main action "<label> all ▾".
  taskMenu(t, st, it, kind, list, id, filled = false, box = CONTROL) {
    const { label, glyph } = TASK_LOOK[kind];
    const tip = `${label} ${kind === "merge" ? "its pull requests" : "for its pull requests waiting on reviewers"}, with a new agent or an open Claude`;
    return this.menuButton(t, id, "", storyTaskRows(t, st.profile, it, kind, list), tip, filled
      ? { width: 340, trigger: (toggle) => primaryButton(t, `${id}-all`, `${label} all ▾`, toggle, { tip }) }
      : { width: 340, iconPath: own(glyph), box });
  }

  // The header's actions, few: one filled main action (the most urgent: answer the agent asking, the
  // pull request action, else show, resume or start its agent), Pause while it has a space, and More
  // (⋯, `more`, drawn with headRow's icons) for the rest. Per-agent Show and Pause stay on the subtask
  // rows; the key and headRow's open icon open Jira.
  headActions(t, st, it, cx) {
    // A run on the story (a clean-up, Move to Done): its mark says how far it got and how long it's
    // taken, so the header redraws each second meanwhile (one timer per copy).
    const busy = busyOf(it.key);
    if (busy && cx && !this.busyTick) {
      this.busyTick = true;
      cx.timer.after(1000, (cx) => { this.busyTick = false; cx.notify(); });
    }
    // Being cleaned up: nothing to start or change on it until that ends, only its mark.
    if (busy?.kind === "clean") return { actions: [], tasks: [], clean: busyMark(t, "story-clean", busy, { words: true }), more: null };
    if (it.review) return { actions: this.reviewActions(t, st, it), more: null };
    if (it.pull) return { actions: this.pullActions(t, st, it), more: null };
    const live = allAgents(it);
    const waiting = live.find((a) => a.status === "blocked");
    // The most urgent pull request action, when those PRs are one ticket's.
    // need()'s ranks: 1 changes requested, 2 failing checks, 3 ready to merge.
    const headKind = { 1: "comments", 2: "fix", 3: "merge" }[need(it)[0]];
    const headPrs = headKind ? allPrs(it).filter((p) => askFor(p) === headKind) : [];
    const headAsk = headPrs.length && new Set(headPrs.map((p) => p.key)).size === 1 ? { kind: headKind, prs: headPrs } : null;
    // What cmd-shift-r does (startWork): the whole story's agent, or a ticket's single one.
    const ticket = it.story ? it : it.subs[0];
    const key = ticket.key;
    const paused = allPaused(it);
    const work = live.length ? (viewOf(st.profile, it) === "agent" ? null : { label: "Show agent", tip: "Show its agent" })
      : paused.length ? { label: "Resume", tip: `Bring back ${paused.length === 1 ? "its paused session" : `its ${paused.length} paused sessions`} where they left off` }
      : ticket.last ? { label: "Resume", tip: `Continue "${ticket.last.title}" (${ago(ticket.last.updated)} ago)`, last: true }
      : { label: it.space ? "Start agent" : "Start work", tip: `Start a Claude agent on ${key}${it.space ? "" : ", in a new space for the story"}`, fresh: true };
    // A finished story the list left out (its Done group's) is nothing to start: no filled Start work,
    // though More still starts one afresh, and Resume stays for a session of its own.
    const over = settled(it) && !live.length && !paused.length;
    const go = work && !(over && work.fresh) && primaryButton(t, "story-main", work.label, () => startWork(st, it), { tip: `${work.tip} ⌘⇧R` });
    // Its open pull requests, for Merge and Request approval (the same menus as on its row in the
    // list, rowTasks). With more than one ready to merge, the main action is Merge all: the Merge
    // menu, filled (an agent checks them and plans merging them together).
    const { openPrs, unapproved } = taskPrs(it);
    const taskMenu = (kind, list, filled = false) => this.taskMenu(t, st, it, kind, list, `story-${kind}`, filled);
    const mergeAll = headKind === "merge" && headPrs.length > 1 ? taskMenu("merge", openPrs, true) : null;
    const peek = waiting && primaryButton(t, "story-peek", "Peek", () => { clearPoint(st.profile, it.key); run("terminal.peek", { terminal: waiting.address }); },
      { tip: `Answer ${waiting.tab_name} here, without switching spaces` });
    const [primary, step] = peek ? [peek, "peek"] : mergeAll ? [mergeAll, "merge"]
      : headAsk ? [this.askButton(t, st, it, `story-ask-${headAsk.kind}`, headAsk.kind, headAsk.prs, true), headAsk.kind] : [go, null];
    // What Next pointed at (pointFor): its button lit, a soft halo breathing slowly behind it (native,
    // 3.2 s), so the eye finds it without anything blinking.
    const lit = step && pointFor(st.profile, it)?.kind === step;
    const main = lit ? div().id("story-pointed").flex_none().relative().p(3)
      .child(div().absolute().inset_0().rounded(10).bg(tint(t.accent, "40")).loop("opacity", { from: 0.35, to: 1, period: 3200, easing: "ease-in-out" }))
      .child(primary) : primary;
    // Pausing the story pauses every agent in its space and closes it: it asks first when an agent is
    // at work, or the space holds tabs with no agent, which close with it.
    const why = it.space ? pauseWhy(it) : "";
    const pauseIt = it.space ? this.carefulButton(t, "story-pause", "Pause", Boolean(why), (cx) => this.pauseStory(st, it, cx),
      { tip: "Pause every agent of this story and close its space; their sessions are kept ⌥⌘P", confirmTip: `${capitalize(why)}: click again to pause the story anyway` }) : null;
    const start = () => once(it.key, () => launch(st.profile, it, { name: key, argv: claudeArgv(st.profile), task: ticketTask(st, it, key) }));
    const conductor = it.story ? boardOf(st.setup)?.orchestrator?.trim() : null;
    const earlier = sessionsFor(st.data, key).filter((x) => !(work?.last && x.id === ticket.last.id));
    const rows = [
      // The main action, when a pull request's or the agent's took its place.
      ...(work && primary !== go && !live.length ? [{ label: work.label, tip: `${work.tip} ⌘⇧R`, action: () => startWork(st, it) }] : []),
      // With a space, more agents come from the tab bar's +; before one, this starts the story afresh
      // instead of resuming its last session.
      ...((work?.fresh && !over) || it.space ? [] : [{ label: "Start fresh", tip: `Start a fresh Claude agent on ${key}`, action: start }]),
      ...(conductor ? [{ label: "Start orchestrator", tip: `Start one Claude agent that runs ${key} through its subtasks, with the profile's orchestrator prompt`,
        action: () => once(it.key, () => launch(st.profile, it, { name: key, argv: claudeArgv(st.profile), task: ticketTask(st, it, key, conductor) })) }] : []),
      ...(earlier.length ? [{ header: `Resume a session on ${key}` }, ...this.sessionRows(st, it, key, earlier)] : []),
    ];
    // A finished story (done, or every PR merged) with something left to clean gets the broom.
    const clean = cleanable(st.profile, it).length ? this.cleanButton(t, st, it) : null;
    // Working alone, nobody can approve: no Request approval.
    const tasks = [unapproved.length && !worksAlone(st.setup) ? taskMenu("approval", unapproved) : null, openPrs.length && !mergeAll ? taskMenu("merge", openPrs) : null,
      finishes(st.setup) && (canMoveToDone(it) || busy?.kind === "done") ? this.finishButton(t, st, it, "story-finish", { words: true }) : null].filter(Boolean);
    return { actions: [main, pauseIt].filter(Boolean), tasks, clean, more: rows.length ? this.menuButton(t, "story-more", "", rows, "More for this story", { iconPath: own("ellipsis") }) : null };
  }

  // A review previewed: start its review agent (or show the one open); headRow's open icon opens it on GitHub.
  // A review's header: Start review (or Show review), Approve (yours, straight on GitHub after a
  // second click, agent or not), and once its agent runs, what to do with the review it drafted: post
  // the comments, approve with them, or request changes, each sent to the agent after a second click.
  // Nothing is posted until one is pressed; posting yourself, leave them.
  reviewActions(t, st, it) {
    const p = it.review;
    const tab = reviewTab(p);
    const agent = tab ? agents().find((a) => a.tab === tab.id) ?? null : null;
    const tell = (text) => (cx) => {
      if (agent.status === "blocked") { this.flash = `${agent.tab_name} is waiting for your answer: answer it first.`; cx.notify(); return; }
      sendToClaude(agent.address, text).then(() => { run("space.select", { id: agent.space }); run("pane.focus", { pane: agent.pane }); })
        .catch((e) => { this.flash = `Couldn't send it to ${agent.tab_name}: ${String(e?.message ?? e)}`; cx.notify(); });
    };
    const decide = (id, label, text, tip) => this.carefulButton(t, `review-${id}`, label, true, tell(text), { tip, confirmTip: `${tip}: click again to send it to its agent` });
    return [
      primaryButton(t, "review-start", tab ? "Show review" : "Start review", () => startReview(st.profile, p), { tip: `${tab ? "Show its review agent" : `Check it out and start a review agent on it, in ${st.profile.name}'s ${REVIEWS} space`} ⌘⇧R` }),
      youApproved(st, p)
        ? doneButton(t, "review-approve-self", "Approved", mark(t, "pr-approved", 14), t.done, { tip: `You approved ${prName(p)} on GitHub` })
        : this.approving?.[p.url]
          ? doneButton(t, "review-approve-self", "Approving…", mark(t, "working", 14), t.muted, { tip: `Approving ${prName(p)} on GitHub` })
          : this.carefulButton(t, "review-approve-self", "Approve", true, (cx) => this.approvePr(st, p, cx),
          { tip: `Approve ${prName(p)} on GitHub yourself`, confirmTip: `Click again to approve ${prName(p)} on GitHub, as yourself` }),
      ...(agent ? [
        decide("post", "Post comments", askOf(st.profile, "post", [p]), "Have the agent post its comments as a review"),
        decide("approve", "Approve with comments", askOf(st.profile, "approve", [p]), "Have the agent approve it, with the comments you agreed on"),
        decide("changes", "Request changes", askOf(st.profile, "changes", [p]), "Have the agent request changes, with its findings"),
      ] : []),
    ];
  }

  // Approves a review's pull request as you (approvePull), notes it (APPROVALS) so the header says
  // Approved at once, then loads the stories again.
  // While GitHub answers, the button is Approving… with a spinner (`this.approving`, by url, this copy's).
  approvePr(st, p, cx) {
    say(`Approving ${prName(p)}…`);
    this.approving = { ...(this.approving ?? {}), [p.url]: true };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await approvePull(p, { demo: Boolean(st.setup.github?.demo) || isDemo(st.profile), account: st.setup.github?.account });
        const now = Date.now();
        setShared(APPROVALS, { ...Object.fromEntries(Object.entries(shared(APPROVALS) ?? {}).filter(([, at]) => now - at < APPROVED_FOR)), [p.url]: now });
        say(`Approved ${prName(p)} on GitHub.`);
        setShared(REFRESH, Date.now());
      } catch (e) {
        say(`Couldn't approve ${prName(p)}: ${String(e?.message ?? e)}`);
      } finally {
        delete this.approving?.[p.url];
      }
      cx.notify();
    });
  }

  // One of your pull requests with no ticket: the main action is what it needs (fix checks, address
  // comments, merge), sent to its agent on the Desk, else as the first message of a new one there;
  // Show agent while one is open; Request approval while it waits on reviewers (startDeskTask, as the
  // list's "No ticket" menu does). headRow's open icon opens it on GitHub.
  pullActions(t, st, it) {
    const p = it.pull;
    const agent = pullAgent(p);
    const kind = askFor(p);
    const ask = kind ? this.carefulButton(t, `pull-ask-${kind}`, ASK[kind], kind === "merge", () => askPull(st.profile, p, kind),
      { tip: `${askOf(st.profile, kind, [p])}${agent ? "" : " (a new agent on the Desk)"}`, confirmTip: `Click again to ask ${agent ? agent.tab_name : "a new agent on the Desk"} to merge ${prName(p)}`, filled: true }) : null;
    const show = agent ? (ask ? textButton : primaryButton)(t, "pull-show", "Show agent", () => showPullAgent(p), { tip: `Show ${agent.tab_name} on the Desk ⌘⇧R` }) : null;
    const waiting = !p.isDraft && p.reviewDecision !== "APPROVED" && !kind && !worksAlone(st.setup);
    const approval = waiting ? textButton(t, "pull-approval", "Request approval", () => startDeskTask("approval", st.profile, [prLine(t, p)]),
      { tip: "Find out what it waits on and draft a request to its reviewers, with a new agent on the Desk" }) : null;
    return [ask, show, approval].filter(Boolean);
  }

  // A pull request shown on its own: who opened it (a review's), its checks and review, when it last
  // changed, and its description (GitHub's Markdown, loaded when shown, folded like a ticket's). Its
  // files are in the Changes view.
  reviewDetail(t, st, it, note, cx) {
    const p = lonePr(it);
    const c = CHECKS[checksOf(p)], r = REVIEW[p.reviewDecision];
    const demo = Boolean(st.setup.github?.demo) || isDemo(st.profile);
    const about = this.description(t, st, `pr:${p.url}`, cx, { id: "pr-desc", fold: true, load: async () => markdownBlocks(await pullBody(p, { demo, account: st.setup?.github?.account })) });
    return v_flex().id("story-detail").flex_1().min_w(0).min_h(0).gap(8)
      .when(Boolean(note), (el) => el.child(note))
      .child(h_flex().flex_none().gap(6).items_center().text_size(SMALL).text_color(t.muted)
        .child(div().flex_none().child(`${prName(p)}${it.review ? ` by ${p.author?.login ?? "someone"}` : ""} · updated ${ago(Date.parse(p.updatedAt))} ago`))
        .when(p.isDraft, (el) => el.child(chip(t, "Draft", t.muted)))
        .when(Boolean(c), (el) => el.child(chip(t, c[0], t[c[1]])))
        .when(!p.isDraft && Boolean(r), (el) => el.child(chip(t, r[0], t[r[1]]))))
      .child(div().flex_none().text_size(SMALL).text_color(t.dim).child(it.review ? "Start review opens a Claude agent on it, in the Reviews space."
        : "It names no ticket, so its agents work on the Desk."))
      .when(Boolean(about), (el) => el.child(div().id("pr-desc-view").flex_1().min_h(0).overflow_y_scrollbar().child(about)));
  }

  detail(t, st, it, cx, note = null) {
    if (lonePr(it)) return this.reviewDetail(t, st, it, note, cx);
    // A subtask's title shows its description under it, and hides it again.
    const opened = (s) => this.opened.has(s.key);
    const title = (s) => skinFont(div(), "ui").id(`sub-title-${s.key}`).flex_1().min_w(0).truncate().cursor_pointer().text_color(s.category === "done" ? t.muted : t.foreground).hover((x) => x.text_color(t.accent))
      .tooltip(opened(s) ? "Hide the description" : "Show the description")
      .on_click((_e, cx) => { if (this.opened.has(s.key)) this.opened.delete(s.key); else this.opened.add(s.key); cx.notify(); }).child(s.title);
    // A subtask's row: its key, title, state and agent buttons, then its pull requests. A ticket with
    // no subtasks has no row: its state and actions are the header's, only its pull requests show.
    this.colRows = new Set([...it.subs.map((s) => s.key), ...allPrs(it).map(prName)]);
    // A calm list: at rest a row shows what you read (who it's assigned to, key, title, its agent's
    // mark, its status); its actions show on the row hovered, laid over the end of its title, so they
    // keep no room at rest and the title has the row. Peek stays while the agent asks something.
    const hover = (key) => (on, cx) => {
      const was = this.hoverSub;
      // The row left may report after the row entered: only its own leaving clears it.
      this.hoverSub = on ? key : was === key ? null : was;
      if (this.hoverSub !== was) cx.notify();
    };
    const acts = (s) => s.category !== "done" || s.agent || s.paused || s.last
      ? this.agentButtons(t, st, it, `sub-agent-${s.key}`, s.key, s.agent, s.paused, s.last, { calm: !this.subAwake(s.key) }) : [];
    // Over the title's end, on the row's own colour made solid (the hover's is see-through), with a
    // short fade so the title runs under it rather than stopping at an edge.
    const actions = (s, list) => {
      const bg = this.hoverSub === s.key ? solidOver(t.background, t.hover) : t.background;
      return h_flex().id(`sub-actions-${s.key}`).absolute().top(0).bottom(0).right(0).items_center()
        .child(bands(Array.from({ length: 6 }, (_, i) => alpha(bg, (i + 1) / 7)), {}).flex_none().w(24).h_full())
        .child(h_flex().flex_none().h_full().gap(4).pl(4).items_center().bg(bg).children(list));
    };
    const sub = (s, about = opened(s) ? this.description(t, st, s.key, cx, { id: `sub-desc-${s.key}` }) : null, list = acts(s)) => v_flex().id(`sub-row-${s.key}`).flex_none().gap(4).px(8).py(8).border_t_1().border_color(t.border).hover((x) => x.bg(t.hover))
      .on_hover(hover(s.key))
      .child(h_flex().gap(10).items_center().min_w(0)
        // Who it's assigned to leads the row: the first thing looked for.
        .child(assigned(t, `sub-assignee-${s.key}`, s.assignee, s.mine, s.avatar))
        .child(skinFont(div(), "numbers").flex_none().w(84).text_size(SMALL).text_color(t.dim).child(s.key))
        // As high as a button, so a row is the same height with its actions shown or not.
        .child(h_flex().id(`sub-main-${s.key}`).relative().flex_1().min_w(0).h(CONTROL).items_center()
          .child(title(s))
          // What kind of work it is, at the title's end (the title truncates first); the actions
          // shown on hover lie over it.
          .when(Boolean(s.tags?.length), (el) => el.child(tagRow(t, s.tags, `sub-tags-${s.key}`).ml(8)))
          .when(list.length > 0, (el) => el.child(actions(s, list))))
        // After the title, the same columns on every row, filled or empty, so marks and chips line up
        // down the list. The status is as wide as its widest chip in this list, measured as drawn
        // (column()).
        .child(this.agentSlot(t, s))
        .child(this.column("status", s.key, h_flex().flex_none().items_center()
          .when(Boolean(s.status), (el) => el.child(this.statusChip(t, st, s.key, s.status, s.category, `sub-status-${s.key}`, cx))))))
      .when(Boolean(about), (el) => el.child(div().pl(SUB_INDENT).pb(2).child(about)))
      .children(s.prs.map((p) => this.pr(t, p, st, it).pl(SUB_INDENT)));
    // Yours first, then everyone else's, each under a small heading; one group alone needs none.
    const heading = (id, words) => div().id(id).flex_none().px(8).pt(14).pb(6).text_size(SMALL).font_semibold().text_color(t.muted).child(words);
    const subGroups = (list) => {
      const mine = list.filter((s) => s.mine), others = list.filter((s) => !s.mine);
      if (!mine.length || !others.length) return list.map((s) => sub(s));
      return [heading("subs-mine", "Assigned to you"), ...mine.map((s) => sub(s)), heading("subs-others", "Everyone else"), ...others.map((s) => sub(s))];
    };
    const own = it.story ? [] : it.subs[0].prs;
    // The ticket's own description first, folded to a few lines (a pull request's row has none).
    const about = it.pr ? null : this.description(t, st, it.key, cx, { id: "story-desc", fold: true });
    // Its pull requests and subtasks sit in a centred column of their own (ROWS wide), so a row's
    // status stays near its key and title on a very wide screen.
    const rows = v_flex().relative().w_full().min_w(0).max_w(ROWS).child(this.colProbe())
      // Pull requests naming the story's own key, and a ticket's with no subtasks, under a heading
      // like the subtasks' groups; open ones first, newest first, then the merged.
      .when(it.prs.length > 0, (el) => el.child(heading("prs-story", "On the story itself")).children(prOrder(it.prs).map((p) => this.pr(t, p, st, it).px(8))))
      .when(own.length > 0, (el) => el.child(heading("prs-own", own.length === 1 ? "Pull request" : `Pull requests · ${own.length}`)).children(prOrder(own).map((p) => this.pr(t, p, st, it).px(8))))
      .children(it.story ? subGroups(it.subs) : []);
    // Next pointing at a step opens the details at their top, where its box is: a new id is a new
    // scroll position (a mod can't scroll this one itself).
    const point = pointFor(st.profile, it);
    const overview = v_flex().id(point ? `story-overview-${point.at}` : "story-overview").flex_1().min_h(0).gap(0).overflow_y_scrollbar()
      .child(v_flex().id("story-overview-content").flex_none().w_full().on_size_change(this.fits("content"))
        .when(Boolean(about), (el) => el.child(div().flex_none().child(about)))
        .child(h_flex().flex_none().w_full().justify_center().px(40).pb(16).child(rows)));
    // A story at work leaves its details a quarter of the column, so they often go on past the
    // block's edge: a fade over that edge says there's more to scroll to, where text cut off mid-line
    // looked broken. Only while the content is taller than the view (fits()). Bands, as mods paint no
    // gradients; not quite opaque, so it sits on a skin's lit background without a seam.
    const over = (this.fit?.content ?? 0) > (this.fit?.view ?? Infinity) + 1;
    const fade = bands(Array.from({ length: 10 }, (_, i) => alpha(t.background, ((i + 1) / 10) * 0.9)), { vertical: true })
      .absolute().left(0).right(0).bottom(0).h(36);
    const view = div().id("story-overview-view").relative().flex().flex_col().flex_1().min_h(0).on_size_change(this.fits("view"))
      .child(overview).when(over, (el) => el.child(fade));
    // Under the title row (a block of its own): the status command's line, the note, then the
    // description and subtasks.
    const line = this.statusLine(t, st, it, cx);
    const hl = passageFor(st.profile, it.key);
    if (hl) return v_flex().id("story-detail").flex_1().min_w(0).min_h(0).gap(8).child(this.reader(t, st, it, hl, cx));
    return v_flex().id("story-detail").flex_1().min_w(0).min_h(0).gap(8)
      // As wide as the subtask rows at most (ROWS), centred like them.
      .when(Boolean(point), (el) => el.child(h_flex().flex_none().w_full().justify_center().child(this.pointBox(t, st, it, point, cx))))
      .when(Boolean(line), (el) => el.child(line))
      .when(Boolean(note), (el) => el.child(note))
      .child(view);
  }

  // What Next pointed at (pointFor), in one box over the details, marked as a passage is (an accent
  // tint, an accent edge): what to do in plain words and ✕, then the pull requests it's about with
  // the button for each, and for merging several tickets' Merge all, so the step is in one place
  // instead of tinted lines down the list. It fades in once, sliding a few pixels down (native
  // transitions: drawn hidden first, shown on the next frame); nothing in it moves after that.
  pointBox(t, st, it, point, cx) {
    const prs = prOrder(allPrs(it).filter((p) => askFor(p) === point.kind));
    const live = allPrs(it).filter((p) => !p.merged);
    const names = prs.length <= 2 ? prs.map(prName).join(" and ") : `${prs.length} pull requests`;
    // More than one to merge: one Merge all for them, whether one ticket's or several's.
    const all = point.kind === "merge" && prs.length > 1;
    const asking = allAgents(it).find((a) => a.status === "blocked");
    const who = asking ? sessionTitle(asking.title) ?? asking.tab_name : "Its agent";
    const [what, how] = {
      peek: [`${who} is asking you something: answer it`, "Peek answers it here, without switching spaces"],
      comments: [`Changes were requested on ${names}: address them`, "Address comments sends the review to its agent"],
      fix: [`Checks are failing on ${names}: fix them`, "Fix checks sends the failures to its agent"],
      merge: [prs.length === live.length && live.length > 1 ? `All ${live.length} pull requests are approved: merge them` : `${names} ${prs.length === 1 ? "is" : "are"} approved: merge ${prs.length === 1 ? "it" : "them"}`,
        all ? "Merge all asks an agent to check them and plan the merge" : "Merge asks its agent to merge it, after a second click"],
    }[point.kind];
    const row = (p) => {
      const [state, words, color] = prLook(t, p, checksOf(p));
      const title = String(p.title ?? "").replace(/^\s*(?:\[[^\]]*\]|[A-Z][A-Z0-9_]*-\d+)[\s:\u2014-]*/, "") || prName(p);
      return h_flex().flex_none().h(CONTROL).gap(8).items_center().text_size(SMALL)
        .child(h_flex().id(`point-pr-${prName(p)}`).flex_1().min_w(0).h_full().gap(8).items_center().cursor_pointer().hover((x) => x.text_color(t.accent))
          .tooltip(`${words} · ${p.title}`).on_click(() => open(p.url))
          .child(div().flex_none().child(mark(t, state, 14)))
          .child(div().flex_none().text_color(t.dim).child(p.key ?? it.key))
          .child(div().flex_1().min_w(0).truncate().text_size(TEXT).child(title))
          .child(div().flex_none().text_color(t.dim).child(prName(p)))
          .child(div().flex_none().text_color(color).child(PR_SHORT[state] ?? words)))
        // Several to merge are one Merge all below; anything else, each line its own button.
        .when(!all, (el) => el.child(this.askButton(t, st, it, `point-ask-${point.kind}-${prName(p)}`, point.kind, [p])));
    };
    const action = point.kind === "peek" && asking
      ? primaryButton(t, "point-peek", "Peek", () => { clearPoint(st.profile, it.key); run("terminal.peek", { terminal: asking.address }); }, { tip: how })
      : all
        ? this.menuButton(t, "point-merge", "", storyTaskRows(t, st.profile, it, "merge", live), how,
          { width: 340, trigger: (toggle) => primaryButton(t, "point-merge-all", "Merge all ▾", toggle, { tip: how }) })
        : null;
    // Drawn hidden the first time, then shown: the transitions below carry it in. Then, to catch the
    // eye, a glint runs along its border twice (POINT_GLINT, borderGlint() as on Claude's picks) and
    // stops: the box then holds still.
    const shown = this.pointShown === point.at;
    if (!shown) cx.timer.after(30, (cx) => { this.pointShown = point.at; this.pointGlint = Date.now() + POINT_GLINT; cx.notify(); cx.timer.after(POINT_GLINT, (cx) => cx.notify()); });
    const glinting = shown && Date.now() < (this.pointGlint ?? 0);
    const glow = (a) => alpha(t.accent, a);
    return v_flex().id("point-box").flex_none().w_full().min_w(0).max_w(ROWS).relative().overflow_hidden().gap(2).pl(12).pr(8).py(8).rounded(8)
      .bg(tint(t.accent, "12")).border_l_2().border_color(t.accent).child(edgeOf(glow(0.3), 8))
      .on_size_change((size, cx) => this.shineSize("point", size, cx)).child(this.shineProbe("point"))
      .when(glinting, (el) => el.children(borderGlint(glow, this.shine?.point, 8, POINT_GLINT / 2)))
      .opacity(shown ? 1 : 0).top(shown ? 0 : -6).transition("opacity", { duration: 420, easing: "ease-out" }).transition("top", { duration: 420, easing: "ease-out" })
      .child(h_flex().flex_none().gap(10).items_center().text_size(SMALL)
        .child(div().flex_none().font_semibold().text_color(t.accent).child("Next"))
        .child(div().flex_1().min_w(0).truncate().font_medium().text_color(t.foreground).tooltip(what).child(what))
        .child(iconButton(t, "point-close", chrome("x"), (_e, cx) => { clearPoint(st.profile, it.key); cx.notify(); }, "Put this away")))
      .child(div().flex_none().text_size(SMALL).text_color(t.muted).child(how))
      .when(prs.length > 0 && point.kind !== "peek", (el) => el.child(v_flex().flex_none().pt(4).children(prs.map(row))))
      .when(Boolean(action), (el) => el.child(h_flex().flex_none().pt(6).justify_end().child(action)));
  }

  // A passage pointed to (showPassage) in the story's description: the whole description as a list
  // of its blocks, scrolled so the passage is in the middle, the passage marked, under a line saying
  // what it is with a way back. A virtual list, as only one can be scrolled from here; it places rows
  // by heights given, so each block is first drawn in an invisible copy of the column and measured
  // there (`this.readerH`, as drawn, so divided by the zoom when used). Herdr reports a size only when
  // it changes, so each passage's copy has ids of its own and is measured afresh.
  reader(t, st, it, hl, cx) {
    const d = this.descriptionOf(st, it.key, cx);
    if (d.blocks && (this.passage?.at !== hl.at || this.passage.of !== d.blocks)) this.passage = { at: hl.at, of: d.blocks, found: findPassage(d.blocks, hl.quote) };
    const found = d.blocks ? this.passage.found : null;
    // A list's entries are items of their own (each a one-entry list, numbered on), so the one
    // holding the passage is what's scrolled to, not the middle of a long list.
    const lit = (x) => /"mark":true|"marked":true/.test(JSON.stringify(x));
    const blocks = (found?.blocks ?? d.blocks ?? []).flatMap((b) => (b.kind !== "list" ? [b]
      : b.items.map((item, n) => ({ ...b, start: (b.start ?? 1) + n, items: [item], hl: b.hl && (!found.exact || lit(item)), next: n > 0 }))));
    const said = !d.blocks ? (d.error ? "The description didn't load" : "Loading the description…")
      : !found ? "Couldn't find this passage in the description" : found.exact ? "Here in the description" : "Closest match in the description";
    const bar = h_flex().id("passage-bar").flex_none().w_full().gap(10).items_center().px(8).py(6).rounded(7).bg(tint(t.accent, "14"))
      .child(div().flex_none().text_size(SMALL).font_semibold().text_color(found ? t.accent : t.dim).child(said))
      .child(div().flex_1().min_w(0).truncate().text_size(SMALL).text_color(t.muted).tooltip(`“${hl.quote}”`).child(hl.note || (found?.exact ? "" : `“${hl.quote}”`)))
      .child(textButton(t, "passage-back", "Back to the story", (_e, cx) => { setShared(PASSAGE, null); cx.notify(); }));
    const item = (i) => {
      const b = blocks[i];
      const block = blocksView(t, `rd-${i}`, [b], 14, i === 0);
      const box = b.hl ? div().px(12).py(8).rounded(8).bg(tint(t.accent, "12")).border_l_2().border_color(t.accent).child(block) : div().px(12).child(block);
      return h_flex().w_full().justify_center().px(28).pt(i === 0 ? 24 : b.kind === "h" ? 20 : b.next ? 2 : 6).pb(i === blocks.length - 1 ? 32 : b.kind === "list" ? 2 : 6)
        .child(skinFont(div(), "reading").w_full().min_w(0).max_w(DOC.width + 24).text_size(DOC.size).line_height(`${LINE}px`).text_color(tint(t.foreground, "c4")).child(box));
    };
    const sig = `${hl.at}:${blocks.length}`;
    if (this.readerSig !== sig) { this.readerSig = sig; this.readerH = {}; this.readerAt = null; }
    const sizes = blocks.map((_, i) => this.readerH[i] / (this.readerZoom || 1));
    const measured = blocks.length > 0 && sizes.every((h) => h > 0);
    const target = found ? Math.max(0, blocks.findIndex((b) => b.hl)) : -1;
    if (measured && target >= 0 && this.readerAt !== sig) {
      this.readerAt = sig;
      this.readerScroll.scroll_to_item(target, "center");
    }
    // The measuring copy: the same rows at the same width, drawn under the list and never seen.
    const measure = v_flex().id(`story-reader-measure-${sig}`).absolute().top(0).left(0).right(0).invisible()
      .child(div().id("story-reader-zoom").absolute().top(0).left(0).w(100).h(0).on_size_change((size, cx) => {
        const z = size.width / 100;
        if (z && Math.abs((this.readerZoom ?? 0) - z) > 0.001) { this.readerZoom = z; cx.notify(); }
      }))
      .children(blocks.map((_, i) => div().id(`rd-m-${sig}-${i}`).w_full().child(item(i)).on_size_change((size, cx) => {
        const h = size.height;
        if (Math.abs((this.readerH[i] ?? 0) - h) < 0.5) return;
        this.readerH = { ...this.readerH, [i]: h };
        cx.notify();
      })));
    return v_flex().flex_1().min_h(0).gap(6).child(bar)
      .child(v_flex().relative().flex_1().min_h(0).overflow_hidden().child(measure)
        .when(measured, (el) => el
          .child(v_virtual_list("story-reader", blocks.length, sizes, (i) => `rd-${sig}-${i}`, (range) => blocks.slice(range.start, range.end).map((_, k) => item(range.start + k)))
            .track_scroll(this.readerScroll).size_full())
          .child(Scrollbar.vertical("story-reader").viewport_from_layout().absolute().inset_0())));
  }

  // The story details' height as drawn (`view`) and their content's (`content`), on this copy, for the
  // fade over a details block that scrolls; redrawn only when one changes.
  // One cell of a subtask row's column `col`: its content at its own width, measured as drawn, inside
  // a box as wide as the column's widest cell among the rows shown (`this.colRows`). Widths are kept
  // per row on this copy (drawn sizes include the zoom, so they're divided by it: colProbe()); a
  // redraw only when a column's width changes, so it settles in one frame and shrinks again when
  // its widest cell goes.
  column(col, key, content) {
    const zoom = this.colZoom || 1;
    const widths = Object.entries(this.cols?.[col] ?? {}).filter(([k]) => this.colRows?.has(k)).map(([, w]) => w);
    const width = widths.length ? Math.ceil(Math.max(...widths) / zoom) : 0;
    return h_flex().flex_none().items_center().when(width > 0, (el) => el.min_w(width))
      .child(content.id(`sub-${col}-cell-${key}`).on_size_change((size, cx) => {
        const was = this.cols?.[col]?.[key];
        if (was !== undefined && Math.abs(was - size.width) < 0.5) return;
        this.cols = { ...(this.cols ?? {}), [col]: { ...(this.cols?.[col] ?? {}), [key]: size.width } };
        cx.notify();
      }));
  }
  colProbe() {
    return div().id("sub-cols-zoom-probe").absolute().top(0).left(0).w(100).h(0).on_size_change((size, cx) => {
      const zoom = size.width / 100;
      if (!zoom || Math.abs((this.colZoom ?? 0) - zoom) < 0.001) return;
      this.colZoom = zoom;
      cx.notify();
    });
  }

  fits(part) {
    return (size, cx) => {
      if (Math.abs((this.fit?.[part] ?? -1) - size.height) < 0.5) return;
      this.fit = { ...(this.fit ?? {}), [part]: size.height };
      cx.notify();
    };
  }

  // The first line the profile's status command prints for the story, while it has a space: loaded
  // when first shown, on Refresh, and every few minutes; a failure says so quietly.
  statusLine(t, st, it, cx) {
    const command = st.profile.commands?.status?.trim();
    if (!command || !it.space) return null;
    const was = this.statuses[it.key];
    const refresh = shared(REFRESH);
    if (!was || (!was.loading && (Date.now() - was.at > STATUS_EVERY || was.seen !== refresh))) {
      this.statuses[it.key] = { ...(was ?? {}), loading: true, at: was?.at ?? 0, seen: refresh };
      cx.spawn(async (cx) => {
        try {
          const r = await runCommand(st.profile, command, it.key, STATUS_SECONDS, st.space?.machine);
          const first = r.out.split("\n").find((l) => l.trim()) ?? "";
          this.statuses[it.key] = r.code === 0 ? { line: first, full: r.out, at: Date.now(), seen: refresh }
            : { error: r.code === 143 ? "It took too long." : `It failed (${r.code})${r.out ? `: ${r.out}` : ""}`, at: Date.now(), seen: refresh };
        } catch (e) {
          this.statuses[it.key] = { error: String(e?.message ?? e), at: Date.now(), seen: refresh };
        }
        cx.notify();
      });
    }
    const s = this.statuses[it.key];
    if (s.error) return div().id("story-status").flex_none().truncate().text_size(SMALL).text_color(t.muted).tooltip(s.error).child("status unavailable");
    if (!s.line) return null;
    return div().id("story-status").flex_none().truncate().text_size(SMALL).text_color(t.dim).tooltip(s.full ?? s.line).child(s.line);
  }

  // A ticket's description, loaded when first shown and again after the stories reload (st.at) once
  // it's DESC_EVERY old, or after a Refresh press. `load` gives the blocks of something else's (a
  // pull request's, by its own key); the default asks Jira for the ticket's.
  descriptionOf(st, key, cx, load = () => boardDescription(boardOf(st.setup), key, st.data)) {
    const d = this.descs[key];
    const stale = (x) => x.at < st.at && (Date.now() - x.at > DESC_EVERY || (shared(REFRESH) ?? 0) > x.at);
    if (d && (d.loading || !stale(d))) return d;
    this.descs[key] = { ...(d ?? {}), loading: true, at: d?.at ?? 0 };
    cx.spawn(async (cx) => {
      try {
        this.descs[key] = { blocks: await load(), at: Date.now() };
      } catch (e) {
        this.descs[key] = { ...(d ?? {}), error: String(e?.message ?? e), at: Date.now() };
      }
      cx.notify();
    });
    return this.descs[key];
  }

  // A ticket's description, or null: nothing while it loads or when it's empty. Folded to a few lines
  // with "Show more" when `fold`; unfolded, it's all there (the header scrolls).
  description(t, st, key, cx, { id, fold = false, load } = {}) {
    const d = this.descriptionOf(st, key, cx, load);
    if (!d.blocks) return d.error ? div().id(`${id}-error`).text_size(SMALL).text_color(t.dim).tooltip(d.error).child("Couldn't load the description") : null;
    if (!d.blocks.length) return null;
    const more = this.more.has(key);
    // Folded, it ends at a block's end (the first blocks that fit in FOLDED lines), so no line shows
    // cut in half; a first block longer than that is cut at a whole line. A heading never ends it:
    // the block after it comes too, cut to a few lines when it's long.
    let head = 1;
    while (head < d.blocks.length && adfLines(d.blocks.slice(0, head + 1), DOC.perLine) <= FOLDED) head++;
    const room = d.blocks[head - 1].kind === "h" ? FOLDED + 3 : FOLDED;
    while (head < d.blocks.length && d.blocks[head - 1].kind === "h") head++;
    const cut = adfLines(d.blocks.slice(0, head), DOC.perLine) > room;
    const long = fold && (head < d.blocks.length || cut);
    const folded = long && !more;
    // A softer colour than the theme's text: full-strength light text on dark reads as bold at this
    // size (Herdr's font has no lighter weight to use instead).
    const body = skinFont(div(), "reading").id(`${id}-body`).w_full().min_w(0).max_w(DOC.width).text_size(DOC.size).line_height(`${LINE}px`).text_color(tint(t.foreground, "c4"))
      .child(blocksView(t, id, folded ? d.blocks.slice(0, head) : d.blocks, 14, fold))
      .when(folded && cut, (el) => el.max_h(room * LINE).overflow_hidden());
    const column = !long ? body : v_flex().w_full().min_w(0).max_w(DOC.width).gap(12).child(body)
      .child(div().id(`${id}-more`).flex_none().text_size(SMALL).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { if (more) this.more.delete(key); else this.more.add(key); cx.notify(); })
        .child(more ? "Show less" : "Show more"));
    // The ticket's own description (the folding one) sits in a centred column with air on every
    // side; a subtask's, opened under its row, keeps to the row's indent.
    return fold ? h_flex().w_full().justify_center().px(40).pt(24).pb(32).child(column) : column;
  }

  // Changes of a story (and how many screenshots), loaded when first asked for and again after each reload.
  loadExtra(st, it, cx) {
    const before = this.extra[it.key];
    this.extra[it.key] = { ...(before ?? {}), loading: true, at: before?.at ?? 0 };
    const keys = [it.key, ...it.subs.map((s) => s.key)].filter((k, i, a) => a.indexOf(k) === i);
    const on = st.space?.machine ? { on: st.space.machine } : {};
    const demo = isDemo(st.profile);
    cx.spawn(async (cx) => {
      try {
        const prFiles = (p) => {
          const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(p.url);
          if (!m) return Promise.resolve([]);
          if (demo) return demoPullFiles(p.url);
          return gh(st.profile?.github?.account, ["api", "--paginate", `repos/${m[1]}/${m[2]}/pulls/${m[3]}/files`, "--jq", ".[] | {filename, previous_filename, status, additions, deletions, patch, sha}"])
            .then((r) => r.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l)));
        };
        const prs = allPrs(it);
        const [prLists, local, sessions] = await Promise.all([
          Promise.all(prs.map((p) => prFiles(p).catch(() => null))),
          // A pull request shown on its own has no ticket folders or sessions: only its files.
          lonePr(it) ? [] : demo ? demoLocal(st.setup.folder, keys) : readTextFile(modFile("changes.py"))
            .then((code) => exec("python3", ["-I", "-c", code, st.setup.folder, ...keys], on))
            .then((r) => (r.code === 0 ? JSON.parse(r.stdout || "[]") : [])).catch(() => []),
          lonePr(it) ? [] : this.storySessions(st, it, keys),
        ]);
        // A group per repo with uncommitted work (changes.py lists the ticket folders' repos even
        // when clean), then one per pull request.
        const groups = [
          ...local.filter((r) => r.files.length).map((r) => ({ label: `${r.key} · ${r.repo} · not committed`, key: r.key, repo: r.repo, path: r.path,
            files: r.files.map((f) => ({ id: `local:${r.path}:${f.path}`, path: f.path, add: f.add, del: f.del, status: fileStatus(f.status, f.patch), patch: f.patch })) })),
          ...prs.map((p, i) => ({ label: `${it.review ? "Review" : it.pull ? "No ticket" : p.key ?? it.key} · ${prName(p)}${p.merged ? " · merged" : ""}`, key: p.key ?? it.key, repo: prName(p), url: p.url, merged: Boolean(p.merged), title: p.title ?? "", failed: prLists[i] === null,
            files: (prLists[i] ?? []).map((f) => ({ id: `${prName(p)}:${f.filename}`, path: f.filename, from: f.previous_filename ?? null, add: f.additions, del: f.deletions, status: fileStatus(f.status, f.patch), sha: f.status === "removed" ? null : f.sha, patch: f.patch ?? "(no diff to show: a binary file, or too large for GitHub to inline)" })) })),
        ];
        const shots = lonePr(it) ? 0 : await countShots(sessions.map((s) => s.id), st.space?.machine ?? null).catch(() => undefined);
        this.extra[it.key] = { groups, local, at: Date.now() };
        setCounts(it.key, { files: groups.reduce((n, g) => n + g.files.length, 0), shots, repo: (local.find((r) => r.files.length) ?? local[0])?.path ?? null });
      } catch (e) {
        this.extra[it.key] = { ...(before ?? {}), error: String(e?.message ?? e), at: Date.now() };
      }
      cx.notify();
    });
  }

  // The Claude sessions behind a story ([{ id, key, terminal }]): every session started on one of its
  // keys, its paused ones, and its open agents (with their terminal, so an image can go to its chat).
  async storySessions(st, it, keys) {
    const found = new Map();
    const add = (id, key, terminal = null) => {
      if (!id) return;
      const was = found.get(id);
      found.set(id, { id, key: was?.key ?? key, terminal: terminal ?? was?.terminal ?? null });
    };
    const known = projectsOf(st.data);
    for (const s of st.data.sessions ?? []) {
      const key = [...(s.first ?? []), keyIn(s.title, known)].find((k) => keys.includes(k));
      if (key) add(s.id, key);
    }
    for (const k of keys) for (const p of pausedIn(st.profile)[k] ?? []) add(p.sessionId, k);
    for (const a of allAgents(it)) { const rec = await sessionOf(a).catch(() => null); if (rec) add(rec.sessionId, keyOf(a.tab_name) ?? it.key, a.address); }
    return [...found.values()];
  }

  // The Screenshots view is the Artifacts panel's, scoped to the story's sessions through shared state.
  // The title row, shown with every story, keeps that list: gathered when the view shows, and again
  // after each reload (when the stories reload, an agent opening or closing among them).
  // Also gathered again when its open agents change, and while one has no session in the list yet (a
  // new agent's session is only on disk after its first message), every 5 s at most: else a new
  // agent's images stayed out until the stories reloaded.
  shareShots(st, it, cx) {
    const e = this.shots[it.key];
    const live = allAgents(it).map((a) => a.address).sort().join(" ");
    const unseen = Boolean(e?.list) && allAgents(it).some((a) => !e.list.some((s) => s.terminal === a.address));
    if (!e || (!e.loading && (e.at < st.at || e.live !== live || (unseen && Date.now() - e.at > 5000)))) {
      this.shots[it.key] = { ...(e ?? {}), loading: true, at: e?.at ?? 0, live };
      cx.spawn(async (cx) => {
        const list = await this.storySessions(st, it, storyKeys(it)).catch(() => e?.list ?? []);
        this.shots[it.key] = { list, at: Date.now(), live };
        const shots = await countShots(list.map((s) => s.id), st.space?.machine ?? null).catch(() => undefined);
        if (shots !== undefined) setCounts(it.key, { shots });
        cx.notify();
      });
    }
    const list = this.shots[it.key]?.list;
    const next = list ? {
      key: it.key, ids: list.map((s) => s.id), keys: Object.fromEntries(list.map((s) => [s.id, s.key])),
      terminals: Object.fromEntries(list.filter((s) => s.terminal).map((s) => [s.id, s.terminal])), on: st.space?.machine ?? null, started: begun(it),
      // Every agent open in the story's space, for an image whose own session has none open.
      agents: spaceAgents(it).map((x) => x.agent.address),
    } : { key: it.key };
    if (JSON.stringify(shared(ARTIFACTS)) !== JSON.stringify(next)) setShared(ARTIFACTS, next);
  }

  // A reload that failed keeps what was shown, under a notice saying why.
  keptOnError(t, what, extra, body) {
    if (!extra?.error) return body;
    return v_flex().flex_1().min_h(0).gap(8).child(notice(t, `Couldn't load the ${what} again, so these are from before: ${extra.error}`, t.blocked)).child(body);
  }

  changesView(t, st, it, extra, cx) {
    if (extra?.error && !extra.groups) return empty(t, `Couldn't load the changes: ${extra.error}`, { fill: true });
    if (!extra?.groups) return empty(t, "Gathering the changes…", { fill: true });
    return this.keptOnError(t, "changes", extra, this.changesBody(t, st, it, extra, cx));
  }

  changesBody(t, st, it, extra, cx) {
    const all = extra.groups.flatMap((g) => g.files.map((f) => ({ ...f, group: g })));
    if (!all.length) {
      return empty(t, extra.groups.some((g) => g.failed) ? "GitHub didn't answer for these pull requests. Refresh to try again."
        : begun(it) ? "No changes yet: nothing uncommitted on its branches, and no PR yet." : "No changes yet. They show here once you start work on it.", { fill: true });
    }
    const chosen = all.find((f) => f.id === this.file[it.key]) ?? all[0];
    const whole = DIFF.all && Boolean(this.diffScroll); // every file on one page
    this.fileOrder = { key: it.key, ids: all.map((f) => f.id) };
    const viewed = shared(VIEWED) ?? {};
    // One file at a time, the one shown counts as looked at; on the page of all of them, each file
    // does once its last line has been on screen (see track).
    // A file unticked by hand stays unticked until ticked again (`unticked`, this copy's).
    const unticked = (this.unticked ??= new Set());
    if (!whole && !viewed[viewedId(chosen)] && !unticked.has(viewedId(chosen))) setShared(VIEWED, { ...viewed, [viewedId(chosen)]: it.key });
    const seen = (f) => (!whole && f.id === chosen.id && !unticked.has(viewedId(f))) || Boolean(viewed[viewedId(f)]);
    // Ticking a file by hand, as on GitHub: on the page of all files it folds away, and unticked it
    // opens again (back to how it starts: lockfiles stay folded).
    const setSeen = (f, on, cx) => {
      const id = viewedId(f), now = { ...(shared(VIEWED) ?? {}) };
      if (on) { now[id] = it.key; unticked.delete(id); } else { delete now[id]; unticked.add(id); }
      setShared(VIEWED, now);
      // Its header goes to the top of the page, so the next file follows it (and the page doesn't
      // jump by however many lines folded away).
      if (whole) { if (on) DIFF.folds[fileKey(f)] = true; else delete DIFF.folds[fileKey(f)]; DIFF.version++; this.pendingJump = f.id; this.changeAt = null; }
      cx.notify();
    };
    const ROW = 20, GROUP = 76, HEAD = 46, BAND = 26, CH = 7.3; // JetBrains Mono at 12 is about 7.3 per character
    // The rows, built again only when something they come from changed: [{ r, fi }], fi the file's
    // index; on the page of all files each starts with a header row.
    const sig = `${it.key}|${extra.at}|${whole ? "all" : chosen.id}|${DIFF.version}|${all.map((f) => f.id).join(",")}`;
    // The patches shown are parsed (and every file's hashed, for its Viewed tick) first, for at most
    // PARSE_FOR ms a render: a big pull request's take longer than a render may, and Herdr would cut
    // the view off. What's left is for the next render, asked for by a timer (not a task: one that
    // ends inside the render it was started from can't ask for a redraw, and the view stayed put).
    if (this.diffView?.sig !== sig) {
      const shown = new Set(whole ? all.filter((f) => !isFolded(f)) : [chosen]);
      const ready = (f) => hashed(f.patch ?? "") && (!shown.has(f) || parsed(f.patch ?? ""));
      const missing = all.filter((f) => !ready(f));
      const until = Date.now() + PARSE_FOR;
      let done = 0;
      for (const f of missing) {
        if (Date.now() > until) break;
        patchHash(f.patch ?? "");
        // A file whose marks ran out of time isn't done: the next render goes on with it.
        if (shown.has(f) && (diffRows(f.patch ?? "", until), !parsed(f.patch ?? ""))) break;
        done++;
      }
      if (done < missing.length) {
        cx.timer.after(1, (cx) => cx.notify());
        return empty(t, `Reading the changes: ${all.length - missing.length + done} of ${all.length} file${all.length === 1 ? "" : "s"}…`, { fill: true });
      }
    }
    if (this.diffView?.sig !== sig) {
      const rows = [], first = [], last = [];
      all.forEach((f, fi) => {
        if (!whole && f !== chosen) return;
        if (whole) {
          // Each pull request (or repo with uncommitted work) opens its own section; picking its first
          // file shows the section's heading with it.
          first[fi] = rows.length;
          if (!fi || all[fi - 1].group !== f.group) rows.push({ r: { kind: "group" }, fi });
          rows.push({ r: { kind: "file" }, fi });
          if (!isFolded(f)) for (const r of fileRows(f)) rows.push({ r, fi });
        } else {
          first[fi] = rows.length;
          rows.push({ r: { kind: "file" }, fi });
          for (const r of fileRows(f)) rows.push({ r, fi });
        }
        last[fi] = rows.length - 1;
      });
      const top = rows.reduce((m, { r }) => Math.max(m, r.old ?? 0, r.new ?? 0), 0);
      const long = rows.reduce((m, { r, fi }) => Math.max(m, r.kind === "file" ? all[fi].path.length + 50 : (r.text ?? r.context ?? "").length), 0);
      // Herdr's virtual list takes at most 10 000 items, and a big pull request has more lines than
      // that: a run of code lines (nothing in them takes a click) is one item of up to CHUNK lines,
      // and a heading, file header or band one item each. A run of changed lines starts an item 3
      // lines above it (or where its run of lines does), so n / p scroll to that item.
      const plain = (e) => e && e.r.kind !== "group" && e.r.kind !== "file" && e.r.kind !== "hunk";
      const isChange = (e) => e && (e.r.kind === "add" || e.r.kind === "del");
      const breaks = new Set();
      rows.forEach((e, i) => {
        if (!isChange(e) || (isChange(rows[i - 1]) && rows[i - 1].fi === e.fi)) return;
        let b = i;
        while (b > i - 3 && plain(rows[b - 1]) && rows[b - 1].fi === e.fi) b--;
        breaks.add(b);
      });
      const entries = [], itemOf = [];
      rows.forEach((e, i) => {
        const prev = entries[entries.length - 1];
        if (plain(e) && prev?.lines && prev.fi === e.fi && prev.lines.length < CHUNK && !breaks.has(i)) prev.lines.push(e.r);
        else entries.push(plain(e) ? { r: { kind: "lines" }, lines: [e.r], fi: e.fi } : e);
        itemOf[i] = entries.length - 1;
      });
      const starts = first.map((i) => (i === undefined ? undefined : itemOf[i])), ends = last.map((i) => (i === undefined ? undefined : itemOf[i]));
      // A file's header is taller than a line, with room above it, so it reads as a new section.
      const sizes = entries.map((e, i) => (e.lines ? e.lines.length * ROW : e.r.kind === "group" ? (i ? GROUP : GROUP - 32) : e.r.kind === "file" ? HEAD : BAND));
      const changes = [...breaks].map((b) => itemOf[b]).sort((a, b) => a - b);
      this.diffView = { sig, key: it.key, ids: all.map((f) => f.id), files: all, entries, starts, ends, top, long, sizes, changes };
    }
    const view = this.diffView, entries = view.entries;
    // A file picked in the list (or by ↑/↓, or the page just opened on it) is scrolled to the top.
    if (whole && this.pendingJump) {
      const fi = view.ids.indexOf(this.pendingJump);
      if (fi >= 0) { this.diffScroll.scroll_to_item(view.starts[fi], "top"); this.jump = { fi, start: null }; }
      this.pendingJump = null;
    }
    const langs = all.map((f) => syntaxOf(f.path));
    // GitHub's layout: the old and new line numbers in a gutter, then a +/− column, then the line
    // itself. Added and removed lines tint their whole row, their gutter a step stronger, and the
    // words that changed within a line stronger still; bands between hunks open what they hide.
    const num = String(view.top).length * CH + 16;
    const gutter = num * 2 + 18;
    // As wide as the longest line, so long lines scroll sideways instead of being cut.
    const width = view.long * CH + gutter + 32;
    const hex = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c : fallback);
    const ADD = hex(t.ansi2, "#8cc26e"), DEL = hex(t.ansi1, "#e5786d");
    const SYNTAX = { comment: t.dim, string: hex(t.ansi3, t.foreground), number: hex(t.ansi6, t.foreground), keyword: hex(t.ansi5, t.foreground) };
    const cell = (w, c, s) => div().w(w).h_full().flex_none().pr(8).text_right().text_color(c).child(s);
    // Code rows in the code font; the file headers between them in the UI's.
    const row = (id) => skinFont((id ? h_flex().id(id) : h_flex()).font_family("JetBrains Mono"), "mono").text_size(12).w_full().h(ROW).flex_none().items_center().whitespace_nowrap().line_height(`${ROW}px`);
    // A band's buttons. Rows of a virtual list can't hold click handlers, so they're drawn at fixed
    // widths and the list's one click handler finds which was hit from where the press was
    // (`bandHit`); `bandActions` is what both go by.
    const STEP = 20, BTN_GAP = 6;
    const btnWidth = (label) => Math.ceil(label.length * 6.7) + 14;
    const bandActions = (r) => {
      if (r.error || r.loading) return [];
      if (r.left === null) return [{ label: "↓ Show the rest of the file", top: STEP, bottom: 0 }];
      if (!(r.left > 0)) return [];
      const out = [];
      // Going on down from the code above (not for the first gap: nothing is above it), leading up
      // into the code below (not after the last change), or the whole gap.
      if (r.left > STEP && r.from > 1) out.push({ label: `↓ ${STEP} more`, top: STEP, bottom: 0 });
      if (r.left > STEP && !r.trailing) out.push({ label: `↑ ${STEP} more`, top: 0, bottom: STEP });
      out.push({ label: r.left > STEP ? `Show all ${r.left}` : `Show ${r.left} line${r.left === 1 ? "" : "s"}`, top: r.left, bottom: 0 });
      return out;
    };
    // A band: a calm strip, a little taller than a line and ruled above and below, so the hidden
    // stretch reads as a pause between changes, with the function the next change is in.
    const band = (r) => {
      const acts = bandActions(r);
      return row().h(BAND).line_height(`${BAND}px`).bg(t.raised).border_y_1().border_color(t.border).text_color(t.dim)
        .child(div().w(gutter).h_full().flex_none().text_center().child("⋯"))
        .child(h_flex().gap(BTN_GAP).pl(4).pr(12).items_center()
          .children(acts.map((a) => div().w(btnWidth(a.label)).flex_none().h(18).flex().items_center().justify_center().rounded(5)
            .text_size(11).line_height("18px").text_color(t.muted).bg(t.selected).child(a.label)))
          .when(Boolean(r.error), (el) => el.child(div().text_color(t.blocked).child(`Couldn't read the file: ${r.error}`)))
          .when(r.loading, (el) => el.child(div().child("Reading the file…")))
          .when(Boolean(r.context), (el) => el.child(div().pl(4).text_color(t.muted).child(r.context))));
    };
    const bandHit = (r, x) => {
      let at = gutter + 4;
      for (const a of bandActions(r)) {
        const w = btnWidth(a.label);
        if (x >= at && x < at + w) return a;
        at += w + BTN_GAP;
      }
      return null;
    };
    // The list's one click handler: a file's header folds or unfolds it, a band's button opens its gap.
    const clickRow = (key, cx) => {
      const e = entries[Number(key)];
      // A press on Ask agent's bar, laid over the list, isn't a press on the row under it.
      if (!e || this.pressOnBar) return;
      const f = all[e.fi];
      if (e.r.kind === "group") { if (f.group.url) open(f.group.url); return; }
      if (e.r.kind === "file") {
        const x = this.pressX ?? -1;
        if (x >= VIEW_X - 4 && x < VIEW_X + VIEW_W + 4) return setSeen(f, !seen(f), cx);
        const act = headHit(f, x);
        if (act === "copy") {
          const path = fullPath(f);
          cx.write_to_clipboard(path);
          this.copied = path;
          cx.timer.after(1500, (cx) => { if (this.copied === path) { this.copied = null; DIFF.version++; cx.notify(); } });
          DIFF.version++; cx.notify(); return;
        }
        if (act === "github") return open(`${f.group.url}/files`);
        if (act === "reveal") return reveal(fullPath(f));
        if (act === "ask") {
          const id = `diff:${f.id}`;
          this.sending = this.sending === id ? null : id;
          this.asking = f.id;
          if (this.sending) { this.note.set_value(""); this.note.focus(); }
          DIFF.version++; cx.notify(); return;
        }
        if (act) return;
        if (whole) { DIFF.folds[fileKey(f)] = !isFolded(f); DIFF.version++; cx.notify(); }
        return;
      }
      if (e.r.kind !== "hunk") return;
      const a = bandHit(e.r, this.pressX ?? -1);
      if (a) { this.openGap(st, f, e.r.gap, a.top, a.bottom, cx); cx.notify(); }
    };
    // A file's header: a bordered bar in the UI font with space above it: the fold chevron, the
    // Viewed box (at a fixed place, VIEW_X, as the click finds it by where the press was), the name
    // bold and its folder dim, what happened to it when not just modified, its count and GitHub's
    // squares, and why it's folded.
    const VIEW_X = 32, VIEW_W = 74;
    // Each file's own actions in its header, right after the Viewed box (the header's gap of 10) at
    // fixed places, so a click finds them by where the press was: copy its path, open it on GitHub
    // (or show it on disk), and ask the story's agent about it.
    const ACT_X = VIEW_X + VIEW_W + 10, ACT_GAP = 2;
    const fullPath = (f) => (f.group.path ? `${f.group.path}/${f.path}` : f.path);
    const headActs = (f) => [
      { kind: "copy", w: 26 },
      ...(f.group.url ? [{ kind: "github", w: 26 }] : f.group.path ? [{ kind: "reveal", w: 26 }] : []),
      ...(lonePr(it) ? [] : [{ kind: "ask", w: 84 }]),
    ];
    // Which action a press at `x` (zoom taken out) is on. A press in the gaps between them, or just
    // past their ends, is on none ("none"), so a slightly missed action never folds the file.
    const headHit = (f, x) => {
      let at = ACT_X;
      for (const a of headActs(f)) { if (x >= at - ACT_GAP / 2 && x < at + a.w + ACT_GAP / 2) return a.kind; at += a.w + ACT_GAP; }
      return x >= VIEW_X + VIEW_W && x < at + 8 ? "none" : null;
    };
    // A pull request's (or uncommitted repo's) section heading on the page of all files: well clear of
    // the file above, its icon, repo and number large, its title, merged / not committed, how many of
    // its files are viewed, and a rule under it in the accent. A click opens the pull request.
    const section = (g) => {
      const files = all.filter((x) => x.group === g);
      const done = files.filter((x) => seen(x)).length;
      const [name, num] = g.url ? g.repo.split("#") : [g.repo, null];
      return v_flex().w_full().h_full().flex_none().justify_end().when(Boolean(g.url), (el) => el.cursor_pointer())
        .child(h_flex().w_full().gap(10).px(4).pb(8).items_center().whitespace_nowrap().border_b_2().border_color(tint(t.accent, "99"))
          .child(div().flex_none().text_color(g.url ? t.accent : t.muted).child(icon(own(g.url ? (g.merged ? "git-merge" : "git-pull-request") : "folder-open"), 16)))
          .child(h_flex().flex_none().gap(6).items_baseline()
            .child(div().text_size(TEXT + 3).font_semibold().text_color(t.foreground).child(name))
            .when(Boolean(num), (el) => el.child(div().text_size(TEXT + 3).text_color(t.dim).child(`#${num}`))))
          .when(Boolean(g.title), (el) => el.child(div().flex_shrink(1).min_w(0).truncate().text_size(TEXT).text_color(t.muted).child(g.title)))
          .child(div().flex_none().px(7).py(1).rounded(5).text_size(SMALL)
            .bg(g.url ? (g.merged ? tint(t.accent, "26") : tint(t.done, "26")) : t.raised).text_color(g.url ? (g.merged ? t.accent : t.done) : t.muted)
            .child(g.url ? (g.merged ? "Merged" : "Open") : "Not committed"))
          .when(g.key !== it.key, (el) => el.child(div().flex_none().text_size(SMALL).text_color(t.dim).child(g.key)))
          .child(div().flex_none().text_size(SMALL).text_color(done === files.length ? t.done : t.dim)
            .child(`${files.length} file${files.length === 1 ? "" : "s"} · ${done === files.length ? "all viewed" : `${done} viewed`}`))
          .when(Boolean(g.url), (el) => el.child(div().flex_none().text_size(SMALL).text_color(t.dim).child("Open on GitHub ↗"))));
    };
    const header = (f) => {
      const folded = whole && isFolded(f), ticked = seen(f);
      const what = f.status === "added" ? "New file" : f.status === "removed" ? "Deleted"
        : f.status === "renamed" ? (f.from ? `Renamed from ${f.from}` : "Renamed") : null;
      // A flat band edge to edge, ruled above and below like the rest of the layout (no cards), with
      // space above it; one at a time there's nothing to fold, so no chevron (its place stays).
      return div().w_full().h(HEAD).flex_none().pt(12)
        .child(h_flex().w_full().h_full().gap(10).px(10).items_center().border_y_1().border_color(t.border).bg(t.selected)
          .when(whole, (el) => el.cursor_pointer()).text_size(TEXT).whitespace_nowrap()
          .child(div().flex_none().w(12).text_color(t.dim).child(whole ? (folded ? "▸" : "▾") : ""))
          .child(h_flex().flex_none().w(VIEW_W).h(22).gap(6).px(7).items_center().rounded(5).border_1().border_color(ticked ? tint(t.done, "66") : t.border)
            .bg(ticked ? tint(t.done, "1f") : t.background).text_size(SMALL).text_color(ticked ? t.done : t.muted)
            .child(div().flex_none().w(12).h(12).rounded(3).flex().items_center().justify_center().text_size(10).line_height("12px")
              .when(ticked, (el) => el.bg(t.done).text_color(t.background).child("✓"))
              .when(!ticked, (el) => el.border_1().border_color(t.dim)))
            .child("Viewed"))
          .child(h_flex().flex_none().gap(ACT_GAP).items_center().children(headActs(f).map((a) => {
            const on = (a.kind === "ask" && this.sending === `diff:${f.id}`) || (a.kind === "copy" && this.copied === fullPath(f));
            const box = h_flex().flex_none().w(a.w).h(24).gap(5).items_center().justify_center().rounded(6)
              .text_size(SMALL).text_color(on ? t.foreground : t.dim).when(on, (el) => el.bg(t.hover));
            if (a.kind === "copy") return box.child(icon(this.copied === fullPath(f) ? chrome("check") : own("copy"), 14));
            if (a.kind === "github") return box.child(icon(own("external-link"), 14));
            if (a.kind === "reveal") return box.child(icon(own("folder-open"), 14));
            return box.child(icon(own("send"), 13)).child("Ask agent");
          })))
          .child(div().flex_none().w(1).h(16).bg(t.border))
          .child(h_flex().flex_none().gap(0)
            .when(f.path.includes("/"), (el) => el.child(div().text_color(t.dim).child(f.path.replace(/[^/]*$/, ""))))
            .child(div().font_semibold().text_color(ticked && folded ? t.muted : t.foreground).child(f.path.split("/").pop())))
          .when(Boolean(what), (el) => el.child(div().flex_none().text_size(SMALL)
            .text_color(f.status === "added" ? t.done : f.status === "removed" ? t.blocked : t.muted).child(what)))
          .child(h_flex().flex_none().gap(6).items_center().text_size(SMALL)
            .child(div().text_color(t.done).child(`+${f.add ?? 0}`))
            .child(div().text_color(t.blocked).child(`−${f.del ?? 0}`))
            .child(h_flex().gap(2).children(changeSquares(f.add ?? 0, f.del ?? 0).map((k) => div().w(8).h(8).rounded(2)
              .bg(k === "add" ? t.done : k === "del" ? t.blocked : t.raised)))))
          .when(folded, (el) => el.child(div().flex_none().text_size(SMALL).text_color(t.dim)
            .child(`${DIFF.folds[fileKey(f)] !== undefined ? (ticked ? "Viewed, folded" : "Folded") : FOLD_FILES.test(f.path) ? "Generated, folded" : "Large, folded"}: click to show`))));
    };
    const line = ({ r, fi, lines }) => {
      const f = all[fi];
      if (lines) return v_flex().w_full().flex_none().children(lines.map((x) => line({ r: x, fi })));
      if (r.kind === "group") return section(f.group);
      if (r.kind === "file") return header(f);
      if (r.kind === "hunk") return band(r);
      if (r.kind === "note") return row().text_color(t.dim).italic().child(div().w(gutter).h_full().flex_none()).child(div().pl(4).pr(12).child(r.text || " "));
      const c = r.kind === "add" ? ADD : r.kind === "del" ? DEL : null;
      const numColor = c ? mixColor(t.dim, c, 0.45) : t.dim;
      return row()
        .when(Boolean(c), (el) => el.bg(tint(c, "24")))
        .child(h_flex().h_full().flex_none().when(Boolean(c), (el) => el.bg(tint(c, "38")))
          .child(cell(num, numColor, r.old == null ? "" : String(r.old)))
          .child(cell(num, numColor, r.new == null ? "" : String(r.new)))
          .child(div().w(18).h_full().flex_none().text_center().text_color(c ?? t.dim).child(r.kind === "add" ? "+" : r.kind === "del" ? "−" : "")))
        .child(h_flex().pl(4).pr(12).text_color(t.foreground)
          .children(lineSegments(r.text, syntaxSpans(r.text, langs[fi]), r.marks).map(([s, kind, changed]) => div()
            .when(Boolean(kind), (el) => el.text_color(SYNTAX[kind]))
            .when(changed && Boolean(c), (el) => el.bg(tint(c, "5c")).rounded(3))
            .child(s)))
          .when(!r.text, (el) => el.child(" ")));
    };
    // One list per story on the page of all files (it keeps its place), else one per file, so each
    // opens at its top.
    const list = whole ? `diff-all-${patchHash(it.key)}` : `diff-lines-${patchHash(chosen.id)}`;
    const pick = (f) => { this.file[it.key] = f.id; this.changeAt = null; if (whole) this.pendingJump = f.id; };
    // One file at a time, each opens at its top (the list's scroll handle keeps its place otherwise).
    if (!whole && this.fileScroll && this.oneFile !== chosen.id) { this.oneFile = chosen.id; this.changeAt = null; this.fileScroll.scroll_to_item(0, "top"); }
    const scroller = whole ? this.diffScroll : this.fileScroll;
    // Keys, once the diff or the file list has been clicked: n / p the next or previous change
    // (across files on the page of all of them), ] / [ the next or previous file, v ticks the file
    // shown as viewed; in the file list ↑ / ↓ step through the files too.
    const keys = (arrows) => (e, cx) => {
      if (e.modifiers?.platform || e.modifiers?.control || e.modifiers?.alt) return;
      const k = e.key;
      if (k === "v") { setSeen(chosen, !seen(chosen), cx); cx.stop_propagation(); return; }
      if (k === "n" || k === "p") { if (this.stepChange(it.key, scroller, k === "n" ? 1 : -1)) { cx.stop_propagation(); cx.notify(); } return; }
      const by = k === "]" || (arrows && k === "down") ? "down" : k === "[" || (arrows && k === "up") ? "up" : null;
      if (by && this.stepFile(it.key, by)) { this.changeAt = null; if (whole) this.pendingJump = this.file[it.key]; cx.stop_propagation(); cx.notify(); }
    };
    const progress = all.filter(seen).length;
    const ask = this.askBar(t, st, it, all), askShown = ask.length > 0;
    const keycap = (k) => div().flex_none().min_w(16).h(16).px(4).rounded(4).border_1().border_color(t.border).text_size(10.5).line_height("14px").text_center().text_color(t.muted).child(k);
    // Each side scrolls on its own: the files in their column, the diff both ways. Every box down
    // to the scrolling ones has a definite height (h_full / flex_1 with min_h(0)). The file list's
    // width is dragged by the line between them; Herdr keeps it under the group's id, the same for
    // every story.
    return h_resizable("changes-split").flex_1().min_h(0).border_t_1().border_color(t.border)
      .child(resizable_panel().size(260).size_range(180, 640).child(v_flex().size_full().min_h(0).border_r_1().border_color(t.border)
        // ↑ and ↓ (and the diff's keys) work once the list has been clicked.
        .when(Boolean(this.filesFocus), (el) => el.track_focus(this.filesFocus).on_mouse_down("left", () => this.filesFocus.focus())
          .on_key_down(keys(true)))
        // How far the review has got: files ticked as viewed, of all of them.
        .child(v_flex().flex_none().px(12).pt(10).pb(8).gap(6).border_b_1().border_color(t.border)
          .child(h_flex().gap(6).items_center().text_size(SMALL)
            .child(div().flex_1().text_color(t.muted).child(`${all.length} file${all.length === 1 ? "" : "s"}`))
            .child(div().flex_none().text_color(progress === all.length ? t.done : t.dim).child(progress === all.length ? "All viewed" : `${progress} of ${all.length} viewed`)))
          .child(h_flex().w_full().h(3).rounded(2).bg(t.raised).overflow_hidden()
            .child(div().h_full().rounded(2).bg(t.done).w(`${(100 * progress) / all.length}%`)))
          // Every file on one page, or one at a time.
          .when(Boolean(this.diffScroll), (el) => el.child(h_flex().gap(2).pt(2)
            .child(textButton(t, "diff-all", "All files", (_e, cx) => { if (!DIFF.all) { DIFF.all = true; DIFF.version++; this.pendingJump = chosen.id; cx.notify(); } }, { on: DIFF.all, tip: "Every file on one page" }))
            .child(textButton(t, "diff-one", "One file", (_e, cx) => { if (DIFF.all) { DIFF.all = false; DIFF.version++; cx.notify(); } }, { on: !DIFF.all, tip: "One file at a time" })))))
        .child(v_flex().id("change-files").flex_1().min_h(0).py(4).pr(6).gap(1).overflow_y_scrollbar()
          .children(extra.groups.flatMap((g, gi) => [
            // A group's heading: its repo (and pull request), whether it's uncommitted or merged, its
            // ticket key when it's another than the story's, and how many of its files are viewed.
            h_flex().id(`files-group-${gi}`).flex_none().px(6).pt(10).pb(3).gap(6).items_center().text_size(SMALL).tooltip(g.label)
              .when(g.key !== it.key, (el) => el.child(div().flex_none().text_color(t.dim).child(g.key)))
              .child(div().flex_shrink(1).min_w(0).truncate().font_medium().text_color(t.muted).child(g.repo))
              .when(!g.url || g.merged, (el) => el.child(div().flex_none().text_color(t.dim).child(g.url ? "merged" : "not committed")))
              .child(div().flex_1())
              .when(g.files.length > 1, (el) => el.child(div().flex_none().text_color(t.dim)
                .child(`${g.files.filter((f) => seen({ ...f, group: g })).length}/${g.files.length}`))),
            ...g.files.map((f) => h_flex().id(`file-${f.id}`).flex_none().h(24).px(6).gap(6).items_center().rounded(6).cursor_pointer().text_size(SMALL)
              .when(f.id === chosen.id, (el) => el.bg(t.selected)).when(f.id !== chosen.id, (el) => el.hover((x) => x.bg(t.hover)))
              .tooltip(`${STATUS[f.status ?? "modified"][2]}: ${f.path}${f.from ? `\nRenamed from ${f.from}` : ""}`).on_click((_e, cx) => { pick(f); cx.notify(); })
              // What happened to it as a letter (modified dim), the name (generated files dim), then
              // its folder dim (the full path is the tip).
              .child(div().flex_none().w(10).text_center().font_medium().text_color(t[STATUS[f.status ?? "modified"][1]] ?? t.dim).child(STATUS[f.status ?? "modified"][0]))
              .child(h_flex().flex_1().min_w(0).gap(6).overflow_hidden()
                .child(div().flex_none().max_w_full().truncate().text_color(seen(f) || FOLD_FILES.test(f.path) ? t.muted : t.foreground).child(f.path.split("/").pop()))
                .when(f.path.includes("/"), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(f.path.replace(/\/[^/]*$/, "")))))
              .when(seen(f), (el) => el.child(div().flex_none().text_color(t.done).child("✓")))
              .child(div().flex_none().text_color(t.done).child(`+${f.add}`))
              .child(div().flex_none().text_color(t.blocked).child(`−${f.del}`))),
          ])))
        // The keys, quietly at the foot of the list.
        .when(Boolean(this.diffFocus), (el) => el.child(h_flex().flex_none().flex_wrap().px(12).py(8).gap(4).items_center().border_t_1().border_color(t.border).text_size(10.5).text_color(t.dim)
          .child(keycap("n")).child(keycap("p")).child(div().pr(6).child("change"))
          .child(keycap("]")).child(keycap("[")).child(div().pr(6).child("file"))
          .child(keycap("v")).child(div().child("viewed"))))))
      // The diff: both modes are the same list (one at a time it holds one file), each file under the
      // same header with its own actions, so there's no bar above it.
      .child(resizable_panel().child(v_flex().size_full().min_w(0).min_h(0)
        .child(div().flex_1().min_h(0).relative()
          // Sizes and positions come back as drawn (zoom included) while the header's are set at zoom
          // 1: a probe 100 wide says the zoom, and a press's x is divided by it.
          .child(div().id("diff-zoom-probe").absolute().top(0).left(0).w(100).h(0).on_size_change((size) => { if (size.width > 0) this.diffZoom = size.width / 100; }))
          .child(div().id("diff-x").size_full().overflow_x_scrollbar()
            // Where a press lands, for the band buttons and the Viewed box (and the press gives the diff
            // the keys); a scroll asks the page which file it's on, and n / p start from where it is.
            .child(div().w_full().min_w(width).h_full()
              .when(Boolean(this.diffFocus), (el) => el.track_focus(this.diffFocus).on_key_down(keys(false)))
              .on_mouse_down("left", (e) => {
                // Over Ask agent's bar (laid on top of the list, and as drawn too): the bar's, not the list's.
                this.pressOnBar = askShown && (e.local_position?.y ?? Infinity) < (this.askBarH ?? 0);
                if (this.pressOnBar) return;
                this.pressX = e.local_position ? e.local_position.x / (this.diffZoom || 1) : null;
                this.diffFocus?.focus();
              })
              .on_scroll_wheel((_e, cx) => { this.changeAt = null; if (whole && this.track(it.key)) cx.notify(); })
              .child(v_virtual_list(list, entries.length, view.sizes, (i) => String(i), (range) => {
                // Drawn during layout: it may only note what's on screen, not ask for a redraw.
                this.diffRange = { start: range.start, end: range.end };
                // Before it knows its height the list asks for every item at once; drawing them all
                // could run past the time Herdr gives a render, so past the first screenfuls (DRAW_FIRST
                // lines) they're blank boxes of the right height until it asks again for what's on screen.
                let drawn = 0;
                return entries.slice(range.start, range.end).map((e, k) => {
                  drawn += e.lines?.length ?? 1;
                  return drawn <= DRAW_FIRST ? line(e) : div().w_full().h(view.sizes[range.start + k] ?? ROW);
                });
              }).size_full().on_item_click(clickRow).when(Boolean(scroller), (el) => el.track_scroll(scroller)))))
          .child(Scrollbar.vertical(list).viewport_from_layout().absolute().inset_0())
          // Asking the agent about a file: a bar naming it, while it's open, laid over the top of the
          // diff, so opening or closing it doesn't move the page.
          .children(ask))));
  }

  // On the page of all files, after a scroll: the file at the top of what was last drawn becomes
  // the one shown (its header above, its row lit in the list), unless one was just picked and the
  // page hasn't moved since; a file whose last row has been on screen counts as looked at. True
  // when the view should redraw.
  track(key) {
    const view = this.diffView, range = this.diffRange;
    if (!view || view.key !== key || !range) return false;
    if (this.jump) {
      if (this.jump.start === null) this.jump.start = range.start;
      else if (this.jump.start !== range.start) this.jump = null;
    }
    const all = view.files;
    let changed = false;
    const fi = view.entries[range.start]?.fi;
    if (!this.jump && fi !== undefined && all[fi] && this.file[key] !== all[fi].id) { this.file[key] = all[fi].id; changed = true; }
    // Before the list knows its height it draws every row at once: that's not what's on screen.
    if (range.end - range.start > 90) return changed;
    const viewed = shared(VIEWED) ?? {}, add = {};
    all.forEach((f, i) => {
      const end = view.ends[i];
      if (end !== undefined && end >= range.start && end < range.end && !isFolded(f) && !viewed[viewedId(f)] && !this.unticked?.has(viewedId(f))) add[viewedId(f)] = key;
    });
    if (Object.keys(add).length) setShared(VIEWED, { ...viewed, ...add });
    return changed;
  }

  // Open some of a gap's hidden lines; the file is read first if it hasn't been.
  openGap(st, f, gap, top, bottom, cx) {
    const key = fileKey(f);
    const open = (DIFF.open[key] ??= {});
    const g = (open[gap] ??= { top: 0, bottom: 0 });
    g.top += top; g.bottom += bottom;
    DIFF.version++;
    if (DIFF.text[key]?.lines) return;
    if (DIFF.text[key]?.loading) return;
    DIFF.text[key] = { loading: true };
    cx.spawn(async (cx) => {
      try {
        let text;
        // A demo profile's files (demo.js) have their text in the fixture, if anywhere.
        if (isDemo(st.profile)) text = await demoBlob(f.group.url ?? null, f.path);
        else if (f.group.path) text = await readTextFile(`${f.group.path}/${f.path}`, { on: st.space?.machine ?? null });
        else {
          // The pull request's own version of the file, by its blob (merged ones too).
          const m = /github\.com\/([^/]+)\/([^/]+)\/pull\//.exec(f.group.url ?? "");
          if (!m || !f.sha) throw new Error("GitHub didn't say which version of it to read");
          const r = await gh(st.profile?.github?.account, ["api", "-H", "Accept: application/vnd.github.raw", `repos/${m[1]}/${m[2]}/git/blobs/${f.sha}`]);
          if (r.code !== 0) throw new Error((r.stderr || "gh failed").trim());
          text = r.stdout;
        }
        if (text === null || text === undefined) throw new Error("it couldn't be read");
        DIFF.text[key] = { lines: text.replace(/\n$/, "").split("\n").map((l) => l.replace(/\t/g, "    ")) };
      } catch (e) {
        DIFF.text[key] = { error: String(e?.message ?? e) };
      }
      DIFF.version++;
      cx.notify();
    });
  }

  // n / p in the Changes view: the next or previous run of changed lines, put on screen with a few
  // lines above it. Going on from the last one jumped to while the page hasn't been scrolled since,
  // else from what's at the top of the page. True when it moved.
  stepChange(key, scroller, by) {
    const view = this.diffView, top = this.diffRange?.start ?? 0;
    if (!view || view.key !== key || !scroller || !view.changes.length) return false;
    // `changes` are the items that start 3 lines above each run of changes (see changesBody).
    const from = this.changeAt?.sig === view.sig ? this.changeAt.i : top;
    const c = by > 0 ? view.changes.find((i) => i > from) : [...view.changes].reverse().find((i) => i < from);
    if (c === undefined) return false;
    const fi = view.entries[c].fi;
    scroller.scroll_to_item(c, "top");
    this.changeAt = { sig: view.sig, i: c };
    if (this.file[key] !== view.ids[fi]) { this.file[key] = view.ids[fi]; this.jump = { fi, start: null }; }
    return true;
  }

  // ↑ / ↓ in the Changes view's file list: the file before or after the chosen one.
  stepFile(key, k) {
    const by = k === "up" ? -1 : k === "down" ? 1 : 0;
    const ids = this.fileOrder?.key === key ? this.fileOrder.ids : [];
    if (!by || !ids.length) return false;
    const at = Math.max(0, ids.indexOf(this.file[key]));
    this.file[key] = ids[Math.min(ids.length - 1, Math.max(0, at + by))];
    return true;
  }

  // What every copy shows: the profile's stories, most urgent first, and the one shown.
  prepare(cx) {
    const st = this.state(cx);
    this.profile = st.profile;
    const t = skinTheme();
    // Only the sidebar's list asks for Jira; the story's own blocks just stay empty (they're hidden
    // where the profile has no Jira, but may show for a moment while the layout catches up).
    if (!this.ready(st)) return { st, t, early: this.loader ? needsSetup(t, st, "a board", "circle-check", "Set up this profile's board, Jira or a GitHub Project, to see your stories here: their subtasks, pull requests, checks and reviews in one place.", "jira") : div().size_full() };
    if (!st.data) return { st, t, early: frame(t, { ...st, error: st.error && `Couldn't load your stories: ${st.error}` }, [], st.error ? div().flex_1() : empty(t, "Gathering your stories…", { fill: true })) };
    // The agents' tabs and states, by pane: one finishing its turn (working, then done or idle) may
    // have pushed or opened a pull request, so the stories reload; a tab merely opening or closing
    // only changes the sessions (a closed one's can be resumed at once), so they alone reload.
    const live = agentsByKey(st.profile);
    const sig = new Map(profileAgents(st.profile).map(({ agent }) => [agent.pane, agent.status]));
    const was = this.liveSig;
    this.liveSig = sig;
    if (was) {
      if ([...sig].some(([pane, now]) => was.get(pane) === "working" && (now === "done" || now === "idle"))) this.loadAfterAgent(cx);
      else if (sig.size !== was.size || [...sig.keys()].some((pane) => !was.has(pane))) this.loadSessions(cx);
    }
    const items = ordered(build(st.data, live, pausedIn(st.profile), storySpaces(st.profile), boardOf(st.setup)?.handover, { left: leftStories(st.profile) }));
    const spaceKey = keyOf(st.space?.name);
    const inStory = profileOf(st.space)?.id === st.profile.id ? items.find((x) => x.it.key === spaceKey)?.it ?? null : null;
    const reviews = reviewsOf(st.data);
    const done = doneIn(st.data, st.profile, boardOf(st.setup)?.handover);
    const shown = findItem([...items, ...done], loneOf(st.data), previewIn(st.profile)) ?? inStory;
    // What's shown, for carefulButton: a button armed on one story isn't armed on the next.
    this.shownKey = `${st.profile.id}:${shown?.key ?? ""}`;
    return { st, t, items, reviews, shown, done };
  }

  // A story previewed that has begun (sessions, pull requests) has its screenshots counted once per
  // load, so the tab bar can show Screenshots only when there are some.
  countPreviewShots(st, it, cx) {
    if (it.space || lonePr(it) || !begun(it) || (shared(COUNTS) ?? {})[it.key]?.shots !== undefined) return;
    const e = this.shots[it.key];
    if (e && (e.loading || e.at >= st.at)) return;
    this.shots[it.key] = { ...(e ?? {}), loading: true, at: e?.at ?? 0 };
    cx.spawn(async () => {
      const list = await this.storySessions(st, it, storyKeys(it)).catch(() => e?.list ?? []);
      this.shots[it.key] = { list, at: Date.now() };
      const shots = await countShots(list.map((s) => s.id), null).catch(() => undefined);
      setCounts(it.key, { shots: shots ?? 0 });
    });
  }

  // Above the terminals: the story shown's title row, with what can be done, folded or not.
  render(cx) {
    const { st, t, early, shown } = this.prepare(cx);
    if (early) return early;
    if (shown && viewOf(st.profile, shown) === "shots") this.shareShots(st, shown, cx);
    else if (shown && previewIn(st.profile) === shown.key) this.countPreviewShots(st, shown, cx);
    return decor("blockDecor", t, v_flex().size_full().min_w(0).px(INSET).when(sideHidden(layout()), (el) => el.pl(INSET + buttonsRoom())).justify_center().text_size(TEXT).text_color(t.foreground)
      .child(shown ? this.headRow(t, st, shown, headFolded(), cx) : div().text_color(t.dim).child("Pick a story on the left.")), storyBlock("stories", shown));
  }
}

// Under the title row: the story's note line, status line, description and subtasks.
export class StoryBody extends Stories {
  init(cx) {
    super.init(cx);
    this.readerScroll = VirtualListScrollHandle.new(); // the passage reader, scrolled to the passage
  }
  render(cx) {
    const { st, t, early, shown } = this.prepare(cx);
    if (early) return early;
    const n = noteNow();
    const note = n ? div().id("story-note").flex_none().truncate().text_size(SMALL).text_color(t.muted).tooltip(n.full ?? n.text).child(n.text)
      : st.data.prError ? div().id("story-note").flex_none().truncate().text_size(SMALL).text_color(t.blocked).tooltip(st.data.prError).child("Pull requests didn't load, Refresh to try again")
      : null;
    return decor("blockDecor", t, v_flex().size_full().min_h(0).px(INSET).pt(10).pb(6).gap(6).text_size(TEXT).text_color(t.foreground)
      .child(shown ? this.detail(t, st, shown, cx, note) : empty(t, "Pick a story on the left.", { fill: true })), storyBlock("story-body", shown));
  }
}

// The sidebar for a profile with a board: what needs you; its stories in progress (on the board or
// here), the pull requests waiting for your review, the stories to do, the ones handed over; then its
// other spaces.
export class StoryList extends Stories {
  init(cx) {
    this.loader = true;
    Source.prototype.init.call(this, cx);
    cx.timer.every(QUICK_EVERY, (cx) => { if (this.inFlight(this.context())) this.quickPulls(cx); });
  }

  // A fresh load from Jira and GitHub (not the sessions alone, nor the copy kept from before a
  // restart) is what pull request notifications compare.
  async fetch(ctx) {
    const data = await super.fetch(ctx);
    this.fresh = ctx.key;
    return data;
  }

  loaded(ctx) {
    super.loaded(ctx);
    const entry = this.cache[ctx.key];
    if (this.fresh !== ctx.key || entry?.error || !entry?.data) return;
    this.fresh = null;
    notifyPulls(ctx, entry.data);
    pruneShared(ctx.profile, entry.data);
    fetchAvatars(entry.data).catch(() => {});
  }

  // Next: one card, the whole queue's. A header line ("Next", how many items, Claude's picks as a ✨
  // badge, the chevron) over, folded, the queue's most urgent item, or, unfolded, the whole queue
  // inside the same border (queueList()), in order, the item shown lit: Next goes to the row after it.
  // Folded, it never puts a pick of Claude's in front of what needs you (#87): its main row is the
  // queue's first item, saying "You're on it" while that's on screen, and where ⌘⇧J goes (`top`, the
  // item after the one shown) is a smaller line under it when that's another item. Only a queue of
  // picks alone leads with one, and the card is then tinted, so it reads as generated. While Claude
  // has no picks, a slim magic button is the card's last row.
  // `shownKey`: the item on screen now (the story or review shown, "desk"), lit in the open queue.
  nextCard(t, st, items, reviews, queue, top, shownKey) {
    const glow = (a) => alpha(t.accent, a);
    const picks = queue.filter((x) => x.suggest).length;
    const brewing = Boolean(brewingIn(st.profile));
    // A queue of one has nothing more to show unfolded: no chevron, and an open queue that drops to
    // one item folds rather than stay a list of one (#64).
    const many = queue.length > 1;
    if (!many) this.queueOpen = false;
    const toggle = (_e, cx) => { this.queueOpen = !this.queueOpen; cx.notify(); };
    const open = Boolean(this.queueOpen);
    // The most urgent: the queue's first, unless it's all picks, where Next just cycles through them.
    const lead = queue[0]?.suggest ? top : queue[0] ?? top;
    const here = queueShown(lead, shownKey);
    const tint = !open && Boolean(lead.suggest);
    const card = v_flex().id("story-next").flex_none().p(4).gap(2).rounded(10).border_1()
      .bg(tint ? glow(0.07) : t.raised).border_color(tint ? glow(0.3) : t.border)
      .child(h_flex().flex_none().h(24).pl(8).gap(6).items_center().text_size(SMALL)
        .child(div().flex_none().font_medium().text_color(t.dim).child("Next"))
        // How many, as every group counts: where you are is the lit row, and Next goes to the one
        // after it. A position here ("3 of 3") read as another marker, disagreeing with the lit row.
        .child(div().flex_none().text_color(t.muted).child(String(queue.length)))
        .child(div().flex_1())
        .child(h_flex().id("story-next-tools").flex_none().gap(2).items_center().on_mouse_down("left", stop).on_click(stop)
          // Claude's picks: how many are in the queue (turning while Claude brews); opens the queue, when it holds more than one.
          .when(picks > 0 || brewing, (el) => el.child(h_flex().id("story-next-picks").flex_none().h(20).px(6).gap(4).items_center().rounded(6)
            .text_color(t.accent).when(many, (x) => x.cursor_pointer().hover((h) => h.bg(glow(0.14))).on_click(toggle))
            .tooltip(brewing ? "Claude is looking for what to do next" : many ? `${picks} suggested by Claude: open the queue to see them` : `${picks} suggested by Claude`)
            .child(brewing ? brewMark(t, 12) : icon(own("sparkles"), 12)).when(picks > 0, (x) => x.child(String(picks)))))
          .when(many, (el) => el.child(iconButton(t, "story-queue", chrome(open ? "chevron-down" : "chevron-right"), toggle,
            open ? "Hide the queue" : "Show the whole queue", { on: open })))))
      .when(open, (el) => el.children(this.queueList(t, st, items, reviews, queue, shownKey)))
      .when(!open, (el) => el.child(withDrop(t, st.profile, lead, queueRow(t, lead, here, () => goNext(st.profile, lead), { card: true }))
        .tooltip(`${queueAway(lead) ? "Opens on the web" : lead.suggest?.idea ? "Starts a Claude on the Desk with this idea" : here ? "Go to its step" : "Go there"}${lead === top ? " ⌘⇧J" : ""}`)))
      .when(!open && lead !== top, (el) => el.child(queueThen(t, top, () => goNext(st.profile, top))))
      .when(!picks, (el) => el.child(div().pt(2).child(this.magic(t, st, items, reviews, { slim: true }))));
    return card;
  }

  // Nothing in the queue: a calm "All clear" line over the magic button, at its fullest.
  allClear(t, st, items, reviews) {
    return v_flex().flex_none().gap(6)
      .child(h_flex().flex_none().px(10).gap(8).items_center().text_size(SMALL).text_color(t.muted)
        .child(mark(t, "done", 14)).child(div().child("All clear: nothing needs you")))
      .child(this.magic(t, st, items, reviews));
  }

  // The whole queue, under Next while its chevron is open: what needs you, the clean-up, then the
  // suggestions (each with why, and an ✕ to drop it); a click does what Next would. At its foot the
  // What next? button, to ask for suggestions (again). The item shown is lit (a pick by its story),
  // not Next's, which is the one after it: lighting that lit the row under the one clicked.
  // Its rows, for inside Next's card.
  queueList(t, st, items, reviews, queue, shownKey) {
    const lit = (x) => queueShown(x, shownKey);
    const row = (x) => withDrop(t, st.profile, x, queueRow(t, x, lit(x), () => goNext(st.profile, x)));
    // A group's label only when there's more than one group: alone it repeats the card's header.
    const groups = [queue.some((x) => !x.clean && !x.suggest && !x.review && !x.ask), queue.some((x) => x.ask), queue.some((x) => x.review && !x.suggest), queue.some((x) => x.clean)].filter(Boolean).length;
    const part = (label, list) => (!list.length ? [] : groups < 2 ? list.map(row) : [h_flex().px(10).pt(6).pb(2).gap(6).items_center().text_size(SMALL).text_color(t.dim)
      .child(div().child(label)).child(div().text_color(t.muted).child(String(list.length))), ...list.map(row)]);
    const asked = queue.filter((x) => !x.clean && !x.suggest && !x.review && !x.ask), fromAgents = queue.filter((x) => x.ask), review = queue.filter((x) => x.review && !x.suggest),
      clean = queue.filter((x) => x.clean), said = queue.filter((x) => x.suggest);
    return [...part("Needs you", asked), ...part("From agents", fromAgents), ...part("To review", review), ...part("Clean up", clean),
      // Claude's picks last, a tinted group of the card, so they read as generated (with none, the
      // What next? button is the card's last row instead).
      ...(said.length ? [div().pt(4).child(this.suggestBox(t, st, items, reviews, said, row))] : [])];
  }

  // The suggestions' group, the card's last: tinted as the magic button is, a header "Suggested by
  // Claude" with their age, and a small Re-magic that asks again (brewing in its place while Claude
  // runs; the new picks replace these). No border of its own: it's part of Next.
  suggestBox(t, st, items, reviews, said, row) {
    const glow = (a) => alpha(t.accent, a);
    const at = (shared(SUGGESTED) ?? {})[st.profile.id]?.at;
    return v_flex().id("queue-suggested").flex_none().pb(2).gap(2).rounded(8).bg(glow(0.07))
      .child(h_flex().flex_none().pl(10).pr(2).pt(4).gap(6).items_center()
        .child(icon(own("sparkles"), 12).text_color(t.accent))
        .child(div().flex_1().min_w(0).truncate().text_size(SMALL).text_color(t.accent).child(`Suggested by Claude${at ? ` · ${ago(at)}` : ""}`))
        .child(brewingIn(st.profile)
          ? h_flex().id("queue-remagic").flex_none().px(6).py(2).gap(4).items_center().text_size(SMALL).text_color(t.accent).tooltip("Claude is looking around again")
            .child(brewMark(t, 12)).child(div().frames(brewWords(brewingIn(st.profile), true), 2400))
          : h_flex().id("queue-remagic").flex_none().px(6).py(2).gap(4).items_center().rounded(6).cursor_pointer().text_size(SMALL).text_color(t.dim)
            .hover((x) => x.bg(glow(0.14)).text_color(t.accent)).tooltip("Ask Claude again, from where things stand now")
            .on_click(() => startSuggest(st, items, reviews))
            .child(icon(own("sparkles"), 12)).child("Re-magic")))
      .children(said.map(row));
  }

  // What next? Under Next, or in its place, while Claude has no picks in the queue: a Claude in the
  // background suggests what to do (startSuggest). A glint glides along its border and its sparkles
  // breathe slowly; brewing, the glint goes quicker, the sparkles turn with bubbles drifting up and
  // the words change every few seconds (borderGlint(), brewMark(), sparkle()). Native loops only.

  // `slim`: under a Next that has work in it, quieter so it doesn't outshout what needs you.
  magic(t, st, items, reviews, { slim = false } = {}) {
    const glow = (a) => alpha(t.accent, a);
    const brewing = Boolean(brewingIn(st.profile));
    return h_flex().id("story-magic").relative().overflow_hidden().flex_none().px(10).py(slim ? 4 : 8).gap(8).items_center().rounded(8)
      .bg(glow(brewing ? 0.12 : slim ? 0.05 : 0.08)).child(edgeOf(glow(brewing ? 0.45 : slim ? 0.2 : 0.3), 8))
      .when(!brewing, (el) => el.cursor_pointer().hover((x) => x.bg(glow(0.16))).on_click(() => startSuggest(st, items, reviews))
        .tooltip("Claude looks at the sprint, the backlog, your pull requests and reviews in the background, and fills Next with what to do"))
      .when(brewing, (el) => el.tooltip("Claude is looking around in the background: a minute or two, ten at most"))
      .on_size_change((size, cx) => this.shineSize("magic", size, cx)).child(this.shineProbe("magic"))
      .children(borderGlint(glow, this.shine?.magic, 8, brewing ? 2600 : 6000))
      .child(brewing ? brewMark(t, slim ? 12 : 16) : sparkle(t, slim ? 12 : 16))
      .child(div().flex_1().min_w(0).truncate().text_size(SMALL).font_medium().text_color(t.accent)
        .when(brewing, (el) => el.frames(brewWords(brewingIn(st.profile) ?? 1), 2800)).when(!brewing, (el) => el.child(slim ? "Conjure more to do" : "Conjure what's next")));
  }

  // A finished story in the Done group: muted, the done mark, its key and badges (its merged pull
  // requests among them); a click previews it, as a story not open. No actions of its own.
  doneRow(t, it, on, st) {
    const sign = statusMark(t, "done", { where: "row", size: 8, color: t.done });
    return decor("rowDecor", t, h_flex().id(`done-${it.key}`).flex_none().px(8).py(7).gap(10).items_start().rounded(8).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => selectStory(st.profile, it)).tooltip(`Done on the board · ${progress(it)}. Show its details, pull requests and earlier sessions`)
      .child(div().flex_none().mt(1).child(sign ?? mark(t, "done", 16)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(skinFont(div(), "ui").truncate().font_medium().text_color(t.muted).child(it.title))
        .child(h_flex().min_w(0).h(14).gap(8).items_center().text_size(SMALL).opacity(0.6)
          .child(skinFont(div(), "numbers").flex_none().text_color(t.dim).child(it.key))
          .children(storyBadges(t, it)))),
      { selected: on, state: "done", story: it, now: new Date() });
  }

  // The Done group, last in the sidebar and folded unless unfolded by hand (per profile): the finished
  // stories the list leaves out once cleaned up, so they stay one click away without crowding what's
  // in play. Its heading counts them and its chevron folds it; folded, the one shown still has its row.
  doneGroup(t, st, done, shown) {
    if (!done.length) return [];
    const all = shared(DONE_OPEN) ?? {};
    const open = Boolean(all[st.profile.id]);
    const flip = () => { const next = { ...all }; if (open) delete next[st.profile.id]; else next[st.profile.id] = true; setShared(DONE_OPEN, next); };
    const when = st.data.sprints?.[0]?.kanban ? "in the last 14 days" : "this sprint";
    return [div().id("stories-done").flex_none().cursor_pointer().on_click(flip)
      .tooltip(`${open ? "Fold" : "Show"} the stories finished ${when}`)
      .child(groupHeader(t, "Done", done.length, icon(chrome(open ? "chevron-down" : "chevron-right"), 12).text_color(t.dim))),
    ...done.filter(({ it }) => open || it.key === shown?.key).map(({ it }) => this.doneRow(t, it, it.key === shown?.key, st))];
  }

  render(cx) {
    const { st, t, early, items, reviews, shown, done } = this.prepare(cx);
    if (early) return early;
    orderAgents(st.profile, items);
    // Every finished story the board has, not just the ones listed: one that's left only leftovers
    // behind is listed once they're found.
    checkLeftovers(st.profile, build(st.data, new Map(), {}, storySpaces(st.profile), null, { all: true }));
    const started = items.filter(({ it }) => it.space);
    // Story spaces named before names were just the key get renamed once.
    for (const { it } of started) if (it.space.name !== it.key && !RENAMED.has(it.space.id)) { RENAMED.add(it.space.id); run("space.rename", { id: it.space.id, name: it.key }); }
    const tally = (lo, hi) => items.filter((x) => x.n[0] >= lo && x.n[0] <= hi).length;
    // The summary: a mark and a number each (the words in its tooltip), coloured as the rows are.
    const counts = [[tally(0, 0), "need you", "working", "needs-you"], [tally(1, 1), "with changes requested", "working", "changes"], [tally(2, 2), "with checks failing", "blocked", "failing"], [tally(3, 3), "ready to merge", "done", "ready"],
      [reviews.length, "to review", "accent", "review"], [tally(5, 5), "working", "accent", "working"], [tally(7, 7), "paused", "muted", "paused"]];
    // Next: what cmd-shift-j goes to, the one after the item shown in what needs you.
    const desk = deskOf(st.profile);
    const onDesk = Boolean(desk?.active) && !shown;
    const queue = needQueueOf(st.profile, items, reviews);
    const shownKey = shown?.key ?? (onDesk ? DESK_ITEM.key : undefined);
    const top = nextIn(queue, shownKey);
    const next = top ? this.nextCard(t, st, items, reviews, queue, top, shownKey) : this.allClear(t, st, items, reviews);
    // The stories, grouped by where their work is on the board: in progress (what needs you first, as
    // ordered() keeps it), to do, and the sunk ones, handed over (sunkWords), each in the list's order.
    const words = sunkWords(boardOf(st.setup));
    const handed = items.filter((x) => sunk(x.it, x.n));
    const going = items.filter((x) => !sunk(x.it, x.n) && underWay(x.it));
    const toDo = items.filter((x) => !sunk(x.it, x.n) && !underWay(x.it));
    const rows = (list) => list.map(({ it }) => this.row(t, it, it.key === shown?.key, cx, st));
    const group = (label, n) => groupHeader(t, label, n);
    // `badge`: a chip after the title (an approved pull request's).
    // `lead`: what goes before the title instead of the skin's mark (a pull request's state, an avatar).
    const plain = (id, on, color, title, line, onClick, square, badge = null, lead = null) => h_flex().id(id).flex_none().px(8).py(7).gap(10).items_start().rounded(8).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover))).on_click(onClick)
      .child(lead ? div().flex_none().mt(1).child(lead) : ((m) => (m ? div().flex_none().mt(1).child(m) : null))(statusMark(t, square ? "space" : "review", { where: "plain", size: 8, color })) ?? div().flex_none().mt(1).child(square ? div().flex().size(16).items_center().justify_center().child(icon(chrome("folder"), 12).text_color(t.dim)) : mark(t, "review", 16)))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(h_flex().min_w(0).gap(6).items_center()
          .child(skinFont(div(), "ui").flex_1().min_w(0).truncate().font_medium().child(title))
          .when(Boolean(badge), (el) => el.child(div().flex_none().child(badge))))
        .child(div().truncate().text_size(SMALL).text_color(t.muted).child(line)));
    const approvedChip = (p) => (!p.merged && p.reviewDecision === "APPROVED" ? div().id(`approved-${prName(p)}`).tooltip("Approved").child(mark(t, "pr-approved", 14)) : null);
    // With a GitHub owner set, Reviews for you always shows (empty, it says so), unless the person
    // works alone: nobody on their team asks for reviews, so it shows only with something in it (or to
    // say pull requests didn't load). Your pull requests holds only the ones on no story here, as a
    // story's own are on the story (its row's and header's Merge): it shows with something in it, or
    // to say pull requests didn't load.
    const owner = st.setup.github?.owner;
    const noPulls = st.data.prError ? "Pull requests didn't load, Refresh to try again" : null;
    const alone = worksAlone(st.setup);
    const always = Boolean(owner) && (!alone || Boolean(noPulls));
    // Every open pull request of yours on no story of the list, whatever its title (a story's own are on
    // the story): one naming no ticket shows on its own, one naming another board's ticket opens on GitHub.
    const known = projectsOf(st.data);
    const storyOf = (p) => {
      const k = prKey(p, st.data, known);
      return k ? items.find(({ it }) => it.key === k || it.subs.some((s) => s.key === k))?.it ?? null : null;
    };
    const minePrs = (st.data.prs ?? []).filter((p) => !p.merged && !storyOf(p)).sort((a, b) => Date.parse(b.updatedAt ?? 0) - Date.parse(a.updatedAt ?? 0));
    // A pull request of yours: its state as the mark before it (the words in its tooltip).
    const myPull = (p) => {
      const [state, words, color] = prLook(t, p, checksOf(p));
      // One naming no ticket of the board is shown on its own (pullItem), on its Changes too.
      const lone = prKey(p, st.data, known) ? null : pullItem(p);
      return plain(`mine-${prName(p)}`, Boolean(lone) && lone.key === shown?.key, color, p.title.replace(/^\s*\[[^\]]*\]\s*/, ""), `${prName(p)}${p.updatedAt ? ` · ${ago(Date.parse(p.updatedAt))}` : ""}`,
        () => { if (lone) { selectStory(st.profile, lone); setView(st.profile, lone, "changes"); } else open(p.url); }, false, null, mark(t, state, 16))
        .tooltip(`${words}. ${lone ? "Show its files and what it needs" : "Open on GitHub"}`);
    };
    // Pull requests grouped by the story they belong to (a subtask's key counts for its story), in the
    // order their newest one comes; a ticket not in the list (another board's) is a group of its key,
    // and the ones naming no ticket come last.
    const byStory = (list, prOf) => {
      const groups = new Map();
      for (const x of list) {
        const p = prOf(x), story = storyOf(p), key = story?.key ?? prKey(p, st.data, known) ?? "";
        if (!groups.has(key)) groups.set(key, { key, story, list: [] });
        groups.get(key).list.push(x);
      }
      return [...groups.values()].sort((a, b) => (a.key === "") - (b.key === ""));
    };
    // Your pull requests' "No ticket" heading ends in icon menus, the Desk's: Request approval (while one
    // of them, not a draft, isn't approved; for those, unless the person works alone) and Merge (for
    // all). Each starts a new agent on the Desk with its task, or sends it to one of the Desk's Claudes.
    const taskMenu = (g, kind, list) => {
      const { label, glyph } = TASK_LOOK[kind];
      const what = "pull requests without a ticket";
      const rows = storyTaskRows(t, st.profile, null, kind, list);
      const id = g.key || "none";
      return div().id(`${kind}-wrap-${id}`).flex_none().on_mouse_down("left", stop).on_click(stop).child(this.menuButton(t, `${kind}-${id}`, "", rows, `${label} for ${what}, with a new agent or an open Claude`, { iconPath: own(glyph), width: 340 }));
    };
    const plan = (g) => {
      const waiting = g.list.filter((p) => !p.merged && !p.isDraft && p.reviewDecision !== "APPROVED");
      return h_flex().flex_none().gap(2).items_center()
        .when(waiting.length > 0 && !alone, (el) => el.child(taskMenu(g, "approval", waiting)))
        .child(taskMenu(g, "merge", g.list));
    };
    // A group folds by its chevron, so a story with many pull requests doesn't push the rest down;
    // folded, its heading says how many and the most urgent state among them. Kept per profile.
    const folds = (shared(PR_FOLDS) ?? {})[st.profile.id] ?? {};
    const foldId = (g, id) => `${id}:${g.key || "none"}`;
    const fold = (g, id) => {
      const all = shared(PR_FOLDS) ?? {}, mine = { ...(all[st.profile.id] ?? {}) };
      if (mine[foldId(g, id)]) delete mine[foldId(g, id)]; else mine[foldId(g, id)] = true;
      setShared(PR_FOLDS, { ...all, [st.profile.id]: mine });
    };
    const storyHead = (g, id, prOf) => {
      const shut = Boolean(folds[foldId(g, id)]);
      const open = g.list.map(prOf).filter((p) => !p.merged);
      const [worst, tip] = open.length ? prSummary(t, open) : [null, ""];
      const what = g.key ? `${g.key}'s pull requests` : "the pull requests without a ticket";
      return h_flex().id(`${id}-${g.key || "none"}`).flex_none().px(8).pt(10).pb(2).gap(8).items_center().text_size(SMALL).text_color(t.dim)
        .when(Boolean(g.story), (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip(`Show ${g.key}`).on_click(() => selectStory(st.profile, g.story)))
        .child(div().id(`${id}-fold-${g.key || "none"}`).flex_none().flex().size(16).items_center().justify_center().rounded(4).cursor_pointer()
          .hover((s) => s.bg(t.hover)).tooltip(`${shut ? "Show" : "Fold"} ${what}`)
          .on_mouse_down("left", stop).on_click((e, cx) => { stop(e, cx); fold(g, id); })
          .child(icon(chrome(shut ? "chevron-right" : "chevron-down"), 12).text_color(t.dim)))
        .child(skinFont(div().flex_none(), "key").child(g.key || "No ticket"))
        .child(div().flex_1().min_w(0).truncate().child(g.story?.title ?? ""))
        .when(shut && Boolean(worst), (el) => el.child(div().flex_none().child(countBadge(t, `${id}-sum-${g.key || "none"}`, worst[0], open.length, tip, worst[2]).when(open.length === 1, (x) => x.child("1")))))
        // Its menus for the pull requests naming no ticket (the Desk's); not for a ticket of another board.
        .when(id === "mine-story" && !g.key, (el) => el.child(div().flex_none().child(plan(g))));
    };
    const grouped = (list, prOf, row, id) => byStory(list, prOf).flatMap((g) => [storyHead(g, id, prOf), ...(folds[foldId(g, id)] ? [] : g.list.map(row))]);
    // The profile's spaces that aren't a story's, nor its Desk.
    const keys = new Set(items.map(({ it }) => it.key));
    const others = spacesOf(st.profile).filter((s) => !keys.has(keyOf(s.name)) && s.id !== desk?.id);
    // Earlier sessions that name no ticket of the board, for the Desk's menu.
    const loose = (st.data.sessions ?? []).filter((s) => !s.running && !(s.first ?? []).length && !keyIn(s.title, known))
      .sort((a, b) => b.updated - a.updated);
    // How fresh this is: loading now, or when it was loaded. Quiet unless something's wrong: a load
    // failed, or what's shown is over an hour old (a restart, say). A click reloads.
    const age = st.at ? Date.now() - st.at : null;
    const stale = age != null && age > 60 * 60 * 1000;
    const fresh = skinFont(h_flex().id("stories-fresh").flex_none().h(20).gap(6).items_center().cursor_pointer()
      .text_color(!st.loading && (stale || st.error) ? t.working : t.dim), "fresh", SMALL).hover((x) => x.text_color(t.foreground))
      .tooltip("Load the stories again").on_click(() => setShared(REFRESH, Date.now()))
      .when(st.loading, (el) => el.child(icon(chrome("spinner"), 11).spin(900)))
      .child(skinText(st.loading ? (st.data ? `Updating… showing what was loaded ${ago(st.at) === "now" ? "just now" : `${ago(st.at)} ago`}` : "Loading…")
        : age == null ? "Not loaded yet" : stale ? `From ${ago(st.at)} ago: click to update` : `Updated ${ago(st.at) === "now" ? "just now" : `${ago(st.at)} ago`} ↻`, "fresh"))
      .when(Boolean(st.error), (el) => el.child(div().flex_1().min_w(0).truncate().tooltip(st.error).child(`· ${st.error}`)));
    // Clean up all: a broom and how many finished stories have something left to clean, beside the
    // freshness line; one dialog lists them, its Clean up runs `kelpie.clean-all`.
    // While Clean up all (or a story's clean-up) runs, the working mark in the broom's place.
    const dirty = items.map((x) => x.it).filter((it) => cleanable(st.profile, it).length);
    const sweeping = busyOf(`all:${st.profile.id}`) ?? items.map((x) => busyOf(x.it.key)).find((e) => e?.kind === "clean") ?? null;
    const cleanAll = dirty.length || sweeping ? h_flex().flex_none().gap(2).items_center()
      .child(sweeping ? busyMark(t, "stories-clean-all", sweeping) : iconButton(t, "stories-clean-all", own("brush-cleaning"), () => askCleanAll(st.profile, dirty),
        `Clean up ${dirty.length === 1 ? `the ${finished(dirty[0]) ? "finished" : "reassigned"} story` : `all ${dirty.length} ${dirty.every(finished) ? "finished " : ""}stories`} with something left`))
      .when(dirty.length > 0, (el) => el.child(div().text_size(SMALL).text_color(t.dim).child(String(dirty.length)))) : null;
    return v_flex().size_full().min_h(0).text_size(TEXT).text_color(t.foreground)
      .child(v_flex().flex_none().px(INSET).pb(10).gap(8)
        .child(h_flex().flex_none().gap(8).items_center().child(div().flex_1().min_w(0).child(fresh)).when(Boolean(cleanAll), (el) => el.child(cleanAll)))
        .when(counts.some(([n]) => n), (el) => el.child(h_flex().flex_wrap().gap(12).items_center().children(counts.filter(([n]) => n)
          .map(([n, label, c, state]) => countBadge(t, `count-${state}`, state, n, `${n} ${label}`, t[c]).when(n === 1, (x) => x.child("1"))))))
        .when(Boolean(next), (el) => el.child(next)))
      .child(v_flex().id("work-side-list").flex_1().min_h(0).px(8).pb(10).overflow_y_scrollbar()
        // The Desk, for work without a ticket: always first.
        .children(deskRows(t, this, st.profile, { on: onDesk, sessions: loose }))
        // "In progress": started on the board or here; shown only when there are some.
        .when(going.length > 0, (el) => el.child(group("In progress", going.length)).children(rows(going)))
        .when(always || reviews.length > 0, (el) => el.child(group("Reviews for you", reviews.length))
          .when(reviews.length === 0, (x) => x.child(empty(t, noPulls ?? "Nothing waiting for your review.")))
          .children(grouped(reviews, (r) => r.review, (r) => plain(`review-${prName(r.review)}`, r.key === shown?.key, t.accent, r.title, `${prName(r.review)} · ${ago(Date.parse(r.review.updatedAt))}`,
            () => selectStory(st.profile, r), false, approvedChip(r.review), avatar(t, r.review.author?.login ?? "", 16)).tooltip(`From ${r.review.author?.login ?? "someone"}. Preview it: its checks and files, and Start review`), "review-story")))
        .when(Boolean(owner && noPulls) || minePrs.length > 0, (el) => el.child(group("Your pull requests", minePrs.length))
          .when(minePrs.length === 0, (x) => x.child(empty(t, noPulls ?? "No open pull requests of yours.")))
          .children(grouped(minePrs, (p) => p, myPull, "mine-story")))
        .child(group("To do", toDo.length))
        .children(toDo.length ? rows(toDo) : [empty(t, noneToDo(st.data, items))])
        .when(handed.length > 0, (el) => el.child(group(words.heading, handed.length)).children(rows(handed)))
        .when(others.length > 0, (el) => el.child(group("Other spaces", others.length))
          .children(others.map((s) => plain(`space-${s.id}`, s.active && !shown, t.dim, s.name, `${s.tabs.length} tab${s.tabs.length === 1 ? "" : "s"} · no story`,
            () => { setPreview(st.profile, null); run("space.select", { id: s.id }); }, true))))
        .children(this.doneGroup(t, st, done, shown)));
  }
}

// Below the tab bar, when the terminals aren't shown: the story's changes (its screenshots are the
// "story-shots" block, the Artifacts panel scoped to the story; see shareShots). A story
// not started has no main area: its details above take the column, with the buttons that start it.
export class StoryView extends Stories {
  init(cx) {
    super.init(cx);
    // "Send to agent": a note about the file shown, typed under its header (Enter sends).
    this.note = InputState.new({ placeholder: "A note for the agent (Enter sends it, Esc closes)" });
    this.note.on("submit", (_e, cx) => this.send(cx));
    this.sending = null; // the target id whose note is open
    this.target = null; // what Enter sends: { id, st, it, key, about }
    this.filesFocus = cx.focus_handle(); // the Changes view's file list, for ↑ / ↓
    this.diffScroll = VirtualListScrollHandle.new(); // the all-files page, to jump to a file
    this.fileScroll = VirtualListScrollHandle.new(); // one file at a time, for n / p
    this.diffFocus = cx.focus_handle(); // the diff itself, for n / p, ] / [ and v
  }

  // While a file's Ask agent (in its header) is open, a bar over the top of the diff naming it, with
  // the note (Enter sends, Esc closes); what the latest send led to shows under it. It's laid over the
  // list (absolute), so it takes no room and the page stays where it was; its height as drawn
  // (`this.askBarH`) tells a press on it from one on the list under it.
  askBar(t, st, it, all) {
    const f = this.sending?.startsWith("diff:") ? all.find((x) => `diff:${x.id}` === this.sending) : null;
    const rows = this.sendBar(t, st, it, f ? this.sending : "", f?.group.key ?? it.key, f ? (f.group.url
      ? `About ${f.path} in ${f.group.repo} (${f.group.url}/files):`
      : `About ${f.path} in ${f.group.repo} (${f.group.path}/${f.path}, not committed):`) : "");
    if (!rows.length) return [];
    return [v_flex().id("ask-bar").absolute().top(0).left(0).right(0).px(10).py(8).gap(6).bg(t.background).border_b_1().border_color(t.border)
      .on_size_change((size) => { this.askBarH = size.height; })
      .when(Boolean(f), (el) => el.child(h_flex().gap(6).items_center().text_size(SMALL).text_color(t.muted)
        .child(icon(own("send"), 13)).child("Ask the agent about")
        .child(div().font_medium().text_color(t.foreground).child(f.path.split("/").pop()))
        .child(div().flex_1())
        .child(textButton(t, "ask-close", "Close", (_e, cx) => { this.sending = null; DIFF.version++; cx.notify(); }, { dim: true }))))
      .children(rows)];
  }

  // The note's row, while open for target `id`: what's sent is `about` (the file), then
  // the note. What the latest send led to shows under it.
  sendBar(t, st, it, id, key, about) {
    const rows = [];
    if (this.sending === id) {
      this.target = { id, st, it, key, about };
      rows.push(h_flex().id("send-note").flex_none().gap(8).items_center()
        .on_key_down((e, cx) => { if (e.key === "escape") { this.sending = null; cx.notify(); cx.stop_propagation(); } })
        .child(div().flex_1().min_w(0).child(Input.new(this.note).h(28).px(10).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(SMALL).text_color(t.foreground)))
        .child(div().flex_none().text_size(SMALL).text_color(t.dim).child(`to ${sendKey(it, key)}'s agent`)));
    }
    if (this.flash && noteNow().at >= (this.sentAt ?? Infinity)) rows.push(div().id("send-flash").flex_none().truncate().text_size(SMALL).text_color(t.muted).tooltip(this.flash).child(this.flash));
    return rows;
  }

  send(cx) {
    const x = this.target;
    if (!x || this.sending !== x.id) return;
    const note = this.note.value().trim();
    this.sentAt = Date.now();
    this.ask(x.st, x.it, sendKey(x.it, x.key), note ? `${x.about}\n${note}` : x.about, cx);
    this.note.set_value("");
    this.sending = null;
    cx.notify();
  }

  render(cx) {
    const { st, t, early, shown, items } = this.prepare(cx);
    if (early) return early;
    const mode = shown ? viewOf(st.profile, shown) : null;
    if (!shown) return v_flex().size_full().items_center().justify_center().gap(4)
      .child(div().text_size(TITLE).font_semibold().child(st.profile.name))
      .child(div().text_size(SMALL).text_color(t.muted).child(!items?.length && st.data.sprints.length ? `Nothing ${sprintsWord(st.data)} is yours yet: tickets assigned to you show on the left.`
        : spacesOf(st.profile).length ? "Pick a story on the left." : "No story of it is open. Pick one on the left and start work: it gets a space of its own."));
    const extra = this.extra[shown.key];
    if (mode === "changes" && (!extra || (!extra.loading && extra.at < st.at))) this.loadExtra(st, shown, cx);
    // A story not started has its details above, filling the column (work.js hides this block), and
    // its screenshots have a block of their own ("story-shots").
    const body = mode === "changes" ? this.changesView(t, st, shown, extra, cx) : empty(t, "Its details and what can be done are above.", { fill: true });
    return decor("blockDecor", t, v_flex().size_full().min_h(0).px(INSET).py(10).text_size(TEXT).text_color(t.foreground).child(body), storyBlock("story-view", shown));
  }
}

const READER = new Stories();

// What follows the shown space from one moment to the next: a closed space's profile stays shown
// (config.js), then its story does, previewed; another space shown ends a preview. It must see every
// change of space, so only the footer (always shown) runs it, before syncHub(); what it decides is
// shared state ("kelpie.profile.chosen", the previews), which every other copy just reads.
let lastSpace = null; // the space shown at the last call
let lastStory = null; // { profile, key } when that space was a story's own
let lastProfile = null; // the profile shown at the last call
// `baseline`: only note what's shown now (a copy taking the tracking over from another), act on nothing.
export function syncTracking(baseline = false) {
  keepProfileOnClose(baseline);
  settleAsks();
  const ctx = READER.context();
  if (baseline) { lastSpace = ctx.space?.id ?? null; lastProfile = ctx.profile?.id ?? null; }
  // Another space shown ends a preview, unless the story's own space closed (its last tab did, say):
  // then that story stays shown, previewed, with what brings it back. Switching profiles keeps the
  // preview the profile came back to.
  if (lastSpace !== (ctx.space?.id ?? null)) {
    const closed = lastSpace !== null && !spaces().some((s) => s.id === lastSpace);
    if (closed && lastStory) setPreview({ id: lastStory.profile }, lastStory.key);
    else if (lastSpace !== null && ctx.profile && ctx.profile.id === lastProfile) setPreview(ctx.profile, null);
    lastSpace = ctx.space?.id ?? null;
  }
  lastProfile = ctx.profile?.id ?? null;
  const data = sharedData(ctx)?.data;
  const spaceKey = ctx.profile && hasBoard(ctx.setup) && data && profileOf(ctx.space)?.id === ctx.profile.id ? keyOf(ctx.space?.name) : null;
  const listed = spaceKey && build(data, new Map(), {}, storySpaces(ctx.profile), boardOf(ctx.setup)?.handover).some((x) => x.key === spaceKey);
  lastStory = listed ? { profile: ctx.profile.id, key: spaceKey } : null;
}

// For the tab bar (main.js) and the layout (work.js): the story shown (or the review previewed),
// whether it's a preview, and what its other views hold. Reads what the sidebar loaded; null where
// the profile shows no stories.
export function storyNow() {
  const s = storyItems();
  if (!s) return null;
  const { st: { profile }, items, done, lone } = s;
  const preview = previewIn(profile);
  const spaceKey = profileOf(s.st.space)?.id === profile.id ? keyOf(s.st.space?.name) : null;
  const it = findItem([...items, ...done], lone, preview) ?? findItem(items, [], spaceKey);
  if (!it) return null;
  const counts = (shared(COUNTS) ?? {})[it.key];
  return {
    profile, story: it, preview: Boolean(preview && it.key === preview), view: viewOf(profile, it),
    files: counts?.files, shots: counts?.shots, prs: allPrs(it).length, review: Boolean(lonePr(it)),
    show: (mode) => { if (!(mode === "start" && lonePr(it))) setView(profile, it, mode); },
    terminal: () => openTerminal(profile, it),
    claude: () => openClaude(profile, it),
    start: () => (it.review ? startReview(profile, it.review) : it.pull ? showPullAgent(it.pull) : startWork(s.st, it)),
    pause: () => pauseFocused(profile, it),
    // A story not opened shows its details anyway: nothing to fold.
    fold: () => { if (viewOf(profile, it) !== "start") foldHead(!headFolded()); },
  };
}

// The shown profile's stories in the list's order (each with its need, `n`), and the reviews waiting
// for you, from what the list loaded; null where the profile shows no stories. For the keys and the
// story picker. `done`: the finished stories the list leaves out (its Done group), which can be shown
// but need nothing.
export function storyItems() {
  const ctx = READER.context();
  const data = sharedData(ctx)?.data;
  if (!ctx.profile || !hasBoard(ctx.setup) || !data) return null;
  const handover = boardOf(ctx.setup)?.handover;
  return { st: { ...ctx, data }, items: ordered(build(data, agentsByKey(ctx.profile), pausedIn(ctx.profile), storySpaces(ctx.profile), handover, { left: leftStories(ctx.profile) })), done: doneIn(data, ctx.profile, handover), reviews: reviewsOf(data), lone: loneOf(data) };
}

// The story key a space is named by, when it's a story's space (its profile has Jira).
export const storyKeyOf = (space) => (hasBoard(profileOf(space)) ? keyOf(space?.name) : null);

// The header's main action, from a key: show the story's agent (the one asking first) when one runs,
// else resume what's paused, else its latest session, else start an agent on it.
function startWork(st, it) {
  const live = allAgents(it);
  if (live.length) return focusAgent(st.profile, it, live.find((a) => a.status === "blocked") ?? live[0]);
  const own = it.story ? it : it.subs[0];
  const key = own.key;
  const paused = allPaused(it);
  if (paused.length) return once(it.key, () => resumeAll(st.profile, it, paused));
  if (own.last) return once(it.key, () => resumeSession(st.profile, it, key, own.last));
  return once(it.key, () => launch(st.profile, it, { name: key, argv: claudeArgv(st.profile), task: ticketTask(st, it, key) }));
}

// Pauses the focused agent of the story, as its Pause button does; with none of its agents focused,
// the whole story, as the header's Pause does. Either asks first (one at work, or tabs that close with
// the story), here by pressing the key again within a few seconds.
let pauseArmed = null; // { what, at }
const armedFor = (what) => { const on = pauseArmed?.what === what && Date.now() - pauseArmed.at < 6000; pauseArmed = on ? null : { what, at: Date.now() }; return on; };
async function pauseFocused(profile, it) {
  if (lonePr(it)) return;
  const f = focused();
  const agent = agents().find((a) => a.address === f?.terminal) ?? agents().find((a) => a.pane === f?.pane);
  const key = agent ? keyOf(agent.tab_name) ?? keyOf(spaces().find((s) => s.id === agent.space)?.name) : null;
  if (!agent || !storyKeys(it).includes(key)) {
    if (!it.space) return notify({ title: `${it.key} isn't open: nothing to pause`, level: "info", timeout: 4000 });
    const why = pauseWhy(it);
    if (why && !armedFor(`story:${it.key}`)) return notify({ title: `${capitalize(why)}`, body: `Press the key again to pause ${it.key} anyway.`, level: "warning", timeout: 6000 });
    pauseArmed = null;
    return pauseWholeStory(profile, it);
  }
  if (agent.status === "working" && !armedFor(agent.address)) return notify({ title: `${agent.tab_name} is working`, body: "Press the key again to pause it anyway.", level: "warning", timeout: 6000 });
  pauseArmed = null;
  say(`Pausing ${key}…`);
  const failed = await pause(profile, [{ key, agent }]);
  say(failed.length ? `Couldn't pause ${key}: no Claude session found in its tab.` : null);
}

// Pauses the story a space is named after (the close dialog's Pause), as the header's Pause does.
// The profile's clean-up command (an old profile's is saved as wrapUp).
const cleanCommand = (profile) => (profile?.commands?.cleanUp ?? profile?.commands?.wrapUp)?.trim() || null;

// What finished stories left behind, by story key: the profile's leftovers check's lines when it
// has one, else a ticket folder (a folder named after one of a story's keys, one or two levels under
// the profile's folder, as ticketFolder() finds them). Either way it's looked for under each of the
// story's keys, its own and its subtasks' (work is often done under a subtask's key): the check runs
// once per key, 10 s each, and what it prints is kept under the key it printed it for: the clean-up
// then runs on those keys, and the dialog lists the lines by key. Lines are kept as the person reads
// them (paths under the profile's folder relative to it, the home folder as ~, runs of spaces as one);
// what a line says is the profile's command's to choose. Looked at only while the profile has a clean-up command, as that's what clears them.
// Shared, so every copy's broom agrees; the list looks again every 2 minutes, when its finished
// stories change, and after a clean-up.
const LEFTOVERS = "kelpie.clean.leftovers"; // { [profile id]: { found: { [story key]: { [key]: [lines] } }, ask, at } }
const FOLDER_SCRIPT = 'root="$1"; shift; for k; do for d in "$root/$k" "$root"/*/"$k"; do [ -d "$d" ] && { printf "%s\\n" "$k"; break; }; done; done; true';
const LEFTOVERS_BUSY = new Set();
// How leftovers are looked for: bump it when that changes, so every profile looks again at once.
const LEFTOVERS_WAY = 3; // 2: under each of a story's keys; 3: kept by key, lines shortened
const leftoversCommand = (profile) => profile?.commands?.leftovers?.trim() || null;
// A story's leftovers by key ({ [key]: [lines] }; an older entry's flat list: under the story's key).
const leftoversByKey = (profile, it) => {
  const found = (shared(LEFTOVERS) ?? {})[profile.id]?.found?.[it.key];
  return Array.isArray(found) ? { [it.key]: found } : found ?? {};
};
// The finished stories the leftovers check found something under, while the profile has a clean-up
// command (build() keeps them listed).
const leftStories = (profile) => new Set(cleanCommand(profile) ? Object.keys((shared(LEFTOVERS) ?? {})[profile?.id]?.found ?? {}) : []);
const leftoversOf = (profile, it) => Object.values(leftoversByKey(profile, it)).flat();
const leftoverKeys = (profile, it) => Object.keys(leftoversByKey(profile, it));
// A leftover's line as the person reads it: paths under the profile's folder relative to it, the home
// folder as ~, runs of spaces as one.
let HOME = null;
const readable = (profile, line) => {
  let out = line.replace(/\s+/g, " ").trim();
  const folder = profile.folder?.replace(/\/+$/, "");
  if (folder) out = out.split(`${folder}/`).join("");
  if (HOME) out = out.split(`${HOME}/`).join("~/");
  return out;
};
async function findLeftovers(profile, done) {
  const check = leftoversCommand(profile);
  HOME ??= (await exec("sh", ["-c", 'printf %s "$HOME"']).catch(() => null))?.stdout?.replace(/\/+$/, "") || null;
  const found = {};
  if (!check) {
    const r = await exec("sh", ["-c", FOLDER_SCRIPT, "sh", profile.folder, ...done.flatMap(storyKeys)]);
    const there = new Set(r.stdout.split("\n").filter(Boolean));
    for (const it of done) {
      const hit = storyKeys(it).filter((k) => there.has(k));
      if (hit.length) found[it.key] = Object.fromEntries(hit.map((k) => [k, [`a folder named ${k}`]]));
    }
    return found;
  }
  for (const it of done) {
    // A story's keys at once; stories one after another, so a slow check doesn't pile up.
    const runs = await Promise.all(storyKeys(it).map(async (k) => {
      const r = await runCommand(profile, check, k, 10).catch(() => null);
      return [k, r && r.code === 0 ? r.out.split("\n").map((l) => readable(profile, l)).filter(Boolean) : []];
    }));
    const hit = runs.filter(([, lines]) => lines.length);
    if (hit.length) found[it.key] = Object.fromEntries(hit);
  }
  return found;
}
function checkLeftovers(profile, items, force = false) {
  if (!cleanCommand(profile) || LEFTOVERS_BUSY.has(profile.id)) return;
  const done = items.filter(letGo);
  // What was asked: a change to it (either command, the finished stories, how they're looked for)
  // looks again at once, not after the 2 minutes, so a changed setting shows right away.
  const ask = `${LEFTOVERS_WAY}|${leftoversCommand(profile) ?? ""}|${cleanCommand(profile)}|${done.map((it) => it.key).sort().join(" ")}`;
  const had = (shared(LEFTOVERS) ?? {})[profile.id];
  if (!force && had && had.ask === ask && Date.now() - had.at < 2 * 60 * 1000) return;
  LEFTOVERS_BUSY.add(profile.id);
  findLeftovers(profile, done).then((found) => {
    setShared(LEFTOVERS, { ...(shared(LEFTOVERS) ?? {}), [profile.id]: { found, ask, at: Date.now() } });
  }).catch(() => {}).finally(() => LEFTOVERS_BUSY.delete(profile.id));
}

// What a finished story leaves to clean up, in words for the button's tip and the dialog: its open
// space, its paused sessions (their agents' sessions stay on disk, under Earlier sessions), and that
// the clean-up command runs on what the leftovers check found (the dialog lists it: leftoverItems()).
// Nothing: no broom.
// The leftovers the clean-up dialog lists: { key, text }, the key shown only when it isn't the story's
// (work done under a subtask's key).
function leftoverItems(profile, it) {
  if (!cleanCommand(profile)) return [];
  return Object.entries(leftoversByKey(profile, it)).flatMap(([k, lines]) => lines.map((text) => ({ key: k === it.key ? null : k, text })));
}

// Why a story can't be cleaned up yet, if anything: only work that's done and settled goes. A story
// must be done on its board (a pull request without a ticket: merged) or reassigned to someone else
// (what's left of it here is the person's to clear), with no pull request still
// open and no agent of it working or waiting for you (in its space too, whatever its tab). Uncommitted
// work is checked when it's cleaned (cleanUp), as that takes a look at its folders.
export function cleanBlockers(it) {
  const why = [];
  const lone = it.pull || it.review;
  if (lone ? !allPrs(it).every((p) => p.merged) : it.category !== "done" && !it.reassigned) why.push(lone ? "its pull request isn't merged" : "it isn't done on the board");
  if (!lone && allPrs(it).some((p) => !p.merged)) why.push("a pull request of it is still open");
  const live = [...allAgents(it), ...(it.space ? agents().filter((a) => a.space === it.space.id) : [])];
  if (live.some((a) => a.status === "working")) why.push("an agent is working on it");
  if (live.some((a) => a.status === "blocked")) why.push("an agent is waiting for you");
  return why;
}

function cleanable(profile, it) {
  if (!profile || !letGo(it) || cleanBlockers(it).length) return [];
  const paused = allPaused(it).length;
  const left = cleanCommand(profile) ? leftoversOf(profile, it) : [];
  return [it.space && "closes its space",
    paused && `forgets its ${paused === 1 ? "paused session" : `${paused} paused sessions`}`,
    left.length && `runs the clean-up command on what it left${left.length > 1 ? ` (${left.length} things)` : ""}`].filter(Boolean);
}

// What a clean-up would lose in a story's repos (changes.py), as phrases for its note: uncommitted
// work, and for a story someone else has now (reassigned, not finished) commits no remote has, as its
// work was never merged (a finished one's branch may well be gone from the remote once merged). A
// clean-up command may delete those folders, so a story with any isn't cleaned up. A demo profile has
// none on disk.
async function unsaved(profile, it) {
  if (isDemo(profile)) return [];
  const on = it.space ? spaces().find((s) => s.id === it.space.id)?.machine : null;
  const ahead = !finished(it) && Boolean(it.reassigned);
  const code = await readTextFile(modFile("changes.py"));
  const r = await exec("python3", ["-I", "-c", code, profile.folder, ...(ahead ? ["--unpushed"] : []), ...storyKeys(it)], on ? { on } : {});
  if (r.code !== 0) return [`uncommitted work in its folders (couldn't check them: ${(r.stderr || "").trim().split("\n").pop() || "changes.py failed"})`];
  const repos = JSON.parse(r.stdout || "[]");
  const dirty = repos.filter((x) => x.files?.length).map((x) => `${x.key} ${x.repo}`);
  const unpushed = repos.filter((x) => x.unpushed > 0).map((x) => `${x.unpushed === 1 ? "a commit" : `${x.unpushed} commits`} not pushed in ${x.key} ${x.repo}`);
  return [...(dirty.length ? [`uncommitted work in ${dirty.join(", ")}`] : []), ...unpushed];
}

// Cleans up a finished story (the confirm dialog's Clean up): closes its space, forgets what shared
// state kept of it, runs the clean-up command when it left something (once per key it was found under,
// CLEAN_EACH seconds each), then looks again, so the broom goes once nothing's left. One clean-up of a
// story at a time (busyOf its key), with nothing else started on it meanwhile; `held` when the caller
// (Move to Done) already holds the story's mark: its `at`.
export async function cleanUp(profile, it, { held = null } = {}) {
  const ms = cleanLimit(profile, it);
  const change = { kind: "clean", keys: storyKeys(it), step: `Cleaning up ${it.key}…`, on: null };
  if (held) { stepBusy(it.key, held, { ...change, until: Date.now() + ms }); return cleaning(profile, it, held); }
  const at = takeBusy(it.key, change, ms);
  if (!at) return say(busyWhy(it.key));
  try { return await cleaning(profile, it, at); } finally { endBusy(it.key, at); }
}
// How long a clean-up may hold its story: each key's run of the clean-up command, and the checks before.
const cleanLimit = (profile, it) => (cleanCommand(profile) ? leftoverKeys(profile, it).length : 0) * CLEAN_EACH * 1000 + BUSY_MARGIN;
async function cleaning(profile, it, at) {
  // Checked again now: an agent may have started, or a pull request opened, since the dialog showed.
  const why = cleanBlockers(it);
  if (why.length) return say(`${it.key} wasn't cleaned up: ${why.join(", ")}.`);
  const lose = await unsaved(profile, it);
  if (lose.length) return say(`${it.key} wasn't cleaned up: ${lose.join(", ")}.`);
  const command = cleanCommand(profile);
  const folder = command && leftoversOf(profile, it).length > 0;
  const on = it.space ? spaces().find((s) => s.id === it.space.id)?.machine : null;
  say(`Cleaning up ${it.key}${folder ? ": running the clean-up command…" : "…"}`);
  // run() returns nothing to wait on or catch; what it can't do it says itself.
  try { if (it.space && spaces().some((s) => s.id === it.space.id)) run("space.close", { id: it.space.id, confirmed: true }); } catch {}
  forgetStory(profile, it);
  if (!folder) return say(`Cleaned up ${it.key}.`);
  // Each key's run, one after another: { key, code, out } (code null: it couldn't run).
  const runs = [], keys = leftoverKeys(profile, it);
  for (const [i, k] of keys.entries()) {
    const step = keys.length > 1 ? `Cleaning up ${k}: ${i + 1} of ${keys.length}…` : `Cleaning up ${it.key}: running the clean-up command…`;
    stepBusy(it.key, at, { step });
    if (keys.length > 1) say(step);
    const r = await runCommand(profile, command, k, CLEAN_EACH, on).catch((e) => ({ code: null, out: String(e?.message ?? e) }));
    runs.push({ key: k, ...r });
  }
  const lastLine = (r) => r.out.split("\n").filter(Boolean).pop() ?? "";
  const failed = runs.find((r) => r.code !== 0);
  const keysSaid = (r) => (runs.length > 1 ? `${r.key}: ` : "");
  if (!failed) {
    const said = runs.map((r) => lastLine(r) && `${keysSaid(r)}${lastLine(r)}`).filter(Boolean).join("; ");
    say(`Cleaned up ${it.key}${said ? `: ${said}` : "."}`, runs.map((r) => r.out).filter(Boolean).join("\n") || null);
  } else if (failed.code === 143) {
    // Stopped at its time limit (runCommand): it may have hung on a prompt or a lock. What's left is
    // looked for again below, so the broom stays for it.
    say(`${it.key} wasn't fully cleaned up: the clean-up command for ${failed.key} took longer than ${CLEAN_EACH} s and was stopped${lastLine(failed) ? ` (${lastLine(failed)})` : ""}. Kelpie looks again at what's left: try again, or clean it up by hand.`, failed.out || null);
    notify({ title: `Clean-up of ${failed.key} took too long`, body: `It was stopped after ${CLEAN_EACH} s. Try again, or clean it up by hand.${failed.out ? `\n${failed.out.split("\n").slice(-4).join("\n")}` : ""}`, level: "warning" });
  } else {
    const why = failed.code === null ? "couldn't run" : `failed (${failed.code})`;
    say(`Cleaned up ${it.key}, but the clean-up command ${why}${runs.length > 1 ? ` for ${failed.key}` : ""}${lastLine(failed) ? `: ${lastLine(failed)}` : ""}`, failed.out || null);
    if (failed.code !== null) notify({ title: `Clean-up command failed for ${failed.key}`, body: failed.out.split("\n").slice(-6).join("\n"), level: "warning" });
  }
  const s = storyItems();
  if (s?.st.profile.id === profile.id) checkLeftovers(profile, build(s.st.data, new Map(), {}, storySpaces(profile), null, { all: true }), true);
}

// The confirm dialog's Clean up (`kelpie.clean-story-<key>`), for a story of the shown profile.
export function cleanStoryByKey(key) {
  const s = storyItems();
  const it = s?.items.find((x) => x.it.key === key)?.it;
  if (it) return cleanUp(s.st.profile, it);
}

// The clean-up dialog for a finished or reassigned story (its broom's): the sentence, then what the
// clean-up command runs on as a list (the dialog grows with it).
function askCleanUp(profile, it) {
  if (busyOf(it.key)) return say(busyWhy(it.key));
  const parts = cleanable(profile, it);
  const items = leftoverItems(profile, it);
  const said = parts.map((p, i) => (items.length && i === parts.length - 1 ? p.replace(/ \(\d+ things\)$/, "") : p));
  const why = finished(it) ? `${it.key} is ${it.category === "done" ? "done" : "merged"}` : `${reassignedWords(it)}: ${it.key} isn't yours any more`;
  openOverlay({ mod: MOD, kind: "dialog", width: 520, height: Math.min(480, 200 + Math.min(items.length, 10) * 24), props: {
    role: "confirm", title: `Clean up ${it.key}?`, yes: "Clean up", command: { name: `${MOD}.clean-story-${it.key}` },
    detail: `${why}, nothing of it is open or running. This ${said.join(", ")}${items.length ? ":" : "."}`, items } });
}

// Move to Done (the header's More): a story and its subtasks to the board's done column in one go.
// Only the person's own subtasks move, never others' (they aren't theirs to close), and the story
// itself last, once every subtask is done; tickets already done are left alone. A ticket's status is
// the one shown, so a move made a moment ago counts (MOVED).
const shownDone = (t) => {
  const m = movedNow(t.key);
  return (m ? m.category : t.category) === "done";
};
// What it would move: { mine: your subtasks not done, others: others' not done, story: whether the
// story moves too (not done, and no one else's subtask open) }; null for what isn't a board's ticket
// (a lone pull request). A ticket without subtasks is a story with none. Exported for the tests.
export function donePlan(it) {
  if (!it || it.pr || it.review || it.pull || !it.subs) return null;
  const subs = it.story ? it.subs : [];
  const others = subs.filter((x) => !x.mine && !shownDone(x));
  return { mine: subs.filter((x) => x.mine && !shownDone(x)), others, story: !shownDone(it) && !others.length };
}
const canMoveToDone = (it) => { const p = donePlan(it); return Boolean(p && (p.mine.length || p.story)); };
// Whether the profile's stories offer Move to Done at all: the board's `moveToDone`, on unless set to
// false (the profile dialog's Board page, Your part).
const finishes = (setup) => boardOf(setup)?.cfg?.moveToDone !== false;
// The board's done column's name ("Done"), for the words.
const doneName = (data) => data?.columns?.at(-1)?.name || "Done";
const keyList = (keys) => (keys.length < 3 ? keys.join(" and ") : `${keys.slice(0, -1).join(", ")} and ${keys.at(-1)}`);

// The dialog listing every ticket it moves, from which status, and others' subtasks left alone. Its
// button moves them itself (dialogs.js Confirm, `doneStory`): no command runs it, as any agent can
// run a command and this writes to the board.
function askMoveToDone(st, it) {
  if (busyOf(it.key)) return say(busyWhy(it.key));
  const plan = donePlan(it), done = doneName(st.data);
  const whose = (x) => (x.assignee ? `${x.assignee}'s` : "unassigned");
  const items = [
    ...plan.mine.map((x) => ({ key: x.key, text: `${x.status ?? "No status"} → ${done}` })),
    ...plan.others.map((x) => ({ key: x.key, text: `${x.status ?? "No status"}, ${whose(x)}: left alone` })),
    ...(plan.story ? [{ key: it.key, text: `${it.status ?? "No status"} → ${done}${plan.mine.length ? ", once your subtasks are" : ""}` }]
      : !shownDone(it) ? [{ key: it.key, text: `Stays ${it.status ?? "as it is"}, as ${keyList(plan.others.map((x) => x.key))} ${plan.others.length === 1 ? "is" : "are"} still open` }] : []),
  ];
  const detail = it.story
    ? `This moves your subtasks of ${it.key} to ${done} on the board, one after another, then the story once every subtask is done. Others' subtasks are left as they are, as they aren't yours to close:`
    : `This moves ${it.key} to ${done} on the board:`;
  // Clean up afterwards: offered only when the story will be done (a story that stays can't be
  // cleaned up), off unless chosen last time.
  const check = plan.story ? { label: "Clean up afterwards", on: Boolean((shared(DONE_CLEAN) ?? {})[st.profile.id]),
    about: "Once everything is moved, clean it up as the broom does: only if nothing of it is still open, running or uncommitted." } : null;
  openOverlay({ mod: MOD, kind: "dialog", width: 520, height: Math.min(520, (check ? 250 : 200) + Math.min(items.length, 10) * 24), props: {
    role: "confirm", title: `Move ${it.key} to ${done}?`, yes: `Move to ${done}`, doneStory: { profile: st.profile.id, key: it.key }, detail, items, check } });
}

// Move to Done's dialog button: moves what donePlan() says, as it stands now, one ticket after
// another; one that fails (a workflow asking for fields, no way straight to done, an issue off the
// Project) doesn't stop the rest, and a story whose subtask didn't move stays. The new statuses show
// at once, then the stories load once. Returns { moved, failed: [{ key, why }] }, null when the story
// isn't the shown profile's any more.
// With `clean` (the dialog's Clean up afterwards), once everything moved: the clean-up's own checks
// (cleanBlockers(), uncommitted work), and the clean-up only when they all pass; else it says why.
export async function moveStoryToDone({ profile, key, clean = null }) {
  if (clean !== null) setShared(DONE_CLEAN, { ...(shared(DONE_CLEAN) ?? {}), [profile]: Boolean(clean) });
  const s = storyItems();
  const it = s?.st.profile.id === profile ? [...s.items, ...s.done].map((x) => x.it).find((x) => x.key === key) : null;
  const plan = donePlan(it);
  if (!plan) { say(`Nothing was moved: ${key} isn't among the shown profile's stories any more.`); return null; }
  if (!finishes(s.st.setup)) { say("Nothing was moved: Move to Done is turned off for this profile."); return null; }
  // One run on a story at a time (busyOf its key): another Move to Done, or a clean-up, waits for it.
  // It locks only what clashes with it (the clean-up, its tickets' chips), not starting an agent.
  const keys = [...plan.mine.map((t) => t.key), ...(plan.story ? [key] : [])];
  const at = takeBusy(key, { kind: "done", keys, step: `Moving to Done… 1 of ${keys.length}`, on: keys[0] ?? null },
    keys.length * MOVE_FOR + BUSY_MARGIN + (clean ? cleanLimit(s.st.profile, it) : 0));
  if (!at) { say(busyWhy(key)); return null; }
  try { return await movingToDone(s, it, plan, clean, at); } finally { endBusy(key, at); }
}
async function movingToDone(s, it, plan, clean, at) {
  const { key } = it, profile = s.st.profile.id;
  const board = boardOf(s.st.setup), data = s.st.data, done = doneName(data);
  const moved = [], failed = [];
  const all = [...plan.mine, ...(plan.story ? [it] : [])].length;
  const one = async (t) => {
    stepBusy(key, at, { step: `Moving to Done… ${moved.length + failed.length + 1} of ${all}`, on: t.key });
    try {
      const o = await doneOption(board, t.key, data);
      await moveStatus(board, t.key, o, data);
      noteMoved(s.st.profile, t.key, { ...o, category: o.category ?? "done" }, board);
      moved.push(t.key);
    } catch (e) {
      failed.push({ key: t.key, why: String(e?.message ?? e).split("\n")[0].replace(/[.\s]+$/, "").slice(0, 160) });
    }
  };
  for (const t of plan.mine) await one(t);
  const subsDone = !plan.mine.some((t) => failed.some((f) => f.key === t.key));
  if (plan.story && subsDone) await one(it);
  // No ticket is moving any more: its chip stops spinning while the stories reload and the clean-up runs.
  stepBusy(key, at, { on: null, step: clean ? `Moved to Done; checking ${key} before cleaning up…` : `Moved to Done.` });
  if (moved.length) setShared(REFRESH, Date.now());
  const stays = shownDone(it) || failed.some((f) => f.key === key) ? ""
    : plan.others.length ? ` ${key} stays, as ${keyList(plan.others.map((x) => x.key))} ${plan.others.length === 1 ? "is" : "are"} still open.`
    : ` ${key} stays, as not all its subtasks moved.`;
  const text = `${moved.length ? `Moved ${keyList(moved)} to ${done}.` : "Nothing was moved."}${failed.length
    ? ` Couldn't move ${failed.map((f) => `${f.key} (${f.why})`).join(", ")}: move ${failed.length === 1 ? "it" : "them"} by hand.` : ""}${stays}`;
  say(text, failed.length ? failed.map((f) => `${f.key}: ${f.why}`).join("\n") : null);
  if (failed.length) notify({ title: `Some of ${key} didn't move to ${done}`, body: failed.map((f) => `${f.key}: ${f.why}`).join("\n"), level: "warning" });
  if (!clean) return { moved, failed };
  // The story as it is now: done when it moved (the loaded copy still has its old status).
  const now = shownDone(it) ? { ...it, category: "done" } : it;
  const why = cleanBlockers(now);
  if (!why.length) why.push(...await unsaved(s.st.profile, now));
  if (why.length) {
    say(`${text} ${key} wasn't cleaned up: ${why.join(", ")}.`, failed.length ? failed.map((f) => `${f.key}: ${f.why}`).join("\n") : null);
    notify({ title: `${key} wasn't cleaned up`, body: `${capitalize(why.join(", "))}.`, level: "warning" });
    return { moved, failed, cleaned: false, why };
  }
  // What it left behind: the leftovers check only ever looked at it as a finished story, which it
  // wasn't until a moment ago, so nothing is known yet and the clean-up command wouldn't run. Look now.
  if (cleanCommand(s.st.profile)) {
    const found = await findLeftovers(s.st.profile, [now]).catch(() => ({}));
    const all = shared(LEFTOVERS) ?? {}, had = all[profile] ?? {};
    setShared(LEFTOVERS, { ...all, [profile]: { ...had, found: { ...(had.found ?? {}), ...found } } });
  }
  await cleanUp(s.st.profile, now, { held: at });
  // cleanUp() leaves its own note ("Cleaned up …"); the moves go before it.
  const after = shared(NOTE);
  if (after?.text) say(`${text} ${after.text}`, after.full ?? null);
  return { moved, failed, cleaned: true };
}

// Clean up all's dialog (the list's broom beside its freshness line, and Next): every finished story
// with something left (and every reassigned one, saying who has it), one line each; its button runs
// kelpie.clean-all (cleanAll()).
function askCleanAll(profile, dirty) {
  if (busyOf(`all:${profile.id}`)) return say("Clean up all is already running.");
  dirty = dirty.filter((it) => !busyOf(it.key));
  if (!dirty.length) return say("Those stories are already being cleaned up.");
  const what = dirty.every(finished) ? "finished " : "";
  openOverlay({ mod: MOD, kind: "dialog", width: 520, height: Math.min(480, 200 + Math.min(dirty.length, 10) * 24), props: {
    role: "confirm", title: `Clean up ${dirty.length === 1 ? `1 ${what}story` : `${dirty.length} ${what}stories`}?`, yes: "Clean up all",
    command: { name: `${MOD}.clean-all` }, detail: what ? "Each is done or merged, and leaves something behind:" : "Each is done, merged or someone else's now, and leaves something behind:",
    items: dirty.map((it) => ({ key: it.key, text: `${finished(it) ? "" : `${reassignedWords(it)}: `}${cleanable(profile, it).join(", ")}` })) } });
}

// The sidebar's Clean up all (`kelpie.clean-all`): every finished story of the shown profile with
// something left to clean, one after another. One at a time per profile (a second press is refused),
// each story under its own mark, so one already being cleaned up is skipped.
export async function cleanAll() {
  const s = storyItems();
  if (!s) return;
  const profile = s.st.profile, name = `all:${profile.id}`;
  const dirty = s.items.map((x) => x.it).filter((it) => cleanable(profile, it).length && !busyOf(it.key));
  if (!dirty.length) return;
  const at = takeBusy(name, { kind: "clean", keys: [], step: "Cleaning up…" }, dirty.reduce((n, it) => n + cleanLimit(profile, it), 0));
  if (!at) return say("Clean up all is already running.");
  try {
    for (const [i, it] of dirty.entries()) {
      stepBusy(name, at, { step: `Cleaning up ${it.key}: ${i + 1} of ${dirty.length} stories…` });
      await cleanUp(profile, it);
    }
  } finally { endBusy(name, at); }
  if (dirty.length > 1) say(`Cleaned up ${dirty.length} stories: ${dirty.map((it) => it.key).join(", ")}.`);
}

export function pauseStoryByKey(key) {
  const s = storyItems();
  const space = s && storySpaces(s.st.profile).get(key);
  if (!space) return;
  return pauseWholeStory(s.st.profile, s.items.find((x) => x.it.key === key)?.it ?? { key, space });
}

// Shows an item of what needs you: a story's space, else its preview (a review's too); then its agent
// that's asking, when one is.
function goNext(profile, it) {
  if (it.desk) return goDeskAsking(profile);
  if (it.clean) return askCleanAll(profile, it.clean);
  // A suggestion: an idea starts a Claude on the Desk; else its story when the list has it, else the
  // ticket (or pull request) on the web.
  if (it.suggest?.idea) return startIdea(profile, it.suggest);
  if (it.suggest) return it.it ? selectStory(profile, it.it) : open(it.suggest.url);
  // An agent's ask: its story (and the agent, when it's that story's), else its link, else the agent.
  if (it.ask) {
    dismissAsk(profile, it.ask.id);
    const asker = askerOf(it.ask);
    if (it.it) { selectStory(profile, it.it); if (asker && allAgents(it.it).some((a) => a.address === asker.address)) focusAgent(profile, it.it, asker); return; }
    if (it.ask.url) return open(it.ask.url);
    if (asker) { run("space.select", { id: asker.space }); run("pane.focus", { pane: asker.pane }); }
    return;
  }
  setPoint(profile, it);
  selectStory(profile, it);
  const asking = lonePr(it) ? null : allAgents(it).find((a) => a.status === "blocked");
  if (asking) focusAgent(profile, it, asking);
}

// What next? (the magic button in Next's place): a Claude run in the background, no terminal (brew()),
// with what the list knows (suggestSnapshot); its picks fill Next's queue. The message is the
// profile's (config.js suggestText).
// Where things stand, as lines: the sprints, each story (its status, what it needs, your subtasks,
// its pull requests and agents), the reviews waiting for you, your pull requests naming no ticket,
// the Desk's agents.
// Exported for the tests only (tests/js/stories.test.mjs).
export function suggestSnapshot(st, items, reviews) {
  const pr = (p) => `${prName(p)} ${p.merged ? "merged" : pullWords(p).toLowerCase()}${failing(p) ? ", checks failing" : ""}${p.reviewDecision === "CHANGES_REQUESTED" ? ", changes requested" : ""} ${p.url}`;
  const agentsOf = (it) => allAgents(it).map((a) => a.status).join(", ");
  const out = [`Sprint: ${(st.data.sprints ?? []).map((s) => s.name).join(", ") || "none running"}`];
  const columns = st.data.columns ?? [];
  const board = boardOf(st.setup);
  const handover = columns[handoverFrom(columns, board?.handover)]?.name ?? "the last";
  const solo = Boolean(board?.cfg?.solo);
  if (columns.length) out.push(`Board columns: ${columns.map((c) => c.name).join(" → ")}; ${solo ? `I work alone: from ${handover} on, a ticket waits on me to check it` : `my part is done from ${handover}`}`);
  out.push("", "My stories (in the sprint, assigned to me or with my subtasks):");
  const stories = items.map((x) => x.it).filter((it) => !it.review && !it.pull);
  if (!stories.length) out.push("- none");
  for (const it of stories) {
    out.push(`- ${it.key} ${it.title} [${it.status ?? it.type}]: ${need(it)[1]}${it.space ? " · open here" : ""}${agentsOf(it) ? ` · agents: ${agentsOf(it)}` : ""}${sunk(it) ? (solo ? " · built, mine to check" : " · my part is done") : ""}`);
    if (it.story) for (const s of it.subs) out.push(`  - ${s.key} ${s.title} [${s.status ?? "?"}]${s.mine ? " (mine)" : ""}`);
    for (const p of allPrs(it)) out.push(`  - PR ${pr(p)}`);
  }
  const lone = pullsOf(st.data);
  if (lone.length) out.push("", "My pull requests naming no ticket:", ...lone.map((x) => `- ${pr(x.pull)} ${x.title}`));
  out.push("", "Reviews requested from me:", ...(reviews.length ? reviews.map((r) => `- ${prName(r.review)} by ${r.review.author?.login ?? "?"}: ${r.title} ${r.review.url}`) : ["- none"]));
  const desk = deskAgents(st.profile);
  if (desk.length) out.push("", `Desk agents: ${desk.map((a) => `${sessionTitle(a.title) ?? a.tab_name} (${a.status})`).join(", ")}`);
  return out.join("\n");
}
// The magic's motion, native loops only and kept calm: what you read holds still (the picks and
// their words), the shine runs only along the border, and the sparkles breathe slowly; brewing, the
// shine goes quicker, the sparkles turn slowly with two bubbles drifting up and the words change
// every few seconds.
// The shine: a bright copy of the box's own rounded border, seen through windows sliding across it,
// so the glint follows the corners exactly. Each window moves one way while the copy inside moves
// the other (the same period and easing, so the copy stays put over the box); three nested windows,
// wider ones fainter, soften its ends. `size` is the box's, as it reported it (shineSize()); `radius`
// its corners'. For a `relative().overflow_hidden()` box whose border is drawn by edgeOf() (a box
// clips inside its own border, so a copy on a real border would be hidden).
function edgeOf(color, radius) {
  return div().absolute().top(0).left(0).right(0).bottom(0).rounded(radius).border_1().border_color(color);
}
// Sizes come back as drawn, zoom included, while sizes set here are zoomed again: a probe 100 wide
// says the zoom (`size.zoom`, shineSize()), and the width is divided by it.
function borderGlint(glow, size, radius, period) {
  if (!size?.width || !size.zoom) return [];
  const w = size.width / size.zoom;
  return [[96, 0.25], [56, 0.45], [28, 0.95]].map(([win, a]) => {
    const from = -48 - win / 2, to = w + 48 - win / 2;
    return div().absolute().top(0).bottom(0).w(win).overflow_hidden().loop("left", { from, to, period, easing: "ease-in-out" })
      .child(div().absolute().top(0).bottom(0).w(w).rounded(radius).border_1().border_color(glow(a)).loop("left", { from: -from, to: -to, period, easing: "ease-in-out" }));
  });
}
// What the button says while Claude brews: every verb with every thing (16 × 16), plus a few odd
// ones, in an order shuffled once per run (seeded by its start, so every copy shows the same order and
// a redraw doesn't start it over). The small one (Re-magic's place) cycles the verbs' first words.
const BREW_VERBS = ["Brewing", "Stirring", "Conjuring", "Divining", "Consulting", "Wandering through", "Sniffing out", "Untangling",
  "Dusting off", "Peeking into", "Rummaging through", "Weighing", "Shuffling", "Herding", "Squinting at", "Tidying"];
const BREW_THINGS = ["the sprint", "the backlog", "pull requests", "the board", "stale tickets", "the crystal ball", "the tea leaves", "open reviews",
  "the roadmap", "forgotten TODOs", "the burndown", "subtasks", "CI runs", "priorities", "loose ends", "the next sprint"];
const BREW_ODD = ["Whatevering…", "Asking the rubber duck…", "Counting story points twice…", "Reading between the tickets…", "Waking up the backlog…", "Polishing the crystal ball…"];
const BREWS = {};
function brewWords(seed, small = false) {
  const id = `${seed}:${small}`;
  if (BREWS[id]) return BREWS[id];
  const all = small ? [...new Set(BREW_VERBS.map((v) => v.split(" ")[0].toLowerCase())), "whatevering"]
    : [...BREW_VERBS.flatMap((v) => BREW_THINGS.map((x) => `${v} ${x}…`)), ...BREW_ODD];
  // A small seeded shuffle (mulberry32), so the order is the same everywhere for one run.
  let a = Number(seed) >>> 0 || 1;
  const rand = () => { a = (a + 0x6d2b79f5) >>> 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  for (const k of Object.keys(BREWS)) if (!k.startsWith(`${seed}:`)) delete BREWS[k];
  return (BREWS[id] = all);
}
function brewMark(t, size) {
  const bubble = (left, period, d) => div().absolute().left(left).size(d).rounded_full().bg(t.accent).loop("top", { from: size - d, to: 1, period, easing: "ease-in-out" }).loop("opacity", { from: 0.6, to: 0.05, period });
  return div().relative().flex_none().w(size + 6).h(size)
    .child(div().absolute().left(0).top(0).child(icon(own("sparkles"), size).text_color(t.accent).spin(4800)))
    .child(bubble(size + 1, 2600, 2)).child(bubble(size + 4, 3400, 2));
}
// Idle: the sparkles breathing, slowly and not far.
function sparkle(t, size) {
  return icon(own("sparkles"), size).text_color(t.accent).loop("opacity", { from: 0.65, to: 1, period: 4000, easing: "ease-in-out" });
}
// Brewing: the background Claude's run, by profile ({ [profile id]: started at }), shared so every
// copy draws the brewing look. A run is cut off after BREW_FOR (exec kills it); a mark older than
// that (its task dropped by a reload) no longer counts.
const BREWING = "kelpie.next.brewing";
const BREW_FOR = 10 * 60 * 1000;
const brewingIn = (profile) => { const at = (shared(BREWING) ?? {})[profile?.id]; return at && Date.now() - at < BREW_FOR + 30000 ? at : null; };
const setBrewing = (profile, at) => setShared(BREWING, { ...(shared(BREWING) ?? {}), [profile.id]: at });

// Asks Claude for picks: `claude -p` on the profile's account, in its folder, no session saved,
// with no file-editing tools (read only as the prompt says; what else it may use is its own
// settings' call). It hands its picks in through the plugin's suggest_next (suggestNextRequest(),
// which applyPicks), so the plugin must be on the profile's account (askPlugin() otherwise); a run
// that ends without handing any in, or fails, is a toast.
function startSuggest(st, items, reviews) {
  if (brewingIn(st.profile)) return;
  brew(st.profile, suggestTask(st, items, reviews)).catch(() => {});
}
// kelpie.what-next: the same, for the shown profile, from a key or a script.
export function whatNext() {
  const s = storyItems();
  if (s) startSuggest(s.st, s.items, s.reviews);
}
export async function brew(profile, task) {
  const started = Date.now();
  setBrewing(profile, started);
  try {
    if (isDemo(profile)) {
      const { kept } = await applyPicks(profile, await demoSuggest());
      if (!kept.length) notify({ title: "No suggestions this time", body: "The demo's fixture has no picks.", level: "info", timeout: 6000 });
      return;
    }
    if (!(await hasPlugin(profile))) { await askPlugin(profile, "what-next"); return; }
    // Read only: plan mode (whatever the person's own default mode is, auto or bypass included) and
    // no editing tools. Reading through the person's own access (plugins, MCP, tools) still works, and
    // so does suggest_next, marked read only: it changes only what Kelpie suggests. KELPIE_PROFILE
    // tells the plugin which profile the picks are for, as this Claude runs in no terminal of Herdr's.
    const [cmd, ...args] = ["env", `KELPIE_PROFILE=${profile.id}`, ...claudeArgv(profile, "--permission-mode", "plan", "--disallowedTools", "Edit", "Write", "NotebookEdit", "--no-session-persistence", "--output-format", "json", "-p", task)];
    const r = await exec(cmd, args, { cwd: profile.folder, timeout: BREW_FOR });
    let out = null;
    try { out = JSON.parse(r.stdout); } catch { /* not JSON: said below */ }
    if (!out || out.is_error) throw new Error(String(out?.result ?? r.stderr ?? "").trim().split("\n").pop() || `Claude stopped (code ${r.code}).`);
    const got = (shared(SUGGESTED) ?? {})[profile.id];
    if (!got || got.at < started) throw new Error(`Claude finished without handing its suggestions to Kelpie. ${String(out.result ?? "").trim().split("\n").pop()}`.trim());
    if (!got.items?.length) notify({ title: "No suggestions this time", body: "Claude found nothing worth suggesting.", level: "info", timeout: 6000 });
  } catch (e) {
    notify({ title: "What next? didn't work", body: String(e?.message ?? e).slice(0, 300), level: "error", timeout: 8000 });
  } finally {
    setBrewing(profile, null);
  }
}
// An idea of Claude's, picked: a Claude on the Desk starts on it with the profile's message
// (prompts.idea, config.js ASK_PROMPTS), a tab named after it; the idea leaves the queue.
// Exported for the tests.
export function startIdea(profile, s) {
  const name = `Idea: ${s.action}`.slice(0, 60);
  // The idea is Claude's words, maybe drawn from others' (tickets, pull requests): information.
  openDesk(profile, { name, argv: claudeArgv(profile), task: `${askText(profile, "idea", { idea: s.idea, where: s.where || "not said", why: s.why || "not said" })}\n\n${OTHERS}` });
  dismissSuggestion(profile, s.key);
}
function suggestTask(st, items, reviews) {
  const cfg = boardOf(st.setup)?.cfg;
  return suggestText(st.profile, { name: st.profile.name, snapshot: suggestSnapshot(st, items, reviews), board: cfg?.url ?? "", owner: st.setup.github?.owner ?? "" });
}

// Claude's picks, checked against the sidebar's rules before they go in the queue: a subtask
// becomes its story, a key Jira doesn't know is dropped, a story comes once, a pull request is a
// github.com link; NEXT_MAX at most. An idea (no ticket: something to make better, only when there's
// nothing else) is kept as it is, IDEA_MAX at most, after the rest. They replace the profile's earlier
// picks. { kept, dropped }.
const NEXT_MAX = 8;
const IDEA_MAX = 3;
async function applyPicks(profile, items) {
  const data = (shared(DATA) ?? {})[profile.id]?.data;
  if (!data) throw new Error("The stories haven't loaded yet.");
  const parentOf = new Map(data.children.map((c) => [c.key, c.fields?.parent?.key]));
  const titles = new Map([...data.parents, ...data.children].map((i) => [i.key, i.fields?.summary ?? ""]));
  const listed = new Set(data.parents.map((p) => p.key));
  const text = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const kept = [], dropped = [], seen = new Set();
  for (const raw of items) {
    const action = text(raw?.action).slice(0, 120), why = text(raw?.why).slice(0, 300);
    const named = text(raw?.key) || text(raw?.url);
    const drop = (reason) => dropped.push({ item: named || action, why: reason });
    if (kept.length >= NEXT_MAX) { drop(`only ${NEXT_MAX} are kept`); continue; }
    if (!action) { drop("no action"); continue; }
    let key, url, title = "", from = null;
    // An idea (rung 4: something to make better, no ticket): its brief and where, at most IDEA_MAX.
    if (text(raw?.idea)) {
      if (kept.filter((x) => x.idea).length >= IDEA_MAX) { drop(`only ${IDEA_MAX} ideas are kept`); continue; }
      kept.push({ key: `idea:${kept.length}`, idea: text(raw.idea).slice(0, 1500), where: text(raw?.where).slice(0, 200), title: "", action, why, url: "" });
      continue;
    }
    if (text(raw?.key)) {
      from = text(raw.key).toUpperCase();
      if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(from)) { drop("not a ticket key, like ABC-12"); continue; }
      key = parentOf.get(from) ?? from;
      if (!listed.has(key)) {
        // Not in the list (someone else's, unassigned, the backlog): Jira says whether it exists
        // and, for a subtask, its story. Only a subtask goes to its parent: a story's is its epic.
        const found = await lookUp(boardOf(profile), key, data);
        if (!found) { drop("not found on the board"); continue; }
        key = found.story?.key ?? found.key;
        title = found.story ? found.story.summary : found.summary;
      }
      title = titles.get(key) || title;
      url = ticketUrl(boardOf(profile), data, key) ?? "";
    } else {
      const m = /^https:\/\/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)\/?$/.exec(text(raw?.url));
      if (!m) { drop("no ticket key, pull request link or idea"); continue; }
      key = `pr:${m[1]}#${m[2]}`;
      url = text(raw.url);
    }
    if (seen.has(key)) { drop("a second pick for one story"); continue; }
    seen.add(key);
    kept.push({ key, title, action, why, url, ...(from && from !== key ? { from } : {}) });
  }
  // Ideas always come after tickets and pull requests.
  const ordered = [...kept.filter((x) => !x.idea), ...kept.filter((x) => x.idea)];
  setShared(SUGGESTED, { ...(shared(SUGGESTED) ?? {}), [profile.id]: { at: Date.now(), items: ordered } });
  return { kept: ordered, dropped };
}

// cmd-shift-j, the list's "Next": each press goes to what needs you after the item shown (the stories
// that need you, most urgent first, then the reviews waiting for you), wrapping around.
export function nextNeed() {
  const s = storyItems();
  const now = s && storyNow();
  const onDesk = Boolean(s && !now && deskOf(s.st.profile)?.active);
  const top = s && nextIn(needQueueOf(s.st.profile, s.items, s.reviews), now?.story.key ?? (onDesk ? DESK_ITEM.key : undefined));
  // A profile without stories: only its Desk can need you.
  if (!s && goDeskAsking(shownProfile())) return;
  if (top) return goNext(s.st.profile, top);
  // Nothing in the profile's list: any agent waiting for you, in a plain space of this profile
  // ("Working on") or in another profile's, so a count of waiting agents always leads somewhere.
  if (goBlockedAgent()) return;
  notify({ title: "Nothing needs you right now", level: "info", timeout: 3000 });
}

// Shows an agent waiting for you, the shown profile's first, the one after the focused pane when
// several wait. False when none does.
function goBlockedAgent() {
  const profile = shownProfile();
  const of = spaceProfiles();
  const mine = (a) => profile && of.get(a.space)?.id === profile.id;
  const list = agents().filter((a) => a.status === "blocked" && a.pane)
    .sort((a, b) => Number(mine(b)) - Number(mine(a)));
  if (!list.length) return false;
  const here = list.findIndex((a) => a.pane === focused()?.pane);
  const a = list[(here + 1) % list.length];
  if (!mine(a)) chooseProfile(null);
  // A story preview in its profile would cover the terminal.
  setPreview(of.get(a.space) ?? null, null);
  run("space.select", { id: a.space });
  run("pane.focus", { pane: a.pane });
  return true;
}

// Shows the story a notification named ("kelpie.show-notified-<id>"; with no id, or one since
// forgotten, the latest), for a story whose space didn't exist then. Its profile is shown first.
export function showNotified(id) {
  const map = shared(NOTIFIED) ?? {};
  const n = (id && map[id]?.key ? map[id] : null) ?? Object.values(map).filter((x) => x?.key).sort((a, b) => b.at - a.at)[0];
  if (!n) return;
  if (shownProfile()?.id !== n.profile) chooseProfile(n.profile);
  const s = storyItems();
  const x = s?.items.find((x) => x.it.key === n.key);
  if (x) selectStory(s.st.profile, x.it);
}

// Exported for the tests only (tests/js/stories.test.mjs, next.test.mjs, diff.test.mjs, demo.test.mjs):
// the logic the views rely on, pinned there. Nothing in the mods imports these.
export { agentsByKey, applyPicks, build, changeSquares, diffRows, fileStatus, finished, issue, keyIn, lastSessions, need, needQueue, needQueueOf, nextIn, ordered, patchHash, progress, projectsOf, pull, pullsOf, sunk, syntaxOf, syntaxSpans, wordChanges };
