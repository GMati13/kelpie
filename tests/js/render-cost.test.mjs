// What a render costs as herdr-core fills up (#104). herdr-core lists every space, pane and agent
// of every Herdr window, and each host read converts the whole list into the mod engine, which is far
// slower than Node: views that re-read the lists for each space or agent grew with the square of
// what was open, past the time Herdr gives a render, and stayed "interrupted". So a render reads
// the same whatever else is open: these count the reads (the stub's `mock.reads`) with 30 and with
// 60 spaces of no profile open beside the demo's, each with an agent and a shell.
import { DEMO, draw, fakeCx, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { StoryList, Stories, StoryBody } from "../../mods/kelpie/stories.js";
import { spaceProfiles, spacesOf, profileById } from "../../mods/kelpie/config.js";
import Quiet from "../../mods/kelpie/main.js";
import { SpacePicker } from "../../mods/kelpie/workside.js";

let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

// `n` spaces in folders of no profile: other people's work, another window's.
function crowd(n) {
  for (let i = 0; i < n; i++) {
    const id = `x${i}`, folder = `/home/test/elsewhere/${i}`, tabs = [];
    for (const [j, agent] of [[0, true], [1, false]]) {
      const tab = `xt${i}-${j}`, pane = `xp${i}-${j}`;
      tabs.push({ id: tab, name: agent ? `OTHER-${i}` : "zsh", named: true, index: j + 1, active: agent, status: agent ? "working" : null });
      mock.state.panes.push({ id: pane, tab, cwd: folder, focused: agent, title: "zsh", program: { name: agent ? "Claude Code" : "zsh", agent } });
      if (agent) mock.state.agents.push({ address: `xa${i}`, space: id, tab, pane, tab_name: `OTHER-${i}`, status: "working", title: "", focused: false, program: { name: "Claude Code", agent: true } });
    }
    mock.state.spaces.push({ id, name: `OTHER-${i}`, folder, active: false, tabs });
  }
}

const total = (reads) => Object.values(reads).reduce((a, b) => a + b, 0);

// One render's host reads, after a first render and its loads.
// `elsewhere`: their folder is another profile's.
async function readsOf(n, { elsewhere = false, ...setup }, make) {
  setupDemoWorld({ stories, ...setup });
  if (elsewhere) mock.state.shared.set("kelpie.profiles", { ...mock.sharedValue("kelpie.profiles"), other: { id: "other", name: "Other", folder: "/home/test/elsewhere" } });
  crowd(n);
  const { view, cx } = await make();
  mock.reads = {};
  view.render(cx);
  return mock.reads;
}

const VIEWS = [
  ["the story list", {}, () => draw(new StoryList())],
  ["a story's title row", { shown: "ACME-142" }, () => draw(new Stories())],
  ["a story's details", { shown: "ACME-142" }, () => draw(new StoryBody())],
  ...["toolbar", "footer"].map((role) => [`the ${role}`, { shown: "ACME-142", props: { role } }, () => {
    const cx = { ...fakeCx(), spawn() {} }, view = new Quiet({});
    view.init({}, cx);
    view.render(cx);
    return { view, cx };
  }]),
  // The profile picker with its menu open. It lists each space in no profile, so these are another
  // profile's: the menu only counts them.
  ["the profile menu", { shown: "ACME-142", elsewhere: true }, () => {
    mock.state.shared.set("kelpie.spacemenu", true);
    const cx = fakeCx(), view = new SpacePicker();
    view.init(cx);
    view.render(cx);
    return { view, cx };
  }],
];

for (const [name, setup, make] of VIEWS) {
  test(`${name} reads as much with 60 other spaces open as with 30`, async () => {
    const some = await readsOf(30, setup, make), more = await readsOf(60, setup, make);
    assert.deepEqual(more, some, `${total(some)} reads with 30 other spaces, ${total(more)} with 60`);
  });
}

test("each space's profile comes from one read of each list", () => {
  setupDemoWorld();
  crowd(30);
  mock.reads = {};
  const of = spaceProfiles();
  assert.deepEqual(mock.reads, { spaces: 1, "shared:kelpie.space.profile": 1, "shared:kelpie.profiles": 1, panes: 1 });
  assert.equal(of.get("s0")?.id, DEMO, "the demo's spaces are the demo's");
  assert.equal(of.get("x0"), null, "a space in no profile's folder is no profile's");
  assert.equal(spacesOf(profileById(DEMO)).length, mock.state.spaces.length - 30);
});
