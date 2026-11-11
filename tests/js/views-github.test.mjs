// What the views draw for the demo on its GitHub Project board (kelpie.demo-github: the same fixture
// loaded through project.js), pinned as snapshots under tests/snapshots/github/: the sidebar, a story's
// title row and its details. The stories are the Jira demo's (project.test.mjs's parity test), so
// these differ from sidebar/, header/ and body/ only where the board does: statuses named as the
// Project's columns, links to GitHub issues.
import { DEMO, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { texts } from "gpui-kit";
import { byId, matchSnapshot, render } from "../lib/snapshot.mjs";
import { Stories, StoryBody, StoryList } from "../../mods/kelpie/stories.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";
import { DEMO_PROJECT_PROFILE } from "../lib/stories.mjs";
import { readFileSync } from "node:fs";

const PROFILE = { jira: null, project: DEMO_PROJECT_PROFILE.project };
const snap = (name, el) => matchSnapshot(name, render(el, skinTheme()));
let stories;
before(async () => { setupDemoWorld({ profile: PROFILE }); stories = await loadStories(StoryList); });

const world = (opts = {}) => setupDemoWorld({ stories, profile: PROFILE, ...opts });

test("the loaded stories are the Project's: GitHub issue pages, its columns, its iteration", () => {
  assert.equal(stories.data.site, "https://github.com");
  assert.ok(stories.data.parents.every((i) => i.url.startsWith("https://github.com/kelpie--demo/acme/issues/")));
  assert.ok(stories.data.project?.id, "what a Status move needs");
  assert.equal(stories.data.sprints.length, 1);
});

test("the sidebar on a GitHub Project", async () => {
  world();
  const { el } = await draw(new StoryList());
  assert.ok(byId(el, "story-ACME-142"), "the demo's stories are listed");
  snap("github/sidebar", el);
});

test("a story's title row on a GitHub Project: its key opens the issue on GitHub", async () => {
  world({ shown: "ACME-160" });
  const { el } = await draw(new Stories());
  assert.deepEqual(texts(byId(el, "story-ask-comments")), ["Address comments"]);
  snap("github/header", el);
});

test("a story's details on a GitHub Project: the Markdown description and its subtasks", async () => {
  world();
  mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-142" });
  const { el } = await draw(new StoryBody());
  assert.ok(byId(el, "story-desc-more"), "the description is drawn, folded");
  snap("github/body", el);
});

// KELPIE-129: GitHub's limit as the demo plays it (fixture github.limit, demo.js demoLimit()): a card
// under the freshness line says the stories may be behind and until when, whole (a note on the
// freshness line was cut off before its time). Used up, the stories stay, as old as they are. Its
// time is the clock's, so the words are checked rather than snapshotted.
const T = "\\d+:\\d\\d [AP]M";
for (const [limit, title, line] of [
  ["used", "GitHub's limit is used up", new RegExp(`^These stories are as they were at ${T}\\. Kelpie can't update them until ${T}, when GitHub lets it ask again\\.$`)],
  ["low", "GitHub's limit is running low", new RegExp(`^Kelpie updates the stories only every 10 minutes until ${T}, so they may be a little behind\\.$`)],
]) {
  test(`the demo's GitHub limit ${limit === "used" ? "used up" : "running low"}: a card says the stories may be behind`, async () => {
    world({ stories: { ...stories, at: Date.now() - 10 * 60e3 } }); // loaded 10 minutes ago
    // The fixture as read from disk, with its github.limit set.
    const text = readFileSync(new URL("../../mods/kelpie/demo/demo.json", import.meta.url), "utf8");
    const base = mock.on.readTextFile;
    mock.on.readTextFile = (path, ...rest) => (String(path).endsWith("demo/demo.json") ? JSON.stringify({ ...JSON.parse(text), github: { limit, resets: "+25m" } }) : base?.(path, ...rest));
    const { cx } = await draw(new StoryList());
    await cx.settle();
    const el = (await draw(new StoryList(), { init: () => {} })).el;
    const card = texts(byId(el, "stories-limit"));
    assert.equal(card[0], title);
    assert.match(card[1], line);
    const fresh = texts(byId(el, "stories-fresh"));
    assert.ok(!fresh.some((x) => /GitHub/.test(x)), "said once, in the card, not cut off on the freshness line");
    assert.ok(byId(el, "story-ACME-142"), "the stories stay");
    if (limit === "used") assert.ok(fresh.some((x) => /10m ago/.test(x)), "shown as old as they are, not as just loaded");
  });
}

test("the demo's GitHub limit is off as the fixture comes", async () => {
  world();
  const { el } = await draw(new StoryList());
  assert.equal(byId(el, "stories-limit"), null);
});
