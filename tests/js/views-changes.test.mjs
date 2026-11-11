// The Changes view (stories.js StoryView, changesBody) on a big pull request: a render never spends
// long on patches, as Herdr cuts off a render that runs too long (and a cut-off render that kept
// starting over never showed anything); the rest waits for the next render, and what's parsed stays.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { handlers, isElement, nodeOf, texts, walk } from "gpui-kit";
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

// A render spends at most PARSE_FOR ms on patches (here the clock moves 1 ms each time it's read: once
// per file and once per removed line marked): it shows how far it got and a timer asks for the next
// render, which goes on from there until all are read.
test("changes: a big pull request is read over a few renders, then shown", async (t) => {
  const { view, cx } = await changes(Array.from({ length: 140 }, (_, i) => file(i, 40)));
  const timers = [];
  cx.timer = { every() {}, after: (_ms, fn) => timers.push(fn) };
  let clock = Date.now();
  t.mock.method(Date, "now", () => (clock += 1));
  const first = view.render(cx);
  assert.match(texts(first)[0], /^Reading the changes: \d+ of 140 files…$/);
  assert.equal(virtualList(first), null, "no rows built in that render");
  assert.equal(timers.length, 1, "a timer asks for the next render");
  let renders = 1, el = first;
  while (!virtualList(el) && renders < 2000) {
    const now = timers.splice(0);
    assert.equal(now.length, 1);
    const before = cx.notified;
    now[0](cx);
    assert.equal(cx.notified, before + 1, "the timer asks for a redraw");
    el = view.render(cx);
    renders++;
  }
  t.mock.restoreAll();
  assert.ok(renders > 2 && renders < 2000, `${renders} renders`);
  // The section heading, then each file: its header, a band, its 80 lines in items of up to 30
  // (a new one 3 lines above each run of changes: here every line is one), the band after them.
  assert.equal(virtualList(el).args[1], 1 + 140 * (1 + 1 + Math.ceil(80 / 30) + 1));
});

// Marking what changed inside each line (a token LCS per pair) is the slow part, and one file of many
// changed lines took longer than a whole render in Herdr: it was cut off inside that file every time
// and never showed. Marking now stops when the render's time is up and goes on where it stopped.
test("changes: one file of many changed lines is marked over several renders, never starting over", async (t) => {
  const big = file(5000, 300);
  const { view, cx } = await changes([big]);
  const timers = [];
  cx.timer = { every() {}, after: (_ms, fn) => timers.push(fn) };
  let clock = Date.now();
  t.mock.method(Date, "now", () => (clock += 1));
  const first = view.render(cx);
  assert.match(texts(first)[0], /^Reading the changes: 0 of 1 file…$/, "the render stopped inside the file");
  let renders = 1, el = first;
  while (!virtualList(el) && renders < 100) { timers.splice(0).forEach((fn) => fn(cx)); el = view.render(cx); renders++; }
  t.mock.restoreAll();
  // 300 removed lines at ~30 a render: about 10 renders. Starting over each time would never end.
  assert.ok(renders > 5 && renders < 100, `${renders} renders`);
  const rows = diffRows(big.patch);
  assert.ok(rows.filter((r) => r.kind === "del").every((r) => r.marks?.length), "every pair marked");
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

// A file header's actions (Copy path, Open on GitHub or Show in Finder, Ask Claude) and its Viewed box
// are told apart by where the press was, as rows of Herdr's virtual list take no click handlers.
// Herdr reports that press as drawn, zoom included, while the header is laid out at zoom 1: a click on
// an action used to land on another, or on none, which folded the file (issue #52).
const STORY = "ACME-184";
const prGroup = { label: "ACME-184 · web#409", key: STORY, repo: "web#409", url: "https://github.com/kelpie--demo/web/pull/409", merged: false, title: "A pull request", files: [file(6000, 3), file(6001, 3)] };
const localGroup = { label: "ACME-184 · api · not committed", key: STORY, repo: "api", path: "/home/test/acme/api", files: [{ ...file(6002, 3), id: "local:/home/test/acme/api:src/file6002.ts" }] };
// Each call's files get a version of their own (`sha`): whether a file is folded outlives a view, by
// file and version, so one test's fold doesn't carry into the next.
let version = 0;
async function storyChanges(groups, { all = true } = {}) {
  setupDemoWorld({ stories });
  mock.state.shared.delete("kelpie.viewed");
  mock.state.shared.set("kelpie.stories.preview", { [DEMO]: STORY });
  mock.state.shared.set("kelpie.view", { [`preview:${DEMO}`]: "changes" });
  const { view, cx } = await draw(new StoryView());
  version++;
  view.extra[STORY] = { groups: groups.map((g) => ({ ...g, files: g.files.map((f) => ({ ...f, sha: `${f.sha}-${version}` })) })), at: Date.now() };
  const clip = [];
  cx.write_to_clipboard = (s) => clip.push(s);
  shown(view, cx);
  // All files or one at a time: the switch under the file list's progress line (the choice outlives a view).
  handlers(view.render(cx)).find((h) => h.id === (all ? "diff-all" : "diff-one")).fn({}, cx);
  shown(view, cx);
  return { view, cx, clip };
}
const byId = (el, id) => walk(el).find((n) => n.calls.some(([m, a]) => m === "id" && a[0] === id));
const call = (n, method) => n.calls.find(([m]) => m === method)?.[1].find((v) => typeof v === "function");
// Herdr at `zoom`: the probe reports its size as drawn, then a press at `x` and `y` (as laid out, at
// zoom 1) lands where Herdr draws it, and the click goes to the list's row `key`.
function clickAt({ view, cx }, zoom, x, key, y = 200) {
  const el = view.render(cx);
  const probe = byId(el, "diff-zoom-probe");
  if (probe) call(probe, "on_size_change")({ width: 100 * zoom, height: 0 }, cx);
  const press = walk(el).find((n) => n.calls.some(([m]) => m === "on_scroll_wheel") && n.calls.some(([m]) => m === "on_mouse_down"));
  call(press, "on_mouse_down")({ button: "left", click_count: 1, position: { x: x * zoom, y: y * zoom }, local_position: { x: x * zoom, y: y * zoom } }, cx);
  call(virtualList(el), "on_item_click")(String(key), cx);
}
const headerOf = (view, fi) => view.diffView.entries.findIndex((e) => e.r.kind === "file" && e.fi === fi);
const rowCount = ({ view, cx }) => virtualList(view.render(cx)).args[1];
// Where each part of a header is, as laid out: the Viewed box at 32 (74 wide), then the actions 10
// after it, 2 apart: Copy path (26), Open on GitHub or Show in Finder (26), Ask Claude (84).
const CENTRE = { viewed: 32 + 37, copy: 116 + 13, open: 144 + 13, ask: 172 + 42 };

for (const zoom of [0.8, 1, 1.2, 1.5, 2]) {
  for (const all of [true, false]) {
    const mode = all ? "All files" : "One file";
    test(`changes: at zoom ${zoom} in ${mode}, Copy path only copies the path`, async () => {
      const s = await storyChanges([prGroup], { all });
      const rows = rowCount(s);
      clickAt(s, zoom, CENTRE.copy, headerOf(s.view, 0));
      assert.deepEqual(s.clip, ["src/file6000.ts"]);
      assert.equal(rowCount(s), rows, "the file didn't fold");
      assert.equal(s.view.sending ?? null, null);
    });
    test(`changes: at zoom ${zoom} in ${mode}, Open on GitHub only opens the pull request's files`, async () => {
      const s = await storyChanges([prGroup], { all });
      const rows = rowCount(s);
      mock.calls.length = 0;
      clickAt(s, zoom, CENTRE.open, headerOf(s.view, 0));
      assert.ok(mock.of("exec").some(([, args]) => args.includes(`${prGroup.url}/files`)), "it opened the pull request's files");
      assert.deepEqual(s.clip, []);
      assert.equal(rowCount(s), rows, "the file didn't fold");
    });
    test(`changes: at zoom ${zoom} in ${mode}, Show in Finder only shows the uncommitted file`, async () => {
      const s = await storyChanges([localGroup], { all });
      const rows = rowCount(s);
      mock.calls.length = 0;
      clickAt(s, zoom, CENTRE.open, headerOf(s.view, 0));
      assert.ok(mock.of("exec").some(([, args]) => args.some((a) => String(a).includes("/home/test/acme/api/src/file6002.ts"))), "it showed the file");
      assert.equal(rowCount(s), rows, "the file didn't fold");
    });
    test(`changes: at zoom ${zoom} in ${mode}, Ask Claude only opens its picker`, async () => {
      const s = await storyChanges([prGroup], { all });
      const rows = rowCount(s);
      // Near its right end too, which a press not divided by the zoom missed past zoom 1.
      clickAt(s, zoom, CENTRE.ask + 38, headerOf(s.view, 0));
      assert.equal(s.view.sending, `diff:${prGroup.files[0].id}`);
      assert.equal(rowCount(s), rows, "the file didn't fold");
      assert.deepEqual(s.clip, []);
    });
    // One file at a time, the file shown already counts as viewed, so there the click unticks it.
    test(`changes: at zoom ${zoom} in ${mode}, Viewed only ticks or unticks the file`, async () => {
      const s = await storyChanges([prGroup], { all });
      const ticked = () => Object.keys(mock.state.shared.get("kelpie.viewed") ?? {}).some((k) => k.includes("src/file6000.ts"));
      const was = ticked();
      assert.equal(was, !all);
      clickAt(s, zoom, CENTRE.viewed + 30, headerOf(s.view, 0));
      assert.equal(ticked(), !was, "the tick changed");
      assert.deepEqual(s.clip, []);
      assert.equal(s.view.sending ?? null, null);
    });
  }
}

// Between the Viewed box and the first action, or just past the last, a slightly missed press does
// nothing: it doesn't fold the file.
test("changes: a press just beside a header's actions doesn't fold the file", async () => {
  const s = await storyChanges([prGroup]);
  const rows = rowCount(s);
  for (const x of [113, 172 + 84 + 4]) {
    clickAt(s, 1, x, headerOf(s.view, 0));
    assert.equal(rowCount(s), rows, `a press at ${x} didn't fold the file`);
  }
  assert.deepEqual(s.clip, []);
  assert.equal(s.view.sending ?? null, null);
  // Elsewhere on the header (its name) still folds it.
  clickAt(s, 1, 400, headerOf(s.view, 0));
  assert.ok(rowCount(s) < rows, "a press on the name folds it");
});

// Ask Claude's picker is laid over the top of the diff: opening it takes no room above the list, so the
// page doesn't move; and a press on it isn't a press on the row under it.
test("changes: Ask Claude's picker is laid over the diff, not above it", async () => {
  const s = await storyChanges([prGroup]);
  // The diff's side of the split: the box holding the list (and, before, the bar above it).
  const pane = (el) => {
    const split = walk(el).find((n) => n.kind === "h_resizable");
    const panel = nodeOf(split.calls.filter(([m]) => m === "child")[1][1][0]);
    return nodeOf(panel.calls.find(([m]) => m === "child")[1][0]);
  };
  const kids = (n) => n.calls.filter(([m]) => m === "child" || m === "children").flatMap(([m, a]) => (m === "children" ? [...a[0]] : [a[0]]));
  const before = kids(pane(s.view.render(s.cx))).length;
  clickAt(s, 1.2, CENTRE.ask, headerOf(s.view, 0));
  const el = s.view.render(s.cx);
  assert.match(texts(el).join(" "), /Ask Claude about file6000\.ts/);
  assert.equal(kids(pane(el)).length, before, "nothing above the list");
  const bar = byId(el, "ask-bar");
  assert.ok(bar && bar.calls.some(([m]) => m === "absolute"), "the bar is laid over the list");
  // The bar is 60 tall as drawn: a press in it is the bar's, one under it the list's.
  call(bar, "on_size_change")({ width: 600, height: 60 * 1.2 }, s.cx);
  const rows = rowCount(s);
  clickAt(s, 1.2, CENTRE.copy, headerOf(s.view, 0), 30);
  assert.deepEqual(s.clip, [], "a press on the bar doesn't reach the header under it");
  assert.equal(rowCount(s), rows, "nor fold it");
  clickAt(s, 1.2, CENTRE.copy, headerOf(s.view, 0), 100);
  assert.deepEqual(s.clip, ["src/file6000.ts"]);
});

// Ask Claude from a file's header (KELPIE-84): the picker offers a new Claude in the story's space
// and the story's open Claudes; a suggestion asks the one picked, with the file it's about.
test("changes: a suggestion in Ask Claude's picker asks the Claude picked about the file", async () => {
  const s = await storyChanges([prGroup]);
  mock.state.spaces = [...mock.state.spaces, { id: "s-ask", name: "Elsewhere", tabs: [] }];
  mock.state.agents = [...mock.state.agents,
    { address: "t-ask", tab_name: `${STORY} claude`, space: "s-ask", pane: "p-ask", status: "idle", title: "" },
    { address: "t-other", tab_name: "ACME-999", space: "s-ask", pane: "p-other", status: "idle", title: "" }];
  mock.on.hc = (args) => (args[0] === "get" ? { code: 0, stdout: JSON.stringify({ foreground: { name: "claude" } }), stderr: "" } : { code: 0, stdout: "{}", stderr: "" });
  clickAt(s, 1, CENTRE.ask, headerOf(s.view, 0));
  const el = s.view.render(s.cx);
  const words = texts(el).join(" ");
  assert.match(words, /New Claude in ACME-184's space/);
  assert.match(words, new RegExp(`${STORY} claude`), "the story's open Claude is offered");
  assert.doesNotMatch(words, /ACME-999/, "another story's Claude isn't");
  assert.equal(s.view.target.chosen, "t-ask", "the Claude on the story's key is picked");
  mock.calls.length = 0;
  handlers(el).find((h) => h.id === "ask-claude-suggest-explain").fn({}, s.cx);
  await new Promise((r) => setImmediate(r));
  const sent = mock.of("hc").filter(([a]) => a[0] === "send");
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0].at(-2), "t-ask");
  assert.match(sent[0][0].at(-1), /^About the file src\/file6000\.ts in web#409 \(ACME-184\), in the pull request/);
  assert.equal(s.view.sending, null, "the picker closed");
  // What it led to stays over the diff until closed.
  const after = s.view.render(s.cx);
  assert.match(texts(after).join(" "), /Sent your question to ACME-184 claude\./);
  handlers(after).find((h) => h.id === "ask-claude-note-close").fn({}, s.cx);
  assert.equal(byId(s.view.render(s.cx), "ask-bar"), undefined, "closed, nothing is laid over the diff");
});
