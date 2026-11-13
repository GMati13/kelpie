// What Next points at when it opens a story (stories.js POINT: setPoint, pointFor, pointBox): one
// box over the details with the step and the pull requests it's about, the header's button for the
// step lit; and Merge all, the header's main action when the approved pull requests are several
// tickets' (the demo's ACME-171: web#415 with checks passing, charts#58 with none).
import { DEMO, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, nodeOf, texts } from "gpui-kit";
import { byId, matchSnapshot, render } from "../lib/snapshot.mjs";
import { Stories, StoryBody, StoryList, nextNeed } from "../../mods/kelpie/stories.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";

const snap = (name, el) => matchSnapshot(name, render(el, skinTheme()));
let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

const POINT = "kelpie.point";
const pointAt = (key, kind, at = Date.now()) => mock.state.shared.set(POINT, { [DEMO]: { key, kind, at } });
async function show(View, { space = "ACME-171", point = null, data = stories } = {}) {
  setupDemoWorld({ stories: data, shown: space });
  if (point) pointAt(...point);
  return draw(new View());
}
const press = (el, id, cx) => handlers(el).find((h) => h.id === id).fn({}, cx);

test("ready to merge across tickets: the header's main action is Merge all, a menu", async () => {
  const { el, view, cx } = await show(Stories);
  assert.deepEqual(texts(byId(el, "story-merge-all")), ["Merge all ▾"]);
  assert.equal(byId(el, "story-merge-more"), null, "no second Merge icon beside it");
  assert.equal(byId(el, "story-pointed"), null, "not lit unless Next pointed at it");
  press(el, "story-merge-all", cx);
  const open = render(view.render(cx), skinTheme());
  assert.match(open, /Merge for ACME-171 with/);
  assert.match(open, /New agent/);
});

// The demo's charts#58 named ACME-172 too: two pull requests ready to merge, one ticket's.
const oneTicket = () => {
  const data = structuredClone(stories);
  data.data.prs.find((p) => p.repository.name === "charts").title = "ACME-172 Dark palette for the dashboard charts";
  return data;
};
test("two pull requests ready to merge on one ticket: Merge all too, in the header and the box", async () => {
  const head = await show(Stories, { data: oneTicket() });
  assert.deepEqual(texts(byId(head.el, "story-merge-all")), ["Merge all ▾"]);
  const { el } = await show(StoryBody, { data: oneTicket(), point: ["ACME-171", "merge"] });
  const box = byId(el, "point-box");
  assert.deepEqual(texts(byId(box, "point-merge-all")), ["Merge all ▾"]);
  assert.doesNotMatch(render(box, skinTheme()), /#point-ask-merge-/, "no Merge per line beside it");
});

test("one pull request ready to merge: Merge, on its line", async () => {
  const data = structuredClone(stories);
  data.data.prs = data.data.prs.filter((p) => p.repository.name !== "charts");
  const { el } = await show(StoryBody, { data, point: ["ACME-171", "merge"] });
  const box = byId(el, "point-box");
  assert.equal(byId(box, "point-merge-all"), null);
  assert.ok(byId(box, "point-ask-merge-web#415"));
});

test("the box is as wide as the subtask rows at most", async () => {
  const { el } = await show(StoryBody, { point: ["ACME-171", "merge"] });
  assert.ok(nodeOf(byId(el, "point-box")).calls.some(([m, a]) => m === "max_w" && a[0] === 760));
});

// KELPIE-228: Request approval and Merge are the Ask line's, beside its suggestions, not the header's.
test("a story waiting on reviewers offers Request approval and Merge on its Ask line, not as header icons", async () => {
  const { el } = await show(Stories, { space: "ACME-142" });
  assert.equal(byId(el, "story-approval-more"), null);
  assert.equal(byId(el, "story-merge-more"), null);
  const body = (await show(StoryBody, { space: "ACME-142" })).el;
  assert.deepEqual(texts(byId(body, "ask-task-merge")), ["Merge"]);
  assert.deepEqual(texts(byId(body, "ask-task-approval")), ["Request approval"]);
});

test("Next pointed at merging: one box with the step, its pull requests and Merge all; the header's lit", async () => {
  const head = await show(Stories, { point: ["ACME-171", "merge"] });
  assert.deepEqual(texts(byId(head.el, "story-pointed")), ["Merge all ▾"]);
  assert.match(render(byId(head.el, "story-pointed"), skinTheme()), /loop\(opacity/, "its halo breathes");
  const { el } = await show(StoryBody, { point: ["ACME-171", "merge"] });
  const box = byId(el, "point-box");
  assert.deepEqual(texts(box).slice(0, 3), ["Next", "All 2 pull requests are approved: merge them", "Merge all asks an agent to check them and plan the merge"]);
  assert.ok(byId(box, "point-pr-web#415") && byId(box, "point-pr-charts#58"), "both pull requests in the box");
  assert.deepEqual(texts(byId(box, "point-merge-all")), ["Merge all ▾"]);
  // The list's own lines aren't tinted: the box holds the step.
  assert.doesNotMatch(render(byId(el, "sub-row-ACME-172"), skinTheme()), /accent\/12/);
  snap("body/pointed", el);
});

test("the box fades in once, and the details open at their top", async () => {
  const { el, view, cx } = await show(StoryBody, { point: ["ACME-171", "merge"] });
  const timers = [];
  cx.timer = { every() {}, after: (ms, fn) => timers.push(fn) };
  assert.match(render(byId(el, "point-box"), skinTheme()).split("\n")[0], /opacity=0/);
  view.render(cx);
  timers[0](cx);
  const shown = view.render(cx);
  assert.match(render(byId(shown, "point-box"), skinTheme()).split("\n")[0], /opacity=1/);
  const at = mock.sharedValue(POINT)[DEMO].at;
  assert.ok(byId(shown, `story-overview-ACME-171-${at}`), "an id of its own while pointed (tests/js/scroll.test.mjs: put back to the top)");
});

test("a glint runs along the box's border for its first seconds, then it rests", async () => {
  const { view, cx } = await show(StoryBody, { point: ["ACME-171", "merge"] });
  const timers = [];
  cx.timer = { every() {}, after: (ms, fn) => timers.push({ ms, fn }) };
  view.render(cx);
  timers.shift().fn(cx);
  // Its size, as Herdr reports it once drawn (on_size_change and the zoom probe).
  view.shine = { point: { width: 600, zoom: 1 } };
  const box = () => render(byId(view.render(cx), "point-box"), skinTheme());
  assert.match(box(), /loop\(left/, "glinting");
  assert.deepEqual(timers.map((x) => x.ms), [5000], "a redraw when it ends");
  view.pointGlint = Date.now() - 1;
  assert.doesNotMatch(box(), /loop\(left/, "at rest");
});

test("several tickets failing checks: each line in the box has its own Fix checks", async () => {
  const { el } = await show(StoryBody, { space: "ACME-151", point: ["ACME-151", "fix"] });
  const box = byId(el, "point-box");
  assert.ok(box, "the box");
  assert.match(render(box, skinTheme()), /#point-ask-fix-/);
});

test("the pointer ends when the story needs something else, after an hour, or by its ✕", async () => {
  // Pointed at fixing checks, but ACME-171 only needs merging: nothing shows.
  assert.equal(byId((await show(StoryBody, { point: ["ACME-171", "fix"] })).el, "point-box"), null);
  assert.equal(byId((await show(StoryBody, { point: ["ACME-171", "merge", Date.now() - 61 * 60 * 1000] })).el, "point-box"), null);
  // Another story's pointer isn't this one's.
  assert.equal(byId((await show(StoryBody, { point: ["ACME-151", "fix"] })).el, "point-box"), null);
  const { el, view, cx } = await show(StoryBody, { point: ["ACME-171", "merge"] });
  press(el, "point-close", cx);
  assert.equal(mock.sharedValue(POINT)[DEMO], null);
  assert.equal(byId(view.render(cx), "point-box"), null);
});

test("taking the step from Merge all's menu ends the pointer", async () => {
  const { el, view, cx } = await show(Stories, { point: ["ACME-171", "merge"] });
  press(el, "story-merge-all", cx);
  press(view.render(cx), "story-merge-row-1", cx);
  assert.equal(mock.sharedValue(POINT)[DEMO], null);
});

test("Next (⌘⇧J) points at the step of the story it opens", async () => {
  setupDemoWorld({ stories });
  nextNeed();
  const p = mock.sharedValue(POINT)?.[DEMO];
  assert.ok(p, "a pointer");
  assert.match(p.key, /^ACME-\d+$/);
  assert.ok(["peek", "comments", "fix", "merge"].includes(p.kind));
});
// The Ask line's Merge asks who it has chosen: a new Claude here, with the merge task, and on the thread.
test("the Ask line's Merge starts a new Claude with the merge task, and goes on the thread", async () => {
  const { el, view, cx } = await show(StoryBody, { space: "ACME-171" });
  mock.calls.length = 0;
  handlers(el).find((h) => h.id === "ask-task-merge").fn({}, cx);
  await new Promise((r) => setImmediate(r));
  const started = mock.of("run").find(([n]) => n === "tab.new" || n === "space.new");
  assert.ok(started, "a new Claude");
  assert.match(String(started[1].task ?? ""), /merge/i);
  assert.match(texts(byId(view.render(cx), "ask-thread")).join(" "), /Merge/);
});
