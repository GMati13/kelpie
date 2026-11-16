// Long runs a confirm dialog asked for (KELPIE-262; stories.js askRun, takeRuns; main.js track): Move to
// Done, Ready for Done, Close and Run all. The dialog's button writes a one-time request and closes at
// once; the copy that follows what's shown takes it and runs it in place. They write to the board or
// GitHub, or start agents, so only that button may ask for one: never a kelpie.* command or a plugin
// request, which any agent can run.
import { DEMO, fakeCx, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { StoryList, askRun, busyOf, takeRuns } from "../../mods/kelpie/stories.js";
import { demoJira } from "../../mods/kelpie/demo.js";
import Quiet from "../../mods/kelpie/main.js";
import { bodyOf, readRepo } from "../lib/helpers.mjs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const ASKS = "kelpie.run.asks";
const statusOf = async (key) => (await demoJira(["get", `/rest/api/3/issue/${key}`])).body.fields.status.name;
const asks = () => mock.sharedValue(ASKS) ?? {};
// A file's code without its comment lines, which name these functions too.
const code = (src) => src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

// Only the confirm dialog's own button asks for a run: no kelpie.* command, plugin request or other
// view does, and nothing else writes the key.
test("only the confirm dialog's button writes a run request", () => {
  const mods = ["kelpie", "kelpie-artifacts"].flatMap((m) => readdirSync(join("mods", m)).filter((f) => f.endsWith(".js")).map((f) => `${m}/${f}`));
  for (const f of mods) {
    const src = readRepo("mods", f);
    if (f !== "kelpie/stories.js") assert.doesNotMatch(src, /kelpie\.run\.asks|RUN_ASKS/, f);
    if (f !== "kelpie/stories.js" && f !== "kelpie/dialogs.js") assert.doesNotMatch(src, /\baskRun\b/, f);
  }
  const stories = readRepo("mods/kelpie/stories.js");
  assert.equal(stories.match(/kelpie\.run\.asks/g).length, 1, "named once");
  assert.equal(stories.match(/setShared\(RUN_ASKS,/g).length, 2, "written by askRun() and, emptied, by takeRuns()");
  assert.equal(code(stories).match(/\baskRun\(/g).length, 1, "stories.js only defines it");
  assert.match(bodyOf(stories, "export function takeRuns() {"), /setShared\(RUN_ASKS, \{\}\);/);
  // In dialogs.js, only Confirm's yes() asks, and main.js's command loop never reaches it.
  const dialogs = readRepo("mods/kelpie/dialogs.js");
  const yes = bodyOf(dialogs, "  yes(command = props().command, cx = null) {");
  assert.equal(code(dialogs).match(/\baskRun\(/g).length, code(yes).match(/\baskRun\(/g).length, "only in Confirm's yes()");
  assert.doesNotMatch(bodyOf(readRepo("mods/kelpie/main.js"), "async function command(c) {"), /askRun|takeRuns|RUN_ASKS/);
});

describe("a run request", () => {
  let stories;
  before(async () => {
    setupDemoWorld();
    stories = await loadStories(StoryList);
  });

  test("is taken once, even when a draw sees it again before its removal lands", async () => {
    setupDemoWorld({ stories });
    assert.equal(askRun("done", { profile: DEMO, key: "ACME-142" }), true);
    const [id] = Object.keys(asks());
    const was = asks();
    const runs = takeRuns();
    assert.equal(runs.length, 1);
    assert.deepEqual(asks(), {}, "removed as it's taken");
    // Another copy's draw, or a write racing the removal, puts it back: it isn't run again.
    mock.state.shared.set(ASKS, was);
    assert.deepEqual(takeRuns(), []);
    await Promise.all(runs);
    assert.deepEqual(await Promise.all(["ACME-143", "ACME-142"].map(statusOf)), ["Done", "Done"]);
    assert.ok(id);
  });

  test("one older than a minute is dropped, unrun", async () => {
    setupDemoWorld({ stories });
    mock.state.shared.set(ASKS, { old: { kind: "done", args: { profile: DEMO, key: "ACME-129" }, at: Date.now() - 61e3 } });
    assert.deepEqual(takeRuns(), []);
    assert.deepEqual(asks(), {});
    assert.equal(busyOf("ACME-129"), null);
    assert.equal(await statusOf("ACME-130"), "In QA", "nothing moved");
  });

  test("a malformed one is refused when asked and dropped when taken", () => {
    setupDemoWorld({ stories });
    assert.equal(askRun("clean", { profile: DEMO, keys: ["ACME-129"] }), false, "not a run a dialog asks for");
    assert.equal(askRun("done", { profile: DEMO, key: "acme-129; rm -rf ~" }), false, "not a ticket key");
    assert.equal(askRun("close", { profile: DEMO, keys: ["ACME-118", 5] }), false);
    assert.equal(askRun("done", { key: "ACME-129" }), false, "no profile");
    assert.deepEqual(asks(), {});
    mock.state.shared.set(ASKS, {
      a: { kind: "exec", args: { profile: DEMO }, at: Date.now() },
      b: { kind: "done", args: { profile: DEMO, key: "ACME-129 x" }, at: Date.now() },
      c: null,
    });
    assert.deepEqual(takeRuns(), []);
    assert.deepEqual(asks(), {});
    assert.equal(busyOf("ACME-129"), null);
  });

  test("the footer takes it as it draws, and other copies don't", async () => {
    // The tab bar doesn't lead while the sidebar shows: it leaves the request alone.
    setupDemoWorld({ stories, props: { role: "toolbar" } });
    askRun("done", { profile: DEMO, key: "ACME-142" });
    const draw = () => { const cx = { ...fakeCx(), spawn() {} }; const v = new Quiet({}); v.init({}, cx); v.render(cx); };
    draw();
    assert.equal(Object.keys(asks()).length, 1, "left for the leading copy");
    mock.state.props = { role: "footer" };
    draw();
    assert.deepEqual(asks(), {}, "taken");
    await Promise.resolve();
    assert.equal(busyOf("ACME-142")?.kind, "done", "running in place, under its mark");
  });
});
