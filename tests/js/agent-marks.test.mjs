// An agent's state has one mark, wherever it shows (ui.js agentMark(), #101): the tab bar's slot, a
// split pane's header, the sidebar's agent rows and a subtask's slot draw the same mark for the same
// state, in both layouts; no two states look alike (unknown isn't idle's look); only working and
// needs you move; and a tab with an agent always shows its state, never the program's icon.
import { setupDemoWorld, fakeCx, loadStories } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { byId, matchSnapshot, render } from "../lib/snapshot.mjs";
import { agentMark } from "../../mods/kelpie/ui.js";
import { PaneHead } from "../../mods/kelpie/panes.js";
import { StoryList } from "../../mods/kelpie/stories.js";
import Quiet from "../../mods/kelpie/main.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";

const LAYOUTS = ["Kelpie", "Kelpie-Plain"];
// Herdr's statuses, null (a Claude that hasn't reported one yet) and Kelpie's own "paused".
const STATES = { blocked: "needs you", working: "working", done: "done", idle: "idle", null: "unknown", paused: "paused" };
const status = (k) => (k === "null" ? null : k);
const PLACES = ["tab", "pane", "side-tab", "sub"];
const draw = (el) => render(el, skinTheme());
const indent = (text, by) => text.trimEnd().split("\n").map((l) => by + l).join("\n");

let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

// The demo's ACME-142 space shown, its first tab's agent (ACME-143) in `state`: null keeps its pane a
// Claude's but drops it from the agents and the tab's status, as Herdr does before it reports.
function world(layout, state, props = { role: "toolbar" }) {
  const w = setupDemoWorld({ stories, shown: "ACME-142", layout, props });
  const tab = w.spaces[0].tabs[0];
  tab.status = state;
  mock.state.panes.find((p) => p.tab === tab.id).status = state;
  mock.state.agents = state ? w.agents.map((a) => (a.tab === tab.id ? { ...a, status: state } : a)) : w.agents.filter((a) => a.tab !== tab.id);
  return tab;
}

for (const layout of LAYOUTS) {
  test(`${layout}: one mark per agent state, the same in every place`, () => {
    setupDemoWorld({ layout });
    const seen = new Map();
    for (const k of Object.keys(STATES)) {
      const [first, ...rest] = PLACES.map((where) => draw(agentMark(skinTheme(), status(k), { where })));
      rest.forEach((r, i) => assert.equal(r, first, `${STATES[k]}: ${PLACES[i + 1]} draws it as the tab does`));
      assert.ok(!seen.has(first), `${STATES[k]} looks like ${seen.get(first)}`);
      seen.set(first, STATES[k]);
      // Motion only while something happens: working moves, needs you pulses, the rest hold still.
      assert.equal(first.includes("~"), k === "working" || k === "blocked", `${STATES[k]}: ${first}`);
    }
  });

  test(`${layout}: a Claude's tab shows its state in every state, never the program's icon`, () => {
    const out = [];
    for (const k of ["blocked", "working", "done", "idle", "null"]) {
      const tab = world(layout, status(k));
      // The program has an icon, so a tab that fell back to it would show it.
      mock.state.panes.find((p) => p.tab === tab.id).program = { name: "Claude Code", agent: true, icon: "icons/claude.svg", tint: true };
      const cx = { ...fakeCx(), spawn() {} };
      const view = new Quiet({});
      view.init({}, cx);
      const el = byId(view.render(cx), `tab-${tab.id}`);
      const text = draw(el);
      assert.ok(!text.includes("claude.svg"), `${STATES[k]}: no program icon`);
      assert.ok(text.includes(indent(draw(agentMark(skinTheme(), status(k), { where: "tab" })), "    ")), `${STATES[k]}: its mark in the slot`);
      out.push(`== ${STATES[k]}\n${text}`);
    }
    matchSnapshot(`${layout === "Kelpie" ? "toolbar" : "plain/toolbar"}/agent-states`, out.join(""));
  });

  test(`${layout}: a split pane's header leads with the same mark as its tab`, () => {
    for (const k of ["blocked", "working", "done", "idle", "null"]) {
      const tab = world(layout, status(k));
      const p = mock.state.panes.find((x) => x.tab === tab.id);
      p.pane = p.id;
      mock.state.props = { role: "pane-head", pane: p.id };
      const head = new PaneHead();
      head.init();
      const mark = byId(head.render(fakeCx()), `pane-mark-${p.id}`);
      assert.ok(mark, `${STATES[k]}: a mark`);
      assert.ok(draw(mark).includes(indent(draw(agentMark(skinTheme(), status(k), { where: "pane" })), "  ")), STATES[k]);
    }
  });
}

test("a tab with no agent keeps its program's icon", () => {
  const w = setupDemoWorld({ stories, shown: "ACME-142", props: { role: "toolbar" } });
  const tab = w.spaces[0].tabs[1];
  mock.state.panes.find((p) => p.tab === tab.id).program = { name: "zsh", icon: "icons/zsh.svg", tint: true };
  const cx = { ...fakeCx(), spawn() {} };
  const view = new Quiet({});
  view.init({}, cx);
  assert.match(draw(byId(view.render(cx), `tab-${tab.id}`)), /zsh\.svg/);
});
