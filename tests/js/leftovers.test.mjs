// The leftovers check (stories.js checkLeftovers, #112): what a finished story left behind, which its
// broom offers to clean up. A cleaned-up story once kept its broom: a check that never ended blocked
// every later one, a recheck asked for while one ran was dropped, and that run's old lines were
// written over the clean-up. The check and clean-up commands are stand-ins answered by the test.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { tempDir, until } from "../lib/helpers.mjs";
import { mock } from "herdr";
import { checkLeftovers, cleanUp } from "../../mods/kelpie/stories.js";

const story = (over = {}) => ({ key: "ABC-1", title: "A story", category: "done", prs: [], subs: [], agent: null, space: null, ...over });
const LEFTOVERS = "kelpie.clean.leftovers";
const found = () => mock.sharedValue(LEFTOVERS)?.w?.found ?? {};

let profile, checks, cleaned;
// Each check run waits for the test: answer(lines) prints them for the oldest one waiting.
const answer = (out = "") => checks.shift().resolve({ code: 0, stdout: out, stderr: "" });
beforeEach(() => {
  mock.reset();
  profile = { id: "w", name: "W", folder: tempDir(), commands: { leftovers: "check {key}", cleanUp: "clean {key}" } };
  mock.state.shared.set("kelpie.profiles", { w: profile });
  checks = []; cleaned = [];
  mock.on.exec = (cmd, args) => {
    if (cmd === "python3") return { code: 0, stdout: "[]", stderr: "" };
    const line = cmd === "sh" ? String(args[3] ?? "") : "";
    if (line.startsWith("check ")) return new Promise((resolve) => checks.push({ line, resolve }));
    if (line.startsWith("clean ")) { cleaned.push(line); return { code: 0, stdout: "removed", stderr: "" }; }
    return undefined;
  };
});

test("a check that never ends doesn't stop the checks for good", async () => {
  checkLeftovers(profile, [story()]);
  await until(() => checks.length === 1, 3000, "the first check");
  const run = mock.sharedValue("kelpie.clean.checking")?.w;
  assert.equal(run.until - run.at, 10000 + 60000, "its limit: each finished story's run, plus a margin");
  checkLeftovers(profile, [story()], true);
  await new Promise((r) => setImmediate(r));
  assert.equal(checks.length, 1, "one check at a time");
  // Its task was dropped (a reload mid-check): past its limit it no longer counts.
  mock.state.shared.set("kelpie.clean.checking", { w: { ...run, until: Date.now() - 1 } });
  checkLeftovers(profile, [story()], true);
  await until(() => checks.length === 2, 3000, "a new check");
  checks.pop().resolve({ code: 0, stdout: "worktrees/ABC-1", stderr: "" }); // the new check's
  await until(() => found()["ABC-1"], 3000, "the new check's answer");
  answer("stale"); // the lost run ending late writes nothing over the newer one
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(found(), { "ABC-1": { "ABC-1": ["worktrees/ABC-1"] } });
});

test("a recheck asked for while a check runs happens once it ends", async () => {
  checkLeftovers(profile, [story()]);
  await until(() => checks.length === 1, 3000, "the first check");
  checkLeftovers(profile, [story()], true); // a clean-up ended meanwhile
  answer("worktrees/ABC-1");
  await until(() => !mock.sharedValue("kelpie.clean.checking")?.w, 3000, "the first check ending");
  checkLeftovers(profile, [story()]); // the next draw: not left for the 2 minutes
  await until(() => checks.length === 1, 3000, "the recheck");
  answer("");
  await until(() => !found()["ABC-1"], 3000, "its answer");
});

test("a story cleaned up while a check runs loses its broom, whatever that check found before", async () => {
  mock.state.shared.set(LEFTOVERS, { w: { found: { "ABC-1": { "ABC-1": ["worktrees/ABC-1"] } }, ask: "", at: Date.now() } });
  checkLeftovers(profile, [story()], true); // looks while the worktree is still there
  await until(() => checks.length === 1, 3000, "the running check");
  const done = cleanUp(profile, story());
  await until(() => cleaned.length === 1 && checks.length === 2, 3000, "the clean-up, then its own look");
  answer("worktrees/ABC-1"); // the check that began before the clean-up ends, with the old line
  answer(""); // the clean-up's look: nothing left
  await done;
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(found(), {}, "nothing left, so no broom");
});
