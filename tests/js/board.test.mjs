// The board layer (board.js, config.js boardOf()): which board a profile has, a ticket's link and
// the board's questions answered for the demo, and that every board question goes through it, so a
// second kind of board only has to answer there.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { mock } from "herdr";
import { PREFIX, boardOf, defaultPrefix, hasBoard, parsePrefixes, parseProject, prefixFor } from "../../mods/kelpie/config.js";
import { boardSite, description, loadBoard, lookUp, projectCategory, statusOptions, ticketText, ticketUrl } from "../../mods/kelpie/board.js";
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

describe("a GitHub Project as the board", () => {
  const PROJECT = { url: "https://github.com/users/me/projects/2", owner: "me", ownerType: "user", number: 2, prompt: "P", orchestrator: "O", handover: "Testing" };
  test("boardOf gives its section, prompts, handover and the profile's GitHub account", () => {
    assert.deepEqual(boardOf({ project: PROJECT, github: { owner: "me", account: "me-work" } }),
      { kind: "project", cfg: PROJECT, name: "GitHub", prompt: "P", orchestrator: "O", handover: "Testing", account: "me-work" });
    assert.equal(boardOf({ project: PROJECT }).account, null, "no account: gh's active one");
  });
});

describe("parseProject: a Project's address", () => {
  test("a user's or an organisation's, a view after it or not", () => {
    assert.deepEqual(parseProject("https://github.com/users/GMati13/projects/2"), { owner: "GMati13", ownerType: "user", number: 2 });
    assert.deepEqual(parseProject(" https://github.com/orgs/acme-co/projects/14/views/3 "), { owner: "acme-co", ownerType: "org", number: 14 });
  });
  test("github.com only, and a real login", () => {
    for (const url of ["http://github.com/users/me/projects/2", "https://github.com.evil.example/users/me/projects/2", "https://gitlab.com/users/me/projects/2",
      "https://github.com/me/projects/2", "https://github.com/users/-me/projects/2", "https://github.com/users/kelpie--demo/projects/1", "https://github.com/users/me/projects/x", "", null]) {
      assert.equal(parseProject(url), null, String(url));
    }
  });
  test("the demo's owner may be a name GitHub can't have", () => {
    assert.equal(parseProject("https://github.com/users/kelpie--demo/projects/1", { demo: true }).owner, "kelpie--demo");
  });
});

describe("ticket key prefixes", () => {
  test("a repo's own: its name in capitals, other characters dropped", () => {
    assert.equal(defaultPrefix("GMati13/kelpie"), "KELPIE");
    assert.equal(defaultPrefix("acme/my-app.v2"), "MYAPPV2");
    assert.equal(defaultPrefix("acme/123"), null, "digits alone aren't a prefix");
    assert.equal(defaultPrefix("acme/a"), null, "one letter isn't found in titles");
  });
  test("every prefix fits what the key finders take, so a key is found in titles", () => {
    for (const p of ["KELPIE", "AB", "A1"]) assert.match(`${p}-42`, /^[A-Z][A-Z0-9]+-\d+$/);
    for (const p of ["A", "A_B", "1A", "ab", "A-B"]) assert.equal(PREFIX.test(p), false, p);
  });
  test("the profile's own, by repo", () => {
    assert.deepEqual(parsePrefixes("acme/web=WEB, Acme/API = api\nacme/docs=DOC"), { "acme/web": "WEB", "acme/api": "API", "acme/docs": "DOC" });
    assert.deepEqual(parsePrefixes(""), {});
    assert.equal(prefixFor({ prefixes: "acme/web=FRONT" }, "Acme/Web"), "FRONT");
    assert.equal(prefixFor({ prefixes: "acme/web=FRONT" }, "acme/api"), "API");
  });
  test("malformed ones are errors naming the entry, never quietly other keys", () => {
    assert.throws(() => parsePrefixes("acme/web"), /acme\/web/);
    assert.throws(() => parsePrefixes("web=WEB"), /web=WEB/);
    assert.throws(() => parsePrefixes("acme/web=W_B"), /W_B/);
    assert.throws(() => parsePrefixes("acme/web=$(id)"), /can't be a key prefix/);
    assert.throws(() => parsePrefixes("acme/web=WEB, acme/api=WEB"), /share/);
    assert.throws(() => prefixFor({ prefixes: "nonsense" }, "acme/web"));
  });
});

describe("projectCategory: a Status option as a status category", () => {
  test("first to do, last or closed done, the rest in progress, no Status to do", () => {
    assert.deepEqual([0, 1, 2, 3].map((i) => projectCategory(i, 4)), ["new", "indeterminate", "indeterminate", "done"]);
    assert.equal(projectCategory(0, 4, true), "done");
    assert.equal(projectCategory(-1, 4), "new");
    assert.equal(projectCategory(-1, 0, true), "done");
  });
});
