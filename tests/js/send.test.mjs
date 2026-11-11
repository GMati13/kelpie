// config.js sendToClaude: a message goes only to a terminal whose foreground process is Claude, as
// the system reports it (hc get --json), and every message a mod sends goes through it.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO, bodyOf, readRepo } from "../lib/helpers.mjs";
import { mock } from "herdr";
import { sendToClaude } from "../../mods/kelpie/config.js";

let foreground;
beforeEach(() => {
  mock.reset();
  foreground = null;
  mock.on.hc = (args) => (args[0] === "get" ? { code: 0, stdout: JSON.stringify(foreground === undefined ? {} : { foreground }), stderr: "" } : undefined);
});
const sends = () => mock.of("hc").filter(([a]) => a[0] === "send").map(([a]) => a);

describe("sendToClaude sends to Claude", () => {
  for (const [what, fg] of [
    ["claude by name", { name: "claude", argv: ["claude"] }],
    ["claude by path", { name: "2.1.3", argv: ["/Users/me/.local/bin/claude", "--resume", "x"] }],
    ["node running Claude Code's cli.js", { name: "node", argv: ["node", "/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js"] }],
    ["node running bin/claude", { name: "node", argv: ["/opt/homebrew/bin/node", "/opt/homebrew/bin/claude"] }],
    ["the demo's stand-in agent", { name: "sh", argv: ["sh", `${REPO}/mods/kelpie/demo/agent.sh`, "idle", ""] }],
  ]) {
    test(what, async () => {
      foreground = fg;
      await sendToClaude("t1", "hello");
      assert.deepEqual(mock.of("hc")[0][0], ["get", "t1", "--json"]);
      assert.deepEqual(sends(), [["send", "--json", "--", "t1", "hello"]]);
    });
  }
});

describe("sendToClaude refuses anything else", () => {
  for (const [what, fg] of [
    ["a login shell", { name: "zsh", argv: ["-zsh"] }],
    ["a shell", { name: "bash", argv: ["bash"] }],
    ["a shell whose argv mentions claude-code", { name: "bash", argv: ["bash", "-c", "echo claude-code"] }],
    ["a shell whose argv mentions claude", { name: "zsh", argv: ["zsh", "-c", "claude --help; zsh"] }],
    ["vim on a file named claude.md", { name: "vim", argv: ["vim", "claude.md"] }],
    ["a program named claude-ish", { name: "claudette", argv: ["claudette"] }],
    ["nothing in the foreground", null],
    ["no foreground at all", undefined],
  ]) {
    test(what, async () => {
      foreground = fg;
      await assert.rejects(sendToClaude("t1", "rm -rf ~\n"), /isn't running Claude/);
      assert.deepEqual(sends(), []);
    });
  }
  // The package's path counts only as the script node runs, never named anywhere in a command line.
  test("a shell whose argv names the @anthropic-ai/claude-code package", async () => {
    foreground = { name: "bash", argv: ["bash", "-c", "ls ~/.npm/@anthropic-ai/claude-code"] };
    await assert.rejects(sendToClaude("t1", "x"));
    assert.deepEqual(sends(), []);
  });
  test("hc get answering something that isn't JSON", async () => {
    mock.on.hc = (args) => (args[0] === "get" ? { code: 1, stdout: "not json", stderr: "" } : undefined);
    await assert.rejects(sendToClaude("t1", "x"));
    assert.deepEqual(sends(), []);
  });
});

// hc answers a refused send with an exit code, not a rejection: taken as sent, Kelpie once said
// "Sent" for a message that never went (KELPIE-120).
describe("sendToClaude says when hc didn't send", () => {
  const refuse = (answer) => {
    mock.on.hc = (args) => (args[0] === "get" ? { code: 0, stdout: JSON.stringify({ foreground: { name: "claude", argv: ["claude"] } }), stderr: "" } : answer);
  };
  test("an agent blocked on a question", async () => {
    refuse({ code: 5, stdout: JSON.stringify({ error: { kind: "blocked", message: "t1 is blocked" } }), stderr: "" });
    await assert.rejects(sendToClaude("t1", "hello"), /waiting for your answer/);
  });
  test("an agent still settling", async () => {
    refuse({ code: 5, stdout: JSON.stringify({ error: { kind: "unavailable", message: "t1 is still starting: its output has not settled" } }), stderr: "" });
    await assert.rejects(sendToClaude("t1", "hello"), /still starting or busy printing/);
  });
  test("an error hc has no plain words for keeps its own message", async () => {
    refuse({ code: 4, stdout: JSON.stringify({ error: { kind: "config", message: "bad draft_wait" } }), stderr: "" });
    await assert.rejects(sendToClaude("t1", "hello"), /bad draft_wait/);
  });
  test("a failure with no JSON at all", async () => {
    refuse({ code: 1, stdout: "", stderr: "" });
    await assert.rejects(sendToClaude("t1", "hello"), /code 1/);
  });
  // hc holds a send behind a draft for up to a minute, and Herdr stops a mod's hc after 30 s: the
  // message never went, and its error named Herdr's internals.
  test("a send Herdr stopped after 30 s says why in plain words", async () => {
    mock.on.hc = (args) => {
      if (args[0] === "get") return { code: 0, stdout: JSON.stringify({ foreground: { name: "claude" } }), stderr: "" };
      throw new Error("`herdr.hc`: hc took longer than 30 s and was stopped.");
    };
    await assert.rejects(sendToClaude("t1", "hello"), (e) => /typed in it and not sent yet/.test(e.message) && !/herdr\.hc/.test(e.message));
  });
  test("text starting with a dash goes after --, never read as an option", async () => {
    refuse(undefined);
    await sendToClaude("t1", "--force yes");
    assert.deepEqual(sends(), [["send", "--json", "--", "t1", "--force yes"]]);
  });
});

// Every hc() call in the mods is a literal list whose first word is known, and the only "send" is
// sendToClaude's own: a message typed into a shell would run as a command.
const jsFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? jsFiles(join(dir, e.name)) : e.name.endsWith(".js") ? [join(dir, e.name)] : []);

test("every hc send in the mods goes through sendToClaude", () => {
  const seen = [];
  for (const f of jsFiles(join(REPO, "mods"))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\bhc\(\s*([^)\s][^\n]{0,30})/g)) {
      const at = `${relative(REPO, f)}:${src.slice(0, m.index).split("\n").length}`;
      const verb = /^\[\s*"(\w+)"/.exec(m[1])?.[1];
      assert.ok(verb, `${at}: hc() takes a literal list starting with its command (${m[1]})`);
      assert.ok(["get", "kill", "run", "keys", "send"].includes(verb), `${at}: hc ${verb} is new: check it can't type into a shell`);
      if (verb === "send") seen.push(at);
    }
    for (const m of src.matchAll(/["'`]send["'`]/g)) {
      const line = src.slice(0, m.index).split("\n").length;
      const text = src.split("\n")[line - 1];
      if (/own\("send"\)/.test(text)) continue; // the send icon
      assert.match(text, /\bhc\(\["send"/, `${relative(REPO, f)}:${line}: a "send" outside hc(["send", ...]): ${text.trim()}`);
    }
  }
  assert.equal(seen.length, 1, `one hc send: ${seen}`);
  assert.match(bodyOf(readRepo("mods/kelpie/config.js"), "export async function sendToClaude(address, text) {"), /await hc\(\["send", "--json", "--", address, text\]\)/);
  assert.match(seen[0], /^mods\/kelpie\/config\.js:/);
});
