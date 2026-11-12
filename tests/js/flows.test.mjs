// Flows driven through their real entry points on the demo's world (#18: built and tested in parts,
// but never clicked through end to end): Pause in the demo, ⌥⌘C on a story with a space, a pull
// request button while the story's agent is still starting, and the key loop staying free while a
// clean-up runs.
import { DEMO, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers } from "gpui-kit";
import { Stories, StoryList, storyItems, storyNow } from "../../mods/kelpie/stories.js";
import { command } from "../../mods/kelpie/main.js";

const note = () => mock.sharedValue("kelpie.stories.note")?.[DEMO]?.text ?? "";
const runs = (name) => mock.of("run").filter(([n]) => n === name).map(([, a]) => a);
// What hc get says of a demo agent's terminal: the stand-in's shell, which keeps no session file.
const standIn = () => {
  mock.on.hc = (args) => (args[0] === "get" ? { code: 0, stdout: JSON.stringify({ foreground: { pid: 4242, name: "sh" } }), stderr: "" } : undefined);
};

describe("the demo's flows", async () => {
  setupDemoWorld();
  const stories = await loadStories(StoryList);
  const agentsOf = (key) => {
    const it = storyItems().items.map((x) => x.it).find((x) => x.key === key);
    return mock.state.agents.filter((a) => a.space === it?.space?.id);
  };

  test("Pause on a demo agent keeps a session the stand-in resumes, and closes its tab", async () => {
    setupDemoWorld({ shown: "ACME-142", stories });
    standIn();
    const [a] = agentsOf("ACME-142");
    assert.ok(a, "ACME-142 has an agent in the demo");
    mock.state.focused = { terminal: a.address, pane: a.pane, tab: a.tab, space: a.space };
    // A working agent asks twice (⌥⌘P's second press); an idle one goes at once: press twice either way.
    await storyNow().pause();
    await storyNow().pause();
    const paused = Object.values(mock.sharedValue("kelpie.paused")?.[DEMO] ?? {}).flat();
    assert.ok(paused.some((p) => p.sessionId.startsWith("demo-") && p.name === a.tab_name), `a demo session kept for ${a.tab_name}`);
    assert.ok(runs("tab.close").some((x) => x.id === a.tab) || runs("pane.close").some((x) => x.pane === a.pane), "its tab or pane closes");
    assert.doesNotMatch(note(), /no Claude session found/);
  });

  test("⌥⌘C on a story with a space opens a tab on every press", async () => {
    setupDemoWorld({ shown: "ACME-142", stories });
    await storyNow().claude();
    await storyNow().claude();
    assert.equal(runs("tab.new").length, 2, "two presses, two Claude tabs");
  });

  test("a pull request button while the story's agent is still starting says so, not \"Asked\"", async () => {
    // ACME-151's failing checks are on ACME-152's pull request; with no agents, Fix checks starts one.
    setupDemoWorld({ stories, agentOf: (s) => (s.name === "ACME-151" ? null : undefined) });
    mock.state.agents = mock.state.agents.filter((a) => mock.state.spaces.find((s) => s.id === a.space)?.name !== "ACME-151");
    mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-151" });
    mock.state.shared.set("kelpie.launching", { "ACME-151": { at: Date.now(), done: null } });
    const { el, cx } = await draw(new Stories());
    const fix = handlers(el).find((h) => h.id === "story-ask-fix");
    assert.ok(fix, "Fix checks is the header's action");
    fix.fn({}, cx);
    assert.doesNotMatch(note(), /^Asked/);
    assert.match(note(), /still starting/);
    assert.equal(runs("space.new").length + runs("tab.new").length, 0, "nothing launched twice");
  });

  test("a clean-up from its dialog doesn't hold the key loop", async () => {
    // ACME-122 left a ticket folder, and the profile has a clean-up command for it.
    setupDemoWorld({ stories, profile: { commands: { cleanUp: "rm -rf worktrees/{key}" } } });
    mock.state.shared.set("kelpie.clean.leftovers", { [DEMO]: { found: { "ACME-122": { "ACME-122": ["worktrees/ACME-122"] } } } });
    // Everything the clean-up waits on never answers.
    mock.on.exec = () => new Promise(() => {});
    mock.on.hc = () => new Promise(() => {});
    const done = await Promise.race([command("clean-story-ACME-122").then(() => "returned"), new Promise((r) => setTimeout(() => r("held"), 200))]);
    assert.equal(done, "returned");
    const all = await Promise.race([command("clean-all").then(() => "returned"), new Promise((r) => setTimeout(() => r("held"), 200))]);
    assert.equal(all, "returned");
  });
});
