// The load record, for working out why something shows late (#110): each load of a source (the
// story list's full load, Source.load), each quick pull request read (quickPulls()) and each sessions
// read (loadSessions()), with when it was last asked for and why, what's waiting, what was turned
// away and why, when it started and how long it took, and the last runs.
//
// It's kept in memory (one context for every copy of the mod) and costs next to nothing. Only while
// debugging is on (shared DEBUG_ON, `herdr-app do kelpie.debug-loads` toggles it) is it written to
// shared state, DEBUG, to read in Herdr's shared.json: at most every DEBUG_EVERY and only when it
// changed, as every copy draws again on a shared write. A request turned away again for the same
// reason (a stale list asking on every draw while GitHub's budget runs low) changes nothing written,
// so the record can't make the list draw over and over.
import { notify, setShared, shared } from "herdr";

export const DEBUG = "kelpie.debug.loads";
export const DEBUG_ON = "kelpie.debug.on";
export const DEBUG_EVERY = 3000;
const RUNS = 30; // the last runs kept, newest first
const WHY = 120;
const ERROR = 200;

const RECORD = { jobs: {}, runs: [] }; // job ("stories:<profile>", "quick:<profile>", "sessions:<profile>") -> its entry
const PUBLISH = { at: 0, text: null, pending: false };

// "14:03:21.042", local: what a person reading the record compares with the clock.
const clock = (ms) => {
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};
const cut = (s, n) => String(s ?? "").replace(/[\x00-\x1f\x7f]+/g, " ").slice(0, n);
const entry = (job) => (RECORD.jobs[job] ??= { runs: 0 });

// Asked for, and why ("timer", "refresh", "an agent's turn ended"…). Not written by itself: what
// comes of it (it starts, waits or is turned away) is, with it. A stale list asks on every draw.
export function asked(job, why) {
  entry(job).asked = { at: Date.now(), why: cut(why, WHY) };
}

// Asked for while one runs: it waits, and runs once that ends. Already waiting, nothing changes.
export function waits(job, why, cx) {
  const e = entry(job);
  if (e.waiting) return;
  e.waiting = { at: Date.now(), why: cut(why, WHY) };
  publish(cx);
}

// Turned away (a load running answers it, GitHub's limit, nothing loaded yet). The same reason again
// only counts, unwritten (see the top).
export function skipped(job, why, cx) {
  const e = entry(job);
  const text = cut(why, WHY);
  if (e.skipped?.why === text) { e.skipped.times++; return; }
  e.skipped = { at: Date.now(), why: text, times: 1 };
  publish(cx);
}

// A run that waited is put down to what it waited for (a Refresh pressed mid-load, say), not to the
// draw that started it once the other ended.
export function began(job, why, cx) {
  const e = entry(job);
  const now = Date.now();
  const waited = e.waiting ? now - e.waiting.at : 0;
  e.running = { at: now, why: cut(e.waiting?.why ?? why ?? "", WHY), waited };
  e.waiting = null;
  publish(cx);
}

// `error`: what went wrong, or a note on an answer not used (dropped, as a full load ran meanwhile).
export function ended(job, error, cx) {
  const e = entry(job);
  if (!e.running) return;
  const now = Date.now();
  const took = now - e.running.at;
  e.runs++;
  e.last = { at: e.running.at, took, ...(error ? { error: cut(error, ERROR) } : {}) };
  e.slowest = Math.max(e.slowest ?? 0, took);
  RECORD.runs.unshift({ job, why: e.running.why, waited: e.running.waited, took, ...(error ? { error: cut(error, ERROR) } : {}), at: e.running.at });
  RECORD.runs.length = Math.min(RECORD.runs.length, RUNS);
  e.running = null;
  publish(cx);
}

// The record as written: times as clock times, durations in ms.
export function snapshot(now = Date.now()) {
  const at = (x) => (x ? { ...x, at: clock(x.at) } : undefined);
  const jobs = Object.fromEntries(Object.entries(RECORD.jobs).map(([job, e]) => [job, {
    ...(e.running ? { running: { ...at(e.running), for: now - e.running.at } } : {}),
    ...(e.waiting ? { waiting: { ...at(e.waiting), for: now - e.waiting.at } } : {}),
    ...(e.asked ? { asked: at(e.asked) } : {}),
    ...(e.last ? { last: at(e.last) } : {}),
    ...(e.skipped ? { skipped: at(e.skipped) } : {}),
    runs: e.runs,
    ...(e.slowest != null ? { slowest: e.slowest } : {}),
  }]));
  return { jobs, runs: RECORD.runs.map(at) };
}

// Written while debugging is on, at most every DEBUG_EVERY, only when changed; what changes sooner
// waits for a timer (`cx`, the view the change happened in) or the next change.
function publish(cx) {
  if (!shared(DEBUG_ON)) return;
  const now = Date.now();
  if (now - PUBLISH.at < DEBUG_EVERY) {
    if (!PUBLISH.pending && cx?.timer?.after) {
      PUBLISH.pending = true;
      cx.timer.after(DEBUG_EVERY - (now - PUBLISH.at), (cx) => { PUBLISH.pending = false; publish(cx); });
    }
    return;
  }
  // "running"/"waiting" `for` grows with time: compared without it, so only a real change writes.
  const value = snapshot(now);
  const text = JSON.stringify(value, (k, v) => (k === "for" ? undefined : v));
  if (text === PUBLISH.text) return;
  PUBLISH.at = now;
  PUBLISH.text = text;
  setShared(DEBUG, { written: clock(now), ...value });
}

// kelpie.debug-loads: on, the record is written now and as it changes; off, it's taken out of
// shared state again (the memory one stays).
export function toggleDebug() {
  const on = !shared(DEBUG_ON);
  setShared(DEBUG_ON, on || null);
  PUBLISH.at = 0;
  PUBLISH.text = null;
  if (on) publish(null);
  else setShared(DEBUG, null);
  notify(on
    ? { title: "Load record on", body: `What Kelpie loads, what waits and how long each took is now in Herdr's shared.json, under ${DEBUG}. Run it again to turn it off.`, level: "info", timeout: 8000 }
    : { title: "Load record off", body: "It's no longer written to shared.json.", level: "info", timeout: 5000 });
}

// For the tests: back to an empty record.
export function resetDebug() {
  RECORD.jobs = {};
  RECORD.runs = [];
  PUBLISH.at = 0;
  PUBLISH.text = null;
  PUBLISH.pending = false;
}
