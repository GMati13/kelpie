// Showing agents that wait on you (#252): an agent whose turn ended waiting on the person (#251,
// shared `kelpie.waiting`) has its own mark wherever an agent's mark shows, and its story ranks after
// the blocked ones, the question on its row.
import { DEMO, NOW, draw, fakeCx, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, texts } from "gpui-kit";
import { byId, render } from "../lib/snapshot.mjs";
import { StoryList, getNextRequest, goNext, need, needQueueOf, queueRow, storyItems, withDrop } from "../../mods/kelpie/stories.js";
import { forgetTurns, noteTurns } from "../../mods/kelpie/triage.js";
import { put, tempDir, until } from "../lib/helpers.mjs";
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

// Next (#252): blocked first, then the agents waiting on you (their own asks too, one row per agent),
// then your pull requests' needs, then finished turns to check, then the reviews.
const queue = () => { const s = storyItems(); return needQueueOf(s.st.profile, s.items, s.reviews, s.st.data); };

test("Next: blocked, then waiting on you, then your pull requests' needs, then finished turns, then reviews", () => {
  const { w } = world();
  const done = w.agents.find((x) => x.tab_name === "ACME-127");
  const all = mock.state.shared.get("kelpie.waiting");
  mock.state.shared.set("kelpie.waiting", { [DEMO]: { ...all[DEMO], [done.address]: { state: "ready", kind: "done", line: "Check the banner shows once after the laptop wakes", at: NOW } } });
  const keys = queue().map((x) => x.key);
  const at = (k) => keys.findIndex((x) => x.startsWith(k));
  assert.ok(at("ACME-142") < at("ask:"), "the blocked story first");
  assert.ok(at("ask:") >= 0 && at("wait:") >= 0, "the agent's own ask and the agent found waiting");
  assert.ok(at("wait:") < at("ACME-160"), "before changes requested");
  assert.ok(at("ACME-171") < at("ready:"), "ready to merge before finished turns");
  assert.ok(at("ready:") < at("review:"), "finished turns before the reviews");
  assert.ok(!keys.includes("ACME-151"), "the waiting story is its agent's row, not a row of its own too");
  const wait = queue().find((x) => x.key.startsWith("wait:"));
  assert.equal(wait.wait.line, QUESTION);
  assert.equal(wait.it.key, "ACME-151");
});

test("an agent that asked through Next itself has one row: its ask", () => {
  const { a } = world();
  mock.state.shared.set("kelpie.next.asks", { [DEMO]: [{ id: "q1", at: NOW, action: "Add the CI secret", terminal: a.address, tab: "ACME-152" }] });
  const rows = queue().filter((x) => x.ask?.terminal === a.address || x.agent?.address === a.address);
  assert.deepEqual(rows.map((x) => x.key), ["ask:q1"]);
});

test("a click shows the agent and leaves it waiting; its ✕ sets it aside until its next turn", async () => {
  const { a } = world();
  const s = storyItems();
  const wait = queue().find((x) => x.key.startsWith("wait:"));
  const before = mock.calls.length;
  goNext(s.st.profile, wait);
  const ran = mock.calls.slice(before).filter((c) => c.fn === "run");
  assert.deepEqual(ran.find((c) => c.args[0] === "pane.focus")?.args[1], { pane: a.pane }, "shows the agent");
  assert.ok(waitsOnYou(a), "still waiting: a click doesn't answer it");
  const row = withDrop(skinTheme(), s.st.profile, wait, queueRow(skinTheme(), wait, false, () => {}));
  handlers(row).find((h) => h.id === `queue-drop-${wait.key}`).fn({}, { stop_propagation() {} });
  assert.equal(mock.sharedValue("kelpie.waiting")[DEMO][a.address].aside, true);
  assert.ok(!queue().some((x) => x.key.startsWith("wait:")), "set aside");
  assert.equal(agentStatus(a), "done", "its mark is Herdr's again");
});

test("its pane focused marks it seen, and Next draws it dimmer", () => {
  const { a } = world();
  forgetTurns();
  mock.state.focused = { space: a.space, tab: a.tab, pane: a.pane };
  noteTurns();
  assert.equal(mock.sharedValue("kelpie.waiting")[DEMO][a.address].seen, true);
  const wait = queue().find((x) => x.key.startsWith("wait:"));
  assert.match(render(queueRow(skinTheme(), wait, false, () => {}), skinTheme()), /opacity/);
});

test("get_next names it as an agent waiting, with its story", async () => {
  const { a } = world();
  const home = tempDir();
  mock.state.appHome = home;
  mock.on.exec = (c, args, o) => mock.realExec(c, args, { ...o, env: { PATH: process.env.PATH } });
  put(`${home}/kelpie/next-get.json`, JSON.stringify({ account: "", terminal: a.address }));
  const r = await getNextRequest();
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.items.find((x) => x.kind === "agent-waiting"), { kind: "agent-waiting", key: "ACME-151", action: QUESTION, detail: "ACME-151 · ACME-152's agent" });
});

// The footer (#252): blocked agents and agents waiting on you, counted apart; a click goes to the most
// urgent: blocked first, then the longest waiting.
import quietPages from "../../mods/kelpie/skins/quiet-pages.js";
import { command } from "../../mods/kelpie/main.js";
import { mark } from "../../mods/kelpie/ui.js";
import { attention } from "../../mods/kelpie/attention.js";
const footer = () => quietPages.footerExtras(skinTheme(), { mark: (s, z) => mark(skinTheme(), s, z) });
const tipOf = (el) => render(el, skinTheme()).match(/tip="([^"]*)"/)?.[1];

test("the footer counts both, says both, and goes to the blocked one first, then the waiting one", async () => {
  const { w, a } = world({ layout: "Kelpie" });
  const blocked = w.agents.find((x) => x.status === "blocked");
  mock.state.focused = { space: blocked.space, tab: blocked.tab, pane: blocked.pane };
  const tree = render(footer(), skinTheme());
  assert.ok(tree.includes("circle-help"), "the waiting mark beside the safelight");
  assert.equal(tipOf(footer()), "An agent needs you · 1 waiting on you: show the next");
  const before = mock.calls.length;
  await command("next-agent");
  assert.deepEqual(mock.calls.slice(before).filter((c) => c.fn === "run" && c.args[0] === "pane.focus").map((c) => c.args[1]), [{ pane: a.pane }], "the waiting one, as the blocked one is shown");
});

test("only agents waiting: their count alone, and its words", () => {
  const { w } = world({ layout: "Kelpie" });
  for (const x of w.agents) if (x.status === "blocked") x.status = "idle";
  const { n, w: waiting, words } = attention();
  assert.deepEqual([n, waiting], [0, 1]);
  assert.equal(words, "An agent is waiting on you: show it");
  assert.ok(!render(footer(), skinTheme()).includes("e8603f"), "no safelight");
});

// The notification (#252): only when the profile asks for it, once per turn, never for the agent shown.
describe("telling you an agent waits", () => {
  const setup = ({ waiting, focused = false } = {}) => {
    const w = setupDemoWorld({ stories, profile: waiting === undefined ? {} : { notify: { waiting } } });
    forgetTurns();
    const a = w.agents.find((x) => x.tab_name === "ACME-152");
    if (focused) mock.state.focused = { space: a.space, tab: a.tab, pane: a.pane };
    a.status = "working";
    noteTurns();
    a.status = "done";
    noteTurns();
    return a;
  };
  const told = () => mock.of("notify").filter(([n]) => /waiting on you/.test(n.title));
  test("on: one notification with the question; its click shows the agent", async () => {
    const a = setup({ waiting: true });
    await until(() => told().length === 1, 3000, "told");
    const [n] = told()[0];
    assert.equal(n.title, "ACME-152's agent is waiting on you");
    assert.equal(n.body, QUESTION);
    assert.match(n.action.name, /^kelpie\.show-waiting-[a-z0-9]+$/);
    const before = mock.calls.length;
    await command(n.action.name.slice("kelpie.".length));
    assert.deepEqual(mock.calls.slice(before).filter((c) => c.fn === "run" && c.args[0] === "pane.focus").map((c) => c.args[1]), [{ pane: a.pane }]);
  });
  test("off by default, and never for the agent you're looking at", async () => {
    setup();
    await until(() => mock.sharedValue("kelpie.waiting")?.[DEMO], 3000);
    assert.equal(told().length, 0, "off by default");
    setup({ waiting: true, focused: true });
    await until(() => mock.sharedValue("kelpie.waiting")?.[DEMO], 3000);
    assert.equal(told().length, 0, "not for the agent shown");
  });
});
