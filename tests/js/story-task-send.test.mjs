// The Merge and Request approval menus' "Or send it to …" rows (stories.js sendStoryTask()): picking an
// open Claude shows it at once and says it's sending, then says it was sent, or why not, as a toast
// too, since the menu may be on a story's row in the list whose details aren't shown (KELPIE-120).
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { sendStoryTask } from "../../mods/kelpie/stories.js";

const profile = { id: "w", name: "W", folder: "/work/acme", github: { owner: "acme" } };
const story = { key: "ABC-1", title: "Checkout", subs: [] };
const prs = [{ name: "web#4", title: "Pay", url: "https://github.com/acme/web/pull/4", state: "ready to merge" }];
const agent = { address: "t7", space: "s1", pane: "p1", tab_name: "ABC-1 fix the form", status: "working" };

let sendAnswer;
beforeEach(() => {
  mock.reset();
  sendAnswer = { code: 0, stdout: "{}", stderr: "" };
  mock.on.hc = (args) => (args[0] === "get" ? { code: 0, stdout: JSON.stringify({ foreground: { name: "claude", argv: ["claude"] } }), stderr: "" } : sendAnswer);
});
const note = () => mock.sharedValue("kelpie.stories.note")?.text;
const sends = () => mock.of("hc").filter(([a]) => a[0] === "send");
const shown = () => mock.of("run").filter(([n]) => n === "space.select" || n === "pane.focus").map(([n, a]) => [n, a.id ?? a.pane]);

describe("sending a story's Merge to an open Claude", () => {
  test("shows the Claude and says it's sending before the send ends", async () => {
    let finish;
    mock.on.hc = (args) => (args[0] === "get" ? { code: 0, stdout: JSON.stringify({ foreground: { name: "claude" } }), stderr: "" } : new Promise((r) => { finish = r; }));
    const done = sendStoryTask("merge", profile, story, prs, agent);
    assert.deepEqual(shown(), [["space.select", "s1"], ["pane.focus", "p1"]]);
    assert.equal(note(), "Sending ABC-1's merge to ABC-1 fix the form…");
    await new Promise((r) => setImmediate(r));
    finish({ code: 0, stdout: "{}", stderr: "" });
    await done;
    assert.equal(note(), "Sent ABC-1's merge to ABC-1 fix the form.");
    assert.equal(mock.of("notify").length, 0);
  });
  test("the task goes to that Claude", async () => {
    await sendStoryTask("merge", profile, story, prs, agent);
    const [[args]] = sends();
    assert.equal(args.at(-2), "t7");
    assert.match(args.at(-1), /web#4/);
  });
  test("a send hc refused says so, never Sent, and as a toast", async () => {
    sendAnswer = { code: 5, stdout: JSON.stringify({ error: { kind: "unavailable", message: "t7 is still starting" } }), stderr: "" };
    await sendStoryTask("approval", profile, story, prs, agent);
    assert.equal(note(), "Couldn't send it to ABC-1 fix the form. It's still starting or busy printing: try again in a moment.");
    const [[n]] = mock.of("notify");
    assert.equal(n.title, "Couldn't send it to ABC-1 fix the form");
    assert.equal(n.level, "warning");
  });
  test("a terminal not running Claude is a toast too", async () => {
    mock.on.hc = (args) => (args[0] === "get" ? { code: 0, stdout: JSON.stringify({ foreground: { name: "zsh" } }), stderr: "" } : sendAnswer);
    await sendStoryTask("merge", profile, story, prs, agent);
    assert.equal(sends().length, 0);
    assert.match(mock.of("notify")[0][0].body, /isn't running Claude/);
  });
  test("a Claude waiting for your answer gets nothing, and the toast says why", async () => {
    await sendStoryTask("merge", profile, story, prs, { ...agent, status: "blocked" });
    assert.equal(sends().length, 0);
    assert.deepEqual(shown(), []);
    assert.match(mock.of("notify")[0][0].body, /waiting for your answer/);
  });
  test("the Desk's pull requests with no ticket say so in the note", async () => {
    await sendStoryTask("merge", profile, { key: "", title: "" }, prs, { ...agent, tab_name: "Claude Code" });
    assert.equal(note(), "Sent the merge to Claude Code.");
  });
});
