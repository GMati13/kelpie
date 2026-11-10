// The board layer (board.js, config.js boardOf()): which board a profile has, a ticket's link and
// the board's questions answered for the demo, and that every board question goes through it, so a
// second kind of board only has to answer there.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { mock } from "herdr";
import { boardOf, hasBoard } from "../../mods/kelpie/config.js";
import { boardSite, description, loadBoard, lookUp, statusOptions, ticketText, ticketUrl } from "../../mods/kelpie/board.js";
import { DEMO_PROFILE } from "../lib/stories.mjs";

beforeEach(() => mock.reset());
const JIRA = { site: "https://acme.atlassian.net", board: 3, keychain: "k", prompt: "Do {key}", orchestrator: "Run {key}", handover: "QA" };

describe("boardOf: a profile's board", () => {
  test("a profile with Jira has a Jira board, carrying its prompts and handover column", () => {
    assert.deepEqual(boardOf({ jira: JIRA }), { kind: "jira", cfg: JIRA, name: "Jira", prompt: "Do {key}", orchestrator: "Run {key}", handover: "QA" });
    assert.equal(hasBoard({ jira: JIRA }), true);
  });
  test("a setup reads the same as its profile, as both carry the sections", () => {
    assert.deepEqual(boardOf({ saved: true, folder: "/w", jira: JIRA, github: null }), boardOf({ id: "w", jira: JIRA }));
  });
  test("no board without one, nor for nothing", () => {
    for (const p of [{ id: "w", github: { owner: "o" } }, { jira: null }, null, undefined]) {
      assert.equal(boardOf(p), null);
      assert.equal(hasBoard(p), false);
    }
  });
});

describe("a ticket's link", () => {
  const board = boardOf({ jira: JIRA });
  test("on the site the list loaded, else the profile's", () => {
    assert.equal(ticketUrl(board, { site: "https://loaded.atlassian.net" }, "ABC-1"), "https://loaded.atlassian.net/browse/ABC-1");
    assert.equal(ticketUrl(board, null, "ABC-1"), "https://acme.atlassian.net/browse/ABC-1");
    assert.equal(boardSite(board, {}), "https://acme.atlassian.net");
  });
  test("none without an address to make it from", () => {
    assert.equal(ticketUrl(null, null, "ABC-1"), null);
    assert.equal(boardSite(null, null), "");
  });
});

describe("the board's questions, answered for the demo", () => {
  const board = boardOf(DEMO_PROFILE);
  test("a load gives the stories, their subtasks, the columns and the sprint", async () => {
    const d = await loadBoard(board);
    assert.ok(d.columns.length > 1 && d.columns.every((c) => c.name && Array.isArray(c.statuses)));
    assert.ok(d.sprints.length >= 1);
    assert.ok(d.mine.length > 0 && d.parents.length > 0 && d.children.length > 0);
    const stories = new Set(d.parents.map((p) => p.key));
    assert.ok(d.children.every((c) => stories.has(c.fields.parent.key)), "every child is a story's");
  });
  test("a ticket's description, text, status choices; an unknown ticket is null", async () => {
    const d = await loadBoard(board);
    const sub = d.children[0];
    assert.ok(Array.isArray(await description(board, sub.key)));
    const t = await ticketText(board, sub.key);
    assert.equal(t.parent, sub.fields.parent.key);
    assert.ok(t.summary);
    const options = await statusOptions(board, sub.key);
    assert.ok(options.length > 0 && options.every((o) => o.id && o.to));
    assert.equal((await lookUp(board, sub.key)).story.key, sub.fields.parent.key);
    assert.equal(await lookUp(board, "ACME-99999"), null);
    assert.equal(await lookUp(null, sub.key), null);
  });
});

describe("one way to the board", () => {
  // Only the board layer (with config.js boardOf() and the profile checks) and the Jira-only parts (the old Sprint view, the profile dialog's Check,
  // the demo answering) talk to Jira; the story views ask board.js, so a second kind of board fits.
  const ALLOWED = new Set(["board.js", "config.js", "sprint.js", "setup.js", "demo.js"]);
  const dir = new URL("../../mods/kelpie/", import.meta.url);
  test("no view calls jira() or reads a profile's jira section to decide anything", () => {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".js") && !ALLOWED.has(f))) {
      const src = readFileSync(new URL(f, dir), "utf8");
      assert.doesNotMatch(src, /\bjira\(/, `${f} calls jira() itself`);
      assert.doesNotMatch(src, /\b(profile|setup|p|space)\??\.jira\b(?!\s*[:=])/, `${f} reads .jira itself`);
    }
  });
});
