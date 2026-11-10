// What the story's details draw under the title row (stories.js StoryBody: detail, description,
// fits()), pinned as snapshots (tests/README.md, Snapshots): the description folded with Show more and
// opened, the subtasks with their actions, a subtask's own description, and the fade shown only while
// the details are taller than their block.
import { DEMO, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, texts } from "gpui-kit";
import { byId, matchSnapshot, render } from "../lib/snapshot.mjs";
import { StoryBody, StoryList } from "../../mods/kelpie/stories.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";

const snap = (name, el) => matchSnapshot(name, render(el, skinTheme()));
let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

async function body({ space = null, preview = null, layout = "Kelpie" } = {}) {
  setupDemoWorld({ stories, shown: space, layout });
  if (preview) mock.state.shared.set("kelpie.stories.preview", { [DEMO]: preview });
  return draw(new StoryBody());
}
const press = (el, id, cx) => handlers(el).find((h) => h.id === id).fn({}, cx);

for (const layout of ["Kelpie", "Kelpie-Plain"]) {
  test(`${layout}: a story's details, its description folded`, async () => {
    const { el } = await body({ space: "ACME-142", layout });
    assert.deepEqual(texts(byId(el, "story-desc-more")), ["Show more"]);
    snap(`${layout === "Kelpie" ? "body" : "plain/body"}/story`, el);
  });
}

test("Show more opens the description, and a subtask's title its own", async () => {
  const { el, view, cx } = await body({ preview: "ACME-142" });
  press(el, "story-desc-more", cx);
  press(el, "sub-title-ACME-143", cx);
  view.render(cx);
  await cx.settle();
  const open = view.render(cx);
  assert.deepEqual(texts(byId(open, "story-desc-more")), ["Show less"]);
  assert.ok(byId(open, "sub-desc-ACME-143-body"), "the subtask's description shows under it");
  snap("body/opened", open);
  // Put back: these are kept per story key for every copy in this process.
  press(open, "story-desc-more", cx);
  press(open, "sub-title-ACME-143", cx);
});

test("the fade shows only while the details are taller than their block", async () => {
  const { el, view, cx } = await body({ preview: "ACME-180" });
  const size = (id, height) => handlers(el, "on_size_change").find((h) => h.id === id).fn({ width: 600, height }, cx);
  const fade = (x) => render(byId(x, "story-overview-view"), skinTheme()).split("\n").filter((l) => /^  \S/.test(l));
  size("story-overview-view", 300);
  size("story-overview-content", 200);
  const fits = view.render(cx);
  assert.equal(fade(fits).length, 1, "only the details, no fade");
  size("story-overview-content", 900);
  const over = view.render(cx);
  assert.equal(fade(over).length, 2, "the details and the fade over their edge");
  snap("body/fade", byId(over, "story-overview-view"));
});

test("a review's details", async () => {
  snap("body/review", (await body({ preview: "review:web#421" })).el);
});
