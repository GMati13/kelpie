// When the story list loads again (Source.load in source.js, Stories in stories.js): a reload asked
// for while a load runs (Refresh, Kelpie's own action, an agent's turn ending) isn't dropped. The load
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

test("an agent's turn ending while a load runs loads again once it ends", async () => {
  list.fullAt = 0; // its minute is up
  list.loadAfterAgent(cx);
  list.asked[0](checks("PENDING"));
  await settle();
  list.state(cx);
  await settle();
  assert.equal(list.asked.length, 2);
});

test("a timer's or a stale copy's request during a load isn't kept: that load answers it", async () => {
  list.load(cx);
  list.asked[0](checks("PENDING"));
  await settle();
  list.state(cx);
  await settle();
  assert.equal(list.asked.length, 1);
});
