// What the sidebar's top and foot draw, pinned as snapshots (tests/README.md, Snapshots): the footer's
// Claude limits line (main.js workClaude) as usual, near a limit (the reset time beside the share) and
// past a reset; the profile picker's row and its menu (workside.js SpacePicker).
import { fakeCx, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { texts } from "gpui-kit";
import { byId, matchSnapshot, render } from "../lib/snapshot.mjs";
import { StoryList } from "../../mods/kelpie/stories.js";
import { SpacePicker } from "../../mods/kelpie/workside.js";
import { demoNow } from "../../mods/kelpie/demo.js";
import Quiet from "../../mods/kelpie/main.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";

const snap = (name, el) => matchSnapshot(name, render(el, skinTheme()));
let stories, limits;
before(async () => {
  setupDemoWorld();
  stories = await loadStories(StoryList); // reads the fixture, whose limits the demo's footer shows
  limits = { ...demoNow().limits };
});

// The footer of the demo profile, its limits as the fixture's with `change` over them.
function footer(change = {}, layout = "Kelpie") {
  Object.assign(demoNow().limits, limits, change);
  setupDemoWorld({ stories, layout, props: { role: "footer" } });
  const cx = { ...fakeCx(), spawn() {} };
  const view = new Quiet({});
  view.init({}, cx);
  return view.render(cx);
}

for (const layout of ["Kelpie", "Kelpie-Plain"]) {
  test(`${layout}: the footer's limits`, () => {
    const el = footer({}, layout);
    assert.deepEqual(texts(byId(el, "acct-five")), ["5h", "38%"]);
    snap(`${layout === "Kelpie" ? "footer" : "plain/footer"}/limits`, el);
  });
}

test("near a limit, its reset time follows the share", () => {
  const el = footer({ five: 91, fiveResets: "+20m", week: 87, weekResets: "+2d" });
  assert.deepEqual(texts(byId(el, "acct-five")), ["5h", "91%", "20m"]);
  assert.deepEqual(texts(byId(el, "acct-week")), ["Week", "87%", "Thu"]);
  snap("footer/near-limit", lineOf(el));
});

test("a window whose reset time has passed says reset", () => {
  const el = footer({ fiveResets: "-5m" });
  assert.deepEqual(texts(byId(el, "acct-five")), ["5h", "reset"]);
  snap("footer/reset", lineOf(el));
});

// The account line's three cells: the account, its 5h and Week columns.
const lineOf = (el) => ["acct", "acct-five", "acct-week"].map((id) => byId(el, id));

test("the profile picker: its row, and the menu open", () => {
  setupDemoWorld({ stories, shown: "ACME-142" });
  mock.state.shared.set("kelpie.profiles", { ...mock.sharedValue("kelpie.profiles"), side: { id: "side", name: "Side project", folder: "/home/test/code/side" } });
  const picker = new SpacePicker();
  const cx = fakeCx();
  picker.init(cx);
  snap("footer/profile-row", picker.render(cx));
  mock.state.shared.set("kelpie.spacemenu", true);
  const open = picker.render(cx);
  assert.ok(byId(open, "menu-profile-demo") && byId(open, "menu-profile-side"));
  snap("footer/profile-menu", byId(open, "space-menu"));
});
