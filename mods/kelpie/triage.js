// Finding agents that wait on the person in silence (#251, part of #249). Herdr flags an agent only
// while it asks interactively (blocked: a permission prompt, a menu); most end their turn with a
// question, a choice, a plan to read or work to check and then wait, unflagged. So when an agent's
// turn ends (working to done or idle), Kelpie reads the last message it wrote (last-turn.py, the
// session's transcript, its end only) and decides whether it waits on the person:
//   - its own rules first (triageByRules(): a closing question to the person), free;
//   - only when those can't tell, a small model (claude -p, the profile's attention.model, haiku by
//     default) on the profile's own Claude account: no tools, no MCP servers, plan mode, no session
//     kept, the task on stdin (stories.js feedClaude()), the message fenced and the task ending with
//     OTHERS, an answer in a set shape (--json-schema). What it says is only shown to the person,
//     cleaned and cut (cleanLine()); nothing acts on it.
// What it finds is kept in shared WAITING, by profile, then by agent address: { turn, at, state, kind,
// line, how, tab }, `state` waiting, ready or none (none kept too, so a reload doesn't ask again).
// An entry goes once its agent works again or turns blocked (then it needs the person now), once its
// terminal is gone, or after a day (noteTurns()). Skipped: a profile with attention.triage false, an
// agent in no profile's space, one whose session runs on another Claude account than its profile's
// (#254), and a turn in which the agent asked through Next itself (add_to_next): its own ask wins.
// Run by the copy that follows what's shown (main.js track()), as agents end turns whatever's shown.
import { appHome, exec, notify, readTextFile } from "herdr";
import { agents, focused, setShared, shared } from "./host.js";
import { WAITING } from "./attention.js";
import { OTHERS, askText, claudeArgv, fenced, spaceProfiles, triageModel, triageOn } from "./config.js";
import { MOD, claudeSession, modFile } from "./ui.js";
import { accountKey, accountOf } from "./boundary.js";
import { feedClaude } from "./stories.js";
import { demoLastTurn, demoTriage, isDemo } from "./demo.js";

export { WAITING };
const ASKS = "kelpie.next.asks";
const KEEP_FOR = 24 * 3600 * 1000;
const RESTING = new Set(["done", "idle"]);
const AT_ONCE = 2; // triages running at once, in all
const MODEL_FOR = 60 * 1000;
const LINE_MAX = 120;
export const STATES = ["waiting", "ready", "none"];
export const KINDS = ["question", "choice", "plan", "review", "stuck", "done"];
// The model's answer, checked by Claude Code (--json-schema) and again here (cleanAnswer()).
export const SCHEMA = {
  type: "object",
  properties: { state: { type: "string", enum: STATES }, kind: { type: "string", enum: KINDS }, line: { type: "string" } },
  required: ["state", "line"],
  additionalProperties: false,
};

// The tracking copy's own memory (one context for every copy, but only it runs this): each agent's
// state when last seen, the triages queued and those running.
const SEEN = new Map();
const STARTED = new Map(); // when each agent's current or last turn began (ms), for an ask made in it
const QUEUE = [];
const RUNNING = new Set();
// For the tests: forget what was seen, as after a reload.
export function forgetTurns() { SEEN.clear(); STARTED.clear(); QUEUE.length = 0; RUNNING.clear(); }

// A line for the person: no control characters, one line, cut whole words where it can.
export function cleanLine(text, max = LINE_MAX) {
  const s = String(text ?? "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max / 2 ? cut.lastIndexOf(" ") : cut.length).replace(/[\s,;:.-]+$/, "")}…`;
}

// Kelpie's own rules, before any model: the closing message's last sentence asks the person
// something. Null when they can't tell (the model then decides).
export function triageByRules(text) {
  const paras = String(text ?? "").replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const last = paras.at(-1);
  if (!last) return null;
  // Markdown marks and a trailing code fence say nothing about the question.
  const plain = last.replace(/```[\s\S]*?```/g, " ").replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
  const sentences = plain.match(/[^.!?]+[.!?]*/g)?.map((x) => x.trim()).filter(Boolean) ?? [];
  const end = sentences.at(-1) ?? "";
  if (!/\?\s*\)?$/.test(end) || end.length < 8) return null;
  const kind = /\bplan\b/i.test(plain) && /\b(approve|go ahead|okay|ok|look|read|sound)\b/i.test(plain) ? "plan"
    : /\b(or|which|either)\b/i.test(end) ? "choice" : "question";
  return { state: "waiting", kind, line: cleanLine(end), how: "rules" };
}

// The model's answer, checked: a known state and kind, a cleaned line. Null for anything else.
export function cleanAnswer(out) {
  if (!out || typeof out !== "object" || !STATES.includes(out.state)) return null;
  return { state: out.state, kind: KINDS.includes(out.kind) ? out.kind : null, line: cleanLine(out.line), how: "claude" };
}

// The model's task: the profile's message (prompts.triage) with the closing message fenced, then OTHERS,
// as it's the agent's words, maybe carrying others' (a ticket, a pull request).
export const triageText = (profile, text) => `${askText(profile, "triage", { message: fenced("the agent's last message", String(text ?? "").trim()) })}\n\n${OTHERS}`;

// The argv of the model's run, on the profile's Claude account: one question, nothing it could do.
// KELPIE_PROFILE and KELPIE_STORY cleared, as one inherited from where Herdr started would have the
// plugin's hook say this Claude works on a story.
export const triageArgv = (profile) => ["env", "-u", "KELPIE_PROFILE", "-u", "KELPIE_STORY",
  ...claudeArgvOf(profile, "-p", "--model", triageModel(profile), "--tools", "", "--strict-mcp-config", "--permission-mode", "plan",
    "--no-session-persistence", "--output-format", "json", "--json-schema", JSON.stringify(SCHEMA))];
// claudeArgv() starts with `env` when it sets anything; joined to the env above as one command.
const claudeArgvOf = (profile, ...args) => { const a = claudeArgv(profile, ...args); return a[0] === "env" ? a.slice(1) : a; };

// Asks the model. Null when it fails or answers nothing usable.
async function askModel(profile, text) {
  const r = await feedClaude(triageArgv(profile), triageText(profile, text), { cwd: appHome(), timeout: MODEL_FOR }).catch(() => null);
  let out = null;
  try { out = JSON.parse(r?.stdout ?? ""); } catch { return null; }
  if (!out || out.is_error) return null;
  let answer = out.structured_output ?? null;
  if (!answer && typeof out.result === "string") { try { answer = JSON.parse(out.result); } catch { /* not JSON */ } }
  return cleanAnswer(answer);
}

// The agent's last turn, from its session: { text, turn, at, asked }, or null (no Claude session, one
// on another account than its profile's, or a turn that didn't close with a message).
async function lastTurn(address, profile) {
  const rec = await claudeSession(address).catch(() => null);
  if (!rec?.sessionId || accountKey(rec.config ?? null) !== accountOf(profile)) return null;
  const code = await readTextFile(modFile("last-turn.py")).catch(() => null);
  if (!code) return null;
  const on = address.includes("/") ? address.split("/")[0] : null;
  const id = String(rec.sessionId);
  const run = await exec("python3", ["-I", "-c", code, rec.config ?? "", id], on ? { on } : {}).catch(() => null);
  try { return run?.code === 0 ? JSON.parse(run.stdout || "{}")[id] ?? null : null; } catch { return null; }
}

// One agent's turn, triaged and kept.
async function triageOne(job) {
  const { profile, address } = job;
  const demo = isDemo(profile);
  const turn = demo ? await demoLastTurn(job.tab, job.ended) : await lastTurn(address, profile);
  if (!turn?.text) return;
  const prev = (shared(WAITING) ?? {})[profile.id]?.[address];
  if (prev?.turn && prev.turn === turn.turn) return;
  // The agent asked through Next itself in this turn (add_to_next): that's its line, not ours.
  const since = Date.parse(turn.asked ?? "") || job.started || 0;
  if (((shared(ASKS) ?? {})[profile.id] ?? []).some((x) => x.terminal === address && x.at >= since)) return;
  const found = triageByRules(turn.text) ?? (demo ? cleanAnswer(await demoTriage(job.tab)) : await askModel(profile, turn.text));
  if (!found) return;
  // It may have started again while this ran: then nothing waits.
  if (!RESTING.has(agents().find((a) => a.address === address)?.status)) return;
  const all = shared(WAITING) ?? {};
  setShared(WAITING, { ...all, [profile.id]: { ...(all[profile.id] ?? {}), [address]: { turn: turn.turn ?? null, at: Date.now(), ...found, tab: job.tab ?? null } } });
  if (found.state === "waiting") tellWaiting(profile, address, job.tab, found.line);
}

// A notification for an agent that began waiting on you (#252), when the profile asks for it
// (notify.waiting, off by default): once per turn (a turn is triaged once), never for the agent whose
// pane is focused. Its click runs kelpie.show-waiting-<id> (a command takes no arguments: shared
// SHOW_WAITING maps the id to the agent, for a day).
export const SHOW_WAITING = "kelpie.waiting.show";
function tellWaiting(profile, address, tab, line) {
  if (profile?.notify?.waiting !== true) return;
  const a = agents().find((x) => x.address === address);
  if (!a || a.pane === focused()?.pane) return;
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();
  const kept = Object.fromEntries(Object.entries(shared(SHOW_WAITING) ?? {}).filter(([, v]) => now - (v?.at ?? 0) < KEEP_FOR));
  setShared(SHOW_WAITING, { ...kept, [id]: { address, at: now } });
  notify({ title: `${tab ?? "An agent"}'s agent is waiting on you`, body: line || "It ended its turn waiting on you.", level: "info", action: { name: `${MOD}.show-waiting-${id}` } });
}

// Starts queued triages, AT_ONCE at most, one per agent: a turn that ended while that agent's last
// one is still read waits for it.
function pump() {
  while (RUNNING.size < AT_ONCE) {
    const at = QUEUE.findIndex((j) => !RUNNING.has(j.address));
    if (at < 0) return;
    const [job] = QUEUE.splice(at, 1);
    RUNNING.add(job.address);
    triageOne(job).catch((e) => console.log(`kelpie triage: ${e}`)).finally(() => { RUNNING.delete(job.address); pump(); });
  }
}

// Each render of the tracking copy: drops entries whose agent works again, turned blocked, is gone or
// is a day old; queues a triage for each agent whose turn just ended (working to done or idle), and for
// one first seen finished and unseen (done: after a reload) that has no entry yet. Writes only on a change.
export function noteTurns(now = Date.now()) {
  const list = agents();
  const live = new Map(list.map((a) => [a.address, a]));
  const all = shared(WAITING) ?? {};
  let changed = false;
  const kept = {};
  // The agent's pane focused since it began waiting: you've seen it, so Next draws it dimmer (#252).
  const pane = focused()?.pane ?? null;
  for (const [id, byAgent] of Object.entries(all)) {
    const left = Object.fromEntries(Object.entries(byAgent ?? {}).filter(([address, e]) => {
      const a = live.get(address);
      const stays = Boolean(a) && RESTING.has(a.status) && now - (e?.at ?? 0) < KEEP_FOR;
      if (!stays) changed = true;
      return stays;
    }).map(([address, e]) => {
      if (e.seen || !pane || live.get(address)?.pane !== pane || e.state === "none") return [address, e];
      changed = true;
      return [address, { ...e, seen: true }];
    }));
    if (Object.keys(left).length) kept[id] = left;
  }
  if (changed) setShared(WAITING, kept);
  let of = null;
  for (const a of list) {
    const was = SEEN.get(a.address);
    SEEN.set(a.address, a.status);
    if (a.status === "working" && was !== "working") STARTED.set(a.address, now);
    const ended = RESTING.has(a.status) && (was === "working" || (was === undefined && a.status === "done"));
    if (!ended) continue;
    of ??= spaceProfiles();
    const profile = of.get(a.space);
    if (!profile || !triageOn(profile)) continue;
    if (was === undefined && kept[profile.id]?.[a.address]) continue;
    const at = QUEUE.findIndex((j) => j.address === a.address);
    const job = { address: a.address, profile, tab: a.tab_name ?? null, ended: now, started: STARTED.get(a.address) ?? null };
    if (at >= 0) QUEUE[at] = job; else QUEUE.push(job);
  }
  for (const k of [...SEEN.keys()]) if (!live.has(k)) { SEEN.delete(k); STARTED.delete(k); }
  pump();
}

// What's waiting on the person, for the views (#252): entries of `state`, by profile.
export function waitingIn(profile, state = "waiting") {
  return Object.entries((shared(WAITING) ?? {})[profile?.id] ?? {}).filter(([, e]) => e?.state === state).map(([address, e]) => ({ address, ...e }));
}
