// What kind of work a ticket is, on its row (#53): labels kept small and clean (labelsOf()), the tags
// a row shows (tagsOf(): the type when it says something, a bug the same on either board), their
// colours readable on the theme (legible(), tagColor()), and where they're drawn: the story list, the
// story's title row and its subtask rows, on a Jira board and on a GitHub Project.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { handlers, nodeOf, texts, walk } from "gpui-kit";
import { ROW_CONTROL } from "../../mods/kelpie/ui.js";
import { mock } from "herdr";
import { DEMO, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { byId, render } from "../lib/snapshot.mjs";
import { Stories, StoryBody, StoryList, contrast, fitTags, labelsOf, legible, tagColor, tagsOf } from "../../mods/kelpie/stories.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";
import { DEMO_PROJECT_PROFILE } from "../lib/stories.mjs";

const DARK = { background: "#101010", foreground: "#f0f0f0", blocked: "#e8907f", muted: "#999999", ansi2: "#a9c48a", ansi3: "#e6c07b", ansi4: "#8fb3c9", ansi5: "#c99bb8", ansi6: "#8fc0b0", accent: "#e8a87c" };
const LIGHT = { ...DARK, background: "#fbf8f3", foreground: "#1a1714" };
const story = (type, labels) => ({ issuetype: { name: type }, labels });

describe("labelsOf: labels as they're kept", () => {
  test("Jira's plain names and GitHub's names with colours", () => {
    assert.deepEqual(labelsOf({ labels: ["frontend", "ux"] }), [{ name: "frontend" }, { name: "ux" }]);
    assert.deepEqual(labelsOf({ labels: [{ name: "bug", color: "D73A4A" }] }), [{ name: "bug", color: "d73a4a" }]);
    assert.deepEqual(labelsOf({}), []);
  });
  test("strangers' names: control characters gone, cut, no repeats, ten at most", () => {
    assert.deepEqual(labelsOf({ labels: ["a\u001b]52;c;x\u0007b", "  spaced \n out "] }).map((l) => l.name), ["a ]52;c;x b", "spaced out"]);
    assert.equal(labelsOf({ labels: ["x".repeat(200)] })[0].name.length, 40);
    assert.deepEqual(labelsOf({ labels: ["a", "a", "", null, 7] }).map((l) => l.name), ["a"], "a number is no label on either board");
    assert.equal(labelsOf({ labels: Array.from({ length: 30 }, (_, i) => `l${i}`) }).length, 10);
  });
  test("a colour is kept only as six hex digits", () => {
    for (const color of ["red", "#d73a4a", "d73a4a;x", "zzzzzz", "fff", "d73a4a00", null, 12])
      assert.deepEqual(labelsOf({ labels: [{ name: "bug", color }] }), [{ name: "bug" }], String(color));
  });
});

describe("tagsOf: what a row shows", () => {
  test("the level's usual type says nothing; another type does, before the labels", () => {
    assert.deepEqual(tagsOf(story("Story", ["mobile"]), "Story").map((x) => x.name), ["mobile"]);
    assert.deepEqual(tagsOf(story("Task", ["mobile"]), "Story").map((x) => [x.name, x.from]), [["Task", "type"], ["mobile", "label"]]);
    assert.deepEqual(tagsOf(story("Ta\u001bsk", []), "Story").map((x) => x.name), ["Ta sk"], "a type is the board's text too");
  });
  test("a GitHub Project's made-up types never show: every issue has the usual one", () => {
    assert.deepEqual(tagsOf(story("Issue", []), "Issue"), []);
    assert.deepEqual(tagsOf(story("Sub-issue", ["ci"]), "Sub-issue").map((x) => x.name), ["ci"]);
  });
  test("Kelpie's own Issue/Sub-issue never shows, even on a story that is a sub-issue among issues", () => {
    const made = (name, labels = []) => ({ issuetype: { name, madeUp: true }, labels });
    assert.deepEqual(tagsOf(made("Sub-issue", ["ci"]), "Issue").map((x) => x.name), ["ci"]);
    assert.deepEqual(tagsOf(made("Issue"), "Sub-issue"), []);
  });
  test("a bug always shows, first, once: Jira's Bug type and a bug label are one tag", () => {
    assert.deepEqual(tagsOf(story("Bug", []), "Bug").map((x) => x.name), ["Bug"], "even when most tickets are bugs");
    assert.deepEqual(tagsOf(story("Bug", ["bug", "ci"]), "Story").map((x) => x.name), ["Bug", "ci"]);
    assert.deepEqual(tagsOf(story("Issue", [{ name: "ci" }, { name: "type: bug", color: "d73a4a" }]), "Issue").map((x) => [x.name, x.bug]), [["type: bug", true], ["ci", false]]);
    assert.deepEqual(tagsOf(story("Story", ["kind/bug"]), "Story").map((x) => x.bug), [true], "a grouped name");
    assert.deepEqual(tagsOf(story("Story", ["Defect", "ci"]), "Story").map((x) => x.bug), [true, false]);
  });
  test("a label that only has the word in it isn't a bug, and isn't dropped beside a Bug type", () => {
    assert.deepEqual(tagsOf(story("Story", ["not-a-bug", "incident-review"]), "Story").map((x) => x.bug), [false, false]);
    assert.deepEqual(tagsOf(story("Bug", ["bug-bash"]), "Story").map((x) => x.name), ["Bug", "bug-bash"]);
  });
});

describe("tag colours", () => {
  test("a repo's colour too dark or too pale for the theme is moved toward its text colour until it reads", () => {
    for (const [t, hex] of [[DARK, "#0b3d0f"], [DARK, "#000000"], [LIGHT, "#fbca04"], [LIGHT, "#ededed"]]) {
      assert.ok(contrast(hex, t.background) < 4, `${hex} starts unreadable`);
      assert.ok(contrast(legible(t, hex), t.background) >= 4, `${hex} on ${t.background}`);
    }
    assert.equal(legible(DARK, "#fbca04"), "#fbca04", "a readable one is left as it is");
  });
  test("a bug is the theme's red whatever its label's colour; a Jira label always the same colour for its name, never red", () => {
    assert.equal(tagColor(DARK, { name: "bug", color: "00ff00", bug: true }), DARK.blocked);
    assert.equal(tagColor(DARK, { name: "frontend" }), tagColor(DARK, { name: "Frontend" }));
    for (const name of ["frontend", "design", "accessibility", "security", "mobile", "payments"]) assert.notEqual(tagColor(DARK, { name }), DARK.blocked, name);
    assert.ok(new Set(["frontend", "design", "accessibility"].map((name) => tagColor(DARK, { name }))).size > 1, "common names don't all share one colour");
  });
  test("a colour is worked out once, but again for another theme", () => {
    const tag = { name: "deps", color: "0b3d0f" };
    assert.equal(tagColor(DARK, tag), legible(DARK, "#0b3d0f"));
    assert.equal(tagColor(DARK, tag), tagColor(DARK, { ...tag }));
    assert.equal(tagColor(LIGHT, tag), legible(LIGHT, "#0b3d0f"), "the light theme's own, not the dark one's kept");
  });
});

// The demo, on its Jira board and as a GitHub Project of the same issues.
const PROJECT = { jira: null, project: DEMO_PROJECT_PROFILE.project };
const tagsIn = (el, id) => { const box = byId(el, id); return box ? texts(box) : null; };
const look = (el) => render(el, skinTheme());
let jira, github;
before(async () => {
  setupDemoWorld(); jira = await loadStories(StoryList);
  setupDemoWorld({ profile: PROJECT }); github = await loadStories(StoryList);
});

describe("the demo's labels", () => {
  test("the shared copy keeps them: Jira's names, GitHub's with their colours", () => {
    const of = (st, key) => [...st.data.parents, ...st.data.children].find((i) => i.key === key)?.fields.labels;
    assert.deepEqual(of(jira, "ACME-171"), [{ name: "frontend" }, { name: "design" }, { name: "accessibility" }]);
    assert.deepEqual(of(github, "ACME-171")[0], { name: "frontend", color: "bfd4f2" });
    assert.deepEqual(of(github, "ACME-173"), [{ name: "charts", color: "f9d0c4" }]);
  });

  for (const [board, stories, bug] of [["Jira", () => jira, "Bug"], ["a GitHub Project", () => github, "bug"]]) {
    test(`on ${board}: the list's rows show the first two, then +n; a bug in red`, async () => {
      setupDemoWorld({ stories: stories(), ...(board === "Jira" ? {} : { profile: PROJECT }) });
      const { el } = await draw(new StoryList());
      assert.deepEqual(tagsIn(el, "tags-ACME-171"), ["frontend", "design", "+1"]);
      assert.match(look(byId(el, "tags-ACME-171-more")), /tip="Label: accessibility"/);
      assert.deepEqual(tagsIn(el, "tags-ACME-175"), [bug, "ci"]);
      assert.match(look(byId(el, "tags-ACME-175-0")), /fg=blocked/, "a bug reads as a bug on either board");
      assert.equal(tagsIn(el, "tags-ACME-138"), null, "a plain story has no tags");
    });
  }

  // The list's tags are whole words at the key line's end (never squeezed into "mob…"); only a name
  // too long for any row is cut, with an ellipsis, at 110px.
  // The list's tags fit the room the key line leaves, measured as drawn: as many whole as fit, then
  // "+n"; the first cut with an ellipsis when not even it fits whole; only "+n" when that wouldn't read.
  test("the list's tags fit the room measured on screen, never running past the row", async () => {
    setupDemoWorld({ stories: jira });
    const view = new StoryList();
    const { cx } = await draw(view);
    const measure = (zoom, room) => {
      const el = view.render(cx);
      const at = (id, width) => handlers(el, "on_size_change").find((h) => h.id === id).fn({ width: width * zoom, height: 15 * zoom }, cx);
      at("tags-ACME-171-zoom", 100);
      at("tags-ACME-171-m0", 56); at("tags-ACME-171-m1", 46); at("tags-ACME-171-m2", 80); at("tags-ACME-171-mmore", 16);
      at("tags-ACME-171-zone", room);
      return view.render(cx);
    };
    for (const zoom of [1, 1.2]) {
      assert.deepEqual(tagsIn(measure(zoom, 200), "tags-ACME-171"), ["frontend", "design", "accessibility"], `all fit, at ${zoom}`);
      assert.deepEqual(tagsIn(measure(zoom, 130), "tags-ACME-171"), ["frontend", "design", "+1"]);
      const narrow = measure(zoom, 60);
      assert.deepEqual(tagsIn(narrow, "tags-ACME-171"), ["frontend", "+2"], "the first cut to what's left");
      const cut = nodeOf(byId(narrow, "tags-ACME-171-0")).calls;
      assert.ok(cut.some(([m, a]) => m === "w" && a[0] === 40) && cut.some(([m]) => m === "truncate"), "with an ellipsis, at 60 - (4 + 16)");
      assert.deepEqual(tagsIn(measure(zoom, 30), "tags-ACME-171"), ["+3"], "too narrow to read one: only the count");
    }
  });

  // Herdr reports sizes in whatever order: a row measured before its zoom probe still fits right.
  test("the fit doesn't depend on which size Herdr reports first", async () => {
    setupDemoWorld({ stories: jira });
    const view = new StoryList();
    const { cx } = await draw(view);
    const zoom = 1.2, el = view.render(cx);
    const at = (id, width) => handlers(el, "on_size_change").find((h) => h.id === id).fn({ width: width * zoom, height: 18 }, cx);
    // The tags before the zoom probe, the room after it: kept with different zooms, they'd disagree.
    at("tags-ACME-171-m0", 56); at("tags-ACME-171-m1", 46); at("tags-ACME-171-m2", 80); at("tags-ACME-171-mmore", 16);
    at("tags-ACME-171-zoom", 100);
    at("tags-ACME-171-zone", 130);
    assert.deepEqual(tagsIn(view.render(cx), "tags-ACME-171"), ["frontend", "design", "+1"]);
  });

  test("the story's title row fits its tags to the room left before the assignee", async () => {
    setupDemoWorld({ stories: jira, shown: "ACME-171" });
    const view = new Stories();
    const { cx } = await draw(view);
    const el = view.render(cx);
    const at = (id, width) => handlers(el, "on_size_change").find((h) => h.id === id).fn({ width, height: 15 }, cx);
    at("story-tags-zoom", 100); at("story-tags-m0", 56); at("story-tags-m1", 46); at("story-tags-m2", 80); at("story-tags-mmore", 16);
    at("story-tags-zone", 60);
    assert.deepEqual(tagsIn(view.render(cx), "story-tags"), ["frontend", "+2"]);
  });

  test("fitTags: whole tags by the room, then a cut one, then only the count", () => {
    assert.deepEqual(fitTags([50, 40], 94), { n: 2, cut: null, more: false });
    assert.deepEqual(fitTags([50, 40, 30], 94, 16), { n: 1, cut: null, more: true }, "50 + 4 + 40 + 4 + 16 = 114 > 94");
    assert.deepEqual(fitTags([200], 80, 16), { n: 1, cut: 80, more: false }, "one long name alone: cut to the room");
    assert.deepEqual(fitTags([300], 400, 16), { n: 1, cut: null, more: false });
    assert.deepEqual(fitTags([60, 40], 40, 16), { n: 0, cut: null, more: true }, "40 - 20 < 34: unreadable, so the count");
    assert.deepEqual(fitTags([60], 10, 16), { n: 0, cut: null, more: false }, "not even the count fits");
    assert.deepEqual(fitTags([], 100, 16), { n: 0, cut: null, more: false });
  });

  test("a long label is cut with an ellipsis at 110px, wherever it shows", async () => {
    const long = structuredClone(jira);
    long.data.parents.find((i) => i.key === "ACME-142").fields.labels = [{ name: "a-very-long-label-somebody-wrote-on-the-board" }];
    setupDemoWorld({ stories: long });
    const { el } = await draw(new StoryList());
    const tag = nodeOf(byId(el, "tags-ACME-142-0")).calls;
    assert.ok(tag.some(([m]) => m === "truncate") && tag.some(([m, a]) => m === "max_w" && a[0] === 110));
  });

  test("on the list, a story's own space brightens its key and its subtasks are a line under the row", async () => {
    setupDemoWorld({ stories: jira });
    const { el } = await draw(new StoryList());
    assert.deepEqual(texts(byId(el, "here-ACME-142")), ["ACME-142"], "the key itself says it's open here");
    assert.match(look(byId(el, "here-ACME-142")), /fg=muted/);
    assert.equal(texts(byId(el, "b-subs-ACME-142")).length, 0, "no 0/2 on the key line: its words are the tooltip");
    assert.match(look(byId(el, "b-subs-ACME-142")), /tip="Your subtasks: 0 of 2/);
  });

  // A story can show two actions at once (Merge and Request approval, say): they lie over the row's end
  // rather than taking a column, so the text and the subtasks' line keep the row's width.
  test("on the list, a story's actions sit in the row's corner, above its labels, and its subtasks' line stays whole", async () => {
    const calls = (el) => nodeOf(el).calls.map(([m, a]) => [m, a[0]]);
    setupDemoWorld({ stories: jira });
    const { el } = await draw(new StoryList());
    const over = calls(byId(el, "actions-ACME-171"));
    assert.ok(over.some(([m]) => m === "absolute") && over.some(([m, v]) => m === "right" && v === 8), "laid over, at the row's end (inside its padding)");
    // By the numbers: padding 7 + title line 20 puts the title's middle at 17; buttons ROW_CONTROL (22)
    // high from 6 share it and end at 28, above the key line's tags (7 + 20 + 2 - 0.5 = 28.5).
    const top = over.find(([m]) => m === "top")?.[1], high = over.find(([m]) => m === "h")?.[1];
    assert.equal(high, ROW_CONTROL);
    const titleLine = walk(byId(el, "story-ACME-171")).find((n) => n.calls.some(([m, a]) => m === "child" && a[0] === "Dark mode for the dashboard"));
    const h = titleLine.calls.find(([m]) => m === "h")?.[1][0];
    assert.equal(h, 20, "the title line's height is set, not a font's");
    assert.equal(top + high / 2, 7 + h / 2, "centred on the title");
    assert.ok(top >= 4, "inset from the row's top");
    assert.ok(top + high <= 7 + h + 2 - 0.5, "ending above the labels");
    assert.ok(!over.some(([m]) => m === "bg"), "nothing painted behind them");
    assert.deepEqual(titleLine.calls.filter(([m]) => m === "mr").map(([, a]) => a[0]), [ROW_CONTROL + 6], "the title stops short of one button");
    assert.ok(byId(byId(el, "actions-ACME-171"), "tasks-ACME-171"), "Merge is in it");
    assert.ok(calls(byId(el, "b-subs-ACME-171")).some(([m]) => m === "w_full"));
  });

  test("the story's title row shows two, and its subtask rows their own", async () => {
    setupDemoWorld({ stories: jira, shown: "ACME-171" });
    const head = await draw(new Stories());
    assert.deepEqual(tagsIn(head.el, "story-tags"), ["frontend", "design", "+1"], "whole words: the title is cut first");
    setupDemoWorld({ stories: jira });
    mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-171" });
    const body = await draw(new StoryBody());
    assert.deepEqual(tagsIn(body.el, "sub-tags-ACME-173"), ["charts"]);
    assert.equal(tagsIn(body.el, "sub-tags-ACME-172"), null, "a subtask of the usual type with no labels has none");
  });
});
