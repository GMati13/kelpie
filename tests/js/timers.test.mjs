// What the views' timers wake (#38): a timer that runs a script or redraws a view for something not
// drawn is wasted work, every interval, for as long as Herdr runs.
import { DEMO, demoProfile, fakeCx, setupDemoWorld } from "../lib/views.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { WorkSide } from "../../mods/kelpie/workside.js";

// A cx whose timers can be fired by their interval.
function timedCx() {
  const cx = fakeCx(), every = [];
  cx.timer = { every(ms, fn) { every.push({ ms, fn }); }, after() {} };
  cx.fire = async (ms) => { for (const t of every.filter((x) => x.ms === ms)) t.fn(cx); await cx.settle(); };
  return cx;
}
// The sidebar's own sessions list runs sessions.py (`python3 -I -c <script> <folder> 40 <account>`).
const sessionRuns = () => mock.of("exec").filter(([cmd, args]) => cmd === "python3" && args[4] === "40").length;

test("the sidebar's sessions list doesn't load on its timer while the profile shown has a board", async () => {
  setupDemoWorld({ shown: "ACME-142" });
  const cx = timedCx(), side = new WorkSide();
  side.init(cx);
  await cx.settle();
  const drawn = cx.notified;
  await cx.fire(60 * 1000);
  await cx.fire(60 * 1000);
  assert.equal(sessionRuns(), 0, "the story list loads its own sessions: this one isn't drawn");
  assert.equal(cx.notified, drawn, "and the sidebar isn't redrawn for it");
});

test("a profile without a board loads its sessions on the timer, and one left a while loads once drawn again", async () => {
  setupDemoWorld({ shown: "ACME-142", profile: { jira: null } });
  const cx = timedCx(), side = new WorkSide();
  side.init(cx);
  await cx.settle();
  assert.equal(sessionRuns(), 1, "its first load");
  await cx.fire(60 * 1000);
  assert.equal(sessionRuns(), 2, "the timer's");
  // The profile gets a board: the timer skips; it loses it again: drawing the list loads at once.
  const profiles = mock.sharedValue("kelpie.profiles");
  mock.state.shared.set("kelpie.profiles", { [DEMO]: { ...profiles[DEMO], jira: demoProfile().jira } });
  await cx.fire(60 * 1000);
  assert.equal(sessionRuns(), 2);
  mock.state.shared.set("kelpie.profiles", profiles);
  side.render(cx);
  await cx.settle();
  assert.equal(sessionRuns(), 3, "drawn again after a skipped load, it doesn't wait for the next minute");
  side.render(cx);
  await cx.settle();
  assert.equal(sessionRuns(), 3, "only once");
});
