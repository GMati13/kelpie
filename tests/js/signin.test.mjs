// Jira sign-in through a token command (a password manager's `op read …`, `pass …`, `secret-tool
// lookup …`) instead of the macOS Keychain, from the profile dialog to jira.sh, on macOS and on
// Linux (no Keychain there). jira.sh's own handling of the token is tests/shell/jira.test.mjs.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { texts } from "gpui-kit";
import { fakeBin, tempDir } from "../lib/helpers.mjs";
import { DEMO, fakeCx, setupDemoWorld } from "../lib/views.mjs";
import { byId } from "../lib/snapshot.mjs";
import { jira } from "../../mods/kelpie/sprint.js";
import { Setup } from "../../mods/kelpie/setup.js";

beforeEach(() => mock.reset());

const SITE = "https://acme.atlassian.net";
const TOKEN = "TOKEN-sekrit-0123456789";
const EMAIL = "me@example.com";
const COMMAND = `printf '%s\\n' '${TOKEN}'`;

// A fake curl answering signed in (Jira's X-AAccountId header) with `body`.
function fakeCurl(body = { ok: true }) {
  return fakeBin().add("curl", `out=; hdr=
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift ;; -D) hdr=$2; shift ;; esac; shift; done
printf '%s' '${JSON.stringify(body)}' > "$out"
printf 'HTTP/2 200\\r\\nx-aaccountid: abc\\r\\n' > "$hdr"
printf 200`);
}
// jira.sh run for real, with only the fakes, the system's tools and a shell of its own.
function realJira(f) {
  const env = { PATH: f.path, HOME: tempDir("kelpie-home-"), LANG: "C", SHELL: "/bin/sh" };
  mock.on.exec = (cmd, args) => mock.realExec(cmd, args, { env });
}

describe("jira(): a profile signed in by a token command", () => {
  test("jira.sh gets the email and the command before the site, and no Keychain item", async () => {
    mock.on.exec = () => ({ code: 0, stdout: JSON.stringify({ site: SITE, code: 200, authed: true, body: {} }), stderr: "" });
    await jira({ site: SITE, board: 7, keychain: "old-item", email: EMAIL, tokenCommand: COMMAND }, "get", "/rest/api/3/myself");
    const [cmd, args] = mock.of("exec")[0];
    assert.equal(cmd, "sh");
    assert.ok(args[0].endsWith("/jira.sh"));
    assert.deepEqual(args.slice(1), ["--email", EMAIL, "--token-command", COMMAND, SITE, "old-item", "get", "/rest/api/3/myself"]);
  });
  test("end to end: the command's token reaches curl's stdin only, and the answer comes back", async () => {
    const f = fakeCurl({ name: "Team flow", type: "kanban" });
    realJira(f);
    const r = await jira({ site: SITE, board: 7, email: EMAIL, tokenCommand: COMMAND }, "get", "/rest/agile/1.0/board/7");
    assert.deepEqual(r.body, { name: "Team flow", type: "kanban" });
    const [curl] = f.calls("curl");
    assert.equal(curl.stdin, `user = "${EMAIL}:${TOKEN}"\n`);
    assert.ok(!curl.argv.join(" ").includes(TOKEN), "not in curl's arguments");
    assert.ok(!curl.env.includes(TOKEN), "not in curl's environment");
  });
  test("a command that fails says to check it, on any system", async () => {
    for (const platform of ["macos", "linux"]) {
      mock.reset();
      mock.state.window.platform = platform;
      realJira(fakeCurl());
      await assert.rejects(jira({ site: SITE, board: 7, email: EMAIL, tokenCommand: "exit 3" }, "get", "/rest/api/3/myself"),
        /The token command failed or printed nothing\. Check the token command in this profile/, platform);
    }
  });
});

describe("jira(): no sign-in on Linux", () => {
  test("says there's no Keychain and to give a token command, not to check a Keychain item", async () => {
    mock.state.window.platform = "linux";
    const f = fakeCurl();
    realJira(f);
    const e = await jira({ site: SITE, board: 7, keychain: "" }, "get", "/rest/api/3/myself").catch((x) => x);
    assert.equal(e.message, "No Jira Cloud sign-in. There's no Keychain here: give this profile a token command that prints a Jira Cloud API token (id.atlassian.com → Security → API tokens).");
    assert.equal(f.calls("curl").length, 0, "nothing was asked");
  });
});

// The profile dialog's Board page for a profile of the person's own (not the demo, which asks no
// sign-in), on Linux.
function linuxDialog(jiraSection = {}) {
  setupDemoWorld({ profile: { demo: false, jira: { url: `${SITE}/jira/software/projects/ACME/boards/7`, site: SITE, board: 7, ...jiraSection } }, props: { role: "setup", profile: DEMO, focus: "jira", overlay: "overlay-1" } });
  mock.state.window.platform = "linux";
  const d = new Setup();
  const cx = fakeCx();
  d.init(cx);
  // The stub's inputs start empty: fill each with what the dialog opened it with.
  for (const st of [...Object.values(d), ...Object.values(d.asks)]) {
    const start = st?.__state?.args?.[0]?.value;
    if (typeof start === "string" && !st.value()) st.set_value(start);
  }
  return { d, cx };
}

describe("the profile dialog's sign-in on Linux", () => {
  test("only the token command: no Keychain item, no Keychain line to copy", () => {
    const { d, cx } = linuxDialog();
    const el = d.render(cx);
    const words = texts(el).join("\n");
    assert.ok(words.includes("Token command"), words);
    assert.ok(!/Keychain|zsh terminal|for storing the token/.test(words), words);
    assert.equal(byId(el, "setup-copy"), null);
  });
  test("without a command, Save says to give one; with it and the email, it's what's saved", () => {
    const { d } = linuxDialog();
    assert.deepEqual(d.draft().error, ["jira", "Give a token command that prints your Jira Cloud API token."]);
    d.tokenCommand.set_value("secret-tool lookup service jira");
    assert.deepEqual(d.draft().error, ["jira", "Give the Jira email the token command's token belongs to."]);
    d.email.set_value(EMAIL);
    const { error, profile } = d.draft();
    assert.equal(error, null);
    assert.equal(profile.jira.tokenCommand, "secret-tool lookup service jira");
    assert.equal(profile.jira.email, EMAIL);
  });
  test("Check connection signs in through the command and names a Kanban board's kind in words", async () => {
    const { d, cx } = linuxDialog({ tokenCommand: COMMAND, email: EMAIL });
    const f = fakeCurl({ name: "Team flow", type: "kanban" });
    realJira(f);
    d.checkJira(cx);
    await cx.settle();
    assert.equal(d.checks.jira.ok, true, d.checks.jira.text);
    assert.equal(d.checks.jira.text, "Signed in. Board “Team flow” (Kanban).");
    assert.ok(f.calls("curl").every((c) => c.stdin === `user = "${EMAIL}:${TOKEN}"\n`));
  });
});
