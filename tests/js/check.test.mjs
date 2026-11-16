// `herdr-app check` runs a mod's init() for real (Herdr 0.1.16), exec and file writes included (#284):
// while checking() is true the root views start nothing (no copies into the person's Herdr folder, no
// polls, timers or command loops), and still draw, as a check renders them once.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { fakeCx, setupDemoWorld } from "../lib/views.mjs";
import Quiet from "../../mods/kelpie/main.js";

// The Screenshots panel keeps its grid size in the browser-like storage Herdr gives mods.
globalThis.localStorage ??= { getItem: () => null, setItem() {} };
const { default: Artifacts } = await import("../../mods/kelpie-artifacts/main.js");

// A cx counting the timers it was given.
function countingCx() {
  const cx = fakeCx();
  cx.timers = 0;
  cx.timer = { every: () => { cx.timers++; }, after: () => { cx.timers++; } };
  return cx;
}

// What starting up did: Herdr's side effects and the work left to run.
const effects = (cx) => ({
  exec: mock.of("exec").length, hc: mock.of("hc").length, writeTextFile: mock.of("writeTextFile").length,
  nextCommand: mock.of("nextCommand").length, timers: cx.timers,
});
// Lets started tasks run up to where they wait (a command loop waits for good, so never settle()).
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const NONE = { exec: 0, hc: 0, writeTextFile: 0, nextCommand: 0, timers: 0 };

beforeEach(() => mock.reset());

for (const role of ["sidebar", "footer", "toolbar"]) {
  test(`during a check, Kelpie's ${role} starts nothing and still draws`, async () => {
    setupDemoWorld({ props: { role } });
    mock.state.checking = true;
    const cx = countingCx(), view = new Quiet({});
    view.init({}, cx);
    await flush();
    assert.deepEqual(effects(cx), NONE);
    assert.ok(view.render(cx), "it draws");
  });
}

test("in a live window, the sidebar still copies its icons and skins' art and polls", async () => {
  setupDemoWorld({ props: { role: "sidebar" } });
  const cx = countingCx(), view = new Quiet({});
  view.init({}, cx);
  await flush();
  const scripts = mock.of("exec").map(([cmd, args]) => `${cmd} ${args.join(" ")}`);
  assert.ok(scripts.some((s) => s.includes("/art/kelpie/icons")), "the icons' copy");
  assert.ok(scripts.some((s) => s.includes("skins/copy-art.sh")), "the skins' art");
  assert.ok(cx.timers > 0, "its polls");
});

test("during a check, the Screenshots panel sweeps nothing, starts nothing and still draws", async () => {
  mock.state.checking = true;
  const cx = countingCx(), view = new Artifacts();
  view.init({}, cx);
  await flush();
  assert.deepEqual(effects(cx), NONE);
  assert.ok(view.render(cx), "it draws");
});

test("in a live window, the Screenshots panel sweeps its old folders and listens for its keys", async () => {
  const cx = countingCx(), view = new Artifacts();
  view.init({}, cx);
  await flush();
  assert.ok(mock.of("exec").some(([cmd, args]) => cmd === "sh" && args.some((a) => a.includes("artifacts"))), "the sweep");
  assert.equal(mock.of("nextCommand").length, 1, "its command loop");
  assert.ok(cx.timers > 0, "its refresh");
});
