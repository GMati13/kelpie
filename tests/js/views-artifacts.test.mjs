// The story's Artifacts view (stories.js StoryView, artifactsView): the Claude Artifacts its sessions
// published, from the demo's fixture, pinned as a snapshot (tests/README.md, Snapshots), with what its
// buttons do and what it says without any.
import { DEMO, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, texts } from "gpui-kit";
import { byId, matchSnapshot, render } from "../lib/snapshot.mjs";
import { StoryList, StoryView } from "../../mods/kelpie/stories.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";

let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

// The story whose space is `space`, its main area on Artifacts.
async function artifacts(space) {
  const w = setupDemoWorld({ stories, shown: space });
  mock.state.shared.set("kelpie.view", { [w.spaces.find((s) => s.name === space).id]: "artifacts" });
  return draw(new StoryView());
}

test("a story's Artifacts: newest first, who made each and when, and one made on another account", async () => {
  const { el } = await artifacts("ACME-190");
  const list = byId(el, "artifact-list-ACME-190");
  assert.ok(list, "the list");
  const words = texts(list);
  assert.deepEqual(words.filter((w) => ["Saved filters: what a new search reads back", "Filter edge cases"].includes(w)),
    ["Saved filters: what a new search reads back", "Filter edge cases"]);
  assert.ok(words.includes("By Read the last filters back on a new search · published 3 times, last 20h ago"));
  assert.ok(words.some((w) => /^Made on another Claude account \(~\/\.claude-personal\)/.test(w)), "the second's account");
  assert.equal(words.filter((w) => /another Claude account/.test(w)).length, 1, "only that one");
  assert.equal(mock.sharedValue("kelpie.stories.counts")["ACME-190"].artifacts, 2, "counted for the tab bar");
  matchSnapshot("story/artifacts", render(list, skinTheme()));
});

test("Open asks for the profile's Web panel, the icon for the person's browser", async () => {
  const { el, cx } = await artifacts("ACME-190");
  handlers(el).find((h) => h.id === "artifact-ACME-190-0-open").fn({}, cx);
  assert.deepEqual({ ...mock.sharedValue("kelpie.web.open"), at: 0 }, { profile: DEMO, url: "https://claude.ai/artifact/demo-filters-flow", at: 0 });
  handlers(el).find((h) => h.id === "artifact-ACME-190-1-out").fn({}, cx);
  assert.ok(mock.of("exec").some(([c, a]) => c === "open" && a[0] === "https://claude.ai/artifact/demo-filters-cases"));
});

test("a story none of whose agents published one says so", async () => {
  const { el } = await artifacts("ACME-142");
  assert.deepEqual(texts(el), ["No Artifacts yet. Pages this story's agents publish on claude.ai show here."]);
});
