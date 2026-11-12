// Memory over a long session (#41): what the story views keep per key, per file or per patch stays
// bounded however many stories, descriptions and patches a day of work goes through, the newest kept.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { DEMO, draw, fakeCx, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { KEEP, Stories, StoryList, StoryView, fileStatus, patchCaches, patchHash, diffRows } from "../../mods/kelpie/stories.js";
import { mock } from "herdr";

const KEY = "review:web#421";
let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

// Every story whose Changes were opened kept all its patches: now only the last KEEP.changes do.
test("memory: the Changes of only the last few stories opened are kept", async () => {
  setupDemoWorld({ stories });
  mock.state.shared.set("kelpie.stories.preview", { [DEMO]: KEY });
  mock.state.shared.set("kelpie.view", { [`preview:${DEMO}`]: "changes" });
  const { view, cx } = await draw(new StoryView());
  const { st, shown } = view.prepare(cx);
  for (let i = 0; i < KEEP.changes * 3; i++) {
    view.loadExtra(st, { ...shown, key: `review:web#${1000 + i}` }, cx);
    await cx.settle();
  }
  const keys = Object.keys(view.extra);
  assert.ok(keys.length <= KEEP.changes, `${keys.length} stories' changes kept`);
  assert.ok(keys.includes(`review:web#${1000 + KEEP.changes * 3 - 1}`), "the last one opened is kept");
  assert.ok(view.extra[keys.at(-1)].groups, "and loaded");
});

// One still loading isn't dropped (its answer would only start the load again), however many follow.
test("memory: a description still loading is kept, the oldest loaded ones go", async () => {
  const view = new Stories(), cx = fakeCx(), st = { at: 0 };
  let release;
  const slow = new Promise((r) => { release = r; });
  view.descriptionOf(st, "ACME-1", cx, () => slow.then(() => []));
  for (let i = 2; i < KEEP.descriptions * 2; i++) view.descriptionOf(st, `ACME-${i}`, cx, async () => []);
  await new Promise((r) => setImmediate(r));
  assert.ok(Object.keys(view.descs).length <= KEEP.descriptions + 1, `${Object.keys(view.descs).length} descriptions kept`);
  assert.ok(view.descs["ACME-1"]?.loading, "the one loading stays");
  assert.equal(view.descs["ACME-2"], undefined, "the oldest loaded one went");
  release();
  await cx.settle();
  assert.deepEqual(view.descs["ACME-1"].blocks, []);
});

// The caches keyed by whole patches held 4000 of them, whatever their size: now at most 8 million
// characters each, the newest kept.
test("memory: the caches keyed by patches stay under their size", () => {
  const big = (i) => `@@ -1 +1 @@\n-${"x".repeat(10000)}${i}\n+${"y".repeat(10000)}${i}`;
  for (let i = 0; i < 1500; i++) { const p = big(i); patchHash(p); fileStatus("modified", p); }
  for (let i = 0; i < 500; i++) diffRows(big(i), 0);
  const sizes = patchCaches();
  for (const [name, n] of Object.entries(sizes)) assert.ok(n <= 8e6, `${name}: ${n} characters of patches`);
  assert.ok(sizes.hashes > 7e6, "but they still hold most of what fits");
});
