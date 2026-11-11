// mods/kelpie/gh.sh, run for real with a fake gh: a profile's GitHub account is asked for its token by
// name and that token reaches gh only through its environment, never its arguments; no account runs
// gh as it is; an API call also asks for the response's headers (`--include`), for ghlimit.js; a
// name that isn't a GitHub login, or one gh isn't signed in to, runs nothing.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fakeBin, repoFile, sh } from "../lib/helpers.mjs";

const GH = repoFile("mods/kelpie/gh.sh");
const TOKEN = "gho_fakeTokenOfWorkMe";

// A fake gh: `auth token --user work-me` prints its token, any other account fails; the rest succeed.
function setup() {
  const fakes = fakeBin().add("gh", `[ "$1 $2" = "auth token" ] || exit 0
case " $* " in *" --user work-me "*) echo "${TOKEN}"; exit 0 ;; esac
exit 1`);
  const run = (...args) => sh("sh", [GH, ...args], { env: { PATH: fakes.path } });
  return { fakes, run };
}
const tokenOf = (call) => /^GH_TOKEN=(.*)$/m.exec(call.env)?.[1] ?? null;

describe("gh.sh", () => {
  test("runs gh as the named account: its token in gh's environment, not in its arguments", () => {
    const { fakes, run } = setup();
    const r = run("work-me", "api", "graphql", "-f", "q=is:pr");
    assert.equal(r.code, 0, r.stderr);
    const [ask, call] = fakes.calls("gh");
    assert.deepEqual(ask.argv, ["auth", "token", "--hostname", "github.com", "--user", "work-me"]);
    assert.deepEqual(call.argv, ["api", "--include", "graphql", "-f", "q=is:pr"]);
    assert.equal(tokenOf(call), TOKEN);
    assert.ok(!call.argv.join(" ").includes(TOKEN));
    assert.ok(!r.stdout.includes(TOKEN) && !r.stderr.includes(TOKEN), "the token is never printed");
  });

  test("with no account, gh runs as it is, on its active account", () => {
    const { fakes, run } = setup();
    assert.equal(run("", "api", "user").code, 0);
    const calls = fakes.calls("gh");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].argv, ["api", "--include", "user"]);
    assert.equal(tokenOf(calls[0]), null);
  });

  test("an API call asks for the response's headers, for the limit guard, unless it asks itself or pages", () => {
    const { fakes, run } = setup();
    for (const args of [["api", "-i", "user"], ["api", "--include", "user"], ["api", "--paginate", "repos/a/b/pulls/1/files"], ["auth", "status"]]) {
      fakes.clear();
      assert.equal(run("", ...args).code, 0);
      assert.deepEqual(fakes.calls("gh")[0].argv, args, args.join(" "));
    }
  });

  test("an account gh isn't signed in to fails with what to do, and gh isn't run", () => {
    const { fakes, run } = setup();
    const r = run("someone-else", "api", "user");
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /isn't signed in to the GitHub account someone-else.*gh auth login/);
    assert.equal(fakes.calls("gh").length, 1, "only the token was asked for");
  });

  test("a name that isn't a GitHub login runs nothing", () => {
    const { fakes, run } = setup();
    for (const bad of ["-u", "--user=x", "a b", "x;y", "a--b", "-"]) {
      assert.equal(run(bad, "api", "user").code, 2, bad);
    }
    assert.deepEqual(fakes.calls("gh"), []);
  });
});
