// A board profile's earlier sessions (the story list's read: Resume ▾, More, the Desk's clock menu and
// find_agents' `resumable`) are its own Claude account's only, as the plain sidebar's are (#157):
// another account's sessions under the same folder are another profile's, and resuming one would run
// on that account. sessions.py runs for real on a fake home with two accounts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mock } from "herdr";
import { tempDir } from "../lib/helpers.mjs";
import { StoryList } from "../../mods/kelpie/stories.js";

function home() {
  const root = tempDir();
  const folder = join(root, "code", "work");
  mkdirSync(folder, { recursive: true });
  const session = (account, id) => {
    const dir = join(root, account, "projects", folder.replace(/[^A-Za-z0-9]/g, "-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.jsonl`), [
      { type: "system", cwd: folder, gitBranch: "main" },
      { type: "user", message: { role: "user", content: `ACME-1 ${id}` } },
      { type: "ai-title", aiTitle: id },
    ].map((x) => JSON.stringify(x)).join("\n") + "\n");
  };
  session(".claude", "own");
  session(".claude-work", "work");
  mock.on.exec = (c, a, o) => mock.realExec(c, a, { ...o, env: { PATH: process.env.PATH, HOME: root } });
  return { root, folder };
}

const read = (folder, claude) => new StoryList().fetchSessions({ space: {}, setup: { folder, profile: { id: "p", name: "P", folder, jira: { board: 1 }, claude } } });

test("a board profile on Claude's own account lists only that account's sessions", async () => {
  const { folder } = home();
  assert.deepEqual((await read(folder, undefined)).map((s) => s.id), ["own"]);
});

test("a board profile on another account lists only that account's sessions", async () => {
  const { root, folder } = home();
  const list = await read(folder, { config: join(root, ".claude-work") });
  assert.deepEqual(list.map((s) => s.id), ["work"]);
  assert.equal(list[0].config, join(root, ".claude-work"), "resumed on its own account");
});
