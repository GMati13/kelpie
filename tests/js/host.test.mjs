// Herdr's reads kept for one render (mods/kelpie/host.js, #37): inside rendering() each read is
// made once and handed to every caller, and what the render writes drops what it read; outside one,
// every read is fresh. Every mod file goes through it, so no write can leave a stale read behind.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { mock } from "herdr";
import { REPO } from "../lib/helpers.mjs";
import { memo, rendering, run, setShared, shared, spaces, agents, panes, layout, hc } from "../../mods/kelpie/host.js";

beforeEach(() => {
  mock.reset();
  mock.state.spaces = [{ id: "s1", name: "One", tabs: [] }];
  mock.state.shared.set("k", { a: 1 });
});

test("in a render, each list and shared key is read once", () => {
  rendering(() => {
    for (let i = 0; i < 5; i++) { spaces(); agents(); panes(); layout(); shared("k"); shared("other"); }
  });
  assert.deepEqual(mock.reads, { spaces: 1, agents: 1, panes: 1, layout: 1, "shared:k": 1, "shared:other": 1 });
});

test("outside a render, every read is fresh", () => {
  rendering(() => spaces());
  spaces(); spaces();
  shared("k"); shared("k");
  assert.deepEqual(mock.reads, { spaces: 3, "shared:k": 2 });
});

test("a key written in the render is read again, the others aren't", () => {
  rendering(() => {
    assert.deepEqual(shared("k"), { a: 1 });
    shared("j");
    setShared("k", { a: 2 });
    assert.deepEqual(shared("k"), { a: 2 }, "the value written");
    shared("j");
    spaces(); spaces();
  });
  assert.deepEqual(mock.reads, { "shared:k": 2, "shared:j": 1, spaces: 1 });
});

test("a command run or an hc call in the render drops every read", () => {
  rendering(() => {
    assert.equal(spaces().length, 1);
    shared("k");
    mock.state.spaces.push({ id: "s2", name: "Two", tabs: [] }); // what space.new would do
    run("space.new", { name: "Two" });
    assert.equal(spaces().length, 2, "the new space shows");
    shared("k");
    hc(["get", "t1"]);
    spaces();
  });
  assert.deepEqual(mock.reads, { spaces: 3, "shared:k": 2 });
  assert.deepEqual(mock.of("run"), [["space.new", { name: "Two" }]]);
});

test("what's worked out from the reads is kept for the render, until something is written", () => {
  let n = 0;
  const work = () => memo("work", () => ++n);
  rendering(() => {
    assert.equal(work(), 1);
    assert.equal(work(), 1);
    setShared("k", { a: 3 });
    assert.equal(work(), 2, "worked out again after a write");
    run("layout.show", { id: "x" });
    assert.equal(work(), 3, "and after a command");
  });
  assert.equal(work(), 4, "outside a render, every time");
  assert.equal(work(), 5);
});

test("a render that throws ends its frame", () => {
  assert.throws(() => rendering(() => { spaces(); throw new Error("boom"); }), /boom/);
  spaces();
  assert.equal(mock.reads.spaces, 2, "the next read is fresh");
});

test("a render inside a render shares the outer one's reads", () => {
  rendering(() => {
    spaces();
    rendering(() => spaces());
    spaces();
  });
  assert.equal(mock.reads.spaces, 1);
});

// A mod reading or writing through "herdr" directly would bypass the frame: its writes wouldn't drop
// what the render read, and the render would draw what was there before.
const jsFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? jsFiles(join(dir, e.name)) : e.name.endsWith(".js") ? [join(dir, e.name)] : []);
const KEPT = ["agents", "focused", "hc", "layout", "panes", "run", "setShared", "shared", "spaces", "terminals"];

test("every Kelpie mod file reads and writes Herdr's state through host.js", () => {
  for (const f of jsFiles(join(REPO, "mods/kelpie"))) {
    if (f.endsWith("/host.js")) continue;
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /import\s*\*\s*as\s+\w+\s+from\s*"herdr"/, `${relative(REPO, f)} imports all of herdr`);
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"herdr"/g)) {
      const names = m[1].split(",").map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      const bypass = names.filter((n) => KEPT.includes(n));
      assert.deepEqual(bypass, [], `${relative(REPO, f)} imports ${bypass.join(", ")} from "herdr": take them from host.js`);
    }
  }
});
