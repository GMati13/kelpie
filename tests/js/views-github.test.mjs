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

// KELPIE-129: GitHub's limit as the demo plays it (fixture github.limit, demo.js demoLimit()): used up,
// the stories stay and the freshness line says when Kelpie tries again; running low, it says it loads
// less often. Its time is the clock's, so the words are checked rather than snapshotted.
for (const [limit, said] of [["used", /^· GitHub's limit for this account is used up: Kelpie tries again at \d+:\d\d [AP]M$/], ["low", /^· GitHub's limit for this account is running low: Kelpie loads less often until \d+:\d\d [AP]M$/]]) {
  test(`the demo's GitHub limit ${limit === "used" ? "used up" : "running low"}: the freshness line says so`, async () => {
    world({ stories: { ...stories, at: Date.now() - 10 * 60e3 } }); // loaded 10 minutes ago
    // The fixture as read from disk, with its github.limit set.
    const text = readFileSync(new URL("../../mods/kelpie/demo/demo.json", import.meta.url), "utf8");
    const base = mock.on.readTextFile;
    mock.on.readTextFile = (path, ...rest) => (String(path).endsWith("demo/demo.json") ? JSON.stringify({ ...JSON.parse(text), github: { limit, resets: "+25m" } }) : base?.(path, ...rest));
    const { cx } = await draw(new StoryList());
    await cx.settle();
    const el = (await draw(new StoryList(), { init: () => {} })).el;
    const line = texts(byId(el, "stories-fresh"));
    assert.ok(line.some((x) => said.test(x)), line.join(" | "));
    assert.ok(byId(el, "story-ACME-142"), "the stories stay");
    if (limit === "used") assert.ok(!line.some((x) => /just now/.test(x)), "shown as old as they are, not as just loaded");
  });
}

test("the demo's GitHub limit is off as the fixture comes", async () => {
  world();
  const { el } = await draw(new StoryList());
  assert.ok(!texts(byId(el, "stories-fresh")).some((x) => /GitHub's limit/.test(x)));
});
