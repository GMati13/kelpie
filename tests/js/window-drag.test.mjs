// Moving the window (#107): in each column only the top row moves it. Herdr's `window_drag` is a fixed
// setting per layout block, so the layouts give it to the story's title row ("story-head") and to the
// tab bar, and the tab bar keeps every press itself while a title row is above it: dragging it, or
// the details' divider just above it, never moves the window then.
import { DEMO, draw, fakeCx, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock } from "herdr";
import { nodeOf } from "gpui-kit";
import { byId } from "../lib/snapshot.mjs";
import { repoFile } from "../lib/helpers.mjs";
import { Stories, StoryList } from "../../mods/kelpie/stories.js";
import Quiet from "../../mods/kelpie/main.js";
import { GRIP, TAB_BAR, syncHub } from "../../mods/kelpie/work.js";

const LAYOUTS = ["Kelpie", "Kelpie-Plain"];
const nodes = (n, out = []) => { out.push(n); (n.children ?? []).forEach((c) => nodes(c, out)); return out; };
const readLayout = (name) => JSON.parse(readFileSync(repoFile(`layouts/${name}.json`), "utf8"));

let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

for (const name of LAYOUTS) {
  test(`${name}: only the sidebar's top row, the story's title row and the tab bars move the window`, () => {
    const dragging = nodes(readLayout(name)).filter((n) => n.window_drag).map((n) => n.id).sort();
    assert.deepEqual(dragging, ["side-top", "story-head", "toolbar", "toolbar-start"]);
  });

  // #276: Herdr takes a press up to 3px either side of a divider's line as a drag of it (measured on
  // Herdr 0.1.15 and 0.1.16), and while dragging puts the boundary itself under the pointer. The tab
  // bar right under the details' divider keeps its presses (above) and its block moves the window, so
  // the grab's lower half did nothing there. A gap in the details column moved the grab off it but
  // left the pointer on the grab's edge as it dragged (the boundary is the gap's top), and the cursor
  // flickered. So no gap: the tab bar's column starts with a strip that takes no press and moves no
  // window, as tall as the grab below the line.
  test(`${name}: the details' divider can be grabbed anywhere Herdr takes it, none of it over the tab bar`, () => {
    const all = nodes(readLayout(name));
    const details = all.find((n) => n.id === "details");
    assert.equal(details.resizable, true, "the details' split is draggable");
    assert.equal(details.gap ?? 0, 0, "no gap: the boundary Herdr drags stays the line, under the pointer");
    assert.deepEqual(details.children.map((c) => c.id), ["story-body", "lower"]);
    const bar = details.children[1].children[0];
    assert.equal(bar.id, "tab-bar", "the tab bar's column is right under the divider");
    assert.equal(bar.divider, undefined, "no line between the strip and the tab bar");
    assert.deepEqual(bar.children.map((c) => c.id), ["tab-grip", "toolbar"]);
    const grip = bar.children[0];
    assert.ok(!grip.window_drag, "the strip never moves the window");
    assert.equal(grip.content?.props?.role, "grip");
    assert.deepEqual([grip.size, grip.min, grip.max], [{ px: GRIP }, GRIP, GRIP]);
    assert.ok(GRIP >= 3, "the strip holds the grab below the line");
    assert.equal(grip.hidden, true, "hidden until the details show, as they are");
    assert.deepEqual([bar.size, bar.min, bar.max], [{ px: TAB_BAR }, TAB_BAR, TAB_BAR + GRIP]);
    assert.equal(bar.children[1].size.px, TAB_BAR);
  });

  test(`${name}: the tab bars leave no edge of their block to drag by (their padding is the mod's)`, () => {
    for (const id of ["toolbar", "toolbar-start"]) {
      const block = nodes(readLayout(name)).find((n) => n.id === id);
      assert.equal(block.padding, undefined, `${id} has no padding of its own`);
    }
  });
}

// The tab bar's root element, drawn with `head` (the story's title row) shown or hidden.
function tabBar({ space = null, preview = null, head = true, slot = "" } = {}) {
  setupDemoWorld({ stories, shown: space, props: { role: "toolbar", ...(slot ? { slot } : {}) } });
  if (preview) mock.state.shared.set("kelpie.stories.preview", { [DEMO]: preview });
  nodes(mock.state.layout).find((n) => n.id === "story-head").hidden = !head;
  const cx = { ...fakeCx(), spawn() {} };
  const view = new Quiet({});
  view.init({}, cx);
  return view.render(cx);
}
// Whether a left press on the element itself (not one of its children) stops there.
function keepsPresses(el) {
  const press = nodeOf(el).calls.find(([m, a]) => m === "on_mouse_down" && a[0] === "left");
  if (!press) return false;
  let stopped = false;
  press[1].find((v) => typeof v === "function")({}, { stop_propagation: () => { stopped = true; } });
  return stopped;
}

test("under a story's title row, the tab bar keeps every press: dragging it never moves the window", () => {
  assert.ok(keepsPresses(tabBar({ space: "ACME-142" })), "a story's space");
  assert.ok(keepsPresses(tabBar({ preview: "ACME-138" })), "a story previewed");
  assert.ok(keepsPresses(tabBar({ preview: "ACME-180", slot: "start" })), "a story not started (the bottom tab bar)");
});

test("with no story shown, the tab bar is the top row and drags the window as before", () => {
  assert.ok(!keepsPresses(tabBar({ space: "Desk", head: false })), "the Desk");
});

test("the title row's key and status chip keep their presses, so a click on them never starts a window drag", async () => {
  setupDemoWorld({ stories, shown: "ACME-142" });
  const el = await draw(new Stories()).then((d) => d.el);
  assert.ok(keepsPresses(byId(el, "story-key")), "the key");
  assert.ok(keepsPresses(byId(el, "story-status-menu-more")), "the status chip");
});

// The strip over the tab bar shows while the details do, and its column is as tall as the strip and
// the tab bar, so folding leaves no band under the tab bar.
function synced({ folded = false, ...setup }) {
  setupDemoWorld({ stories, ...setup });
  if (folded) mock.state.shared.set("kelpie.storyhead.folded", true);
  mock.on.run = (name, args) => {
    const n = nodes(mock.state.layout).find((x) => x.id === args?.id);
    if (n && (name === "layout.show" || name === "layout.hide")) n.hidden = name === "layout.hide";
    if (n && name === "layout.resize") n.size = args.px != null ? { px: args.px } : { weight: args.weight };
    return undefined;
  };
  syncHub();
  const of = (id) => nodes(mock.state.layout).find((x) => x.id === id);
  return { grip: !of("tab-grip").hidden, bar: of("tab-bar").size.px, body: !of("story-body").hidden };
}

test("the strip over the tab bar shows with the details, and the tab bar's column grows by it", () => {
  assert.deepEqual(synced({ shown: "ACME-142" }), { grip: true, bar: TAB_BAR + GRIP, body: true });
});

test("folded details, or no story, leave the tab bar its own height with no strip", () => {
  assert.deepEqual(synced({ shown: "ACME-142", folded: true }), { grip: false, bar: TAB_BAR, body: false });
  assert.deepEqual(synced({ shown: "Desk" }), { grip: false, bar: TAB_BAR, body: false });
});
