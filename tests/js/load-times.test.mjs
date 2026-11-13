// Where a story list load's time goes (#108): every part (the board, the three pull request searches,
// the sessions) runs at once and the list waits for the slowest, so each is timed on its own and the
// freshness line's tooltip says them, slowest named, once a load is slow enough to ask why.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { DEMO, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { byId } from "../lib/snapshot.mjs";
import { nodeOf } from "gpui-kit";
import { mock } from "herdr";
import { LOAD_SAID, StoryList, loadTimes } from "../../mods/kelpie/stories.js";

let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

// A copy that doesn't load (no init) draws the shared copy as given.
const drawShared = async () => (await draw(new StoryList(), { init: () => {} })).el;
const tipOf = (el) => nodeOf(el).calls.filter(([m]) => m === "tooltip").map(([, a]) => a[0]).at(-1);

test("a load times each of its parts, and the whole", () => {
  const t = stories.data.timing;
  for (const part of ["board", "open", "merged", "reviews", "sessions", "sort", "total"]) assert.equal(typeof t?.[part], "number", part);
  for (const part of ["board", "open", "merged", "reviews", "sessions"]) assert.ok(t[part] <= t.total, `${part} is within the load`);
});

test("a slow part is timed as itself, not as the others' wait", async () => {
  // The tests' clock stands still (tests/lib/views.mjs): here it moves on 5 s while the sessions
  // are read, after the rest has answered.
  const still = Date.now;
  let now = still();
  class SlowSessions extends StoryList {
    fetchSessions(ctx) { return new Promise((r) => setTimeout(r, 20)).then(() => { now += 5000; return super.fetchSessions(ctx); }); }
  }
  setupDemoWorld();
  Date.now = () => now;
  try {
    const list = new SlowSessions(); // asked straight: the list's loads share one cache, filled in before()
    const { timing } = await list.fetch(list.context());
    assert.equal(timing.sessions, 5000, "the sessions' own time");
    assert.equal(timing.board, 0, "the board didn't wait for them");
    assert.equal(timing.total, 5000, "the load did");
    assert.match(loadTimes(timing), /most of it waiting on Claude sessions/);
  } finally {
    Date.now = still;
  }
});

test("a quick load says nothing about its time", () => {
  assert.equal(loadTimes(null), null);
  assert.equal(loadTimes({ board: 10, total: LOAD_SAID - 1 }), null);
});

test("a slow load says each part's time and which it waited on most", () => {
  const text = loadTimes({ board: 1100, open: 3940, merged: 1200, reviews: 2000, sessions: 300, sort: 5, total: 3950 }, 12);
  assert.equal(text, "The last load took 4.0 s, most of it waiting on your open pull requests:\n"
    + "the board 1.1 s · your open pull requests 3.9 s · your merged ones 1.2 s · reviews for you 2.0 s · Claude sessions 300 ms · sorting it out 5 ms · drawing the list 12 ms");
});

test("a profile with no GitHub owner lists no pull request searches", () => {
  const text = loadTimes({ board: 1800, sessions: 200, sort: 3, total: 1800 });
  assert.match(text, /most of it waiting on the board/);
  assert.doesNotMatch(text, /pull requests|reviews/);
});

test("the freshness line's tooltip says a slow load's times", async () => {
  const slow = { ...stories, data: { ...stories.data, timing: { board: 2400, open: 900, merged: 500, reviews: 700, sessions: 100, sort: 4, total: 2400 } } };
  setupDemoWorld({ stories: slow });
  const tip = tipOf(byId(await drawShared(), "stories-fresh"));
  assert.match(tip, /^Load the stories again\nThe last load took 2\.4 s, most of it waiting on the board:\nthe board 2\.4 s · /);
  assert.match(tip, / · drawing the list \d+ ms$/);
  // The shared copy carries the times, so they show after a restart too.
  assert.equal(mock.sharedValue("kelpie.stories.data")[DEMO].data.timing.board, 2400);
});

test("a quick load's freshness tooltip is the plain one", async () => {
  setupDemoWorld({ stories });
  assert.equal(tipOf(byId(await drawShared(), "stories-fresh")), "Load the stories again");
});
