// Each thing shown keeps its own scroll position (#99): a story's details and its Changes, a lone pull
// request's description, a profile's sidebar. Every scroll box's id names what it shows, and its
// position is a handle lent per key by ui.js ScrollPool (GPUI keeps an element's own position only
// while it's drawn, and makes handles only in init), so another story opens at its own place and coming
// back finds the first where it was.
import { DEMO, demoProfile, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, isElement, nodeOf } from "gpui-kit";
import { byId } from "../lib/snapshot.mjs";
import { StoryBody, StoryList, StoryView } from "../../mods/kelpie/stories.js";
import { WorkSide } from "../../mods/kelpie/workside.js";
import { ScrollPool } from "../../mods/kelpie/ui.js";

let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

// The element whose id starts with `prefix` (its id and the handle it tracks), or null.
function scrollBox(x, prefix) {
  if (Array.isArray(x)) { for (const v of x) { const f = scrollBox(v, prefix); if (f) return f; } return null; }
  if (!isElement(x)) return null;
  const n = nodeOf(x);
  const id = n.calls.find(([m, a]) => m === "id" && String(a[0]).startsWith(prefix))?.[1][0];
  if (id !== undefined) return { id, handle: n.calls.find(([m]) => m === "track_scroll")?.[1][0] ?? null };
  for (const a of n.args) { const f = scrollBox(a, prefix); if (f) return f; }
  for (const [, a] of n.calls) for (const v of a) { const f = scrollBox(v, prefix); if (f) return f; }
  return null;
}
// The handle a virtual list tracks (the Changes diff), with the list's id.
function listScroll(x) {
  if (Array.isArray(x)) { for (const v of x) { const f = listScroll(v); if (f) return f; } return null; }
  if (!isElement(x)) return null;
  const n = nodeOf(x);
  if (n.kind === "v_virtual_list") return { id: n.args[0], handle: n.calls.find(([m]) => m === "track_scroll")?.[1][0] ?? null };
  for (const a of n.args) { const f = listScroll(a); if (f) return f; }
  for (const [, a] of n.calls) for (const v of a) { const f = listScroll(v); if (f) return f; }
  return null;
}
const calls = (h) => h.__state.calls.map(([m, a]) => `${m}(${a.join(",")})`);
const preview = (key, view = null) => {
  mock.state.shared.set("kelpie.stories.preview", { [DEMO]: key });
  if (view) mock.state.shared.set("kelpie.view", { [`preview:${DEMO}`]: view });
};

test("ScrollPool: a key gets its own handles back; the one shown longest ago goes to a new key, put back to the top", () => {
  let n = 0;
  const reset = [];
  const pool = new ScrollPool(() => ({ n: n++ }), (h) => reset.push(h.n), 2);
  const a = pool.get("A"), b = pool.get("B");
  assert.notEqual(a, b);
  assert.equal(pool.get("A"), a, "A again: its own");
  assert.deepEqual(reset, []);
  const c = pool.get("C"); // B was shown longest ago (A was just shown)
  assert.equal(c, b);
  assert.deepEqual(reset, [b.n], "reset before it's lent again");
  assert.equal(pool.get("A"), a);
  assert.equal(pool.lent.size, 2, "never more than its size");
});

test("a story's details: an id and a position per story, the same again when it's shown again", async () => {
  setupDemoWorld({ stories });
  preview("ACME-142");
  const { view, cx } = await draw(new StoryBody());
  const first = scrollBox(view.render(cx), "story-overview-ACME");
  preview("ACME-180");
  const other = scrollBox(view.render(cx), "story-overview-ACME");
  preview("ACME-142");
  const back = scrollBox(view.render(cx), "story-overview-ACME");
  assert.equal(first.id, "story-overview-ACME-142");
  assert.equal(other.id, "story-overview-ACME-180");
  assert.ok(first.handle && other.handle, "both keep a position");
  assert.notEqual(first.handle, other.handle, "another story, another position");
  assert.equal(back.id, first.id);
  assert.equal(back.handle, first.handle, "back to where it was");
  assert.deepEqual(calls(first.handle), [], "nothing moved it");
});

test("Next pointing at a story opens its details at their top, once per pointing", async () => {
  setupDemoWorld({ stories, shown: "ACME-171" });
  const at = Date.now();
  mock.state.shared.set("kelpie.point", { [DEMO]: { key: "ACME-171", kind: "merge", at } });
  const { el, view, cx } = await draw(new StoryBody());
  const box = scrollBox(el, "story-overview-ACME");
  assert.equal(box.id, `story-overview-ACME-171-${at}`);
  view.render(cx);
  assert.deepEqual(calls(box.handle), ["scroll_to_item(0)"], "to the top once, not on every render");
  mock.state.shared.set("kelpie.point", { [DEMO]: { key: "ACME-171", kind: "merge", at: at + 1 } });
  view.render(cx);
  assert.deepEqual(calls(box.handle), ["scroll_to_item(0)", "scroll_to_item(0)"], "pointed again: the top again");
});

test("a lone pull request's description: a position per pull request", async () => {
  setupDemoWorld({ stories });
  preview("review:web#421");
  const { el } = await draw(new StoryBody());
  const box = scrollBox(el, "pr-desc-view");
  assert.equal(box.id, "pr-desc-view-review:web#421");
  assert.ok(box.handle);
});

test("Changes: the diff and the file list keep a position per story", async () => {
  setupDemoWorld({ stories });
  preview("review:web#421", "changes");
  const { view, cx } = await draw(new StoryView());
  // Renders until the diff shows, running the timer each "Reading the changes" render leaves.
  const timers = [];
  cx.timer = { every() {}, after: (_ms, fn) => timers.push(fn) };
  const shownOf = async (key) => {
    preview(key, "changes");
    for (let i = 0; i < 50; i++) {
      const el = view.render(cx);
      await cx.settle();
      const list = listScroll(el);
      if (list) return { list, files: scrollBox(el, "change-files-") };
      timers.splice(0).forEach((fn) => fn(cx));
    }
    throw new Error(`${key}'s diff never showed`);
  };
  const a = await shownOf("review:web#421");
  const b = await shownOf("review:api#305");
  const back = await shownOf("review:web#421");
  assert.ok(a.list?.handle && b.list?.handle, "both diffs shown, with a position");
  assert.equal(a.files.id, "change-files-review:web#421");
  assert.equal(b.files.id, "change-files-review:api#305");
  assert.notEqual(a.list.handle, b.list.handle, "the diff: another story, another position");
  assert.notEqual(a.files.handle, b.files.handle, "the file list too");
  assert.equal(back.list.handle, a.list.handle, "back to where the diff was");
  assert.equal(back.files.handle, a.files.handle, "and the file list");
});

test("the sidebar keeps a position per profile", async () => {
  const two = { ...demoProfile(), id: "other", name: "Other" };
  setupDemoWorld({ stories });
  const profilesBoth = () => mock.state.shared.set("kelpie.profiles", { [DEMO]: demoProfile(), other: two });
  profilesBoth();
  mock.state.shared.set("kelpie.stories.data", { [DEMO]: stories, other: stories });
  const pick = (id) => mock.state.shared.set("kelpie.profile.chosen", { id, space: mock.state.spaces.find((s) => s.active)?.id ?? null });
  const { view, cx } = await draw(new StoryList());
  // A profile shown for the first time loads its stories (the demo's, answered by the fixture).
  const shownOf = async (id) => { pick(id); view.render(cx); await cx.settle(10); return scrollBox(view.render(cx), "work-side-list-"); };
  const a = await shownOf(DEMO);
  const b = await shownOf("other");
  const back = await shownOf(DEMO);
  assert.equal(a.id, `work-side-list-${DEMO}`);
  assert.equal(b.id, "work-side-list-other");
  assert.notEqual(a.handle, b.handle);
  assert.equal(back.handle, a.handle);
});

test('"Working on" (a profile with no board) keeps a position per profile', async () => {
  setupDemoWorld({ stories, profile: { jira: null } });
  const plain = { ...demoProfile(), jira: null };
  mock.state.shared.set("kelpie.profiles", { [DEMO]: plain, other: { ...plain, id: "other", name: "Other" } });
  const pick = (id) => mock.state.shared.set("kelpie.profile.chosen", { id, space: mock.state.spaces.find((s) => s.active)?.id ?? null });
  const { view, cx } = await draw(new WorkSide());
  pick(DEMO);
  const a = scrollBox(view.render(cx), "work-side-plain-");
  pick("other");
  const b = scrollBox(view.render(cx), "work-side-plain-");
  pick(DEMO);
  const back = scrollBox(view.render(cx), "work-side-plain-");
  assert.equal(a.id, `work-side-plain-${DEMO}`);
  assert.equal(b.id, "work-side-plain-other");
  assert.notEqual(a.handle, b.handle);
  assert.equal(back.handle, a.handle);
});

test("Changes, One file: each file opens at its top, but coming back to a story finds it where it was", async () => {
  setupDemoWorld({ stories });
  preview("review:web#421", "changes");
  const { el, view, cx } = await draw(new StoryView());
  handlers(el).find((h) => h.id === "diff-one").fn({}, cx);
  try {
    const shownOf = (key) => { preview(key, "changes"); return listScroll(view.render(cx)); };
    const a = shownOf("review:web#421");
    shownOf("review:api#305");
    const back = shownOf("review:web#421");
    assert.equal(back.handle, a.handle);
    assert.deepEqual(calls(a.handle), ["scroll_to_item(0,top)"], "to the top when its file first showed, not again on coming back");
  } finally {
    handlers(view.render(cx)).find((h) => h.id === "diff-all").fn({}, cx); // put back: DIFF is the module's
  }
});
