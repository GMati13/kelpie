// Showing agents that wait on you (#252): an agent whose turn ended waiting on the person (#251,
// shared `kelpie.waiting`) has its own mark wherever an agent's mark shows, and its story ranks after
// the blocked ones, the question on its row.
import { DEMO, NOW, draw, fakeCx, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { texts } from "gpui-kit";
import { byId, render } from "../lib/snapshot.mjs";
import { StoryList, need, storyItems } from "../../mods/kelpie/stories.js";
import { agentStatus, waitsOnYou } from "../../mods/kelpie/attention.js";
import { PaneHead } from "../../mods/kelpie/panes.js";
import Quiet from "../../mods/kelpie/main.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";

const QUESTION = "Can you add it to the CI secrets, or should I skip that test on CI for now?";
let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

// The demo with ACME-152's agent (ACME-151's subtask, done in the fixture) waiting on you.
function world(opts = {}, entry = {}) {
  const w = setupDemoWorld({ stories, ...opts });
  const a = w.agents.find((x) => x.tab_name === "ACME-152");
  mock.state.shared.set("kelpie.waiting", { [DEMO]: { [a.address]: { state: "waiting", kind: "choice", line: QUESTION, at: NOW - 5 * 60e3, turn: "u1", tab: "ACME-152", ...entry } } });
  return { w, a };
}
// The story rows' ids, in the order the list draws them.
const rowsOf = (el) => [...render(el, skinTheme()).matchAll(/#(story-ACME-\d+)\b/g)].map((m) => m[1]);

test("an agent waits on you only while it rests, and not once set aside", () => {
  const { a } = world();
  assert.equal(agentStatus(a), "asks");
  assert.equal(waitsOnYou(a).line, QUESTION);
  assert.equal(agentStatus({ ...a, status: "working" }), "working", "working again: Herdr's state");
  assert.equal(agentStatus({ ...a, status: "blocked" }), "blocked", "blocked: needs you now");
  world({}, { aside: true });
  assert.equal(agentStatus(a), "done", "set aside: Herdr's state");
  world({}, { state: "ready" });
  assert.equal(agentStatus(a), "done", "finished with something to check is no wait");
});

test("its story ranks after the blocked ones, before changes requested, its question on its row", async () => {
  world();
  const it = storyItems().items.find((x) => x.it.key === "ACME-151").it;
  assert.deepEqual(need(it), [0.5, `ACME-152's agent: ${QUESTION}`, "working"]);
  const { el } = await draw(new StoryList());
  assert.deepEqual(texts(byId(el, "waits-ACME-151")), [QUESTION]);
  const rows = rowsOf(el);
  assert.ok(rows.indexOf("story-ACME-142") < rows.indexOf("story-ACME-151"), "the blocked one first");
  assert.ok(rows.indexOf("story-ACME-151") < rows.indexOf("story-ACME-160"), "before changes requested");
  assert.ok(render(byId(el, "story-ACME-151"), skinTheme()).includes("circle-help"), "led by the waiting mark");
  assert.ok(byId(el, "count-asks"), "counted in the list's summary");
});

test("without it, the story is as before", async () => {
  setupDemoWorld({ stories });
  const it = storyItems().items.find((x) => x.it.key === "ACME-151").it;
  assert.equal(need(it)[0], 2, "checks failing");
  const { el } = await draw(new StoryList());
  assert.equal(byId(el, "waits-ACME-151"), null);
});

for (const layout of ["Kelpie", "Kelpie-Plain"]) {
  test(`${layout}: its tab and its pane's header show the waiting mark`, () => {
    const { w, a } = world({ shown: "ACME-151", layout, props: { role: "toolbar" } });
    const cx = { ...fakeCx(), spawn() {} };
    const view = new Quiet({});
    view.init({}, cx);
    const bar = render(view.render(cx), skinTheme());
    assert.ok(bar.includes("circle-help"), "the tab bar");
    const p = mock.state.panes.find((x) => x.tab === a.tab);
    p.pane = a.pane;
    mock.state.props = { role: "pane-head", pane: a.pane };
    p.status = "done";
    const head = new PaneHead();
    head.init();
    assert.ok(render(byId(head.render(fakeCx()), `pane-mark-${a.pane}`), skinTheme()).includes("circle-help"), "the pane's header");
    assert.ok(w);
  });
}
