// What the story's title row draws (stories.js Stories: headRow, headActions, reviewActions,
// pullActions), pinned as snapshots (tests/README.md, Snapshots): the main action for each state, Pause,
// the icons after the line, a review's header before and while its agent runs.
import { DEMO, FIXTURE, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, texts } from "gpui-kit";
import { byId, matchSnapshot, render } from "../lib/snapshot.mjs";
import { Stories, StoryList } from "../../mods/kelpie/stories.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";

const snap = (name, el) => matchSnapshot(name, render(el, skinTheme()));
let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

// The header with the story's space shown (`space`), or a story previewed from the list (`preview`).
async function header({ space = null, preview = null, view = null, shared = {}, ...opts } = {}) {
  setupDemoWorld({ stories, shown: space, ...opts });
  if (preview) mock.state.shared.set("kelpie.stories.preview", { [DEMO]: preview });
  const id = mock.state.spaces.find((s) => s.name === space)?.id ?? `preview:${DEMO}`;
  if (view) mock.state.shared.set("kelpie.view", { [id]: view });
  for (const [k, v] of Object.entries(shared)) mock.state.shared.set(k, v);
  return draw(new Stories());
}
const mainAction = (el) => texts(byId(el, "story-main") ?? byId(el, "story-peek") ?? byId(el, "review-start") ?? byId(el, "story-ask-fix") ?? byId(el, "story-ask-comments") ?? byId(el, "story-ask-merge") ?? []);

const CASES = [
  ["needs-you", { space: "ACME-142" }, "Peek"],
  ["failing", { space: "ACME-151" }, "Fix checks"],
  ["changes", { space: "ACME-160" }, "Address comments"],
  ["ready", { space: "ACME-171" }, "Merge"],
  ["working", { space: "ACME-175", view: "changes" }, "Show agent"],
  ["paused", { preview: "ACME-138" }, "Resume"],
  ["not-open", { preview: "ACME-180" }, "Start work"],
  ["finished", { space: "ACME-122" }, null],
];
for (const [name, opts, main, todo] of CASES) {
  test(`header: ${name}`, { todo }, async () => {
    const { el } = await header(opts);
    if (main) assert.deepEqual(mainAction(el), [main]);
    snap(`header/${name}`, el);
  });
}

test("header: folded, and its More menu open", async () => {
  const { el, view, cx } = await header({ preview: "ACME-138", shared: { "kelpie.storyhead.folded": true } });
  assert.ok(byId(el, "story-more-more"), "a More menu");
  view.menu = "story-more";
  snap("header/more-open", view.render(cx));
  const folded = await header({ space: "ACME-142", shared: { "kelpie.storyhead.folded": true } });
  snap("header/folded", folded.el);
});

// A review: Start review; once its agent runs in the Reviews space, Show review and the three
// decisions, each asking for a second click.
const REVIEWS = [...FIXTURE.spaces, { name: "Reviews", tabs: [{ name: "PR web#421", agent: "idle", title: "Review web#421" }] }];
test("header: a review, before and while its agent runs", async () => {
  const before = await header({ preview: "review:web#421" });
  assert.deepEqual(mainAction(before.el), ["Start review"]);
  snap("header/review", before.el);
  const { el, view, cx } = await header({ preview: "review:web#421", spaces: REVIEWS });
  assert.deepEqual(mainAction(el), ["Show review"]);
  snap("header/review-agent", el);
  handlers(el).find((h) => h.id === "review-approve").fn({}, cx);
  assert.deepEqual(texts(byId(view.render(cx), "review-approve")), ["Confirm approve"]);
});

test("header: a pull request of yours with no ticket", async () => {
  snap("header/pull-no-ticket", (await header({ preview: "pull:docs#58" })).el);
});

test("Kelpie-Plain: the header of a story whose agent needs you", async () => {
  snap("plain/header/needs-you", (await header({ space: "ACME-142", layout: "Kelpie-Plain" })).el);
});

// One tab with no agent: "A tab with no agent closes too".
test("header: Pause's tip about one tab with no agent", async () => {
  const { el } = await header({ space: "ACME-142" });
  assert.match(byId(el, "story-pause") && render(byId(el, "story-pause"), skinTheme()), /A tab with no agent closes too/);
});
