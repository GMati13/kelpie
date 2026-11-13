// What the sidebar draws (stories.js StoryList, desk.js deskRows), pinned as snapshots
// (tests/README.md, Snapshots): the demo's stories in every state, reviews, the "No ticket" pull
// requests, the Desk, and Next with and without Claude's picks.
import { NOW, DEMO, FIXTURE, demoProfile, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { byId, matchSnapshot, render } from "../lib/snapshot.mjs";
import { StoryList } from "../../mods/kelpie/stories.js";
import { deskRows } from "../../mods/kelpie/desk.js";
import { profileById } from "../../mods/kelpie/config.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";
import { handlers, nodeOf, texts } from "gpui-kit";
import { v_flex } from "gpui-base";
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
  // not open (180), waiting on others (129), done and cleaned up (118, the folded Done group); the
  // reviews, your pull requests by story and "No ticket", the Desk with its agent, Next without picks.
  test(`${layout}: the story list in every state`, async () => {
    snap(`${dir}/list`, await list({ layout }));
  });
}

// Working alone: the stories past your part are under "Built", not "Waiting on others".
test("the story list of someone who works alone", async () => {
  // Kelpie-Plain: Quiet Pages sets group headings in capitals.
  const el = await list({ layout: "Kelpie-Plain", profile: { jira: { ...demoProfile().jira, solo: true } } });
  const words = texts(el);
  assert.ok(words.includes("Built"), "built, nobody else to wait on");
  assert.ok(!words.includes("Waiting on others"), "nobody else to wait on");
});

// Working alone (#75): nobody on the team asks for reviews or approves, and a story's own pull
// requests are on the story, so the pull request groups keep only what shows nowhere else.
test("working alone: Reviews for you shows only with a review asked for", async () => {
  const alone = { jira: { ...demoProfile().jira, solo: true } };
  const asked = await list({ profile: alone });
  assert.ok(byId(asked, "review-web#421"), "a review someone asked for still shows");
  const none = { ...stories, data: { ...stories.data, reviews: [] } };
  setupDemoWorld({ stories: none, profile: alone });
  const el = await sharedCopy();
  assert.ok(!texts(el).some((x) => /reviews for you/i.test(x)), "no empty group");
  setupDemoWorld({ stories: none });
  assert.ok(texts(await sharedCopy()).includes("Nothing waiting for your review."), "a team's still says so");
});

// KELPIE-85: Your pull requests is the same for everyone: only the ones on no story of the list, as a
// story's own are on the story (its row and header carry Merge and Request approval).
for (const [who, profile] of [["a team", {}], ["working alone", { jira: { ...demoProfile().jira, solo: true } }]]) {
  test(`${who}: Your pull requests holds only the ones on no story`, async () => {
    const el = await list({ profile });
    assert.ok(byId(el, "mine-docs#58"), "a pull request naming no ticket stays");
    assert.equal(byId(el, "mine-web#418"), null, "ACME-142's is on its story");
    assert.equal(byId(el, "mine-web#423"), null, "ACME-175's too");
    assert.equal(byId(el, "mine-story-ACME-142"), null, "no story headings");
    assert.ok(byId(el, "merge-wrap-none"), "the Desk's Merge stays with the ones naming no ticket");
  });
}

test("working alone: no Request approval anywhere in the list", async () => {
  const alone = { jira: { ...demoProfile().jira, solo: true } };
  const { el, view, cx } = await draw((setupDemoWorld({ stories, profile: alone }), new StoryList()));
  assert.equal(byId(el, "approval-wrap-none"), null, "nobody to ask for an approval");
  handlers(el, "on_hover").find((h) => h.id === "story-ACME-142").fn(true, cx);
  const over = view.render(cx);
  assert.ok(byId(over, "merge-ACME-142-more"), "Merge shows on the row hovered");
  assert.ok(!handlers(over).some((h) => /^approval-/.test(h.id)), "no Request approval menu at all");
  setupDemoWorld({ stories });
  const team = await draw(new StoryList());
  handlers(team.el, "on_hover").find((h) => h.id === "story-ACME-142").fn(true, team.cx);
  assert.ok(byId(team.view.render(team.cx), "approval-ACME-142-more"), "and on a story's row hovered");
});

// KELPIE-85: working alone lost the one-click Merge with the story headings under Your pull requests.
// A story with pull requests ready to merge (ACME-171) offers Merge on its row at rest, in every mode,
// and its menu starts the merge agent in one more click.
for (const [who, profile] of [["a team", {}], ["working alone", { jira: { ...demoProfile().jira, solo: true } }]]) {
  test(`${who}: a story ready to merge offers Merge on its row`, async () => {
    const { el, view, cx } = await draw((setupDemoWorld({ stories, profile }), new StoryList()));
    const row = byId(el, "story-ACME-171");
    assert.ok(byId(row, "merge-ACME-171-more"), "Merge at rest, without opening the story");
    assert.equal(byId(byId(el, "story-ACME-142"), "merge-ACME-142-more"), null, "not on a row with nothing ready, at rest");
    handlers(el).find((h) => h.id === "merge-ACME-171-more").fn({}, cx);
    const open = view.render(cx);
    assert.ok(texts(byId(open, "merge-ACME-171-menu-list")).includes("New agent"), "its menu starts the merge agent");
  });
}

test("working alone with no pull request off a story: no Your pull requests", async () => {
  const onStories = { ...stories, data: { ...stories.data, prs: stories.data.prs.filter((p) => !/docs#58|docs\/pull\/58/.test(p.url ?? "")) } };
  setupDemoWorld({ stories: onStories, profile: { jira: { ...demoProfile().jira, solo: true } } });
  const el = await sharedCopy();
  assert.ok(!texts(el).some((x) => /your pull requests/i.test(x)));
});

test("a finished story whose agent is working has no broom", async () => {
  // Without ACME-116's paused session and ACME-190's space (reassigned), which leave them to clean up too.
  const el = await list({ paused: { "ACME-138": FIXTURE.paused["ACME-138"] }, spaces: FIXTURE.spaces.filter((s) => s.name !== "ACME-190"), agentOf: (space, _tab, a) => (space === "ACME-122" ? { ...a, status: "working" } : a) });
  const row = byId(el, "story-ACME-122");
  assert.ok(row, "the row is drawn");
  assert.equal(byId(row, "clean-ACME-122"), null, "no broom while its agent works");
  assert.equal(byId(el, "stories-clean-all"), null, "nor Clean up all");
  snap("sidebar/row-finished-busy", row);
});

// KELPIE-43: a finished story whose space is closed, with only a ticket folder left, used to drop out
// of the list before the leftovers check looked at it, so it never got a broom.
test("a finished story with only leftovers left is checked, listed and gets its broom", async () => {
  setupDemoWorld({ stories, spaces: FIXTURE.spaces.filter((s) => s.name !== "ACME-122"), profile: { commands: { cleanUp: "rm -rf worktrees/{key}" } } });
  const asked = [];
  const home = mock.on.exec;
  mock.on.exec = (cmd, args) => {
    const script = String(args?.[1] ?? "");
    if (cmd === "sh" && script.includes("for k; do")) { asked.push(...args.slice(4)); return { code: 0, stdout: args.includes("ACME-123") ? "ACME-123\n" : "", stderr: "" }; }
    return home(cmd, args);
  };
  await draw(new StoryList());
  // The check runs on after the render (the clock is pinned here, so until() couldn't time out).
  const found = () => mock.sharedValue("kelpie.clean.leftovers")?.[DEMO]?.found?.["ACME-122"];
  for (let i = 0; i < 50 && !found(); i++) await new Promise((r) => setImmediate(r));
  assert.ok(found(), "the leftovers check found its folder");
  assert.ok(asked.includes("ACME-123"), "the check looked under its subtask's key");
  const el = (await draw(new StoryList())).el;
  assert.ok(byId(byId(el, "story-ACME-122"), "clean-ACME-122"), "its row has the broom");
  assert.ok(byId(el, "stories-clean-all"), "and Clean up all shows");
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

// The top of the list: the freshness line and the counts (its root's first child, pinned), then Next
// (the list's first item, as it scrolls with the list, #125), drawn together.
// Both are already in the list, and the stub refuses an element in a second parent as Herdr does, so
// they're recorded as the box's children without being put in it (the snapshot reads the same).
const head = (el) => {
  const box = v_flex();
  nodeOf(box).calls.push(["child", [nodeOf(el).calls.find(([m]) => m === "child")[1][0]]], ["child", [byId(el, "story-next-wrap")]]);
  return box;
};
const putShared = (key, value) => mock.state.shared.set(key, JSON.parse(JSON.stringify(value)));
// A copy of the list that only reads the shared stories, as every copy but the loader does: the
// loader keeps what it loaded in the module (and would load the whole fixture again), so a test that
// shares other data draws it with this.
const sharedCopy = async () => (await draw(new StoryList(), { init: () => {} })).el;
const sharedDraw = () => draw(new StoryList(), { init: () => {} });
// The stories with no pull requests or reviews: nothing of GitHub's needs you.
const quiet = (e) => ({ ...e, data: { ...e.data, prs: [], reviews: [] } });

// Next is one card: unfolded, the whole queue is inside its border, nothing copied on top, and
// Claude's picks are the card's last group.
test("unfolded, the queue is inside Next's card", async () => {
  setupDemoWorld({ stories });
  putShared("kelpie.next.suggested", PICKS);
  const { view, cx } = await draw(new StoryList());
  view.queueOpen = true;
  const card = byId(view.render(cx), "story-next");
  assert.equal(byId(card, "queue-next"), null, "no copy of the next item on top");
  assert.ok(byId(card, "queue-ACME-142"), "the item Next goes to, in its place");
  assert.ok(byId(card, "queue-review:web#421"), "reviews are in the card");
  assert.ok(byId(byId(card, "queue-suggested"), "queue-suggest:ACME-180"), "and Claude's picks, its last group");
  view.queueOpen = false;
  const folded = byId(view.render(cx), "story-next");
  assert.match(render(byId(folded, "queue-next"), skinTheme()), /ACME-142/, "folded, the one item it goes to");
  assert.equal(byId(folded, "queue-ACME-160"), null);
});

// Folded, Next leads with the most urgent item, never a pick of Claude's in front of it (#87): with
// that story shown, it says you're on it and names what ⌘⇧J goes to in a smaller line under it.
test("folded, Next leads with what needs you, even while it's shown", async () => {
  // One story that needs you (its checks fail), then Claude's picks: no reviews, spaces or asks.
  const failing = stories.data.prs.filter((p) => /ACME-152/.test(p.title) && !p.merged);
  assert.ok(failing.length, "the demo has ACME-151's failing pull request (its subtask ACME-152's)");
  setupDemoWorld({ stories: { ...stories, data: { ...stories.data, prs: failing, reviews: [] } }, spaces: [], paused: {} });
  mock.state.shared.set("kelpie.next.asks", {});
  putShared("kelpie.next.suggested", PICKS);
  const card = async () => byId((await sharedDraw()).el, "story-next");
  let el = await card();
  assert.match(render(byId(el, "queue-next"), skinTheme()), /ACME-151/, "nothing shown: the urgent story");
  putShared("kelpie.stories.preview", { [DEMO]: "ACME-151" });
  el = await card();
  const lead = render(byId(el, "queue-next"), skinTheme());
  assert.match(lead, /ACME-151/, "shown: still the urgent story, not the pick after it");
  assert.match(lead, /You're on it/, "saying it's the one on screen");
  const then = byId(el, "queue-then");
  assert.ok(then, "what ⌘⇧J goes to, in a line of its own");
  assert.match(render(then, skinTheme()), /ACME-180|itinerary/, "Claude's first pick");
  assert.doesNotMatch(render(el, skinTheme()).split("\n")[0], /accent/, "the card isn't tinted as a pick");
  snap("sidebar/next-on-it", el);
});

// The header counts the queue, as every group counts: a position there ("3 of 3") disagreed with the
// lit row (where you are). With one group, it has no label of its own.
test("Next's header counts the queue; a lone group has no label", async () => {
  // Only stories that need you: no reviews, spaces (so no agents or clean-up), asks or picks.
  setupDemoWorld({ stories: { ...stories, data: { ...stories.data, reviews: [] } }, spaces: [], paused: {} });
  mock.state.shared.set("kelpie.next.asks", {});
  const { view, cx } = await sharedDraw();
  view.queueOpen = true;
  const card = byId(view.render(cx), "story-next");
  const text = render(card, skinTheme());
  const rows = text.match(/#queue-ACME-\d+ /g) ?? [];
  assert.ok(rows.length > 1, "several stories queued");
  assert.doesNotMatch(text, / of \d/, "no position in the header");
  assert.match(text, new RegExp(`"Next"\\n\\s+div \\[fg=muted\\]\\n\\s+"${rows.length}"`), "the header says how many");
  assert.doesNotMatch(text, /"Needs you"/, "no label for the only group");
});

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

// A group of pull requests folds by its heading's chevron (the "No ticket" one under Your pull
// requests): its rows go, the heading says how many and the most urgent state, and it stays folded
// per profile.
test("a heading's pull requests fold under it", async () => {
  setupDemoWorld({ stories });
  const { el, view, cx } = await draw(new StoryList());
  assert.ok(byId(el, "mine-docs#58"), "the pull requests naming no ticket show");
  assert.equal(byId(el, "mine-story-sum-none"), null, "no summary while open");
  const click = handlers(el).find((h) => h.id === "mine-story-fold-none");
  click.fn({}, { ...cx, stop_propagation() {} });
  assert.deepEqual(mock.state.shared.get("kelpie.pulls.folded"), { [DEMO]: { "mine-story:none": true } });
  const shut = view.render(cx);
  assert.equal(byId(shut, "mine-docs#58"), null, "its rows are gone");
  const sum = byId(shut, "mine-story-sum-none");
  assert.ok(sum, "the heading says what's folded");
  assert.match(nodeOf(sum).calls.find(([m]) => m === "tooltip")[1][0], /docs#58: /);
  handlers(shut).find((h) => h.id === "mine-story-fold-none").fn({}, { ...cx, stop_propagation() {} });
  assert.deepEqual(mock.state.shared.get("kelpie.pulls.folded"), { [DEMO]: {} });
  assert.ok(byId(view.render(cx), "mine-docs#58"), "unfolded again");
});

// A finished story cleaned up (done, no space, nothing open: ACME-118) stays reachable in the Done
// group, last and folded: its chevron unfolds it per profile, a click on its row previews it, and a
// done story shown keeps its row while the group is folded.
test("finished stories stay in a folded Done group", async () => {
  setupDemoWorld({ stories });
  const { el, view, cx } = await draw(new StoryList());
  assert.equal(byId(el, "story-ACME-118"), null, "not among the stories in play");
  assert.ok(byId(el, "stories-done"), "the Done group's heading");
  assert.equal(byId(el, "done-ACME-118"), null, "folded at first");
  handlers(el).find((h) => h.id === "stories-done").fn({}, cx);
  assert.deepEqual(mock.state.shared.get("kelpie.done.open"), { [DEMO]: true });
  const open = view.render(cx);
  const row = byId(open, "done-ACME-118");
  assert.ok(row, "its row shows once unfolded");
  snap("sidebar/done-row", row);
  handlers(row).find((h) => h.id === "done-ACME-118").fn({}, cx);
  assert.equal(mock.state.shared.get("kelpie.stories.preview")[DEMO], "ACME-118", "a click previews it");
  handlers(open).find((h) => h.id === "stories-done").fn({}, cx);
  assert.deepEqual(mock.state.shared.get("kelpie.done.open"), {});
  const shut = view.render(cx);
  assert.ok(byId(shut, "done-ACME-118"), "folded, the story shown keeps its row");
  assert.equal(byId(shut, "story-ACME-118"), null);
});

// KELPIE-43: a finished story that still leaves something to clean up (ACME-116: no space, its
// subtask's session paused) isn't settled: it stays among the stories, with its broom, not in Done.
test("a finished story with a paused session left stays listed with its broom, not in Done", async () => {
  setupDemoWorld({ stories, props: {} });
  putShared("kelpie.done.open", { [DEMO]: true });
  const { el } = await draw(new StoryList());
  assert.ok(byId(byId(el, "story-ACME-116"), "clean-ACME-116"), "listed, with its broom");
  assert.equal(byId(el, "done-ACME-116"), null, "not in the Done group");
  assert.ok(byId(el, "done-ACME-118"), "a story with nothing left still is");
});

// A profile with no board yet: the list asks for one, Jira or a GitHub Project, naming neither as
// the only kind, and its button opens the profile dialog on the Board tab.
test("a profile with no board asks for one, whichever kind", async () => {
  setupDemoWorld({ profile: { jira: null, project: null } });
  const { el, cx } = await draw(new StoryList());
  const words = texts(el).join("\n");
  assert.match(words, /Connect a board to /);
  assert.match(words, /Jira or a GitHub Project/);
  handlers(el).find((h) => h.id === "setup-jira").fn({}, cx);
  assert.equal(mock.of("openOverlay").at(-1)[0].props.focus, "jira", "the Board tab");
});

// A queue of one (#64): unfolding it would only show that item again, so there's no chevron, and an
// open queue that drops to one item folds. A second item, a pick of Claude's too, brings it back.
test("Next has no chevron while its queue holds one item", async () => {
  const deskOnly = () => setupDemoWorld({ stories: quiet(stories), spaces: FIXTURE.spaces.filter((s) => s.name === "Desk"), paused: {},
    agentOf: (_s, _t, a) => ({ ...a, status: "blocked" }) });
  deskOnly();
  mock.state.shared.set("kelpie.next.asks", {});
  const { view, cx } = await sharedDraw();
  let card = byId(view.render(cx), "story-next");
  assert.ok(byId(card, "queue-next"), "the one item shows");
  assert.equal(byId(card, "story-queue"), null, "no chevron for a queue of one");
  view.queueOpen = true;
  card = byId(view.render(cx), "story-next");
  assert.ok(byId(card, "queue-next"), "an open queue of one is drawn folded");
  assert.equal(view.queueOpen, false, "and stays folded");
  putShared("kelpie.next.suggested", { [DEMO]: { at: NOW - 60e3, items: [PICKS[DEMO].items[2]] } });
  card = byId(view.render(cx), "story-next");
  assert.ok(byId(card, "story-queue"), "a second item, a pick, brings the chevron back");
});

// A pick (or an agent's ask) alone in the queue can still be dropped: folded, its row has the ✕ the
// open queue's rows have, as there's no open list to drop it from (#64).
test("a lone pick in Next can be dropped from the folded card", async () => {
  setupDemoWorld({ stories: quiet(stories), spaces: [], paused: {} });
  mock.state.shared.set("kelpie.next.asks", {});
  putShared("kelpie.next.suggested", { [DEMO]: { at: NOW - 60e3, items: [PICKS[DEMO].items[2]] } });
  const { view, cx } = await sharedDraw();
  const card = byId(view.render(cx), "story-next");
  assert.equal(byId(card, "story-queue"), null, "a queue of one");
  const drop = handlers(card).find((h) => h.id?.startsWith("queue-drop-"));
  assert.ok(drop, "the folded pick has its ✕");
  drop.fn({}, { stop_propagation() {}, notify() {} });
  assert.equal(mock.state.shared.get("kelpie.next.suggested")[DEMO].items.length, 0, "and the ✕ drops it");
});

// A long open queue (#125): pinned above the list, Next's card took the sidebar's whole height,
// left the list none and couldn't scroll itself, so its lower rows and every story were out of reach.
// It's now the list's first item, scrolling with it; the freshness line and the counts stay pinned,
// and opening the queue brings the card's top into view.
test("a long open queue scrolls with the story list", async () => {
  setupDemoWorld({ stories });
  putShared("kelpie.next.suggested", PICKS);
  const { view, cx } = await draw(new StoryList());
  view.queueOpen = true;
  const el = view.render(cx);
  const list = byId(el, `work-side-list-${DEMO}`);
  assert.ok(list, "the list's scroll box");
  const card = byId(list, "story-next");
  assert.ok(card, "Next is inside the list's scroll box");
  assert.ok(byId(card, "queue-suggest:ACME-180"), "with its last rows, reachable by scrolling");
  const calls = nodeOf(list).calls.map(([m]) => m);
  assert.ok(calls.includes("overflow_y_scrollbar") && calls.includes("flex_1") && calls.includes("min_h"), "the list takes the room left and scrolls");
  // Only the list's box holds it: the pinned part above it has the freshness line and the counts.
  const outer = nodeOf(el).calls.filter(([m]) => m === "child").map(([, a]) => a[0]);
  const pinned = outer.find((c) => byId(c, "stories-fresh"));
  assert.ok(pinned && byId(pinned, "count-needs-you"), "the freshness line and the counts are pinned");
  assert.equal(byId(pinned, "story-next"), null, "Next isn't pinned");
  snap("sidebar/queue-long", list);

  // Opening the queue scrolls the list to its top, an empty first line, where the card starts.
  view.queueOpen = false;
  const handle = view.listScrolls.get(DEMO).box.__state;
  const top = byId(view.render(cx), `work-side-list-${DEMO}`);
  const first = nodeOf(top).calls.find(([m]) => m === "child")[1][0];
  assert.equal(nodeOf(first).calls.find(([m]) => m === "id")?.[1][0], "work-side-list-top", "an empty line first");
  handle.calls.length = 0;
  const toggle = handlers(byId(view.render(cx), "story-next"), "on_click").find((h) => h.id === "story-queue");
  toggle.fn({}, cx);
  assert.equal(view.queueOpen, true);
  assert.deepEqual(handle.calls.filter(([m]) => m === "scroll_to_item").map(([, a]) => a[0]), [0], "scrolled to the top");
});

// Picks the person asked for open Next's queue (#124): brew() notes the run in shared
// kelpie.next.picked as it ends with picks, and every copy showing that profile opens once.
test("picks from a run the person started open the queue in every copy, once", async () => {
  setupDemoWorld({ stories });
  putShared("kelpie.next.suggested", PICKS);
  const one = await sharedDraw(), two = await sharedDraw();
  assert.ok(!one.view.queueOpen && !two.view.queueOpen, "folded before the run ends");
  putShared("kelpie.next.picked", { [DEMO]: { at: NOW - 60e3, done: NOW } });
  for (const { view, cx } of [one, two]) {
    const card = byId(view.render(cx), "story-next");
    assert.ok(byId(byId(card, "queue-suggested"), "queue-suggest:ACME-180"), "open, Claude's picks in view");
  }
  // The person folds it: it stays folded.
  handlers(one.view.render(one.cx)).find((h) => h.id === "story-queue").fn({}, one.cx);
  assert.equal(one.view.queueOpen, false);
  one.view.render(one.cx);
  assert.equal(one.view.queueOpen, false, "their fold wins");
});

test("picks that came any other way don't open the queue", async () => {
  setupDemoWorld({ stories });
  // An agent's suggest_next, another copy's reload: picks, but no run of the person's.
  putShared("kelpie.next.suggested", PICKS);
  const { view, cx } = await sharedDraw();
  view.render(cx);
  assert.ok(!view.queueOpen, "picks alone");
  // A run that ended before this copy was drawn (a reload since).
  putShared("kelpie.next.picked", { [DEMO]: { at: NOW - 120e3, done: NOW - 60e3 } });
  view.render(cx);
  assert.ok(!view.queueOpen, "a run from before this copy");
  // Another profile's run.
  putShared("kelpie.next.picked", { other: { at: NOW - 60e3, done: NOW } });
  view.render(cx);
  assert.ok(!view.queueOpen, "another profile's run");
});

test("folded again while Claude worked, the queue stays folded", async () => {
  setupDemoWorld({ stories });
  putShared("kelpie.next.suggested", PICKS);
  const { view, cx } = await sharedDraw();
  const chevron = () => handlers(view.render(cx)).find((h) => h.id === "story-queue").fn({}, cx);
  chevron();
  chevron(); // opened and folded again, after the run began
  putShared("kelpie.next.picked", { [DEMO]: { at: NOW - 60e3, done: NOW } });
  view.render(cx);
  assert.ok(!view.queueOpen);
});

// The copy's own start is its first draw, whatever Next showed then (#124 review): a copy showing
// "All clear" draws no card, and picks that then arrive from its "Conjure what's next" must open it.
// The clock is fixed (tests/lib/views.mjs), so the first draw is moved back by hand.
const drawnAt = async (at) => {
  const now = Date.now;
  Date.now = () => at;
  try { return await sharedDraw(); } finally { Date.now = now; }
};
test("picks asked for from All clear open the queue once the card first shows", async () => {
  setupDemoWorld({ stories: quiet(stories), spaces: [], paused: {} });
  mock.state.shared.set("kelpie.next.asks", {});
  const { view, cx } = await drawnAt(NOW - 120e3);
  assert.equal(byId(view.render(cx), "story-next"), null, "All clear: no card yet");
  putShared("kelpie.next.suggested", PICKS);
  putShared("kelpie.next.picked", { [DEMO]: { at: NOW - 60e3, done: NOW - 30e3 } });
  view.render(cx);
  assert.ok(view.queueOpen, "the card's first draw opens on the picks");
});

test("a run more than a day old opens nothing", async () => {
  setupDemoWorld({ stories });
  putShared("kelpie.next.suggested", PICKS);
  const { view, cx } = await drawnAt(NOW - 26 * 3600e3);
  putShared("kelpie.next.picked", { [DEMO]: { at: NOW - 25.5 * 3600e3, done: NOW - 25 * 3600e3 } });
  view.render(cx);
  assert.ok(!view.queueOpen);
});

test("a run whose picks are all gone since opens nothing; another profile's fold doesn't count", async () => {
  setupDemoWorld({ stories });
  // Every pick dropped since the run: the queue still holds what needs you, but no picks.
  putShared("kelpie.next.suggested", { [DEMO]: { at: NOW - 60e3, items: [] } });
  let { view, cx } = await drawnAt(NOW - 120e3);
  putShared("kelpie.next.picked", { [DEMO]: { at: NOW - 60e3, done: NOW - 30e3 } });
  view.render(cx);
  assert.ok(!view.queueOpen, "no picks left to show");
  // A fold of another profile's queue after the run began.
  putShared("kelpie.next.suggested", PICKS);
  ({ view, cx } = await drawnAt(NOW - 120e3));
  view.queueFolded = { other: NOW - 10e3 };
  view.render(cx);
  assert.ok(view.queueOpen, "opens: the fold was another profile's");
});

// Opened on one profile's picks, the queue is that profile's alone; a deleted profile's run note goes
// with the next load, as its other entries do (#124 review).
test("a queue opened on a profile's picks shows folded on another profile", async () => {
  setupDemoWorld({ stories });
  putShared("kelpie.next.suggested", PICKS);
  const { view, cx } = await sharedDraw();
  view.queueOpen = true;
  view.queueOpenFor = "other";
  view.render(cx);
  assert.ok(!view.queueOpen, "folded here");
});

test("a deleted profile's run note is pruned with the next load", async () => {
  setupDemoWorld({ stories });
  putShared("kelpie.next.picked", { [DEMO]: { at: NOW - 60e3, done: NOW }, gone: { at: NOW - 60e3, done: NOW } });
  await draw(new StoryList());
  assert.deepEqual(Object.keys(mock.sharedValue("kelpie.next.picked")), [DEMO]);
});
