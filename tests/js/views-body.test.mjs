// What the story's details draw under the title row (stories.js StoryBody: detail, description,
// fits()), pinned as snapshots (tests/README.md, Snapshots): the description folded with Show more and
// opened, the subtasks with their actions, a subtask's own description, and the fade shown only while
// the details are taller than their block.
import { DEMO, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, nodeOf, texts, tree, walk } from "gpui-kit";
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

// A pull request shown on its own shows its description (the demo's, GitHub Markdown), folded like a
// ticket's; its template's hint comment doesn't show.
test("a review's details show its description", async () => {
  const { el } = await body({ preview: "review:web#421" });
  const words = render(byId(el, "pr-desc-body"), skinTheme());
  assert.match(words, /Share a trip with a read-only link that works for 14 days/);
  assert.doesNotMatch(words, /Describe how you tested it/);
});

// A review whose title names a ticket shows that ticket under its description, as Start review gives
// it to the agent: its key (opening its page), its summary and its description. The demo's web#421
// names ACME-166, a teammate's story the list doesn't hold, so the board is asked for it.
test("a review's details show the ticket its title names", async () => {
  const { el, cx } = await body({ preview: "review:web#421" });
  const ticket = render(byId(el, "review-ticket-section"), skinTheme());
  assert.match(ticket, /"Ticket"[\s\S]*"ACME-166"[\s\S]*"Share a trip with a link"/);
  assert.match(render(byId(el, "review-ticket-desc-body"), skinTheme()), /The link works for 14 days, then says it has expired/);
  mock.calls.length = 0;
  press(el, "review-ticket-key", cx);
  assert.ok(mock.of("exec").some(([, args]) => args.includes("https://jira.example.com/browse/ACME-166")), "its key opens the ticket's page");
});

// A ticket the list holds needs no asking, and a subtask's story shows beside it.
test("a review naming a subtask of the list shows its story too", async () => {
  const data = structuredClone(stories);
  data.data.reviews = data.data.reviews.map((p) => (p.url.endsWith("/web/pull/421") ? { ...p, title: "ACME-161 Fuzzy matching" } : p));
  setupDemoWorld({ stories: data });
  mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "review:web#421" });
  const { el } = await draw(new StoryBody());
  const ticket = render(byId(el, "review-ticket-section"), skinTheme());
  assert.match(ticket, /"ACME-161"[\s\S]*"Fuzzy matching in the search service"/);
  assert.match(ticket, /"Story"[\s\S]*"ACME-160"[\s\S]*"Typo-tolerant search"/);
});

// One naming no ticket has no ticket section.
test("a review naming no ticket shows none", async () => {
  const { el } = await body({ preview: "review:api#305" });
  assert.equal(byId(el, "review-ticket-section"), null);
});

// A subtask row's actions show on the row hovered (on_hover, this copy's), over its title's end: at
// rest it keeps no room for them.
const hoverRow = (el, key, on, cx) => handlers(el, "on_hover").find((h) => h.id === `sub-row-${key}`).fn(on, cx);

// A subtask with an earlier session shows one action when hovered, Resume: starting fresh and every
// session (with its age) are in the ▾ beside it, and no age sits in the row. The row stays awake
// while its menu is open, though the pointer has left it for the menu.
test("a subtask's Resume is a split button: Start fresh and the sessions in its menu", async () => {
  const { el, view, cx } = await body({ preview: "ACME-180" });
  hoverRow(el, "ACME-181", true, cx);
  const hovered = view.render(cx);
  const row = render(byId(hovered, "sub-row-ACME-181"), skinTheme());
  assert.doesNotMatch(row, /"last session|"Start fresh"/);
  assert.match(row, /"Resume"/);
  press(hovered, "sub-agent-ACME-181-more", cx);
  hoverRow(hovered, "ACME-181", false, cx);
  const open = view.render(cx);
  const menu = render(byId(open, "sub-agent-ACME-181-menu-list"), skinTheme());
  assert.match(menu, /"Start fresh"/);
  assert.match(menu, /"Resume the session"|"Resume one of \d+ sessions"/);
  assert.match(menu, /"Sketch the PDF itinerary layout"[\s\S]*"2d ago"/);
  view.menu = null;
  assert.equal(byId(view.render(cx), "sub-actions-ACME-181"), null, "once it's shut and the pointer gone, the row is calm again");
});

// At rest a row shows only what you read: no actions, except Peek on the row whose agent asks
// something. Hovered, all of them; leaving puts it back. A row entered before the last one reports
// leaving keeps the hover.
test("a subtask's actions show on the row hovered, Peek always", async () => {
  const { el, view, cx } = await body({ preview: "ACME-142" });
  const words = (x, key) => texts(byId(x, `sub-row-${key}`));
  assert.ok(!words(el, "ACME-144").some((w) => /Show agent|Pause|Resume|Start/.test(w)), "a calm row has no buttons");
  assert.equal(byId(el, "sub-actions-ACME-144"), null);
  assert.ok(words(el, "ACME-143").includes("Peek"), "Peek stays while its agent asks");
  assert.ok(!words(el, "ACME-143").includes("Show agent"));
  hoverRow(el, "ACME-143", true, cx);
  const on = view.render(cx);
  assert.ok(words(on, "ACME-143").includes("Peek") && words(on, "ACME-143").includes("Show agent"));
  hoverRow(on, "ACME-144", true, cx);
  hoverRow(on, "ACME-143", false, cx);
  const moved = view.render(cx);
  assert.ok(!words(moved, "ACME-143").includes("Show agent"));
  assert.ok(byId(moved, "sub-actions-ACME-144"), "the row entered keeps the hover");
  hoverRow(moved, "ACME-144", false, cx);
  assert.equal(byId(view.render(cx), "sub-actions-ACME-144"), null);
});

// Every subtask row has the same columns after its title, empty or not, so marks, avatars and chips
// line up down the list; the agent's state is a mark in a slot of its own, there at rest.
test("subtask rows line up: the same columns on every row", async () => {
  const { el } = await body({ preview: "ACME-142" });
  // The row's first line (its first child, up to the next one: its pull requests), then its columns.
  const cols = (key) => {
    const lines = render(byId(el, `sub-row-${key}`), skinTheme()).split("\n").slice(1);
    const end = lines.findIndex((l, i) => i > 0 && /^  \S/.test(l));
    return lines.slice(0, end < 0 ? undefined : end).filter((l) => /^    \S/.test(l)).length;
  };
  // Key, title (its actions laid over it), the agent's mark, avatar, status: no "No PR yet".
  assert.deepEqual(["ACME-143", "ACME-144", "ACME-145"].map(cols), [5, 5, 5]);
  const slot = (key) => render(byId(el, `sub-mark-${key}`), skinTheme());
  assert.match(slot("ACME-143"), /tip="ACME-143: waiting for you"\n  div/, "the agent's mark, saying its state");
  assert.doesNotMatch(slot("ACME-145"), /tip=|\n  div/, "an empty slot");
  assert.doesNotMatch(render(byId(el, "sub-row-ACME-144"), skinTheme()), /No PR yet/);
});

// Each column is as wide as its widest cell among the rows shown, as drawn (divided by the zoom), and
// narrows again once that cell is gone.
test("a subtask column takes its widest cell's width", async () => {
  const { el, view, cx } = await body({ preview: "ACME-142" });
  const fire = (x, id, width) => handlers(x, "on_size_change").find((h) => h.id === id).fn({ width, height: 20 }, cx);
  fire(el, "sub-cols-zoom-probe", 120);
  fire(el, "sub-status-cell-ACME-143", 96);
  fire(el, "sub-status-cell-ACME-144", 60);
  fire(el, "sub-status-cell-ACME-145", 72);
  // The box around a cell, and the min_w it was given.
  const minW = (x, id) => {
    const find = (n) => {
      if (Array.isArray(n)) { for (const k of n) { const f = find(k); if (f) return f; } return null; }
      if (!n || typeof n !== "object") return null;
      const kids = (n.calls ?? []).filter(([m]) => m === "child").map(([, a]) => a[0]);
      if (kids.some((k) => (k?.calls ?? []).some(([m, a]) => m === "id" && a[0] === id))) return n;
      for (const k of [...kids, ...(n.calls ?? []).flatMap(([, a]) => a)]) { const f = find(k); if (f) return f; }
      return null;
    };
    return find(tree(x))?.calls.find(([m]) => m === "min_w")?.[1][0] ?? null;
  };
  const wide = view.render(cx);
  assert.deepEqual(["ACME-143", "ACME-144", "ACME-145"].map((k) => minW(wide, `sub-status-cell-${k}`)), [80, 80, 80]);
  fire(wide, "sub-status-cell-ACME-143", 48);
  const narrow = view.render(cx);
  assert.equal(minW(narrow, "sub-status-cell-ACME-144"), 60);
});

// Who a subtask is assigned to is the first thing looked for, so the avatar leads each row.
test("a subtask row starts with who it's assigned to", async () => {
  const { el } = await body({ preview: "ACME-142" });
  for (const key of ["ACME-143", "ACME-144", "ACME-145"]) {
    const first = render(byId(el, `sub-row-${key}`), skinTheme()).split("\n").find((l) => /^    \S/.test(l));
    assert.match(first, new RegExp(`#sub-assignee-${key}`), key);
  }
});

// The subtask list stays narrow on a wide screen: a row's end within an eye's sweep of its start.
test("the subtask rows are at most 760 wide", async () => {
  const { el } = await body({ preview: "ACME-142" });
  const widths = [];
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    for (const [m, a] of n.calls ?? []) { if (m === "max_w") widths.push(a[0]); a.forEach(walk); }
  };
  walk(tree(el));
  assert.ok(widths.includes(760), `max widths: ${widths}`);
  assert.ok(!widths.some((w) => typeof w === "number" && w > 760 && w < 2000), `nothing wider: ${widths}`);
});

// The subtasks come in two groups: yours first, then everyone else's, each under a heading; a story
// whose subtasks are all yours (or all others') has one plain list.
test("subtasks: yours first, then everyone else's", async () => {
  const order = (x) => render(x, skinTheme()).split("\n").map((l) => /#(subs-mine|subs-others|sub-row-[A-Z]+-\d+)\b/.exec(l)?.[1]).filter(Boolean);
  const split = (await body({ preview: "ACME-142" })).el;
  assert.deepEqual(order(split), ["subs-mine", "sub-row-ACME-143", "sub-row-ACME-144", "subs-others", "sub-row-ACME-145"]);
  assert.deepEqual(texts(byId(split, "subs-mine")), ["Assigned to you"]);
  assert.deepEqual(texts(byId(split, "subs-others")), ["Everyone else"]);
  const allMine = (await body({ preview: "ACME-151" })).el;
  assert.deepEqual(order(allMine), ["sub-row-ACME-152", "sub-row-ACME-153"]);
});

// A pull request's line says what it is: its title without the ticket key, where it is, its state in a
// few words and its age; open ones first, then the merged. A ticket with no subtasks lists its own
// under a heading, a story the ones naming its own key under "On the story itself".
test("pull request lines: title, where, state and age, open ones first", async () => {
  const task = (await body({ preview: "ACME-175" })).el;
  assert.deepEqual(texts(byId(task, "prs-own")), ["Pull requests · 2"]);
  const lines = render(task, skinTheme()).split("\n").map((l) => /#pr-([a-z]+#\d+)\b/.exec(l)?.[1]).filter(Boolean);
  assert.deepEqual(lines, ["web#423", "api#291"], "open first, then merged");
  const open = texts(byId(task, "pr-web#423"));
  assert.ok(open.includes("Wait for the session cookie in the login test"), open.join(" | "));
  assert.ok(!open.some((x) => /ACME-175/.test(x)), "no ticket key in the title");
  assert.ok(open.includes("web#423") && open.includes("Checks running") && open.some((x) => /^(now|\d+[mhd])$/.test(x)), open.join(" | "));
  assert.ok(texts(byId(task, "pr-api#291")).includes("Merged"));
  const story = (await body({ preview: "ACME-142" })).el;
  assert.deepEqual(texts(byId(story, "prs-story")), ["On the story itself"]);
  assert.ok(texts(byId(story, "pr-docs#61")).includes("Offline mode: how saved trips sync"));
});

// The Ask line (KELPIE-84): a story's details end with it, about the story until something else is
// pointed at; who it goes to follows what it's about; only the story's own Claudes are offered.
const askedAbout = (el) => texts(byId(el, "ask-about")).join(" ");
const toLabel = (el) => texts(byId(el, "ask-to-more")).join(" ");
test("the details end with the Ask line, about the story, to a new Claude", async () => {
  const { el } = await body({ space: "ACME-142" });
  assert.ok(byId(el, "ask-line"), "the Ask line is there");
  assert.equal(askedAbout(el), "ACME-142 · the story");
  assert.match(toLabel(el), /^New Claude/);
  assert.match(texts(byId(el, "ask-hint")).join(" "), /whole story goes to a new Claude/);
  assert.deepEqual(handlers(el).filter((h) => h.id?.startsWith("ask-suggest-")).map((h) => h.id), ["ask-suggest-left", "ask-suggest-explain"]);
});
test("a subtask's title points the Ask line at it; a Claude waiting for you can't take it", async () => {
  const { el, view, cx } = await body({ space: "ACME-142" });
  press(el, "sub-title-ACME-143", cx);
  const after = view.render(cx);
  assert.match(askedAbout(after), /^ACME-143 · /);
  // ACME-143's own Claude waits for an answer: a new one is picked, and it's listed as waiting.
  assert.match(toLabel(after), /^New Claude/);
  view.menu = "ask-to";
  assert.match(texts(view.render(cx)).join(" "), /waiting for you, answer it first/);
});
test("a right-click on a pull request points the Ask line at it", async () => {
  const { el, view, cx } = await body({ space: "ACME-142" });
  const line = walk(el).find((n) => n.calls.some(([m, a]) => m === "on_mouse_down" && a[0] === "right") && n.calls.some(([m, a]) => m === "id" && /^pr-/.test(a[0])));
  line.calls.find(([m, a]) => m === "on_mouse_down" && a[0] === "right")[1][1]({}, { stop_propagation() {} });
  assert.match(askedAbout(view.render(cx)), /#\d+/);
  assert.equal(mock.state.shared.get("kelpie.ask.about")[DEMO].about.others, true, "a pull request's title is others' text");
});
// Another story's Claude, or the one reviewing the story's pull requests by others (KELPIE-118),
// isn't offered: only the story's own.
test("the Ask line offers only the story's own Claudes", async () => {
  const { view, cx } = await body({ space: "ACME-142" });
  mock.state.agents = [...mock.state.agents,
    { address: "t-other", tab_name: "ACME-999", space: "s-x", pane: "p-other", status: "idle", title: "" },
    { address: "t-review", tab_name: "Review ACME-142", space: "s-x", pane: "p-review", status: "idle", title: "" }];
  view.menu = "ask-to";
  const words = texts(view.render(cx)).join(" ");
  assert.match(words, /New Claude/);
  assert.doesNotMatch(words, /ACME-999/);
  assert.doesNotMatch(words, /Review ACME-142/);
});
test("a suggestion asks the Claude on the subtask's key, and goes on the story's thread", async () => {
  const { el, view, cx } = await body({ space: "ACME-171" });
  mock.on.hc = (args) => (args[0] === "get" ? { code: 0, stdout: JSON.stringify({ foreground: { name: "claude" } }), stderr: "" } : { code: 0, stdout: "{}", stderr: "" });
  press(el, "sub-title-ACME-172", cx);
  const pointed = view.render(cx);
  assert.match(toLabel(pointed), /▾$/);
  assert.doesNotMatch(toLabel(pointed), /^New Claude/, "its own Claude, idle, is picked");
  mock.calls.length = 0;
  press(pointed, "ask-suggest-explain", cx);
  await new Promise((r) => setImmediate(r));
  const sent = mock.of("hc").filter(([a]) => a[0] === "send");
  assert.equal(sent.length, 1);
  assert.match(sent[0][0].at(-1), /^About the subtask ACME-172 /);
  assert.deepEqual(mock.of("run").filter(([n]) => n === "space.select"), [], "the person stays where they are");
  const thread = view.render(cx);
  assert.match(texts(byId(thread, "ask-thread")).join(" "), /Explain this/);
});
// On a wide screen the Ask line keeps to the subtask rows' width, centred, rather than stretching.
test("the Ask line is at most as wide as the subtask rows", async () => {
  const { el } = await body({ space: "ACME-142" });
  const line = nodeOf(byId(el, "ask-line"));
  assert.ok(line.calls.some(([m, a]) => m === "max_w" && a[0] === 760), "ROWS wide at most");
});
// An answer handed back (answerAskRequest()) shows on its question's line, its first line only, so it
// never squeezes the Ask line out of the short details block; a click opens the whole of it.
test("an answered ask shows its answer's first line, and the whole of it once clicked", async () => {
  setupDemoWorld({ stories, shown: "ACME-142" });
  mock.state.shared.set("kelpie.ask.thread", { [DEMO]: { "ACME-142": [{ id: "abc123xyz", at: Date.now(), story: "ACME-142", about: "ACME-142 · the story", q: "What's left?", to: "Cache trips", status: "answered", answer: "Two things.\nThe replay, and a review.", address: "a0-0" }] } });
  const { el, view, cx } = await draw(new StoryBody());
  const words = texts(byId(el, "ask-thread")).join(" | ");
  assert.match(words, /What's left\? \| Two things\./);
  assert.doesNotMatch(words, /The replay/, "folded to its first line");
  assert.match(words, /answered/);
  assert.match(words, /Show its Claude/);
  press(el, "ask-entry-abc123xyz", cx);
  const open = texts(byId(view.render(cx), "ask-thread")).join(" | ");
  assert.match(open, /Two things\. \| The replay, and a review\./);
});
