// mods/kelpie/stdin.sh, run for real with a fake claude: What next?'s task reaches Claude on stdin,
// never in its arguments (#26: `ps` shows those to every user), and is gone from disk before Claude
// starts.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fakeBin, put, repoFile, sh, tempDir } from "../lib/helpers.mjs";

const TASK = "Stories: ACME-1 \"a title someone wrote\" $(touch pwned)\nline two\n";

function setup() {
  const dir = join(tempDir(), "brew");
  mkdirSync(dir, { mode: 0o700 });
  put(join(dir, "task"), TASK);
  // The fake notes whether the task's file is still there when it runs, and exits 7.
  const fakes = fakeBin().add("claude", `[ -e "$TASK_FILE" ] && echo still-there; echo "claude ran"; exit 7`);
  const run = (folder = dir, ...argv) => sh("sh", [repoFile("mods/kelpie/stdin.sh"), folder, ...argv], { env: { PATH: fakes.path, TASK_FILE: join(dir, "task") } });
  return { dir, fakes, run };
}

describe("stdin.sh", () => {
  test("hands the task to the program on stdin, not as an argument, its folder removed first", () => {
    const { dir, fakes, run } = setup();
    const r = run(dir, "env", "KELPIE_PROFILE=w", "claude", "--output-format", "json", "-p");
    assert.equal(r.code, 7, "the program's own exit code");
    assert.equal(r.stdout, "claude ran\n", "the file was gone when the program started");
    const [call] = fakes.calls("claude");
    assert.equal(call.stdin, TASK, "the task, byte for byte, on stdin");
    assert.deepEqual(call.argv, ["--output-format", "json", "-p"]);
    assert.match(call.env, /^KELPIE_PROFILE=w$/m);
    assert.ok(!existsSync(dir), "the folder is gone too");
    assert.ok(!existsSync(join(dir, "..", "pwned")), "nothing in the task ran");
  });
  test("without the task's file the program never runs", () => {
    const { dir, fakes, run } = setup();
    const r = run(join(dir, "missing"), "claude", "-p");
    assert.equal(r.code, 2);
    assert.equal(fakes.calls("claude").length, 0);
    assert.ok(existsSync(join(dir, "task")), "another folder's file is left alone");
  });
  test("with no program or folder: a usage error, nothing removed", () => {
    const { dir, run } = setup();
    assert.equal(run(dir).code, 2);
    assert.equal(run("", "claude").code, 2);
    assert.ok(existsSync(join(dir, "task")));
  });
});
