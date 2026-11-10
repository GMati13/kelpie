// Helpers shared by the JavaScript tests (tests/README.md has the details).
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The repo's root, and a file in it.
export const REPO = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
export const repoFile = (...parts) => join(REPO, ...parts);
export const readRepo = (...parts) => readFileSync(repoFile(...parts), "utf8");

// A throwaway folder (real path: macOS's /var is a link), removed when the test process ends.
const TEMPS = new Set();
process.on("exit", () => { for (const d of TEMPS) rmSync(d, { recursive: true, force: true }); });
export function tempDir(prefix = "kelpie-test-") {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  TEMPS.add(d);
  return d;
}

// Writes a file, making its folders; `mode` e.g. 0o755.
export function put(path, text = "", mode) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  if (mode) chmodSync(path, mode);
  return path;
}

// A folder of fake programs for PATH. Each fake records every run in `log`: its argv (NUL-separated),
// its stdin (when it isn't a terminal) and its environment, then runs `body` (shell; "$STDIN" is the
// file its stdin went to). Read the runs back with fakes.calls().
export function fakeBin(root = tempDir("kelpie-fake-")) {
  const bin = join(root, "bin"), log = join(root, "log");
  mkdirSync(bin, { recursive: true });
  mkdirSync(log, { recursive: true });
  return {
    bin, log,
    // PATH with the fakes first.
    path: `${bin}:${process.env.PATH}`,
    add(name, body = "") {
      put(join(bin, name), `#!/bin/sh
n=$(cat '${log}/.seq' 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > '${log}/.seq'
d='${log}'/$(printf '%04d' "$n")-'${name}'; mkdir -p "$d"
for a in "$@"; do printf '%s\\0' "$a"; done > "$d/argv"
STDIN="$d/stdin"; if [ -t 0 ]; then : > "$STDIN"; else cat > "$STDIN"; fi
env > "$d/env"
${body}
`, 0o755);
      return this;
    },
    // Every recorded run, in order: { name, argv, stdin, env }.
    calls(name = null) {
      const runs = readdirSync(log).filter((f) => !f.startsWith(".")).sort().map((f) => {
        const d = join(log, f);
        const argv = readFileSync(join(d, "argv"), "utf8").split("\0").slice(0, -1);
        return { name: f.replace(/^\d+-/, ""), argv, stdin: existsSync(join(d, "stdin")) ? readFileSync(join(d, "stdin"), "utf8") : "", env: readFileSync(join(d, "env"), "utf8") };
      });
      return name ? runs.filter((r) => r.name === name) : runs;
    },
    clear() { rmSync(log, { recursive: true, force: true }); mkdirSync(log, { recursive: true }); },
  };
}

// Runs a program and returns { code, stdout, stderr }; `env` is added to a minimal environment
// (PATH, HOME set to a temp folder unless given, LANG), never the caller's whole one.
export function sh(command, args = [], { env = {}, cwd, input = "", timeout = 30000 } = {}) {
  const base = { PATH: process.env.PATH, HOME: env.HOME ?? tempDir("kelpie-home-"), LANG: "C", SHELL: "/bin/sh" };
  const r = spawnSync(command, args, { cwd, input, encoding: "utf8", timeout, env: { ...base, ...env } });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

// A git command for fixtures, with no user or system config (no hooks, signing or aliases of the
// person's).
export function git(cwd, ...args) {
  const r = spawnSync("git", ["-c", "user.name=Kelpie Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], {
    cwd, encoding: "utf8", env: { PATH: process.env.PATH, HOME: cwd, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

// Waits until `check()` is truthy (polling, up to `ms`), for code that runs on after a call returns.
export async function until(check, ms = 3000, what = "the condition") {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

// The body of a top-level function or method in a source file: from `start` (e.g. "async function
// command(c) {") to its closing brace at the start of a line. For static tests on the source.
export function bodyOf(source, start) {
  const at = source.indexOf(start);
  if (at < 0) throw new Error(`${start} not found`);
  const end = source.indexOf("\n}\n", at);
  return source.slice(at, end + 2);
}
