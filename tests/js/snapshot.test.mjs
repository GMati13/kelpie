// The snapshot helper itself (tests/lib/snapshot.mjs): what its text form keeps and leaves out, the
// runs it folds, its diff, and that a missing snapshot fails unless recording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { byId, diff, matchSnapshot, render } from "../lib/snapshot.mjs";

const T = { foreground: "#e0e0e0", accent: "#4080ff", hover: "#262626" };

test("the text form keeps ids, text, colours by token, handlers, tips and motion; not spacing", () => {
  const el = h_flex().id("row").px(8).gap(10).rounded(8).bg("#4080ff26").hover((s) => s.bg(T.hover)).tooltip("Its tip").on_click(() => {})
    .child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(T.accent).spin(900))
    .child(div().map((x) => x.text_color("#123456")).child("Hello"));
  assert.equal(render(el, T), [
    'h_flex #row [bg=accent/26 hover(bg=hover)] {click} tip="Its tip"',
    "  svg chrome:spinner [fg=accent] ~spin",
    "  div [fg=#123456]",
    '    "Hello"',
    "",
  ].join("\n"));
  assert.ok(byId(el, "row"));
});

test("four or more sibling leaves alike but for their colours fold into one line", () => {
  const el = div().children(["#e0e0e0ff", "#e0e0e0cc", "#e0e0e099", "#e0e0e066"].map((c) => div().bg(c)));
  assert.equal(render(el, T), "div\n  div [bg=foreground/ff] ×4 … [bg=foreground/66]\n");
});

test("the diff marks the snapshot's lines - and what's drawn now +", () => {
  assert.equal(diff("a\nb\nc", "a\nx\nc"), "@@ line 1\n  a\n- b\n+ x\n  c");
});

test("a missing snapshot fails, saying how to record it", { skip: process.env.UPDATE_SNAPSHOTS === "1" }, () => {
  assert.throws(() => matchSnapshot("no/such/snapshot", "x\n"), /UPDATE_SNAPSHOTS=1/);
});
