// The load record (debug.js, #110): each full load, quick read and sessions read of the story list,
// when it was asked for and why, what waits, what was turned away, how long each took. Kept in memory;
// written to shared state only while debugging is on, at most every DEBUG_EVERY and only on a change,
// as every copy draws again on a shared write.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mock, setShared } from "herdr";
import { StoryList } from "../../mods/kelpie/stories.js";
import { REFRESH } from "../../mods/kelpie/source.js";
import { DEBUG, DEBUG_EVERY, DEBUG_ON, began, ended, resetDebug, skipped, snapshot, toggleDebug, waits } from "../../mods/kelpie/debug.js";
import { fakeCx, setupDemoWorld } from "../lib/views.mjs";
import { data, issue } from "../lib/stories.mjs";

// The board and GitHub as a test answers them: each full load waits for the test to answer it.
class Answered extends StoryList {
  constructor() { super(); this.asked = []; }
  fetch() { return new Promise((resolve, reject) => this.asked.push({ resolve, reject })); }
}
const answer = () => data({ parents: [issue("ACME-1", "doing")], mine: ["ACME-1"] });
const writes = () => mock.of("setShared").filter(([key]) => key === DEBUG);

let list, cx, timers;
beforeEach(async () => {
  setupDemoWorld();
  resetDebug();
  timers = [];
  cx = fakeCx();
  cx.timer = { every() {}, after(ms, fn) { timers.push({ ms, fn }); } };
  list = new Answered();
});
afterEach(async () => {
  for (const a of list.asked) a.resolve(answer());
  await settle();
});
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); if (cx.errors.length) throw cx.errors[0]; };

test("a load is recorded: why it was asked for, when it ran, how long it took", async () => {
  list.init(cx);
  await settle();
  const running = snapshot().jobs["stories:demo"].running;
  assert.equal(running.why, "start");
  assert.match(running.at, /^\d\d:\d\d:\d\d\.\d{3}$/, "a clock time a person compares with the clock");
  const now = Date.now;
  Date.now = () => now() + 1500; // the clock is fixed (tests/lib/views.mjs): the answer comes 1.5 s later
  try {
    list.asked[0].resolve(answer());
    await settle();
  } finally { Date.now = now; }
  const job = snapshot().jobs["stories:demo"];
  assert.equal(job.running, undefined);
  assert.equal(job.runs, 1);
  assert.equal(job.last.took, 1500);
  assert.deepEqual(snapshot().runs.map((r) => [r.job, r.why]), [["stories:demo", "start"]]);
});

test("a failed load says why it failed", async () => {
  list.init(cx);
  await settle();
  list.asked[0].reject(new Error("Jira answered 502"));
  await settle();
  assert.equal(snapshot().jobs["stories:demo"].last.error, "Jira answered 502");
  assert.equal(snapshot().runs[0].error, "Jira answered 502");
});

test("Refresh while a load runs: it waits, then runs, with how long it waited", async () => {
  list.init(cx);
  await settle();
  setShared(REFRESH, Date.now());
  list.state(cx);
  assert.equal(snapshot().jobs["stories:demo"].waiting.why, "refresh");
  list.asked[0].resolve(answer());
  await settle();
  list.state(cx); // the draw after it ends loads again
  await settle();
  const job = snapshot().jobs["stories:demo"];
  assert.equal(job.waiting, undefined);
  assert.equal(job.running.why, "refresh");
  assert.equal(typeof job.running.waited, "number");
});

test("a timer's request while a load runs is recorded as turned away, not waiting", async () => {
  list.init(cx);
  await settle();
  list.load(cx, { why: "timer" });
  const job = snapshot().jobs["stories:demo"];
  assert.equal(job.waiting, undefined);
  assert.match(job.skipped.why, /^timer: the load running answers it/);
  assert.equal(job.asked.why, "timer");
});

test("quick reads and sessions reads are recorded under their own names", async () => {
  list.init(cx);
  await settle();
  list.asked[0].resolve(answer());
  await settle();
  list.loadAfterAgent(cx);
  list.loadSessions(cx);
  await settle();
  const { jobs } = snapshot();
  assert.equal(jobs["quick:demo"].runs, 1);
  assert.equal(snapshot().runs.find((r) => r.job === "quick:demo").why, "an agent's turn ended");
  assert.equal(jobs["sessions:demo"].runs, 1);
  assert.equal(snapshot().runs.find((r) => r.job === "sessions:demo").why, "an agent tab opened or closed");
});

test("a sessions read asked for during a full load waits for it", async () => {
  list.init(cx);
  await settle();
  list.asked[0].resolve(answer());
  await settle();
  list.load(cx, { why: "refresh" }); // a second full load runs
  list.loadSessions(cx);
  assert.equal(snapshot().jobs["sessions:demo"].waiting.why, "an agent tab opened or closed, behind a full load");
});

test("off (the default), loads write nothing to shared state", async () => {
  list.init(cx);
  await settle();
  list.asked[0].resolve(answer());
  await settle();
  assert.deepEqual(writes(), []);
  assert.equal(mock.sharedValue(DEBUG), null);
});

test("on, it's written; changes within DEBUG_EVERY wait for one timer, not a write each", async () => {
  toggleDebug();
  assert.equal(mock.sharedValue(DEBUG_ON), true);
  assert.equal(writes().length, 1, "written as it's turned on");
  assert.equal(mock.of("notify").length, 1, "and the person is told where to read it");
  began("stories:demo", "timer", cx);
  ended("stories:demo", null, cx);
  began("quick:demo", "timer", cx);
  assert.equal(writes().length, 1, "too soon after the last write");
  assert.deepEqual(timers.map((t) => t.ms <= DEBUG_EVERY), [true], "one timer for all of them");
  // The timer fires once DEBUG_EVERY has passed.
  const now = Date.now;
  Date.now = () => now() + DEBUG_EVERY;
  try { timers[0].fn(cx); } finally { Date.now = now; }
  assert.equal(writes().length, 2);
  const shown = mock.sharedValue(DEBUG);
  assert.equal(shown.jobs["stories:demo"].runs, 1);
  assert.equal(shown.jobs["quick:demo"].running.why, "timer");
});

test("on, the same request turned away again writes nothing: no draw after draw", async () => {
  toggleDebug();
  const now = Date.now;
  let t = now();
  Date.now = () => t;
  try {
    skipped("stories:demo", "stale: GitHub's budget is low", cx);
    const after = writes().length;
    for (let i = 0; i < 5; i++) { t += DEBUG_EVERY; skipped("stories:demo", "stale: GitHub's budget is low", cx); waits("quick:demo", "timer", cx); t += DEBUG_EVERY; waits("quick:demo", "timer", cx); }
    assert.equal(writes().length, after + 1, "only the first wait changed anything");
  } finally { Date.now = now; }
});

test("off again, the record leaves shared state", () => {
  toggleDebug();
  assert.ok(mock.sharedValue(DEBUG));
  toggleDebug();
  assert.equal(mock.sharedValue(DEBUG), null);
  assert.equal(mock.sharedValue(DEBUG_ON), null);
});

test("what's recorded is cut and has no control characters", () => {
  began("stories:demo", `a\u001b[31m${"x".repeat(500)}`, cx);
  ended("stories:demo", `bad\nanswer ${"y".repeat(500)}`, cx);
  const [run] = snapshot().runs;
  assert.ok(!/[\x00-\x1f]/.test(run.why + run.error));
  assert.ok(run.why.length <= 120 && run.error.length <= 200);
});
