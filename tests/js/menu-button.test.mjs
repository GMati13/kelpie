// ui.js menuButton(): a press on an open menu stays on it. The popup is drawn over whatever lies under
// it, which gets the press next unless it's stopped: picking an open Claude in a story's Merge menu,
// opened from its row in the list, also opened the story under the menu, which hid the Claude the pick
// had just shown (KELPIE-120).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers } from "gpui-kit";
import { menuButton } from "../../mods/kelpie/ui.js";

const t = mock.state.theme;
const press = () => { const cx = { stopped: 0, notify() {}, stop_propagation() { this.stopped++; } }; return cx; };

test("an open menu stops presses and clicks from reaching what's under it", () => {
  let picked = 0;
  const host = { menu: "m" };
  const el = menuButton(host, t, "m", "Merge", [{ header: "Or send it to" }, { label: "Claude", action: () => { picked++; } }]);
  const downs = handlers(el, "on_mouse_down").filter((h) => h.id === "m-menu-list");
  const clicks = handlers(el, "on_click").filter((h) => h.id === "m-menu-list");
  assert.equal(downs.length, 1, "the menu's list stops a press");
  assert.equal(clicks.length, 1, "the menu's list stops a click");
  const cx = press();
  downs[0].fn({}, cx);
  clicks[0].fn({}, cx);
  assert.equal(cx.stopped, 2);
  // The row's own click still picks it (it runs first, then the list stops it going further).
  const row = handlers(el, "on_click").find((h) => h.id === "m-row-1");
  row.fn({}, press());
  assert.equal(picked, 1);
  assert.equal(host.menu, null, "picking closes the menu");
});

test("a closed menu stops nothing", () => {
  const el = menuButton({ menu: null }, t, "m", "Merge", [{ label: "Claude", action: () => {} }]);
  assert.equal(handlers(el, "on_mouse_down").filter((h) => h.id === "m-menu-list").length, 0);
});
