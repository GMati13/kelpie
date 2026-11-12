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
import { StoryList, Stories, StoryBody, storyItems } from "../../mods/kelpie/stories.js";
import { rendering, setShared } from "../../mods/kelpie/host.js";
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

// Each Herdr list and shared key is read once per render (#37): the helpers a render goes through
// each asked again (the tab bar read the spaces 19 times and every profile's stories twice, the story
// list the spaces 20 times), and every read converts its whole value. Herdr draws every Kelpie view
// through main.js, which keeps a render's reads (host.js), so these draw them that way, with the
// layout following its show/hide commands as Herdr's does, after a first draw that settles it.
const ROLES = [
  ["story-list", {}], ["story-list", { shown: "ACME-142" }], ["stories", { shown: "ACME-142" }], ["story-body", { shown: "ACME-142" }],
  ["story-view", { shown: "ACME-142" }], ["toolbar", { shown: "ACME-142" }], ["footer", { shown: "ACME-142" }],
  ["space-picker", { shown: "ACME-142" }], ["work-side", { shown: "ACME-142" }],
];
const node = (root, id) => (root?.id === id ? root : (root?.children ?? []).map((c) => node(c, id)).find(Boolean) ?? null);
for (const [role, setup] of ROLES) {
  test(`${role}${setup.shown ? ` (${setup.shown} shown)` : ""}: each list and shared key is read once a render`, async () => {
    setupDemoWorld({ stories, ...setup, props: { role } });
    crowd(30);
    mock.on.run = (name, args) => {
      if (name === "layout.show" || name === "layout.hide") { const n = node(mock.state.layout, args.id); if (n) n.hidden = name === "layout.hide"; }
      return undefined;
    };
    // The tab bar's and footer's own tasks (the key loop, the stats) never end under the stub.
    const loops = role === "toolbar" || role === "footer";
    const cx = { ...fakeCx(), ...(loops ? { spawn() {} } : {}) }, view = new Quiet({});
    view.init({}, cx);
    view.render(cx);
    await cx.settle();
    view.render(cx);
    mock.reads = {};
    mock.calls.length = 0;
    view.render(cx);
    const writes = mock.calls.filter((c) => ["setShared", "run", "hc"].includes(c.fn)).map((c) => `${c.fn} ${JSON.stringify(c.args[0])}`);
    assert.deepEqual(writes, [], "a settled render writes nothing");
    const again = Object.entries(mock.reads).filter(([, n]) => n > 1);
    assert.deepEqual(again, [], `read more than once in one render: ${again.map(([k, n]) => `${k} ×${n}`).join(", ")}`);
    // The list keeps its own stories: the shared copy, every profile's, is only its start.
    if (role === "story-list") assert.equal(mock.reads["shared:kelpie.stories.data"], undefined, "the list reads the shared stories");
  });
}

// The tab bar, the layout's sync and the keys each ask for the shown profile's stories: built once a
// render, again after anything is written.
test("the stories are worked out once a render", () => {
  setupDemoWorld({ stories, shown: "ACME-142" });
  rendering(() => {
    const first = storyItems();
    assert.ok(first?.items.length, "the demo's stories");
    assert.equal(storyItems(), first);
    setShared("kelpie.stories.preview", { [DEMO]: "ACME-180" });
    assert.notEqual(storyItems(), first, "worked out again after a write");
  });
  assert.notEqual(storyItems(), storyItems(), "outside a render, every time");
});
