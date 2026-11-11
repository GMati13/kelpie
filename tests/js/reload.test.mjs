// When the story list loads again (Source.load in source.js, Stories in stories.js): a reload asked
// for while a load runs (Refresh, Kelpie's own action) isn't dropped. The load
// running began before the change, so the list loads once more as soon as it ends, instead of
// showing the old state until the next 2-minute timer.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mock, setShared } from "herdr";
import { StoryList } from "../../mods/kelpie/stories.js";
import { REFRESH } from "../../mods/kelpie/source.js";
import { fakeCx, setupDemoWorld } from "../lib/views.mjs";
import { data, issue, pr } from "../lib/stories.mjs";

// The board and GitHub as a test answers them: each load waits for the test to answer it.
class Answered extends StoryList {
  constructor() { super(); this.asked = []; }
  fetch() { return new Promise((resolve) => this.asked.push(resolve)); }
}
const checks = (state) => data({ parents: [issue("ACME-1", "doing")], mine: ["ACME-1"], prs: [pr("ACME-1 add it", { checks: state })] });
const shownChecks = () => mock.sharedValue("kelpie.stories.data")?.demo?.data?.prs?.[0]?.commits.nodes[0].commit.statusCheckRollup.state ?? null;

let list, cx;
beforeEach(async () => {
  setupDemoWorld();
  cx = fakeCx();
  list = new Answered();
  list.init(cx); // the first load starts
  await settle();
  assert.equal(list.asked.length, 1);
});
// Every load answered, so none is left running into the next test (the list keeps its loads in the module).
afterEach(async () => {
  for (const answer of list.asked) answer(checks(null));
  await settle();
});
// A load waits on its answer, so this lets the tasks run as far as they can rather than awaiting them.
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); if (cx.errors.length) throw cx.errors[0]; };

test("Refresh pressed while a load runs loads again once it ends: the change shows then", async () => {
  setShared(REFRESH, Date.now()); // checks turned green just after the load began
  list.state(cx); // the next draw sees the press while the first load still runs
  await settle();
  assert.equal(list.asked.length, 1, "no second load at the same time");
  list.asked[0](checks("PENDING")); // the first load answers what was true when it began
  await settle();
  assert.equal(shownChecks(), "PENDING");
  list.state(cx); // the draw after it ends
  await settle();
  assert.equal(list.asked.length, 2, "loaded again, not left for the timer");
  list.asked[1](checks("SUCCESS"));
  await settle();
  assert.equal(shownChecks(), "SUCCESS");
  list.state(cx);
  await settle();
  assert.equal(list.asked.length, 2, "and only once");
});

test("KELPIE-146: an agent's turn ending loads no board, while a load runs or after it", async () => {
  // The quick read shows what the turn changed (quick.test.mjs); the board waits for the timer.
  list.fullAt = 0; // long since the last load
  list.loadAfterAgent(cx);
  list.asked[0](checks("PENDING"));
  await settle();
  list.state(cx);
  list.loadAfterAgent(cx);
  await settle();
  assert.equal(list.asked.length, 1);
});

test("a timer's or a stale copy's request during a load isn't kept: that load answers it", async () => {
  list.load(cx);
  list.asked[0](checks("PENDING"));
  await settle();
  list.state(cx);
  await settle();
  assert.equal(list.asked.length, 1);
});

// An agent's tab opening or closing reads only the sessions again (loadSessions()). Asked for while a
// full load or another sessions read runs, it isn't dropped: that one read them when it began, maybe
// before the tab changed, so they're read once more as soon as it ends.
const sessionReads = () => {
  const reads = [];
  list.fetchSessions = () => new Promise((resolve) => reads.push(resolve));
  return reads;
};
const loadedSessions = () => list.cache[list.context().key]?.data?.sessions;

test("a tab changing while a full load runs reads the sessions once that load ends", async () => {
  list.asked[0](checks(null)); // the first load answered: the list has data
  await settle();
  const reads = sessionReads();
  list.load(cx, { again: true }); // a full load begins (it read the sessions as it began)
  await settle();
  assert.equal(list.asked.length, 2);
  list.loadSessions(cx); // then a tab opens
  await settle();
  assert.equal(reads.length, 0, "not beside the full load");
  list.asked[1](checks(null));
  await settle();
  list.state(cx); // the draw after it ends
  await settle();
  assert.equal(reads.length, 1, "read again, not left for the next load");
  reads[0]([{ id: "new-tab" }]);
  await settle();
  assert.deepEqual(loadedSessions(), [{ id: "new-tab" }]);
  list.state(cx);
  await settle();
  assert.equal(reads.length, 1, "and only once");
});

test("a tab changing while the sessions are read reads them once more after", async () => {
  list.asked[0](checks(null));
  await settle();
  const reads = sessionReads();
  list.loadSessions(cx);
  await settle();
  assert.equal(reads.length, 1);
  list.loadSessions(cx); // another tab, while that read runs
  await settle();
  assert.equal(reads.length, 1, "one read at a time");
  reads[0]([{ id: "first" }]);
  await settle();
  list.state(cx);
  await settle();
  assert.equal(reads.length, 2);
  reads[1]([{ id: "first" }, { id: "second" }]);
  await settle();
  assert.deepEqual(loadedSessions(), [{ id: "first" }, { id: "second" }]);
});
