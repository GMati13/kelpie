// The harness itself: every mod file loads under the stubs, and the stubs behave as tests/README.md says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO } from "../lib/helpers.mjs";
import { mock, exec, hc, run, setShared, shared, openOverlay, spaces } from "herdr";
import { div, snapshot, texts, tree, handlers } from "gpui-kit";
import { h_flex, InputState, TextView } from "gpui-base";

const jsFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? jsFiles(join(dir, e.name)) : e.name.endsWith(".js") ? [join(dir, e.name)] : []);

test("every mod file loads under the stubs", async () => {
  const files = jsFiles(join(REPO, "mods"));
  assert.ok(files.length > 20, "the mods' files were found");
  for (const f of files) await assert.doesNotReject(import(f), `${relative(REPO, f)} loads`);
});

test("herdr stub: shared state is in memory and copied in and out", () => {
  mock.reset();
  const v = { a: [1] };
  setShared("k", v);
  v.a.push(2);
  assert.deepEqual(shared("k"), { a: [1] });
  // Handed out frozen: Kelpie keeps a read for the whole render and gives it to every caller
  // (mods/kelpie/host.js), so a mod changing one in place fails here rather than live.
  const got = shared("k");
  assert.throws(() => got.a.push(3), TypeError);
  assert.deepEqual(shared("k"), { a: [1] });
  setShared("k", null);
  assert.equal(shared("k"), null);
});

test("herdr stub: actions are recorded and answered by mock.on", async () => {
  mock.reset();
  mock.state.spaces = [{ id: "s1", name: "One", tabs: [] }];
  mock.on.exec = (cmd) => (cmd === "echo" ? { code: 0, stdout: "hi\n", stderr: "" } : undefined);
  assert.equal((await exec("echo", ["x"])).stdout, "hi\n");
  assert.deepEqual(await exec("other"), { code: 0, stdout: "", stderr: "" });
  await hc(["get", "t1"]);
  assert.equal(run("space.select", { id: "s1" }), null);
  assert.equal(openOverlay({ kind: "dialog" }), "overlay-1");
  assert.deepEqual(mock.of("exec").map((a) => a[0]), ["echo", "other"]);
  assert.deepEqual(mock.of("hc"), [[["get", "t1"]]]);
  assert.deepEqual(mock.of("run"), [["space.select", { id: "s1" }]]);
  assert.equal(spaces()[0].name, "One");
});

test("gpui stubs: elements record their chain, and when() runs its branch", () => {
  const clicked = [];
  const el = div().id("root").child(h_flex().when(true, (e) => e.child("yes")).when(false, (e) => e.child("no")))
    .child(TextView.html("t", "<b>x</b>")).on_click(() => clicked.push(1));
  assert.deepEqual(texts(el), ["yes"]);
  assert.equal(tree(el).kind, "div");
  assert.match(snapshot(el), /TextView\.html\("t", "<b>x<\/b>"\)/);
  handlers(el, "on_click")[0].fn();
  assert.deepEqual(clicked, [1]);
  const input = InputState.new({});
  input.set_value("typed");
  assert.equal(input.value(), "typed");
});
