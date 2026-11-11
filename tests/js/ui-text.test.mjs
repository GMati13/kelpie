// What the UI says in words (#32): plain, accurate, one wording for one thing, no internal names.
// Each test pins a wording that was wrong once.
import { DEMO, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { render } from "../lib/snapshot.mjs";
import { StoryList } from "../../mods/kelpie/stories.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";

let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

const sidebar = async (opts = {}) => {
  setupDemoWorld({ stories, ...opts });
  return render((await draw(new StoryList())).el, skinTheme());
};

// The subtasks' tooltip names the board's handover column (the demo's is QA), not "testing", which
// only some boards have.
test("a story row's subtasks tooltip names the handover column", async () => {
  const out = await sidebar();
  assert.match(out, /Your subtasks: 0 of 1 past QA · 1 in QA/);
  assert.doesNotMatch(out, /testing/);
});

// The list's counts read as a sentence in their tooltips: "1 needs you", "2 need you".
test("the story list's counts agree with their number", async () => {
  const out = await sidebar();
  assert.match(out, /tip="1 needs you"/);
  assert.doesNotMatch(out, /tip="1 need you"/);
});
