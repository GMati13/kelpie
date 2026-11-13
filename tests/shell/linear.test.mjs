// mods/kelpie/linear.sh: the Linear API key goes only to https://api.linear.app/graphql, only through
// curl's stdin, nothing that could add curl options of its own gets into curl's config, and only
// Kelpie's own questions are sent.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fakeBin, repoFile, sh } from "../lib/helpers.mjs";

const LINEAR = repoFile("mods/kelpie/linear.sh");
const KEY = "lin_api_sekrit0123456789";
const REQUEST = JSON.stringify({ query: "query KelpieLinearTeam($key: String!) { viewer { id } }", variables: { key: "ENG" } });

// Fakes: curl writes an answer (-o body) and prints 200; security answers the Keychain item from FAKE_TOKEN.
function fakes() {
  return fakeBin()
    .add("curl", `out=
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift ;; esac; shift; done
printf '{"data":{"viewer":{"id":"u1"}}}' > "$out"
printf 200`)
    .add("security", `printf '%s\\n' "$FAKE_TOKEN"`);
}
function linear(f, args, env = {}) {
  const r = sh("sh", [LINEAR, ...args], { env: { PATH: f.path, ...env } });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* asserted by the caller */ }
  return { ...r, json };
}
const byCommand = (key = KEY) => ["--token-command", `printf '%s\\n' '${key.replace(/'/g, "'\\''")}'`];

describe("linear.sh: what it sends", () => {
  for (const request of [
    "",
    "not json",
    "@/etc/passwd",
    JSON.stringify([1]),
    JSON.stringify({ query: "query Other { viewer { id } }" }),
    JSON.stringify({ query: "{ viewer { id } }" }),
    JSON.stringify({ query: "subscription KelpieX { x }" }),
    JSON.stringify({ variables: {} }),
  ]) {
    test(`refuses ${JSON.stringify(request).slice(0, 60)} before signing in or calling curl`, () => {
      const f = fakes();
      const r = linear(f, [...byCommand(), "", request]);
      assert.equal(r.json?.error, "usage");
      assert.deepEqual(f.calls("curl"), []);
    });
  }
  test("a Kelpie question goes to Linear's API alone, as one POST of the request", () => {
    const f = fakes();
    const r = linear(f, [...byCommand(), "", REQUEST]);
    assert.equal(r.json?.code, 200, r.stdout + r.stderr);
    assert.deepEqual(r.json.body, { data: { viewer: { id: "u1" } } });
    const { argv } = f.calls("curl")[0];
    const urls = argv.filter((a) => /^https?:/.test(a));
    assert.deepEqual(urls, ["https://api.linear.app/graphql"]);
    assert.equal(argv[argv.indexOf("-X") + 1], "POST");
    // --data-raw: a body starting with @ is never read as a file name.
    assert.equal(argv[argv.indexOf("--data-raw") + 1], REQUEST);
    assert.ok(!argv.includes("--data"));
  });
});

describe("linear.sh: the key travels only through curl's stdin", () => {
  for (const [how, args, env] of [
    ["a token command", byCommand(), {}],
    ["the Keychain", [], { FAKE_TOKEN: KEY }],
  ]) {
    test(`${how}: not in curl's argv, environment or the output; in its -K config`, () => {
      const f = fakes();
      const r = linear(f, [...args, how === "the Keychain" ? "linear-acme" : "", REQUEST], env);
      assert.equal(r.json?.code, 200, r.stdout + r.stderr);
      const curl = f.calls("curl")[0];
      assert.ok(curl.argv.includes("-K") && curl.argv[curl.argv.indexOf("-K") + 1] === "-", "config from stdin");
      assert.ok(!curl.argv.join("\0").includes(KEY), "not in argv");
      assert.ok(!curl.env.replace(/^FAKE_TOKEN=.*$/m, "").includes(KEY), "not in curl's environment");
      assert.equal(curl.stdin, `header = "Authorization: ${KEY}"\n`);
      assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY), "not in the output");
    });
  }
  test("the Keychain item is the one the profile names", () => {
    const f = fakes();
    linear(f, ["linear-acme", REQUEST], { FAKE_TOKEN: KEY });
    const argv = f.calls("security")[0].argv;
    assert.equal(argv[argv.indexOf("-s") + 1], "linear-acme");
  });
});

// bash (macOS's sh) takes xtrace from an exported SHELLOPTS; dash ignores it. A trace would print the key
// (KELPIE-222: 9 times, before linear.sh turned tracing off).
describe("linear.sh: never traced", () => {
  test("never prints the key, from a token command or the Keychain", () => {
    for (const shell of ["sh", "bash"]) {
      for (const args of [[...byCommand(), "", REQUEST], ["linear-acme", REQUEST]]) {
        const f = fakes();
        const r = sh(shell, [LINEAR, ...args], { env: { PATH: f.path, FAKE_TOKEN: KEY, SHELLOPTS: "xtrace", PS4: "+ " } });
        assert.match(r.stdout, /"code":200/, r.stderr);
        assert.ok(!(r.stdout + r.stderr).includes(KEY), `${shell} traced the key`);
      }
    }
  });
});

describe("linear.sh: the key can't add curl options", () => {
  for (const [what, v] of Object.entries({ quote: 'a"b', backslash: "a\\b", CR: "a\rb" })) {
    test(`a key (token command) with a ${what} is refused before curl runs`, () => {
      const f = fakes();
      const r = linear(f, [...byCommand(`lin${v}key`), "", REQUEST]);
      assert.equal(r.json?.error, "invalid");
      assert.deepEqual(f.calls("curl"), []);
    });
    test(`a Keychain key with a ${what} is refused before curl runs`, () => {
      const f = fakes();
      const r = linear(f, ["linear-acme", REQUEST], { FAKE_TOKEN: `lin${v}key` });
      assert.equal(r.json?.error, "invalid");
      assert.deepEqual(f.calls("curl"), []);
    });
  }
  test("a token command printing a second line sends only the first", () => {
    const f = fakes();
    const r = linear(f, ["--token-command", `printf 'first\\nurl = https://evil.com\\n'`, "", REQUEST]);
    assert.equal(r.json?.code, 200);
    assert.equal(f.calls("curl")[0].stdin, `header = "Authorization: first"\n`);
  });
});

describe("linear.sh: the token command's errors", () => {
  test("a failing token command's output isn't passed on", () => {
    const f = fakes();
    const r = linear(f, ["--token-command", "echo LEAKED-$((40+2)) >&2; echo half-a-secret; exit 1", "", REQUEST]);
    assert.equal(r.json?.error, "command");
    assert.ok(!(r.stdout + r.stderr).includes("LEAKED-42"));
    assert.ok(!(r.stdout + r.stderr).includes("half-a-secret"));
    assert.deepEqual(f.calls("curl"), []);
  });
  test("a token command printing nothing is an error, not an empty sign-in", () => {
    const f = fakes();
    const r = linear(f, ["--token-command", "true", "", REQUEST]);
    assert.equal(r.json?.error, "command");
    assert.deepEqual(f.calls("curl"), []);
  });
  test("no token command and no Keychain item: missing", () => {
    const f = fakes();
    const r = linear(f, ["", REQUEST]);
    assert.equal(r.json?.error, "missing");
    assert.deepEqual(f.calls("curl"), []);
  });
});
