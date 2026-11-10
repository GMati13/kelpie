// The gh() shell function the profile dialog and the README give for a person's shell setup
// (GH_FUNCTION in setup.js), run for real in bash and zsh with a fake gh: with KELPIE_GH_ACCOUNT it
// runs gh as that account, its token only in that gh run's environment; `gh auth …` and shells without
// the variable run gh as it is; an account gh isn't signed in to runs nothing. And gh-shell-check.sh,
// the GitHub page's Check my shell, run with a fake shell.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { GH_FUNCTION } from "../../mods/kelpie/setup.js";
import { fakeBin, readRepo, repoFile, sh } from "../lib/helpers.mjs";

const TOKEN = "gho_fakeTokenOfWorkMe";
const has = (program) => { try { execFileSync("sh", ["-c", `command -v ${program}`]); return true; } catch { return false; } };

// A fake gh: `auth token --user work-me` prints its token, any other account fails; the rest succeed.
function fakeGh() {
  return fakeBin().add("gh", `[ "$1 $2" = "auth token" ] || exit 0
case " $* " in *" --user work-me "*) echo "${TOKEN}"; exit 0 ;; esac
exit 1`);
}
const tokenOf = (call) => /^GH_TOKEN=(.*)$/m.exec(call.env)?.[1] ?? null;

for (const shell of ["bash", "zsh"]) {
  describe(`the gh() function, in ${shell}`, { skip: !has(shell) && `${shell} isn't installed` }, () => {
    const run = (fakes, account, ...args) => sh(shell, ["-c", `${GH_FUNCTION}\ngh "$@"`, "gh", ...args],
      { env: { PATH: fakes.path, ...(account ? { KELPIE_GH_ACCOUNT: account } : {}) } });

    test("with KELPIE_GH_ACCOUNT, gh runs as that account: its token in gh's environment only", () => {
      const fakes = fakeGh();
      const r = run(fakes, "work-me", "api", "user");
      assert.equal(r.code, 0, r.stderr);
      const [ask, call] = fakes.calls("gh");
      assert.deepEqual(ask.argv, ["auth", "token", "--hostname", "github.com", "--user", "work-me"]);
      assert.deepEqual(call.argv, ["api", "user"]);
      assert.equal(tokenOf(call), TOKEN);
      assert.ok(!r.stdout.includes(TOKEN) && !r.stderr.includes(TOKEN));
    });

    test("without the variable, and for gh auth, gh runs as it is", () => {
      const fakes = fakeGh();
      run(fakes, null, "api", "user");
      run(fakes, "work-me", "auth", "status");
      const calls = fakes.calls("gh");
      assert.deepEqual(calls.map((c) => c.argv), [["api", "user"], ["auth", "status"]]);
      assert.ok(calls.every((c) => tokenOf(c) === null));
    });

    test("an account gh isn't signed in to fails with what to do, and gh doesn't run as anyone else", () => {
      const fakes = fakeGh();
      const r = run(fakes, "someone-else", "pr", "list");
      assert.notEqual(r.code, 0);
      assert.match(r.stderr, /isn't signed in as someone-else: gh auth login/);
      assert.equal(fakes.calls("gh").length, 1, "only the token was asked for");
    });
  });
}

test("the README shows the same function the profile dialog copies", () => {
  const readme = readRepo("README.md").replace(/^  /gm, "");
  assert.ok(readme.includes(GH_FUNCTION), "README's Several accounts has GH_FUNCTION's lines");
});

describe("gh-shell-check.sh", () => {
  const CHECK = repoFile("mods/kelpie/gh-shell-check.sh");
  // A fake shell printing the account it was given and how it was started.
  const fakes = fakeBin().add("fake-shell", 'echo "noise from a shell setup"; echo "account=$KELPIE_GH_ACCOUNT pager=[$GH_PAGER] args=$*"');
  test("starts the person's shell as an agent's starts, the account in its environment", () => {
    const r = sh("sh", [CHECK, "work-me"], { env: { SHELL: `${fakes.bin}/fake-shell` } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim().split("\n").pop(), "account=work-me pager=[] args=-lic gh api user --jq .login");
  });
  test("a name that isn't a GitHub login starts nothing", () => {
    fakes.clear();
    for (const bad of ["-x", "a b", "x;y", "$(id)"]) assert.equal(sh("sh", [CHECK, bad], { env: { SHELL: `${fakes.bin}/fake-shell` } }).code, 2, bad);
    assert.deepEqual(fakes.calls("fake-shell"), []);
  });
});
