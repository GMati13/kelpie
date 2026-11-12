// mods/kelpie/jira.sh: the Jira token goes only to https://<name>.atlassian.net, only through curl's
// stdin, and nothing that could add curl options of its own gets into curl's config.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fakeBin, repoFile, sh } from "../lib/helpers.mjs";

const JIRA = repoFile("mods/kelpie/jira.sh");
const SITE = "https://acme.atlassian.net";
const TOKEN = "TOKEN-sekrit-0123456789";
const EMAIL = "me@example.com";
// A real bug, left for the person to fix: jira.sh checks the site, a transition's key and its id with
// `printf | grep -Eq`, which matches line by line, so a value with a line break passes when any one
// line of it is valid (`https://acme.atlassian.net\nhttps://evil.com` passes the site check). curl
// then refuses the malformed URL, so nothing is sent today, but the check itself doesn't hold.

// Fakes: curl writes a signed-in answer (-o body, -D headers) and prints 200; security answers the
// Keychain item from FAKE_TOKEN and FAKE_ACCT.
function fakes() {
  return fakeBin()
    .add("curl", `out=; hdr=
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift ;; -D) hdr=$2; shift ;; esac; shift; done
printf '{"ok":true}' > "$out"
printf 'HTTP/2 200\\r\\nx-aaccountid: abc\\r\\n' > "$hdr"
printf 200`)
    .add("security", `case " $* " in
  *" -w "*) printf '%s\\n' "$FAKE_TOKEN" ;;
  *) printf '    "acct"<blob>="%s"\\n' "$FAKE_ACCT" ;;
esac`);
}

function jira(f, args, env = {}) {
  const r = sh("sh", [JIRA, ...args], { env: { PATH: f.path, ...env } });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* asserted by the caller */ }
  return { ...r, json };
}
// Signed in by a token command printing TOKEN.
const byCommand = (token = TOKEN, email = EMAIL) => ["--email", email, "--token-command", `printf '%s\\n' '${token.replace(/'/g, "'\\''")}'`];

describe("jira.sh: the site", () => {
  for (const site of [
    "https://evil.com/x.atlassian.net",
    "https://evil.com/.atlassian.net",
    "https://acme.atlassian.net.evil.com",
    "https://acme.atlassian.net@evil.com",
    "https://acme.atlassian.net:443@evil.com",
    "https://evil.com#acme.atlassian.net",
    "https://evil.com?x=.atlassian.net",
    "https://acme.atlassian.net/x",
    "http://acme.atlassian.net",
    "https://.atlassian.net",
    "https://a.b.atlassian.net",
    "acme.atlassian.net",
    "https://acme.atlassian.net\nhttps://evil.com",
    "",
  ]) {
    test(`refuses ${JSON.stringify(site)} before signing in or calling curl`, () => {
      const f = fakes();
      const r = jira(f, [...byCommand(), site, "", "get", "/rest/api/3/myself"]);
      assert.equal(r.json?.error, "site");
      assert.deepEqual(f.calls("curl"), []);
      assert.deepEqual(f.calls("security"), []);
    });
  }

  for (const site of [SITE, `${SITE}/`, "https://my-team2.atlassian.net"]) {
    test(`accepts ${site}`, () => {
      const f = fakes();
      const r = jira(f, [...byCommand(), site, "", "get", "/rest/api/3/myself"]);
      assert.equal(r.json?.code, 200, r.stdout + r.stderr);
      assert.equal(f.calls("curl").length, 1);
    });
  }
});

describe("jira.sh: get paths", () => {
  for (const path of ["rest/api/3/myself", "//evil.com/rest/api", "@evil.com/rest/", "/x/rest/api", "https://evil.com/rest/api", ".evil.com/rest/", ""]) {
    test(`refuses ${JSON.stringify(path)}`, () => {
      const f = fakes();
      const r = jira(f, [...byCommand(), SITE, "", "get", path]);
      assert.equal(r.json?.error, "path");
      assert.deepEqual(f.calls("curl"), []);
    });
  }

  for (const path of ["/rest/api/3/myself", "/rest/agile/1.0/board/12/configuration", "/rest/@evil.com/x", "/rest/../../x"]) {
    test(`${path} stays on the site`, () => {
      const f = fakes();
      const r = jira(f, [...byCommand(), SITE, "", "get", path]);
      assert.equal(r.json?.code, 200);
      const urls = f.calls("curl")[0].argv.filter((a) => /^https?:/.test(a));
      assert.equal(urls.length, 1, `one URL: ${urls}`);
      assert.equal(new URL(urls[0]).host, "acme.atlassian.net");
      assert.ok(urls[0].startsWith(`${SITE}/rest/`));
    });
  }
});

describe("jira.sh: the sign-in can't add curl options", () => {
  const bad = { quote: 'a"b', backslash: "a\\b", CR: "a\rb", LF: "a\nb" };
  for (const [what, v] of Object.entries(bad)) {
    test(`an email with a ${what} is refused before curl runs`, () => {
      const f = fakes();
      const r = jira(f, [...byCommand(TOKEN, `me${v}@example.com`), SITE, "", "get", "/rest/api/3/myself"]);
      assert.equal(r.json?.error, "invalid");
      assert.deepEqual(f.calls("curl"), []);
    });
  }
  // A token command's output counts up to its first line (and loses a trailing CR), so a line break
  // there can't reach curl anyway; the rest must be refused.
  for (const [what, v] of Object.entries({ quote: bad.quote, backslash: bad.backslash, CR: bad.CR })) {
    test(`a token (token command) with a ${what} is refused before curl runs`, () => {
      const f = fakes();
      const r = jira(f, [...byCommand(`tok${v}en`), SITE, "", "get", "/rest/api/3/myself"]);
      assert.equal(r.json?.error, "invalid");
      assert.deepEqual(f.calls("curl"), []);
    });
  }
  for (const [what, v] of Object.entries({ quote: bad.quote, backslash: bad.backslash, CR: bad.CR })) {
    test(`a Keychain token with a ${what} is refused before curl runs`, () => {
      const f = fakes();
      const r = jira(f, [SITE, "jira-acme", "get", "/rest/api/3/myself"], { FAKE_TOKEN: `tok${v}en`, FAKE_ACCT: EMAIL });
      assert.equal(r.json?.error, "invalid");
      assert.deepEqual(f.calls("curl"), []);
    });
    test(`a Keychain account (email) with a ${what} is refused before curl runs`, () => {
      const f = fakes();
      const r = jira(f, [SITE, "jira-acme", "get", "/rest/api/3/myself"], { FAKE_TOKEN: TOKEN, FAKE_ACCT: `me${v}@example.com` });
      // A CR in the account doesn't survive sed's line matching: then the email is missing instead.
      assert.ok(["invalid", "missing"].includes(r.json?.error), r.stdout);
      assert.deepEqual(f.calls("curl"), []);
    });
  }
  test("a token command printing a second line sends only the first", () => {
    const f = fakes();
    const r = jira(f, ["--email", EMAIL, "--token-command", `printf 'first\\nuser = "x:y"\\nurl = https://evil.com\\n'`, SITE, "", "get", "/rest/api/3/myself"]);
    assert.equal(r.json?.code, 200);
    assert.equal(f.calls("curl")[0].stdin, `user = "${EMAIL}:first"\n`);
  });
});

describe("jira.sh: transition", () => {
  for (const [key, id] of [["abc-1", "31"], ["ABC-1;x", "31"], ["ABC-1/../../x", "31"], ["ABC", "31"], ["-1", "31"], ["ABC-1", "3a"], ["ABC-1", ""], ["ABC-1", "1 2"], ["ABC-1\nABC-2", "31"], ["ABC-1", "31\n32"]]) {
    test(`refuses key ${JSON.stringify(key)}, id ${JSON.stringify(id)}`, () => {
      const f = fakes();
      const r = jira(f, [...byCommand(), SITE, "", "transition", key, id]);
      assert.equal(r.json?.error, "usage");
      assert.deepEqual(f.calls("curl"), []);
    });
  }
  test("moves a valid key with a valid id: one POST to its transitions", () => {
    const f = fakes();
    const r = jira(f, [...byCommand(), SITE, "", "transition", "ABC_2-12", "31"]);
    assert.equal(r.json?.code, 200);
    const { argv } = f.calls("curl")[0];
    assert.ok(argv.includes(`${SITE}/rest/api/3/issue/ABC_2-12/transitions`));
    assert.equal(argv[argv.indexOf("-X") + 1], "POST");
    assert.deepEqual(JSON.parse(argv[argv.indexOf("--data") + 1]), { transition: { id: "31" } });
  });
  // Labels and the type say what kind of work a ticket is on its row (#53).
  test("a search asks for each issue's type and labels", () => {
    const f = fakes();
    jira(f, [...byCommand(), SITE, "", "search", "project = ABC", ""]);
    const { argv } = f.calls("curl")[0];
    const { fields } = JSON.parse(argv[argv.indexOf("--data") + 1]);
    assert.ok(fields.includes("issuetype") && fields.includes("labels"), fields.join(", "));
  });
  test("an unknown action is refused", () => {
    const f = fakes();
    assert.equal(jira(f, [...byCommand(), SITE, "", "delete", "/rest/api/3/issue/ABC-1"]).json?.error, "usage");
    assert.deepEqual(f.calls("curl"), []);
  });
});

describe("jira.sh: the token travels only through curl's stdin", () => {
  for (const [how, args, env] of [
    ["a token command", [...byCommand(), SITE, ""], {}],
    ["the Keychain", [SITE, "jira-acme"], { FAKE_TOKEN: TOKEN, FAKE_ACCT: EMAIL }],
  ]) {
    for (const action of [["get", "/rest/api/3/myself"], ["search", "project = ABC"], ["transition", "ABC-1", "31"]]) {
      test(`${how}, ${action[0]}: not in curl's argv, environment or the output; in its -K config`, () => {
        const f = fakes();
        const r = jira(f, [...args, ...action], env);
        assert.equal(r.json?.code, 200, r.stdout + r.stderr);
        const curl = f.calls("curl")[0];
        assert.ok(curl.argv.includes("-K") && curl.argv[curl.argv.indexOf("-K") + 1] === "-", "config from stdin");
        assert.ok(!curl.argv.join("\0").includes(TOKEN), "not in argv");
        assert.ok(!curl.env.replace(/^FAKE_TOKEN=.*$/m, "").includes(TOKEN), "not in curl's environment");
        assert.equal(curl.stdin, `user = "${EMAIL}:${TOKEN}"\n`);
        assert.ok(!r.stdout.includes(TOKEN) && !r.stderr.includes(TOKEN), "not in the output");
      });
    }
  }
});

describe("jira.sh: a trace turned on from outside", () => {
  // bash (macOS's sh) takes xtrace from an exported SHELLOPTS; dash ignores it.
  test("never prints the token, from a token command or the Keychain", () => {
    for (const shell of ["sh", "bash"]) {
      for (const args of [[...byCommand(), SITE, "", "get", "/rest/api/3/myself"], [SITE, "jira-item", "get", "/rest/api/3/myself"]]) {
        const f = fakes();
        const r = sh(shell, [JIRA, ...args], { env: { PATH: f.path, FAKE_TOKEN: TOKEN, FAKE_ACCT: EMAIL, SHELLOPTS: "xtrace", PS4: "+ " } });
        assert.match(r.stdout, /"code":200/, r.stderr);
        assert.ok(!(r.stdout + r.stderr).includes(TOKEN), `${shell} traced the token`);
      }
    }
  });
});

describe("jira.sh: the token command's errors", () => {
  test("a failing token command's stderr isn't passed on", () => {
    const f = fakes();
    const r = jira(f, ["--email", EMAIL, "--token-command", "echo LEAKED-$((40+2)) >&2; echo half-a-secret; exit 1", SITE, "", "get", "/rest/api/3/myself"]);
    assert.equal(r.json?.error, "command");
    assert.ok(!(r.stdout + r.stderr).includes("LEAKED-42"));
    assert.ok(!(r.stdout + r.stderr).includes("half-a-secret"));
    assert.deepEqual(f.calls("curl"), []);
  });
  test("a working token command's stderr isn't passed on either", () => {
    const f = fakes();
    const r = jira(f, ["--email", EMAIL, "--token-command", `echo NOISE-$((40+2)) >&2; echo ${TOKEN}`, SITE, "", "get", "/rest/api/3/myself"]);
    assert.equal(r.json?.code, 200);
    assert.ok(!(r.stdout + r.stderr).includes("NOISE-42"));
  });
  test("a token command printing nothing is an error, not an empty sign-in", () => {
    const f = fakes();
    const r = jira(f, ["--email", EMAIL, "--token-command", "true", SITE, "", "get", "/rest/api/3/myself"]);
    assert.equal(r.json?.error, "command");
    assert.deepEqual(f.calls("curl"), []);
  });
});

// KELPIE-40: the signed-in account's id comes back too, so a load tells your issues by their assignee
// without asking Jira again (board.js keptJira()). Only an id: anything else in that header is dropped.
describe("jira.sh: the signed-in account", () => {
  const withHeader = (line) => fakeBin().add("curl", `out=; hdr=
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift ;; -D) hdr=$2; shift ;; esac; shift; done
printf '{"ok":true}' > "$out"
printf 'HTTP/2 200\\r\\n%s\\r\\n' '${line}' > "$hdr"
printf 200`);
  test("its id, as Jira names it", () => {
    const r = jira(withHeader("X-AAccountId: 5b10a2844c20165700ede21g"), [...byCommand(), SITE, "", "get", "/rest/api/3/myself"]);
    assert.equal(r.json?.authed, true);
    assert.equal(r.json?.account, "5b10a2844c20165700ede21g");
  });
  test("none when Jira named nobody", () => {
    const r = jira(withHeader("x-other: 1"), [...byCommand(), SITE, "", "get", "/rest/api/3/myself"]);
    assert.equal(r.json?.authed, false);
    assert.equal(r.json?.account, "");
  });
  test("a value that isn't an id is dropped", () => {
    const r = jira(withHeader("x-aaccountid: a b\"c<script>"), [...byCommand(), SITE, "", "get", "/rest/api/3/myself"]);
    assert.equal(r.json?.account, "");
  });
});
