// What differs per system (platform.js, and the footer's CPU and memory): opening links and
// folders by the system Herdr reports, and the shell lines that ask the machine they run on. Those
// run here for real, so CI's Linux job checks them on Linux and its macOS job on macOS.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { mock } from "herdr";
import { put, repoFile, tempDir } from "../lib/helpers.mjs";
import { CLAUDE_TMP, STAT_MTIME, fullName, openExternal, platform, reveal, revealLabel } from "../../mods/kelpie/platform.js";
import { STATS } from "../../mods/kelpie/main.js";

beforeEach(() => mock.reset());
const settle = () => new Promise((r) => setTimeout(r, 0));
const run = (script, ...args) => spawnSync("sh", ["-c", script, "sh", ...args], { encoding: "utf8" });

describe("opening links and folders, by the system Herdr reports", () => {
  const cases = {
    macos: { open: ["open", ["https://example.com"]], reveal: ["open", ["-R", "/home/me/shot.png"]], label: "Show in Finder" },
    linux: { open: ["xdg-open", ["https://example.com"]], reveal: ["xdg-open", ["/home/me"]], label: "Open folder" },
    windows: { open: ["explorer.exe", ["https://example.com"]], reveal: ["explorer.exe", ["/select,/home/me/shot.png"]], label: "Show in Explorer" },
  };
  for (const [system, want] of Object.entries(cases)) {
    test(`${system}: ${want.open[0]} for a link, ${want.label} for a file`, async () => {
      mock.state.window.platform = system;
      assert.equal(platform(), system);
      openExternal("https://example.com");
      reveal("/home/me/shot.png");
      await settle();
      assert.deepEqual(mock.of("exec").map(([c, a]) => [c, a]), [want.open, want.reveal]);
      assert.equal(revealLabel(), want.label);
      assert.deepEqual(mock.of("notify"), [], "no toast when it worked");
    });
  }
  test("linux: a file at the root opens the root", async () => {
    mock.state.window.platform = "linux";
    reveal("/shot.png");
    await settle();
    assert.deepEqual(mock.of("exec").map(([c, a]) => [c, a]), [["xdg-open", ["/"]]]);
  });
  test("linux without xdg-open: a toast says so instead of nothing happening", async () => {
    mock.state.window.platform = "linux";
    mock.on.exec = () => { throw new Error("spawn xdg-open ENOENT"); };
    openExternal("https://example.com");
    await settle();
    const [[n]] = mock.of("notify");
    assert.equal(n.title, "Couldn't open https://example.com");
    assert.equal(n.body, "xdg-open isn't available on this system.");
  });
  test("linux: an opener that fails says what it answered", async () => {
    mock.state.window.platform = "linux";
    mock.on.exec = () => ({ code: 4, stdout: "", stderr: "xdg-open: no method available for opening 'x'\n" });
    openExternal("x");
    await settle();
    assert.equal(mock.of("notify")[0][0].body, "xdg-open: no method available for opening 'x'");
  });
  test("a window that says nothing counts as macOS", () => {
    mock.state.window = null;
    assert.equal(platform(), "macos");
  });
});

describe("the shell lines, run on this machine", () => {
  test("the footer's CPU and memory: two whole shares", () => {
    const r = run(STATS);
    assert.equal(r.status, 0, r.stderr);
    const m = /^(\d+) (\d+)$/.exec(r.stdout.trim());
    assert.ok(m, `two numbers, not ${JSON.stringify(r.stdout)}`);
    assert.ok(Number(m[2]) > 0 && Number(m[2]) <= 100, `memory ${m[2]}%`);
  });
  test("stat's mtime line works with this system's stat (macOS gives fractions of a second)", () => {
    const d = tempDir();
    const f = put(join(d, "a b.png"), "x");
    const r = run(`${STAT_MTIME}; stat "$statflag" "$statfmt" "$1"`, f);
    assert.equal(r.status, 0, r.stderr);
    const m = /^(\d+(?:\.\d+)?) (.+)$/.exec(r.stdout.trim());
    assert.ok(m, r.stdout);
    assert.equal(m[2], f);
    assert.ok(Math.abs(Number(m[1]) - Date.now() / 1000) < 600, "a time in seconds");
  });
  test("Claude Code's temp folder line runs and sets nothing that isn't a folder", () => {
    const r = run(`${CLAUDE_TMP}; printf %s "$root"`);
    assert.equal(r.status, 0, r.stderr);
    if (r.stdout) assert.match(r.stdout, /^(\/private)?\/tmp\/claude-\d+$/);
  });
  test("the account's full name: asked without failing, one line", async () => {
    mock.on.exec = (cmd, args) => mock.realExec(cmd, args);
    const name = await fullName();
    assert.equal(typeof name, "string");
    assert.ok(!name.includes("\n"), name);
  });
});

test("kelpie-artifacts' platform.js is the same file as kelpie's (mods can't import across folders)", () => {
  assert.equal(readFileSync(repoFile("mods/kelpie-artifacts/platform.js"), "utf8"), readFileSync(repoFile("mods/kelpie/platform.js"), "utf8"));
});
