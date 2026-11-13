// A list's group heading with something beside its count (Done's fold arrow, To do's and In progress's
// time estimates) keeps its skin's look. The skin's groupDecor rebuilds the heading, and handing it the
// elements already in the view's own heading made it throw (an element goes into one parent only), so
// Quiet Pages fell back to the plain heading for exactly those groups. Seen in the demo (#90).
import { setupDemoWorld } from "../lib/views.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { div, snapshot } from "gpui-kit";
import { groupHeader } from "../../mods/kelpie/ui.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";

const heading = (layout, trail, aside) => {
  setupDemoWorld({ layout });
  return snapshot(groupHeader(skinTheme(), "To do", 3, trail, aside));
};
const arrow = () => div().id("test-arrow");
const sum = () => div().id("test-sum");

test("Quiet Pages draws its own heading with a fold arrow and a sum beside the count", () => {
  const text = heading("Kelpie", arrow, sum);
  assert.match(text, /"TO DO"/, "the skin's capitals");
  assert.match(text, /"DM Sans"/, "the skin's font");
  assert.match(text, /test-arrow/);
  assert.match(text, /test-sum/);
});

test("the plain look draws the arrow and the sum too", () => {
  const text = heading("Kelpie-Plain", arrow, sum);
  assert.match(text, /test-arrow/);
  assert.match(text, /test-sum/);
});
