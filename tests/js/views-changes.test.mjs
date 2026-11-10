// The Changes view (stories.js StoryView, changesBody) on a big pull request: a render never spends
// long on patches, as Herdr cuts off a render that runs too long (and a cut-off render that kept
// starting over never showed anything); the rest waits for the next render, and what's parsed stays.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { isElement, nodeOf, texts } from "gpui-kit";
import { DEMO, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { StoryList, StoryView, diffRows } from "../../mods/kelpie/stories.js";
import { mock } from "herdr";

const KEY = "review:web#421";
let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

// A patch of `n` changed lines, different for each `i`.
const patch = (i, n = 40) => `@@ -1,${n} +1,${n} @@\n` + Array.from({ length: n }, (_, k) => `-const value${i}_${k} = old(${k});\n+const value${i}_${k} = fresh(${k});`).join("\n");
const file = (i, n) => ({ id: `web#421:src/file${i}.ts`, path: `src/file${i}.ts`, from: null, add: n, del: n, status: "modified", sha: `sha${i}`, patch: patch(i, n) });

// The review's Changes view with its files swapped for `files`.
async function changes(files) {
  setupDemoWorld({ stories });
  mock.state.shared.set("kelpie.stories.preview", { [DEMO]: KEY });
  mock.state.shared.set("kelpie.view", { [`preview:${DEMO}`]: "changes" });
  const { view, cx } = await draw(new StoryView());
  Object.assign(view.extra[KEY], { groups: [{ ...view.extra[KEY].groups[0], files }], at: Date.now() });
  return { view, cx };
}
const virtualList = (x) => {
  if (Array.isArray(x)) { for (const v of x) { const r = virtualList(v); if (r) return r; } return null; }
  if (!isElement(x)) return null;
  const n = nodeOf(x);
  if (n.kind === "v_virtual_list") return n;
  for (const a of n.args) { const r = virtualList(a); if (r) return r; }
  for (const [, a] of n.calls) for (const v of a) { const r = virtualList(v); if (r) return r; }
  return null;
};

// Renders until the diff shows, running the timer each "Reading the changes" render leaves.
function shown(view, cx) {
  const timers = [];
  cx.timer = { every() {}, after: (_ms, fn) => timers.push(fn) };
  for (let i = 0; i < 200; i++) {
    const list = virtualList(view.render(cx));
    if (list) return list;
    timers.splice(0).forEach((fn) => fn(cx));
  }
  throw new Error("the diff never showed");
}

// A render spends at most PARSE_FOR ms on patches (here the clock moves 10 ms per file): it shows how
// far it got and a timer asks for the next render, which goes on from there until all are read.
test("changes: a big pull request is read over a few renders, then shown", async (t) => {
  const { view, cx } = await changes(Array.from({ length: 140 }, (_, i) => file(i, 40)));
  const timers = [];
  cx.timer = { every() {}, after: (_ms, fn) => timers.push(fn) };
  let clock = Date.now();
  t.mock.method(Date, "now", () => (clock += 5));
  const first = view.render(cx);
  assert.match(texts(first)[0], /^Reading the changes: \d+ of 140 files…$/);
  assert.equal(virtualList(first), null, "no rows built in that render");
  assert.equal(timers.length, 1, "a timer asks for the next render");
  let renders = 1, el = first;
  while (!virtualList(el) && renders < 200) {
    const now = timers.splice(0);
    assert.equal(now.length, 1);
    const before = cx.notified;
    now[0](cx);
    assert.equal(cx.notified, before + 1, "the timer asks for a redraw");
    el = view.render(cx);
    renders++;
  }
  t.mock.restoreAll();
  assert.ok(renders > 2 && renders < 200, `${renders} renders`);
  // The section heading, then each file: its header, a band, its 80 lines in items of up to 30
  // (a new one 3 lines above each run of changes: here every line is one), the band after them.
  assert.equal(virtualList(el).args[1], 1 + 140 * (1 + 1 + Math.ceil(80 / 30) + 1));
});

test("changes: a small change shows at once", async () => {
  const { view, cx } = await changes([file(900, 3), file(901, 3)]);
  assert.ok(virtualList(view.render(cx)));
});

// Herdr's virtual list refuses more than 10 000 items ("item_sizes may contain at most 10000
// entries"): a pull request of 200 files and 16 000 lines is drawn in far fewer, and the list's
// sizes still add up to every line.
test("changes: more lines than the list takes items", async () => {
  const { view, cx } = await changes(Array.from({ length: 200 }, (_, i) => file(2000 + i, 40)));
  const list = shown(view, cx);
  assert.ok(list.args[1] < 10000, `${list.args[1]} items`);
  const lines = list.args[2].reduce((n, h) => n + h, 0);
  assert.equal(lines, 76 - 32 + 200 * (46 + 26 + 80 * 20 + 26), "every line's height is in the list");
});

// n / p: each run of changed lines starts an item 3 lines above it, so a jump lands there.
test("changes: n goes to the next run of changes, 3 lines above it", async () => {
  const ctx = (i) => ` same line ${i}`;
  const p = "@@ -1,12 +1,12 @@\n" + [...Array.from({ length: 5 }, (_, i) => ctx(i)), "-old a", "+new a", ...Array.from({ length: 5 }, (_, i) => ctx(i + 5)), "-old b", "+new b"].join("\n");
  const { view, cx } = await changes([{ ...file(3000, 1), patch: p }]);
  shown(view, cx);
  const items = view.diffView.entries;
  const firstLine = (i) => items[i].lines?.[0]?.text;
  const jumps = [];
  const scroller = { scroll_to_item: (i) => jumps.push(i) };
  view.diffRange = { start: 0, end: 5 };
  assert.ok(view.stepChange(KEY, scroller, 1));
  assert.ok(view.stepChange(KEY, scroller, 1));
  assert.deepEqual(jumps.map(firstLine), ["same line 2", "same line 7"]);
});

test("diffRows: every patch of a big pull request stays parsed, not the last few", () => {
  const patches = Array.from({ length: 300 }, (_, i) => patch(1000 + i, 5));
  const rows = patches.map(diffRows);
  assert.ok(patches.every((p, i) => diffRows(p) === rows[i]));
});

// The file list and the diff are a resizable split: the list starts 260 wide and is dragged between
// 180 and 640, the window keeping the width under the group's id.
test("changes: the file list's width can be dragged", async () => {
  const { view, cx } = await changes([file(4000, 3)]);
  const find = (x, kind) => {
    if (Array.isArray(x)) { for (const v of x) { const r = find(v, kind); if (r) return r; } return null; }
    if (!isElement(x)) return null;
    const n = nodeOf(x);
    if (n.kind === kind) return n;
    for (const a of n.args) { const r = find(a, kind); if (r) return r; }
    for (const [, a] of n.calls) for (const v of a) { const r = find(v, kind); if (r) return r; }
    return null;
  };
  const split = find(view.render(cx), "h_resizable");
  assert.deepEqual(split.args, ["changes-split"]);
  const panels = split.calls.filter(([m]) => m === "child").map(([, [p]]) => nodeOf(p));
  assert.deepEqual(panels.map((p) => p.kind), ["resizable_panel", "resizable_panel"]);
  assert.deepEqual(panels[0].calls.filter(([m]) => m === "size" || m === "size_range").map(([m, a]) => [m, ...a]), [["size", 260], ["size_range", 180, 640]]);
});
