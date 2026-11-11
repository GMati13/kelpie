// The profile picker's menu with many profiles and spaces (KELPIE-115): its list has a height of its
// own, so it scrolls rather than growing past the menu's end with the entries after it out of reach,
// ↑/↓ bring the lit row into view, opening brings the shown profile's, and a render reads each host
// list once however many profiles there are (render cost, #104).
import { DEMO, fakeCx, setupDemoWorld } from "../lib/views.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { nodeOf, handlers } from "gpui-kit";
import { byId } from "../lib/snapshot.mjs";
import { SpacePicker, menuHeight } from "../../mods/kelpie/workside.js";

// The demo with `n` more profiles (none with a space), the menu open.
function crowded(n) {
  setupDemoWorld({ shown: "ACME-142" });
  const all = { ...mock.sharedValue("kelpie.profiles") };
  for (let i = 0; i < n; i++) all[`more${i}`] = { id: `more${i}`, name: `More ${i}`, folder: `/home/test/more/${i}` };
  mock.state.shared.set("kelpie.profiles", all);
  mock.state.shared.set("kelpie.spacemenu", true);
  const cx = fakeCx(), picker = new SpacePicker();
  picker.init(cx);
  return { picker, cx };
}

const calls = (el, name) => nodeOf(el).calls.filter(([m]) => m === name).map(([, a]) => a);
const scrolls = (picker) => picker.scroll.__state.calls.filter(([m]) => m === "scroll_to_item").map(([, a]) => a[0]);
const listIds = (list) => calls(list, "children")[0][0].map((c) => nodeOf(c).calls.find(([m]) => m === "id")?.[1][0] ?? null);

test("a long menu's list has a height of its own and scrolls, its last entries inside it", () => {
  const { picker, cx } = crowded(30);
  const list = byId(picker.render(cx), "space-menu-list");
  const [[h]] = calls(list, "h");
  assert.equal(h, 520, "as tall as the menu may be, not as tall as its rows");
  assert.equal(calls(list, "max_h").length, 0, "a maximum alone let the list grow with its rows");
  assert.ok(nodeOf(list).calls.some(([m]) => m === "overflow_y_scrollbar"));
  assert.deepEqual(calls(list, "track_scroll").map(([s]) => s), [picker.scroll]);
  const ids = listIds(list);
  assert.ok(ids.includes("menu-profile-more29") && ids.includes("menu-space-new") && ids.includes("menu-profile-edit"),
    "the entries after the profiles are in the scrolling list");
});

test("a short menu is as tall as what it holds", () => {
  const { picker, cx } = crowded(0);
  const list = byId(picker.render(cx), "space-menu-list");
  const [[h]] = calls(list, "h");
  assert.ok(h < 520, `${h}`);
  // A heading, the demo's profile, a rule, then New space, New profile and Edit; 1 between each, 4 around.
  assert.equal(menuHeight([{ header: "Profiles" }, { action: 1 }, { rule: true }, { action: 1 }, { action: 1 }, { action: 1 }]),
    24 + 4 * 32 + 9 + 5 + 8);
});

test("↑/↓ bring the lit row into view", () => {
  const { picker, cx } = crowded(30);
  let menu = byId(picker.render(cx), "space-menu");
  const ids = listIds(byId(menu, "space-menu-list"));
  const key = (k) => { handlers(menu, "on_key_down")[0].fn({ key: k }, { stop_propagation() {}, notify() {} }); menu = byId(picker.render(cx), "space-menu"); };
  picker.scroll.__state.calls.length = 0;
  key("up"); // from no row lit: the last one
  assert.equal(scrolls(picker).at(-1), ids.indexOf("menu-profile-edit"));
  key("down"); // wraps to the first row
  assert.equal(scrolls(picker).at(-1), ids.indexOf(`menu-profile-${DEMO}`));
});

test("opening the menu brings the shown profile's row into view", () => {
  const { picker, cx } = crowded(30);
  mock.state.shared.set("kelpie.spacemenu", false);
  const bar = picker.render(cx);
  handlers(bar, "on_click").find((x) => x.id === "space-picker").fn();
  assert.equal(mock.sharedValue("kelpie.spacemenu"), true);
  const ids = listIds(byId(picker.render(cx), "space-menu-list"));
  assert.deepEqual(scrolls(picker), [0, ids.indexOf(`menu-profile-${DEMO}`)]);
  picker.render(cx);
  assert.equal(scrolls(picker).length, 2, "only once per opening, so the wheel isn't fought");
});

// The layout's name (a short string the skin is picked by) is read for each row, as in every list.
test("the menu reads each host list as often with 30 profiles as with 3", () => {
  const readsOf = (n) => {
    const { picker, cx } = crowded(n);
    picker.render(cx);
    mock.reads = {};
    picker.render(cx);
    const { "shared:layout": _skin, ...reads } = mock.reads;
    return reads;
  };
  assert.deepEqual(readsOf(30), readsOf(3));
});
