// Folding a story's terminals away (#271): the lower block (the tab bar and the terminals) hides as
// it does for a story not started, the tab bar's copy at the column's foot shows, and the details
// take the column. Hidden, never resized, so it comes back at the height it had. The details' fold
// and this one exclude each other, or the column would be a title row over a tab bar.
import { loadStories, setupDemoWorld, DEMO } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { StoryList, foldTerminals, headFolded, storyNow, terminalsFolded } from "../../mods/kelpie/stories.js";
import { syncHub } from "../../mods/kelpie/work.js";

let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

const node = (root, id) => (root?.id === id ? root : (root?.children ?? []).map((c) => node(c, id)).find(Boolean) ?? null);
const hidden = (id) => Boolean(node(mock.state.layout, id)?.hidden);

// The demo with a story shown, the layout following show/hide and resizes as Herdr's does; `resizes`
// collects every layout.resize asked for.
function world(setup) {
  setupDemoWorld({ stories, ...setup });
  const resizes = [];
  mock.on.run = (name, args) => {
    if (name === "layout.show" || name === "layout.hide") { const n = node(mock.state.layout, args.id); if (n) n.hidden = name === "layout.hide"; }
    if (name === "layout.resize") { resizes.push(args); const n = node(mock.state.layout, args.id); if (n) n.size = args.px != null ? { px: args.px } : { weight: args.weight }; }
    return undefined;
  };
  return resizes;
}

test("folded: the lower block hides, the foot's tab bar shows, the details stay", () => {
  const resizes = world({ shown: "ACME-142" });
  syncHub();
  // The tab bar's column takes the strip over it while the details show (#276), once; from then on
  // folding and unfolding resize nothing.
  resizes.length = 0;
  assert.equal(hidden("lower"), false);
  assert.equal(hidden("toolbar-start"), true);
  const size = structuredClone(node(mock.state.layout, "lower").size);
  foldTerminals(true);
  syncHub();
  assert.equal(hidden("lower"), true);
  assert.equal(hidden("main-stack"), true);
  assert.equal(hidden("toolbar-start"), false);
  assert.equal(hidden("story-body"), false);
  foldTerminals(false);
  syncHub();
  assert.equal(hidden("lower"), false);
  assert.equal(hidden("main-stack"), false);
  assert.equal(hidden("toolbar-start"), true);
  assert.deepEqual(node(mock.state.layout, "lower").size, size, "its height is kept");
  assert.deepEqual(resizes, [], "nothing is resized");
});

test("the fold key goes through the shown story", () => {
  world({ shown: "ACME-142" });
  storyNow().foldTerminals();
  assert.equal(terminalsFolded(), true);
  storyNow().foldTerminals();
  assert.equal(terminalsFolded(), false);
});

test("folding the terminals brings the details back, and folding the details the terminals", () => {
  world({ shown: "ACME-142" });
  storyNow().fold();
  assert.equal(headFolded(), true);
  storyNow().foldTerminals();
  assert.equal(headFolded(), false);
  assert.equal(terminalsFolded(), true);
  syncHub();
  assert.equal(hidden("story-body"), false);
  storyNow().fold();
  assert.equal(headFolded(), true);
  assert.equal(terminalsFolded(), false);
  syncHub();
  assert.equal(hidden("lower"), false);
});

test("both folds left set (an older state): the details show", () => {
  world({ shown: "ACME-142" });
  mock.state.shared.set("kelpie.storyhead.folded", true);
  mock.state.shared.set("kelpie.terminals.folded", true);
  syncHub();
  assert.equal(hidden("story-body"), false);
  assert.equal(hidden("lower"), true);
});

test("a story not started has nothing to fold: the key does nothing", () => {
  world({});
  mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-180" });
  assert.equal(storyNow().view, "start");
  storyNow().foldTerminals();
  assert.equal(terminalsFolded(), false);
});

test("no story shown (the Desk): the fold is kept but changes nothing", () => {
  world({ shown: "Desk" });
  mock.state.shared.set("kelpie.terminals.folded", true);
  assert.equal(storyNow(), null);
  syncHub();
  assert.equal(hidden("lower"), false);
  assert.equal(hidden("toolbar-start"), true);
});

test("going to a terminal brings them back: a view picked, or the focus on another pane", () => {
  world({ shown: "ACME-142" });
  const first = mock.state.panes.find((p) => p.focused) ?? mock.state.panes[0];
  mock.state.focused = { pane: first.id, tab: first.tab };
  storyNow().foldTerminals();
  syncHub();
  assert.equal(terminalsFolded(), true, "the same pane focused keeps it folded");
  storyNow().show("changes");
  assert.equal(terminalsFolded(), false, "a view picked");
  storyNow().foldTerminals();
  const other = mock.state.panes.find((p) => p.id !== first.id);
  mock.state.focused = { pane: other.id, tab: other.tab };
  syncHub();
  assert.equal(terminalsFolded(), false, "another pane focused");
  assert.equal(hidden("lower"), false);
});
