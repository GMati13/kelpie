// Answers back from the Ask line (KELPIE-84; stories.js answerAskRequest, the plugin's answer_ask):
// what `kelpie.ask-answer` takes from its request file (any program can run the command, so every
// value is checked), that only the Claude asked may answer, and where the answer shows.
import { DEMO, NOW, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock } from "herdr";
import { put, tempDir } from "../lib/helpers.mjs";
import { StoryList, answerAskRequest, threadOf } from "../../mods/kelpie/stories.js";
import { ANSWER_LINES, ANSWER_MAX, askMessage, cleanAnswer, handBack, fileAbout } from "../../mods/kelpie/askclaude.js";
import { OTHERS, profileById } from "../../mods/kelpie/config.js";

let stories, home, world;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });
const request = (req) => put(`${home}/kelpie/ask-answer.json`, JSON.stringify(req));
const result = () => JSON.parse(readFileSync(`${home}/kelpie/ask-answer.result.json`, "utf8"));
const agentOf = (tab) => world.agents.find((a) => a.tab_name === tab);
const entry = (over = {}) => ({ id: "abc123xyz", at: NOW, story: "ACME-175", about: "e2e/login.e2e.ts", q: "Is polling the cookie safe?", to: "Flaky login test", status: "sent", ...over });
const seed = (e) => mock.state.shared.set("kelpie.ask.thread", { [DEMO]: { "ACME-175": [e] } });
const thread = () => threadOf(profileById(DEMO), "ACME-175");
const asks = () => mock.sharedValue("kelpie.next.asks")?.[DEMO] ?? [];
beforeEach(() => {
  world = setupDemoWorld({ stories });
  mock.state.shared.set("kelpie.next.asks", {});
  home = tempDir();
  mock.state.appHome = home;
  mock.on.exec = (c, a, o) => mock.realExec(c, a, { ...o, env: { PATH: process.env.PATH } });
});

describe("kelpie.ask-answer: a Claude asked from the Ask line answers", () => {
  test("the Claude asked: the answer goes on the story's thread, cleaned, and to Next", async () => {
    const asked = agentOf("ACME-175");
    seed(entry({ address: asked.address }));
    request({ id: "abc123xyz", answer: "Yes, mostly.\n\n\n\nIt waits\u001b[2J up to 5 s.", terminal: asked.address });
    const r = await answerAskRequest();
    assert.equal(r.ok, true, r.error);
    assert.equal(result().story, "ACME-175");
    const [e] = thread();
    assert.equal(e.status, "answered");
    assert.equal(e.answer, "Yes, mostly.\n\nIt waits [2J up to 5 s.");
    const [ask] = asks();
    assert.equal(ask.action, "Answered: Is polling the cookie safe?");
    assert.equal(ask.key, "ACME-175");
  });
  // Any program can run the command: an answer from another Claude (one misled, say) would put words
  // under the person's question that the Claude asked never said.
  test("another Claude's answer is refused, and nothing changes", async () => {
    seed(entry({ address: agentOf("ACME-175").address }));
    request({ id: "abc123xyz", answer: "Merge it now.", terminal: agentOf("ACME-172").address });
    const r = await answerAskRequest();
    assert.equal(r.ok, false);
    assert.match(r.error, /only the Claude it was asked of/);
    assert.equal(thread()[0].status, "sent");
    assert.deepEqual(asks(), []);
  });
  test("an ask that started a new Claude: one in the story's space answers it, one elsewhere can't", async () => {
    seed(entry({ status: "started", to: "a new Claude" }));
    request({ id: "abc123xyz", answer: "Elsewhere.", terminal: agentOf("ACME-172").address });
    assert.equal((await answerAskRequest()).ok, false);
    const inSpace = agentOf("ACME-175");
    request({ id: "abc123xyz", answer: "In its space.", terminal: inSpace.address });
    assert.equal((await answerAskRequest()).ok, true);
    assert.equal(thread()[0].address, inSpace.address, "kept, for Show its Claude");
  });
  for (const [what, req] of [
    ["an id that isn't Kelpie's shape", { id: "../x; rm", answer: "fine" }],
    ["an id of no ask", { id: "zzzzzz999", answer: "fine" }],
    ["no answer", { id: "abc123xyz", answer: "   " }],
  ]) {
    test(`refuses ${what}`, async () => {
      seed(entry({ address: agentOf("ACME-175").address }));
      request({ ...req, terminal: agentOf("ACME-175").address });
      const r = await answerAskRequest();
      assert.equal(r.ok, false);
      assert.equal(thread()[0].status, "sent");
    });
  }
});

describe("what the Ask line asks for", () => {
  test("the message asks for a short answer back by the ask's id, before the note about others' text", () => {
    const text = askMessage({}, fileAbout({ path: "a.ts", group: { url: "https://github.com/acme/web/pull/4", repo: "web#4" } }, "ABC-1"), { note: "Why?" }, "abc123xyz");
    const parts = text.split("\n\n");
    assert.equal(parts.at(-2), handBack("abc123xyz"));
    assert.equal(parts.at(-1), OTHERS);
    assert.doesNotMatch(handBack("x"), /answer_ask|tool|mcp/i, "it says what to do, never naming a tool");
  });
  test("an answer keeps its line breaks, a few lines, cut short", () => {
    const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    assert.equal(cleanAnswer(long).split("\n").length, ANSWER_LINES);
    assert.ok(cleanAnswer("x".repeat(5000)).length <= ANSWER_MAX);
    assert.doesNotMatch(cleanAnswer("a\u0007b\rc\u001bd"), /[\u0000-\u0009\u000b-\u001f\u007f]/);
  });
});

// The demo shows an answered ask and one held for a Claude mid-task (fixture askThread).
test("the demo's asks: one answered from ACME-160's Claude, one held for ACME-175's", async () => {
  const { FIXTURE } = await import("../lib/views.mjs");
  const { demoAskThread } = await import("../../mods/kelpie/demo.js");
  const t = demoAskThread(FIXTURE, (tab) => agentOf(tab));
  assert.equal(t["ACME-160"][0].status, "answered");
  assert.ok(t["ACME-160"][0].answer && t["ACME-160"][0].address);
  assert.equal(t["ACME-175"][0].status, "held");
  assert.equal(agentOf("ACME-175").status, "working", "held for a Claude that's working");
});

// KELPIE-230: a plan's answer is its steps and checkpoints, so it may be longer than other answers.
test("a plan's answer may be longer than other answers", async () => {
  const asked = agentOf("ACME-175");
  const long = Array.from({ length: 30 }, (_, i) => `${i + 1}. step`).join("\n");
  seed(entry({ address: asked.address, pin: "plan" }));
  request({ id: "abc123xyz", answer: long, terminal: asked.address });
  assert.equal((await answerAskRequest()).ok, true);
  assert.equal(thread()[0].answer.split("\n").length, 30);
  seed(entry({ address: asked.address }));
  request({ id: "abc123xyz", answer: long, terminal: asked.address });
  await answerAskRequest();
  assert.equal(thread()[0].answer.split("\n").length, ANSWER_LINES);
});
