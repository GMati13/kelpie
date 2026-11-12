// KELPIE-40: a Jira board's load waits on as few round trips as it can. Each jira.sh run is a whole
// request to Jira (and a Keychain read), so what doesn't depend on another answer runs beside it: a
// fake jira.sh answers after a moment and notes each request's round, one more than the latest round
// that had answered when it was sent. A load's time is about its rounds times one request's.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { loadBoard } from "../../mods/kelpie/board.js";

beforeEach(() => mock.reset());

const SITE = "https://acme.atlassian.net";
const cfg = { site: SITE, board: 3, keychain: "k" };
const me = { accountId: "me-1", displayName: "Me" }, ana = { accountId: "ana-2", displayName: "Ana" };
const story = (key, assignee) => ({ key, fields: { summary: key, issuetype: { name: "Story", subtask: false }, status: { id: "1" }, assignee } });
const sub = (key, parent, assignee) => ({ key, fields: { summary: key, issuetype: { name: "Sub-task", subtask: true }, status: { id: "1" }, parent: { key: parent }, assignee } });
// Yours in the sprint: ACME-2 under ACME-1. Kept (a paused agent, say): ACME-5, now Ana's, and
// ACME-8, still yours but out of the sprint.
const ISSUES = [story("ACME-1", ana), sub("ACME-2", "ACME-1", me), sub("ACME-3", "ACME-1", ana), story("ACME-5", ana), sub("ACME-6", "ACME-5", ana), story("ACME-8", me)];

// `account`: the signed-in account's id as jira.sh prints it ("" when Jira named none).
function fakeJira({ account = "me-1" } = {}) {
  const asked = [];
  let answered = 0;
  mock.on.exec = (cmd, args) => {
    if (cmd !== "sh" || !String(args[0]).endsWith("jira.sh")) return undefined;
    const [what, a] = args.slice(3);
    const round = answered + 1;
    asked.push({ what, a, round });
    let body;
    if (what === "get") body = a.endsWith("/configuration") ? { columnConfig: { columns: [{ name: "To Do", statuses: [{ id: "1" }] }] } } : { values: [{ id: 3, name: "Sprint 3" }] };
    else if (/^sprint in/.test(a)) body = { issues: [ISSUES[1]], isLast: true };
    else {
      const named = [...a.matchAll(/ACME-\d+/g)].map((m) => m[0]);
      const found = ISSUES.filter((i) => named.includes(i.key) || (!/ AND assignee/.test(a) && named.includes(i.fields.parent?.key)));
      body = { issues: /currentUser/.test(a) ? found.filter((i) => i.fields.assignee === me) : found, isLast: true };
    }
    return new Promise((done) => setTimeout(() => {
      answered = Math.max(answered, round);
      done({ code: 0, stdout: JSON.stringify({ site: SITE, code: 200, authed: true, account, body }), stderr: "" });
    }, 5));
  };
  return asked;
}
const rounds = (asked) => Math.max(...asked.map((q) => q.round));

test("kept stories are asked beside the stories' own search, and yours are told by their assignee", async () => {
  const asked = fakeJira();
  const r = await loadBoard({ kind: "jira", cfg }, { keys: ["ACME-5", "ACME-8", "ACME-2"] });
  // The board's settings and sprints; your issues; then their stories beside the kept ones.
  assert.equal(rounds(asked), 3, asked.map((q) => `${q.round} ${q.a}`).join("\n"));
  assert.equal(asked.length, 5);
  assert.ok(!asked.some((q) => /currentUser/.test(q.a) && /^key in/.test(q.a)), "no search only to ask which kept ones are yours");
  // What it loads is as before.
  assert.deepEqual(r.parents.map((i) => i.key), ["ACME-1", "ACME-5", "ACME-8"]);
  assert.deepEqual(r.children.map((i) => i.key), ["ACME-2", "ACME-3", "ACME-6"]);
  assert.deepEqual(r.kept, ["ACME-5", "ACME-8"]);
  assert.deepEqual(r.mine.map((i) => i.key), ["ACME-2", "ACME-8"], "ACME-8 is yours by its assignee; ACME-5 is Ana's");
});

test("a kept key the stories' own search already holds isn't listed twice", async () => {
  fakeJira();
  // ACME-3 is Ana's subtask of your story: kept for its paused agent, and a child of ACME-1 anyway.
  const r = await loadBoard({ kind: "jira", cfg }, { keys: ["ACME-3"] });
  assert.deepEqual(r.children.map((i) => i.key), ["ACME-2", "ACME-3"]);
  assert.deepEqual(r.parents.map((i) => i.key), ["ACME-1"]);
  assert.deepEqual(r.kept, []);
});

test("without the account's id from Jira, which kept ones are yours is still asked", async () => {
  const asked = fakeJira({ account: "" });
  const r = await loadBoard({ kind: "jira", cfg }, { keys: ["ACME-5", "ACME-8"] });
  assert.ok(asked.some((q) => /^key in .* AND assignee = currentUser\(\)/.test(q.a)));
  assert.deepEqual(r.mine.map((i) => i.key), ["ACME-2", "ACME-8"]);
});

test("nothing kept: three rounds, no search for kept stories", async () => {
  const asked = fakeJira();
  await loadBoard({ kind: "jira", cfg }, { keys: [] });
  assert.equal(rounds(asked), 3);
  assert.equal(asked.length, 4);
});
