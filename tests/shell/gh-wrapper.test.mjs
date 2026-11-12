// Kelpie's gh (mods/kelpie/bin/gh) and the shell setup line that puts it first in PATH (GH_SHELL_LINE
// in setup.js, the README's "Several accounts"), run for real in bash and zsh with a fake gh signed in
// to two accounts, alice active: with KELPIE_GH_ACCOUNT=bob, gh acts as bob, also when a program
// started from the shell runs it (#103), its token only in that gh run's environment; `gh auth status`
// names bob (#102); gh's own sign-in commands, a GH_TOKEN already set and shells without the account
// run gh as it is; an account gh isn't signed in to runs nothing. And gh-shell-check.sh, the GitHub
// page's Check my shell, with what it says (shellVerdict()).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GH_SHELL_LINE, shellVerdict } from "../../mods/kelpie/setup.js";
import { fakeBin, readRepo, repoFile, sh, tempDir } from "../lib/helpers.mjs";

const BIN = repoFile("mods/kelpie/bin");
const TOKEN = "gho_fakeTokenOfBob";
const has = (program) => { try { execFileSync("sh", ["-c", `command -v ${program}`]); return true; } catch { return false; } };

// A fake gh signed in to alice (active) and bob: `auth token --user bob` prints bob's token, any other
// account fails; `api user` and `auth status` answer as GH_TOKEN's account, else the active one.
function fakeGh() {
  return fakeBin().add("gh", `who=alice; [ "$GH_TOKEN" = "${TOKEN}" ] && who=bob
case "$1 $2" in
  "auth token") case " $* " in *" --user bob "*) echo "${TOKEN}"; exit 0 ;; esac; exit 1 ;;
  "auth status") echo "github.com"; echo "  Logged in to github.com account $who"; exit 0 ;;
  "api user") echo "$who"; exit 0 ;;
esac
exit 0`);
}
const tokenOf = (call) => /^GH_TOKEN=(.*)$/m.exec(call.env)?.[1] ?? null;
// Runs a script in `shell` set up as a Kelpie terminal is: the account and Kelpie's gh's folder in its
// environment, the shell setup line first (`line: false`: a shell setup without it).
const inShell = (shell, fakes, script, { account = "bob", line = true, env = {} } = {}) =>
  sh(shell, ["-c", `${line ? GH_SHELL_LINE : ":"}\n${script}`], {
    env: { PATH: fakes.path, ...(account ? { KELPIE_GH_ACCOUNT: account, KELPIE_GH_BIN: BIN } : {}), ...env },
  });

for (const shell of ["bash", "zsh"]) {
  describe(`Kelpie's gh, in ${shell}`, { skip: !has(shell) && `${shell} isn't installed` }, () => {
    test("a program started from the shell runs gh as the profile's account, not gh's active one", () => {
      const fakes = fakeGh();
      const r = inShell(shell, fakes, `sh -c 'gh api user'`);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout.trim(), "bob");
      // Without the line, the same program gets the active account: what #103 was.
      assert.equal(inShell(shell, fakeGh(), `sh -c 'gh api user'`, { line: false }).stdout.trim(), "alice");
    });

    test("the shell's own gh too, its token in gh's environment only, asked for by name", () => {
      const fakes = fakeGh();
      const r = inShell(shell, fakes, `gh api user; echo "shell:$GH_TOKEN"`);
      assert.equal(r.stdout, "bob\nshell:\n");
      const [ask, call] = fakes.calls("gh");
      assert.deepEqual(ask.argv, ["auth", "token", "--hostname", "github.com", "--user", "bob"]);
      assert.deepEqual(call.argv, ["api", "user"]);
      assert.equal(tokenOf(ask), null);
      assert.equal(tokenOf(call), TOKEN);
      assert.ok(!r.stdout.includes(TOKEN) && !r.stderr.includes(TOKEN));
    });

    test("gh auth status names the account gh acts as there", () => {
      const r = inShell(shell, fakeGh(), "gh auth status");
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /account bob/);
      assert.match(r.stderr, /gh acts as bob, the Kelpie profile's GitHub account/);
    });

    test("gh's own sign-in commands, help and completion run as they are, with no token", () => {
      const fakes = fakeGh();
      const runs = [["auth", "login"], ["auth", "switch", "--user", "alice"], ["auth", "logout"], ["auth", "refresh"], ["auth", "setup-git"], ["--version"], ["completion", "-s", "zsh"], []];
      for (const args of runs) inShell(shell, fakes, `gh ${args.join(" ")}`);
      const calls = fakes.calls("gh");
      assert.deepEqual(calls.map((c) => c.argv), runs);
      assert.ok(calls.every((c) => tokenOf(c) === null));
    });

    test("a GH_TOKEN already set, or a shell without the account, runs gh as it is", () => {
      const fakes = fakeGh();
      inShell(shell, fakes, "gh api user", { env: { GH_TOKEN: "chosen" } });
      inShell(shell, fakes, "gh api user", { account: null });
      const calls = fakes.calls("gh");
      assert.deepEqual(calls.map((c) => [c.argv, tokenOf(c)]), [[["api", "user"], "chosen"], [["api", "user"], null]]);
    });

    test("the line puts only an absolute folder with no colon first in PATH, and minds set -u", () => {
      for (const bin of ["bin", "./bin", "/a:/b", ":/a", "/a:"]) {
        const fakes = fakeGh();
        const r = inShell(shell, fakes, 'printf %s "$PATH"', { env: { KELPIE_GH_BIN: bin } });
        assert.equal(r.stdout, fakes.path, bin);
      }
      const r = inShell(shell, fakeGh(), "set -u; echo fine", { account: null });
      assert.equal(r.stdout, "fine\n", r.stderr);
    });

    test("an account gh isn't signed in to fails with what to do, and gh doesn't run as anyone else", () => {
      const fakes = fakeGh();
      const r = inShell(shell, fakes, "sh -c 'gh pr list'", { account: "carol" });
      assert.notEqual(r.code, 0);
      assert.match(r.stderr, /isn't signed in as carol.*gh auth login/);
      assert.equal(fakes.calls("gh").length, 1, "only the token was asked for");
    });
  });
}

describe("Kelpie's gh finding the real one", () => {
  test("never itself, even when its folder is on PATH twice", () => {
    const fakes = fakeGh();
    const r = sh(join(BIN, "gh"), ["api", "user"], { env: { PATH: `${BIN}:${BIN}/:${fakes.path}`, KELPIE_GH_ACCOUNT: "bob" } });
    assert.equal(r.stdout.trim(), "bob", r.stderr);
  });
  test("no other gh: says so instead of looping", () => {
    const r = sh(join(BIN, "gh"), ["api", "user"], { env: { PATH: `${BIN}:/usr/bin:/bin`, KELPIE_GH_ACCOUNT: "bob" } });
    assert.equal(r.code, 127);
    assert.match(r.stderr, /found no other gh/);
  });
  test("never one copy running another for ever: two Kelpie gh folders on PATH", () => {
    const other = join(tempDir(), "bin");
    mkdirSync(other);
    copyFileSync(join(BIN, "gh"), join(other, "gh"));
    for (const args of [["help"], ["api", "user"]]) {
      const fakes = fakeGh();
      const r = sh(join(BIN, "gh"), args, { env: { PATH: `${BIN}:${other}:${fakes.path}`, KELPIE_GH_ACCOUNT: "bob" }, timeout: 5000 });
      assert.equal(r.code, 0, `${args}: ${r.stderr}`);
      assert.deepEqual(fakes.calls("gh").at(-1).argv, args);
    }
  });
  test("a trace turned on from outside never prints the token", () => {
    // bash (macOS's sh) takes xtrace from an exported SHELLOPTS; dash ignores it.
    for (const shell of ["sh", ...(has("bash") ? ["bash"] : [])]) {
      const r = sh(shell, [join(BIN, "gh"), "api", "user"], { env: { PATH: fakeGh().path, KELPIE_GH_ACCOUNT: "bob", SHELLOPTS: "xtrace", PS4: "+ " } });
      assert.equal(r.stdout.trim(), "bob", r.stderr);
      assert.ok(!r.stderr.includes(TOKEN) && !r.stdout.includes(TOKEN), `${shell} traced the token`);
    }
  });
  test("an account that isn't a GitHub login runs nothing", () => {
    for (const bad of ["-x", "a b", "x;y", "$(id)", "a--b", "a-", "bob\nx", "bob\n"]) {
      const fakes = fakeGh();
      const r = sh(join(BIN, "gh"), ["api", "user"], { env: { PATH: fakes.path, KELPIE_GH_ACCOUNT: bad } });
      assert.equal(r.code, 2, bad);
      assert.deepEqual(fakes.calls("gh"), [], bad);
    }
  });
});

test("the README shows the same line the profile dialog copies", () => {
  const readme = readRepo("README.md").replace(/^  /gm, "");
  assert.ok(readme.includes(GH_SHELL_LINE), "README's Several accounts has GH_SHELL_LINE's lines");
});

describe("gh-shell-check.sh", () => {
  const CHECK = repoFile("mods/kelpie/gh-shell-check.sh");
  // A fake shell: reads the shell setup the test gives (FAKE_RC), then runs its -c script, as
  // `$SHELL -lic` would.
  const shellFakes = fakeBin().add("fake-shell", '[ -n "$FAKE_RC" ] && . "$FAKE_RC"; eval "$2"');
  const rc = (text) => { const f = join(tempDir(), "rc"); writeFileSync(f, text); return f; };
  const check = (setup, account = "bob", env = {}) => {
    const fakes = fakeGh();
    return sh("sh", [CHECK, account], { env: { PATH: fakes.path, SHELL: `${shellFakes.bin}/fake-shell`, FAKE_RC: rc(setup), ...env } });
  };
  // The gh() function the profile dialog gave before #103: it reached only gh typed in the shell.
  const OLD_FUNCTION = `gh() {
  if [ -n "$KELPIE_GH_ACCOUNT" ] && [ "$1" != auth ]; then
    t=$(command gh auth token --hostname github.com --user "$KELPIE_GH_ACCOUNT") || return 1
    GH_TOKEN=$t command gh "$@"
  else command gh "$@"; fi
}`;

  test("with the line, gh acts as the account in the shell and in a program started from it", () => {
    const r = check(GH_SHELL_LINE);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^shell=bob$/m);
    assert.match(r.stdout, /^program=bob$/m);
    assert.deepEqual(shellVerdict(r.stdout, "bob")[0], true);
  });
  test("with only the old gh() function, it fails the way it fails: a program's gh is someone else", () => {
    const r = check(OLD_FUNCTION);
    assert.match(r.stdout, /^shell=bob$/m);
    assert.match(r.stdout, /^program=alice$/m);
    const [ok, words] = shellVerdict(r.stdout, "bob");
    assert.equal(ok, false);
    assert.match(words, /programs that run gh act as alice.*end of your shell setup/);
  });
  test("with nothing set up, it names the account gh acts as instead", () => {
    const [ok, words] = shellVerdict(check("").stdout, "bob");
    assert.equal(ok, false);
    assert.match(words, /gh here acts as alice, not bob/);
  });
  test("a GH_TOKEN set by the shell setup is named as the cause", () => {
    const [ok, words] = shellVerdict(check(`export GH_TOKEN=other\n${GH_SHELL_LINE}`).stdout, "bob");
    assert.equal(ok, false);
    assert.match(words, /sets GH_TOKEN/);
  });
  test("no answer says what to check", () => {
    assert.match(shellVerdict("noise from a shell setup\n", "bob")[1], /didn't answer.*gh auth login/);
  });
  test("a name that isn't a GitHub login starts nothing", () => {
    shellFakes.clear();
    for (const bad of ["-x", "a b", "x;y", "$(id)", "a--b", "a-", "", "bob\nx", "x\nbob", "bob\n"]) assert.equal(sh("sh", [CHECK, bad], { env: { SHELL: `${shellFakes.bin}/fake-shell` } }).code, 2, bad);
    assert.deepEqual(shellFakes.calls("fake-shell"), []);
  });
});
