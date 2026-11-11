// What kind of work a ticket is, on its row (#53): labels kept small and clean (labelsOf()), the tags
// a row shows (tagsOf(): the type when it says something, a bug the same on either board), their
// colours readable on the theme (legible(), tagColor()), and where they're drawn: the story list, the
// story's title row and its subtask rows, on a Jira board and on a GitHub Project.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { texts } from "gpui-kit";
import { mock } from "herdr";
import { DEMO, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { byId, render } from "../lib/snapshot.mjs";
import { Stories, StoryBody, StoryList, contrast, labelsOf, legible, tagColor, tagsOf } from "../../mods/kelpie/stories.js";
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
  test("a bug always shows, first, once: Jira's Bug type and a bug label are one tag", () => {
    assert.deepEqual(tagsOf(story("Bug", []), "Bug").map((x) => x.name), ["Bug"], "even when most tickets are bugs");
    assert.deepEqual(tagsOf(story("Bug", ["bug", "ci"]), "Story").map((x) => x.name), ["Bug", "ci"]);
    assert.deepEqual(tagsOf(story("Issue", [{ name: "ci" }, { name: "type: bug", color: "d73a4a" }]), "Issue").map((x) => [x.name, x.bug]), [["type: bug", true], ["ci", false]]);
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

  test("the story's title row shows up to three, and its subtask rows their own", async () => {
    setupDemoWorld({ stories: jira, shown: "ACME-171" });
    const head = await draw(new Stories());
    assert.deepEqual(tagsIn(head.el, "story-tags"), ["frontend", "design", "accessibility"]);
    setupDemoWorld({ stories: jira });
    mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-171" });
    const body = await draw(new StoryBody());
    assert.deepEqual(tagsIn(body.el, "sub-tags-ACME-173"), ["charts"]);
    assert.equal(tagsIn(body.el, "sub-tags-ACME-172"), null, "a subtask of the usual type with no labels has none");
  });
});
