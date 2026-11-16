// The footer's attention mark (#250, Quiet Pages' safelight): it counts the agents waiting for you on a
// prompt, every profile's, so what it says and where its click goes must agree. Once its click went
// through the shown profile's Next and opened Clean up all while the agents it counted waited.
import { loadStories, setupDemoWorld } from "../lib/views.mjs";
import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, tree } from "gpui-kit";
import { StoryList, needQueueOf, storyItems } from "../../mods/kelpie/stories.js";
import { command } from "../../mods/kelpie/main.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";
import quietPages from "../../mods/kelpie/skins/quiet-pages.js";

let stories, world;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

// The demo, shown on ACME-142 with its blocked agent focused, and another profile ("Home") whose space
// has an agent waiting too.
beforeEach(() => {
  world = setupDemoWorld({ stories, shown: "ACME-142" });
  const mine = world.agents.find((a) => a.status === "blocked");
  mock.state.focused = { space: mine.space, tab: mine.tab, pane: mine.pane };
  mock.state.shared.set("kelpie.profiles", { ...mock.state.shared.get("kelpie.profiles"), home: { id: "home", name: "Home", folder: "/home-projects" } });
  mock.state.spaces.push({ id: "h0", name: "Garden", folder: "/home-projects", active: false, tabs: [{ id: "h0-t", name: "Garden", named: true, index: 1, active: true, status: "blocked" }] });
  mock.state.shared.set("kelpie.space.profile", { ...mock.state.shared.get("kelpie.space.profile"), h0: "home" });
  mock.state.agents.push({ ...mine, address: "h0-a", space: "h0", tab: "h0-t", pane: "h0-p", tab_name: "Garden" });
});

const mark = () => quietPages.footerExtras(skinTheme());
// What the mark says, its tooltip.
const tip = () => tree(mark()).calls.filter(([m]) => m === "tooltip").map(([, a]) => a[0]).at(-1);
// Clicks the mark, then runs the Kelpie command it asked for, as Herdr does.
async function click() {
  const before = mock.calls.length;
  handlers(mark()).find((h) => h.id === "qp-safelight").fn({}, {});
  const asked = mock.calls.slice(before).filter((c) => c.fn === "run" && String(c.args[0]).startsWith("kelpie."));
  assert.equal(asked.length, 1, "the click asks for one command");
  await command(asked[0].args[0].slice("kelpie.".length));
  return mock.calls.slice(before);
}
const ran = (calls, name) => calls.filter((c) => c.fn === "run" && c.args[0] === name).map((c) => c.args[1]);

test("with two agents waiting, one of them focused, the mark goes to the other, another profile's, not to Next", async () => {
  const s = storyItems();
  assert.ok(needQueueOf(s.st.profile, s.items, s.reviews, s.st.data).length > 1, "Next holds more than that agent's story");
  assert.equal(tip(), "2 agents need you: show the next");
  const calls = await click();
  assert.deepEqual(ran(calls, "pane.focus"), [{ pane: "h0-p" }]);
  assert.deepEqual(ran(calls, "space.select"), [{ id: "h0" }]);
  assert.ok(!calls.some((c) => c.fn === "openOverlay"), "no dialog (Clean up all) opens");
});

test("the only agent waiting already focused: the mark says it's here, and its click moves nothing", async () => {
  mock.state.agents = mock.state.agents.filter((a) => a.address !== "h0-a");
  assert.equal(tip(), "An agent needs you: it's here");
  const calls = await click();
  assert.deepEqual(ran(calls, "pane.focus"), []);
  assert.deepEqual(ran(calls, "space.select"), []);
  assert.ok(!calls.some((c) => c.fn === "openOverlay"));
});

test("no agent waiting: no mark", () => {
  for (const a of mock.state.agents) if (a.status === "blocked") a.status = "idle";
  assert.equal(mark(), null);
});
