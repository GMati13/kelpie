// What the sidebar draws (stories.js StoryList, desk.js deskRows), pinned as snapshots
// (tests/README.md, Snapshots): the demo's stories in every state, reviews, the "No ticket" pull
// requests, the Desk, and Next with and without Claude's picks.
import { NOW, DEMO, FIXTURE, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { byId, matchSnapshot, render } from "../lib/snapshot.mjs";
import { StoryList } from "../../mods/kelpie/stories.js";
import { deskRows } from "../../mods/kelpie/desk.js";
import { profileById } from "../../mods/kelpie/config.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";
import { handlers, nodeOf } from "gpui-kit";
import { mock } from "herdr";

const snap = (name, el) => matchSnapshot(name, render(el, skinTheme()));
let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

// Claude's picks as applyPicks() keeps them (stories.js): a story, someone's pull request, an idea.
const PICKS = { [DEMO]: { at: NOW - 20 * 60e3, items: [
  { key: "ACME-180", title: "Export an itinerary as PDF", action: FIXTURE.suggest[0].action, why: FIXTURE.suggest[0].why, url: "https://jira.example.com/browse/ACME-180", from: "ACME-181" },
  { key: "pr:web#421", title: "", action: FIXTURE.suggest[1].action, why: FIXTURE.suggest[1].why, url: FIXTURE.suggest[1].url },
  { key: "idea:2", idea: FIXTURE.suggest[2].idea, where: "web", title: "", action: FIXTURE.suggest[2].action, why: FIXTURE.suggest[2].why, url: "" },
] } };

const list = async (opts = {}) => {
  setupDemoWorld({ stories, ...opts });
  return (await draw(new StoryList())).el;
};

for (const layout of ["Kelpie", "Kelpie-Plain"]) {
  const dir = layout === "Kelpie" ? "sidebar" : "plain/sidebar";
  // Every state the demo has at once: needs you (ACME-142), failing checks (151), changes requested
  // (160), ready to merge (171), working (175), finished with a space (122, the broom), paused (138),
  // not open (180), waiting on others (129); the reviews, your pull requests by story and "No ticket",
  // the Desk with its agent, Next without picks.
  test(`${layout}: the story list in every state`, async () => {
    snap(`${dir}/list`, await list({ layout }));
  });
}

test("a finished story whose agent is working has no broom", async () => {
  const el = await list({ agentOf: (space, _tab, a) => (space === "ACME-122" ? { ...a, status: "working" } : a) });
  const row = byId(el, "story-ACME-122");
  assert.ok(row, "the row is drawn");
  assert.equal(byId(row, "clean-ACME-122"), null, "no broom while its agent works");
  assert.equal(byId(el, "stories-clean-all"), null, "nor Clean up all");
  snap("sidebar/row-finished-busy", row);
});

test("Next with Claude's picks, and the queue opened", async () => {
  setupDemoWorld({ stories });
  putShared("kelpie.next.suggested", PICKS);
  const { el, view, cx } = await draw(new StoryList());
  snap("sidebar/next-picks", byId(el, "story-next"));
  view.queueOpen = true;
  const open = view.render(cx);
  snap("sidebar/queue-open", head(open));
});

test("Next while Claude is brewing", async () => {
  setupDemoWorld({ stories });
  putShared("kelpie.next.brewing", { [DEMO]: NOW - 30e3 });
  snap("sidebar/next-brewing", head((await draw(new StoryList())).el));
});

test("Next with the Desk's agent asking, nothing else", async () => {
  setupDemoWorld({ stories: quiet(stories), spaces: FIXTURE.spaces.filter((s) => s.name === "Desk"), paused: {},
    agentOf: (_s, _t, a) => ({ ...a, status: "blocked" }) });
  snap("sidebar/next-desk", head(await sharedCopy()));
});

test("all clear: nothing in the queue", async () => {
  setupDemoWorld({ stories: quiet(stories), spaces: [], paused: {} });
  snap("sidebar/all-clear", head(await sharedCopy()));
});

test("the Desk closed, and open without an agent", async () => {
  setupDemoWorld({ stories, spaces: [] });
  const t = skinTheme();
  snap("sidebar/desk-closed", deskRows(t, {}, profileById(DEMO)));
  setupDemoWorld({ stories, spaces: [{ name: "Desk", tabs: [{ name: "Terminal", agent: null }] }] });
  snap("sidebar/desk-no-agent", deskRows(t, {}, profileById(DEMO)));
});

// The top of the list (its root's first child): the freshness line, the counts and Next.
const head = (el) => nodeOf(el).calls.find(([m]) => m === "child")[1][0];
const putShared = (key, value) => mock.state.shared.set(key, JSON.parse(JSON.stringify(value)));
// A copy of the list that only reads the shared stories, as every copy but the loader does: the
// loader keeps what it loaded in the module (and would load the whole fixture again), so a test that
// shares other data draws it with this.
const sharedCopy = async () => (await draw(new StoryList(), { init: () => {} })).el;
// The stories with no pull requests or reviews: nothing of GitHub's needs you.
const quiet = (e) => ({ ...e, data: { ...e.data, prs: [], reviews: [] } });

// A pick of a pull request already waiting for your review ("pr:web#421", the demo's own pick) drops
// out: the review is in the queue already ("review:web#421").
test("a pick of a review already in the queue drops out", async () => {
  setupDemoWorld({ stories });
  putShared("kelpie.next.suggested", PICKS);
  const { view, cx } = await draw(new StoryList());
  view.queueOpen = true;
  const open = view.render(cx);
  assert.ok(byId(open, "queue-review:web#421"), "the review is queued");
  assert.equal(byId(open, "queue-suggest:pr:web#421"), null, "and not again as a pick");
});

// The open queue lights the item shown, the one just clicked, not Next's (the one after it): lighting
// Next's lit the row under the one clicked. Nothing shown, nothing lit.
test("the open queue lights the item shown, not the one after it", async () => {
  const lit = (el, id) => render(byId(el, id), skinTheme()).split("\n")[0].includes("bg=selected");
  const queue = async (preview) => {
    setupDemoWorld({ stories });
    if (preview) putShared("kelpie.stories.preview", { [DEMO]: preview });
    const { view, cx } = await draw(new StoryList());
    view.queueOpen = true;
    return view.render(cx);
  };
  let open = await queue("ACME-160");
  assert.ok(lit(open, "queue-ACME-160"), "the story shown is lit");
  assert.ok(!lit(open, "queue-ACME-151"), "the one after it isn't");
  open = await queue("review:web#421");
  assert.ok(lit(open, "queue-review:web#421"), "a review shown is lit");
  assert.ok(!lit(open, "queue-review:api#305"), "the next review isn't");
  open = await queue(null);
  assert.ok(!lit(open, "queue-ACME-142"), "nothing shown: Next's first item isn't lit");
});

// A story with many pull requests folds by its heading's chevron: its rows go, the heading says how
// many and the most urgent state, and it stays folded per profile.
test("a story's pull requests fold under its heading", async () => {
  setupDemoWorld({ stories });
  const { el, view, cx } = await draw(new StoryList());
  assert.ok(byId(el, "mine-web#418") && byId(el, "mine-docs#61"), "ACME-142's pull requests show");
  assert.equal(byId(el, "mine-story-sum-ACME-142"), null, "no summary while open");
  const click = handlers(el).find((h) => h.id === "mine-story-fold-ACME-142");
  click.fn({}, { ...cx, stop_propagation() {} });
  assert.deepEqual(mock.state.shared.get("kelpie.pulls.folded"), { [DEMO]: { "mine-story:ACME-142": true } });
  const shut = view.render(cx);
  assert.equal(byId(shut, "mine-web#418"), null, "its rows are gone");
  assert.equal(byId(shut, "mine-docs#61"), null);
  assert.ok(byId(shut, "mine-web#423"), "other stories' stay");
  const sum = byId(shut, "mine-story-sum-ACME-142");
  assert.ok(sum, "the heading says what's folded");
  assert.match(nodeOf(sum).calls.find(([m]) => m === "tooltip")[1][0], /web#418: .*\ndocs#61: /);
  handlers(shut).find((h) => h.id === "mine-story-fold-ACME-142").fn({}, { ...cx, stop_propagation() {} });
  assert.deepEqual(mock.state.shared.get("kelpie.pulls.folded"), { [DEMO]: {} });
  assert.ok(byId(view.render(cx), "mine-web#418"), "unfolded again");
});
