// What the story's title row draws (stories.js Stories: headRow, headActions, reviewActions,
// pullActions), pinned as snapshots (tests/README.md, Snapshots): the main action for each state, Pause,
// the icons after the line, a review's header before and while its agent runs.
import { DEMO, FIXTURE, demoProfile, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, texts } from "gpui-kit";
import { byId, matchSnapshot, render } from "../lib/snapshot.mjs";
import { Stories, StoryList } from "../../mods/kelpie/stories.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";
import { demoPulls } from "../../mods/kelpie/demo.js";

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
const mainAction = (el) => texts(byId(el, "story-main") ?? byId(el, "story-peek") ?? byId(el, "review-start") ?? byId(el, "story-ask-fix") ?? byId(el, "story-ask-comments") ?? byId(el, "story-ask-merge") ?? byId(el, "story-merge-all") ?? []);

const CASES = [
  ["needs-you", { space: "ACME-142" }, "Peek"],
  ["failing", { space: "ACME-151" }, "Fix checks"],
  ["changes", { space: "ACME-160" }, "Address comments"],
  // Its approved pull requests are two tickets': Merge all, the Merge menu (point.test.mjs).
  ["ready", { space: "ACME-171" }, "Merge all ▾"],
  ["working", { space: "ACME-175", view: "changes" }, "Show agent"],
  ["paused", { preview: "ACME-138" }, "Resume"],
  ["not-open", { preview: "ACME-180" }, "Start work"],
  ["finished", { space: "ACME-122" }, null],
  // Done and cleaned up (no space): previewed from the sidebar's Done group.
  ["done", { preview: "ACME-118" }, null],
];
for (const [name, opts, main, todo] of CASES) {
  test(`header: ${name}`, { todo }, async () => {
    const { el } = await header(opts);
    if (main) assert.deepEqual(mainAction(el), [main]);
    snap(`header/${name}`, el);
  });
}

// A done story out of the list has nothing to start as its main action; More still starts one afresh.
test("header: a done story offers a fresh start only under More", async () => {
  const { el, view, cx } = await header({ preview: "ACME-118" });
  assert.equal(byId(el, "story-main"), null, "no filled Start work");
  view.menu = "story-more";
  assert.ok(texts(view.render(cx)).includes("Start fresh"));
});

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
  assert.deepEqual(texts(byId(view.render(cx), "review-approve")), ["Confirm approve with comments"]);
});

// Approving yourself: in the header with or without an agent, a second click approves it on GitHub
// (the demo's, kept in memory) and notes it; nothing is sent to an agent.
test("header: approve a review yourself", async () => {
  const before = await header({ preview: "review:web#421" });
  assert.deepEqual(texts(byId(before.el, "review-approve-self")), ["Approve"]);
  const { el, view, cx } = await header({ preview: "review:web#421", spaces: REVIEWS });
  const click = (root) => handlers(root).find((h) => h.id === "review-approve-self").fn({}, cx);
  click(el);
  const armed = view.render(cx);
  assert.deepEqual(texts(byId(armed, "review-approve-self")), ["Confirm approve"]);
  click(armed);
  // While GitHub answers: Approving…, a spinner, nothing to click.
  const waiting = byId(view.render(cx), "review-approve-self");
  assert.deepEqual(texts(waiting), ["Approving…"]);
  assert.match(render(waiting, skinTheme()), /chrome:spinner/);
  assert.deepEqual(handlers(waiting), []);
  await cx.settle();
  assert.equal(mock.sharedValue("kelpie.stories.note")?.text, "Approved web#421 on GitHub.");
  assert.deepEqual(mock.of("hc"), [], "nothing sent to an agent");
  const pr = (await demoPulls("review-requested:@me")).find((p) => p.number === 421);
  assert.equal(pr.reviewDecision, "APPROVED");
  // Then the button is Approved, with the approved mark, and nothing to click.
  const done = byId(view.render(cx), "review-approve-self");
  assert.deepEqual(texts(done), ["Approved"]);
  assert.deepEqual(handlers(done), []);
  snap("header/review-approved", done);
});

// Approved from GitHub's word alone (your latest review, viewerReview), as after a restart: the
// stories loaded again, and nothing noted by Kelpie.
test("header: a review you approved elsewhere says Approved", async () => {
  const fresh = await loadStories(StoryList);
  const { el } = await header({ preview: "review:web#421", stories: fresh, shared: { "kelpie.approved": {} } });
  assert.deepEqual(texts(byId(el, "review-approve-self")), ["Approved"]);
});

// A careful button armed on one review isn't armed on the next one shown (every header has the
// same ids), and a timer disarms it after 5 s, redrawing, even when nothing else changes.
test("header: Confirm approve is dropped on another review, and after 5 s", async () => {
  const { el, view, cx } = await header({ preview: "review:api#305" });
  const timers = [];
  cx.timer = { every() {}, after: (ms, fn) => timers.push({ ms, fn }) };
  handlers(el).find((h) => h.id === "review-approve-self").fn({}, cx);
  assert.deepEqual(texts(byId(view.render(cx), "review-approve-self")), ["Confirm approve"]);
  mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "review:web#421" });
  assert.deepEqual(texts(byId(view.render(cx), "review-approve-self")), ["Approve"], "another review: not armed");
  mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "review:api#305" });
  assert.deepEqual(texts(byId(view.render(cx), "review-approve-self")), ["Confirm approve"], "still armed for the first within 5 s");
  assert.deepEqual(timers.map((x) => x.ms), [5000]);
  const before = cx.notified;
  timers[0].fn(cx);
  assert.equal(cx.notified, before + 1, "the timer redraws");
  assert.deepEqual(texts(byId(view.render(cx), "review-approve-self")), ["Approve"], "disarmed after 5 s");
});

test("header: a pull request of yours with no ticket", async () => {
  snap("header/pull-no-ticket", (await header({ preview: "pull:docs#58" })).el);
});

// Working alone (#75), nobody can approve: no Request approval, a story's or a lone pull request's.
test("header: working alone, no Request approval", async () => {
  const alone = { jira: { ...demoProfile().jira, solo: true } };
  assert.ok(byId((await header({ space: "ACME-160" })).el, "story-approval-more"), "a team's story offers it");
  assert.equal(byId((await header({ space: "ACME-160", profile: alone })).el, "story-approval-more"), null);
  // docs#58 waiting on reviewers, nothing else to do: a team's header offers Request approval.
  const waiting = { ...stories, data: { ...stories.data, prs: stories.data.prs.map((p) => (/docs/.test(p.repository?.nameWithOwner ?? p.url ?? "") && p.number === 58 ? { ...p, isDraft: false, reviewDecision: "REVIEW_REQUIRED" } : p)) } };
  const prev = stories;
  stories = waiting;
  try {
    assert.ok(byId((await header({ preview: "pull:docs#58" })).el, "pull-approval"), "a team's lone pull request offers it");
    assert.equal(byId((await header({ preview: "pull:docs#58", profile: alone })).el, "pull-approval"), null);
  } finally { stories = prev; }
});

test("Kelpie-Plain: the header of a story whose agent needs you", async () => {
  snap("plain/header/needs-you", (await header({ space: "ACME-142", layout: "Kelpie-Plain" })).el);
});

// One tab with no agent: "A tab with no agent closes too".
test("header: Pause's tip about one tab with no agent", async () => {
  const { el } = await header({ space: "ACME-142" });
  assert.match(byId(el, "story-pause") && render(byId(el, "story-pause"), skinTheme()), /A tab with no agent closes too/);
});
