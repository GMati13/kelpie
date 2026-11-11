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
