// The Dock badge (#286): how many agents need you, what the footer counts (blocked on a prompt plus
// waiting on you, every profile), set by the copy that follows what's shown only when the number
// changes, and cleared when none does.
import { DEMO, NOW, fakeCx, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { StoryList } from "../../mods/kelpie/stories.js";
import Quiet, { forgetBadge } from "../../mods/kelpie/main.js";
import { forgetTurns } from "../../mods/kelpie/triage.js";

let stories, world;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });
beforeEach(() => {
  // Triage off: this is about the badge, not about finding agents (triage.test.mjs).
  world = setupDemoWorld({ stories, shown: "ACME-142", props: { role: "footer" }, profile: { attention: { triage: false } } });
  forgetTurns();
  forgetBadge();
});

// One render of the footer, the copy that follows what's shown; what it set on the badge.
function draw() {
  const before = mock.calls.length;
  const cx = { ...fakeCx(), spawn() {} };
  const view = new Quiet({});
  view.init({}, cx);
  view.render(cx);
  return mock.calls.slice(before).filter((c) => c.fn === "setBadge").map((c) => c.args[0]);
}
const waiting = (tab) => {
  const a = world.agents.find((x) => x.tab_name === tab);
  mock.state.shared.set("kelpie.waiting", { [DEMO]: { [a.address]: { state: "waiting", line: "Which one?", at: NOW, turn: "u1" } } });
};

test("the number of agents blocked and waiting on you, set once while it doesn't change", () => {
  waiting("ACME-152");
  assert.deepEqual(draw(), ["2"], "ACME-143 blocked, ACME-152 waiting");
  assert.deepEqual(draw(), [], "the same number isn't set again");
});

test("it follows the count, and clears when nothing needs you", () => {
  assert.deepEqual(draw(), ["1"], "the blocked agent alone");
  waiting("ACME-152");
  assert.deepEqual(draw(), ["2"]);
  for (const a of mock.state.agents) if (a.status === "blocked") a.status = "idle";
  mock.state.shared.set("kelpie.waiting", {});
  assert.deepEqual(draw(), [null], "cleared");
});
