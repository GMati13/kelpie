// Clean up takes only settled work (stories.js cleanBlockers, cleanUp), and removing the demo deletes
// nothing but its own folder (demo.js removeDemo).
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { git, put, tempDir, until } from "../lib/helpers.mjs";
import { mock } from "herdr";
import { busyOf, cleanBlockers, cleanUp } from "../../mods/kelpie/stories.js";
import { removeDemo } from "../../mods/kelpie/demo.js";

beforeEach(() => mock.reset());

const story = (over = {}) => ({ key: "ABC-1", title: "A story", category: "done", prs: [], subs: [], agent: null, space: null, ...over });
const pr = (merged) => ({ url: "https://github.com/acme/api/pull/1", merged, repository: { name: "api" }, number: 1 });

describe("cleanBlockers", () => {
  test("a Done story with nothing open or running can go", () => {
    assert.deepEqual(cleanBlockers(story()), []);
    assert.deepEqual(cleanBlockers(story({ prs: [pr(true)] })), []);
  });
  test("a story not done on the board can't", () => {
    for (const category of ["new", "indeterminate", undefined]) assert.match(cleanBlockers(story({ category })).join(), /isn't done on the board/);
  });
  test("an open pull request, its own or a subtask's, blocks it", () => {
    assert.match(cleanBlockers(story({ prs: [pr(false)] })).join(), /still open/);
    assert.match(cleanBlockers(story({ subs: [{ key: "ABC-2", prs: [pr(false)], agent: null }] })).join(), /still open/);
  });
  test("an agent working or waiting for you blocks it, a subtask's too", () => {
    assert.match(cleanBlockers(story({ agent: { status: "working" } })).join(), /working/);
    assert.match(cleanBlockers(story({ agent: { status: "blocked" } })).join(), /waiting for you/);
    assert.match(cleanBlockers(story({ subs: [{ key: "ABC-2", prs: [], agent: { status: "working" } }] })).join(), /working/);
    assert.deepEqual(cleanBlockers(story({ agent: { status: "idle" } })), []);
  });
  test("any agent in its space counts, whatever its tab is named", () => {
    mock.state.agents = [{ space: "s1", status: "working", tab_name: "scratch" }, { space: "s2", status: "blocked" }];
    assert.match(cleanBlockers(story({ space: { id: "s1" } })).join(), /working/);
    assert.deepEqual(cleanBlockers(story({ space: { id: "s3" } })), []);
  });
  test("a lone pull request (no ticket) goes only once merged", () => {
    assert.match(cleanBlockers(story({ key: "pull:api#1", category: null, pull: true, prs: [pr(false)] })).join(), /isn't merged/);
    assert.deepEqual(cleanBlockers(story({ key: "pull:api#1", category: null, pull: true, prs: [pr(true)] })), []);
  });
});

describe("cleanUp", () => {
  let root, profile;
  const note = () => mock.sharedValue("kelpie.stories.note")?.w?.text ?? "";
  // A ticket folder holding a real repo (changes.py reads it), with one commit.
  function repoIn(key, sub = "") {
    const dir = join(root, sub, key, "api");
    put(join(dir, "README.md"), "hello\n");
    git(dir, "init", "-q");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "first");
    return dir;
  }
  beforeEach(() => {
    root = tempDir();
    profile = { id: "w", name: "W", folder: root, commands: { cleanUp: "rm -rf worktrees/{key}" } };
    mock.state.shared.set("kelpie.profiles", { w: profile });
    // What the leftovers check found: the clean-up command would run on these keys.
    mock.state.shared.set("kelpie.clean.leftovers", { w: { found: { "ABC-1": { "ABC-1": ["a folder named ABC-1"], "ABC-2": ["a folder named ABC-2"] } } } });
    // changes.py runs for real; the profile's clean-up command never does.
    mock.on.exec = (cmd, args, o) => {
      if (cmd === "python3") return mock.realExec(cmd, args, { ...o, env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
      if (cmd === "sh" && args.includes("rm -rf worktrees/ABC-1")) return { code: 0, stdout: "removed", stderr: "" };
      return undefined;
    };
  });
  const cleanRuns = () => mock.of("exec").filter(([c, a]) => c === "sh" && a.some((x) => String(x).includes("rm -rf worktrees/")));

  test("uncommitted changes in a ticket folder's repo stop it", async () => {
    put(join(repoIn("ABC-1"), "README.md"), "changed\n");
    await cleanUp(profile, story());
    assert.match(note(), /ABC-1 wasn't cleaned up: uncommitted work in ABC-1 api/);
    assert.deepEqual(cleanRuns(), []);
    assert.equal(mock.of("run").filter(([n]) => n === "space.close").length, 0);
  });
  test("an untracked file counts as uncommitted work", async () => {
    put(join(repoIn("ABC-1"), "new.txt"), "new\n");
    await cleanUp(profile, story());
    assert.match(note(), /wasn't cleaned up: uncommitted work/);
    assert.deepEqual(cleanRuns(), []);
  });
  test("a subtask's ticket folder counts, under worktrees/ too", async () => {
    repoIn("ABC-1");
    put(join(repoIn("ABC-2", "worktrees"), "README.md"), "changed\n");
    await cleanUp(profile, story({ subs: [{ key: "ABC-2", prs: [], agent: null }] }));
    assert.match(note(), /uncommitted work in ABC-2 api/);
    assert.deepEqual(cleanRuns(), []);
  });
  test("committed work is cleaned up: the clean-up command runs", async () => {
    repoIn("ABC-1");
    await cleanUp(profile, story());
    assert.doesNotMatch(note(), /wasn't cleaned up/);
    assert.ok(cleanRuns().length >= 1, "the clean-up command ran");
  });
  test("a story that isn't settled is refused before anything is looked at", async () => {
    repoIn("ABC-1");
    await cleanUp(profile, story({ category: "indeterminate" }));
    assert.match(note(), /wasn't cleaned up: it isn't done on the board/);
    assert.deepEqual(mock.of("exec").filter(([c]) => c === "python3"), []);
    assert.deepEqual(cleanRuns(), []);
  });
  // A reassigned story isn't done: its work may never have been pushed, and a clean-up command
  // deleting its folder would lose those commits for good.
  const reassigned = (over = {}) => story({ category: "indeterminate", reassigned: { to: ["Sam"] }, ...over });
  test("a reassigned story with commits no remote has isn't cleaned up", async () => {
    repoIn("ABC-1");
    await cleanUp(profile, reassigned());
    assert.match(note(), /ABC-1 wasn't cleaned up: a commit not pushed in ABC-1 api/);
    assert.deepEqual(cleanRuns(), []);
    assert.equal(mock.of("run").filter(([n]) => n === "space.close").length, 0);
  });
  test("a reassigned story whose commits are all pushed is cleaned up", async () => {
    const dir = repoIn("ABC-1");
    const remote = join(root, "remote.git");
    git(root, "init", "-q", "--bare", remote);
    git(dir, "remote", "add", "origin", remote);
    git(dir, "push", "-q", "origin", "HEAD:refs/heads/work");
    await cleanUp(profile, reassigned());
    assert.doesNotMatch(note(), /wasn't cleaned up/);
    assert.ok(cleanRuns().length >= 1, "the clean-up command ran");
  });
  test("changes.py failing stops it too", async () => {
    mock.on.exec = (cmd) => (cmd === "python3" ? { code: 1, stdout: "", stderr: "Traceback\nboom" } : undefined);
    await cleanUp(profile, story());
    assert.match(note(), /wasn't cleaned up: uncommitted work in its folders \(couldn't check them: boom\)/);
    assert.deepEqual(cleanRuns(), []);
  });
  test("a check failing without a word says so plainly, naming no script", async () => {
    mock.on.exec = (cmd) => (cmd === "python3" ? { code: 1, stdout: "", stderr: "" } : undefined);
    await cleanUp(profile, story());
    assert.match(note(), /wasn't cleaned up: uncommitted work in its folders \(couldn't check them\)/);
    assert.doesNotMatch(note(), /\.py/);
  });
});

// One clean-up of a story at a time (#78): a second press while the first ran once ran the clean-up
// command twice at once. The clean-up command is a stand-in that answers only when the test lets it.
describe("cleanUp: one at a time", () => {
  let profile, runs, waiting;
  const note = () => mock.sharedValue("kelpie.stories.note")?.w?.text ?? "";
  const release = () => waiting.shift()({ code: 0, stdout: "removed", stderr: "" });
  beforeEach(() => {
    profile = { id: "w", name: "W", folder: tempDir(), commands: { cleanUp: "slow-clean {key}" } };
    mock.state.shared.set("kelpie.profiles", { w: profile });
    mock.state.shared.set("kelpie.clean.leftovers", { w: { found: { "ABC-1": { "ABC-1": ["a"], "ABC-2": ["b"] } } } });
    runs = []; waiting = [];
    mock.on.exec = (cmd, args) => {
      if (cmd === "python3") return { code: 0, stdout: "[]", stderr: "" };
      const line = cmd === "sh" ? String(args[3] ?? "") : "";
      if (line.startsWith("slow-clean ")) { runs.push(line); return new Promise((r) => waiting.push(r)); }
      return undefined;
    };
  });

  test("a second clean-up of the same story while the first runs is refused", async () => {
    const first = cleanUp(profile, story());
    await until(() => runs.length === 1, 3000, "the first run");
    const busy = busyOf("ABC-1");
    assert.equal(busy?.kind, "clean");
    assert.equal(busy.step, "Cleaning up ABC-1: 1 of 2…");
    assert.equal(busy.until - busy.at, 2 * 25000 + 60000, "its limit is the whole run's: each key's, plus a margin");
    await cleanUp(profile, story());
    assert.equal(note(), "ABC-1 is already being cleaned up.");
    release();
    await until(() => runs.length === 2, 3000, "the second key");
    release();
    await first;
    assert.deepEqual(runs, ["slow-clean ABC-1", "slow-clean ABC-2"], "the command ran once per key, not twice");
    assert.equal(busyOf("ABC-1"), null, "the story is free again");
  });

  test("a mark past its time limit doesn't hold the story", async () => {
    mock.state.shared.set("kelpie.busy", { "ABC-1": { kind: "clean", keys: ["ABC-1"], step: "Cleaning up ABC-1…", at: Date.now() - 600e3, until: Date.now() - 1 } });
    const run = cleanUp(profile, story());
    await until(() => runs.length === 1, 3000, "the run");
    release();
    await until(() => runs.length === 2, 3000, "the second key");
    release();
    await run;
    assert.match(note(), /^Cleaned up ABC-1/);
  });

  test("a clean-up that fails still frees the story", async () => {
    mock.on.exec = (cmd) => (cmd === "python3" ? { code: 1, stdout: "", stderr: "boom" } : undefined);
    await cleanUp(profile, story());
    assert.match(note(), /wasn't cleaned up/);
    assert.equal(busyOf("ABC-1"), null);
  });

  test("a command stopped at its time limit says which key, and to try again or clean it by hand", async () => {
    const line = (args) => String(args[3] ?? "");
    mock.on.exec = (cmd, args) => (cmd === "python3" ? { code: 0, stdout: "[]", stderr: "" }
      : cmd === "sh" && line(args) === "slow-clean ABC-2" ? { code: 143, stdout: "waiting for a lock", stderr: "" }
      : cmd === "sh" && line(args).startsWith("slow-clean") ? { code: 0, stdout: "removed", stderr: "" } : undefined);
    await cleanUp(profile, story());
    assert.equal(note(), "ABC-1 wasn't fully cleaned up: the clean-up command for ABC-2 took longer than 25 s and was stopped (waiting for a lock). Kelpie looks again at what's left: try again, or clean it up by hand.");
    assert.ok(mock.of("notify").some(([n]) => n.title === "Clean-up of ABC-2 took too long" && n.level === "warning"));
    assert.equal(busyOf("ABC-1"), null);
  });
});

describe("removeDemo deletes only the demo's own folder", () => {
  const HOME = "/home/u";
  const ROOT = `${HOME}/.local/share/kelpie/demo`;
  function remove(folder) {
    mock.reset();
    if (folder !== undefined) mock.state.shared.set("kelpie.profiles", { demo: { id: "demo", name: "Demo", folder, demo: true } });
    mock.on.exec = (cmd, args) => (cmd === "sh" && String(args[1]).includes('printf %s "$HOME"') ? { code: 0, stdout: HOME, stderr: "" } : undefined);
    return removeDemo().then(() => mock.of("exec").filter(([c]) => c === "rm"));
  }
  for (const folder of [`${ROOT}/workspace`, `${ROOT}/workspace/`, `${ROOT}/a/b`]) {
    test(`removes ${folder}`, async () => {
      const rms = await remove(folder);
      assert.equal(rms.length, 1);
      assert.deepEqual(rms[0].slice(0, 2), ["rm", ["-rf", folder.replace(/\/+$/, "")]]);
    });
  }
  for (const folder of [
    ROOT, `${ROOT}/`, `${ROOT}/herdr-app`, `${ROOT}/herdr-app/`, `${ROOT}/herdr-app/mods`,
    `${ROOT}/..`, `${ROOT}/../..`, `${ROOT}/x/../../..`, `${ROOT}/..hidden`, `${ROOT}x/workspace`,
    `${HOME}/.local/share/kelpie`, HOME, `${HOME}/Projects`, "/", "", "relative/demo",
  ]) {
    test(`never removes ${JSON.stringify(folder)}`, async () => {
      assert.deepEqual(await remove(folder), []);
    });
  }
  test("no demo profile: nothing removed", async () => {
    assert.deepEqual(await remove(undefined), []);
  });
});
