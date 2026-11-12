// A Jira board without sprints (Kanban, or a team-managed board with sprints off): Jira refuses the
// sprint question, so the board's own filter is its current work (sprint.js activeSprints(),
// boardScope(); board.js loadBoard()). Answered by a fake jira.sh, as no test reaches Jira.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { activeSprints, boardScope } from "../../mods/kelpie/sprint.js";
import { loadBoard } from "../../mods/kelpie/board.js";
import { boardOf } from "../../mods/kelpie/config.js";
import { noneToDo } from "../../mods/kelpie/stories.js";

beforeEach(() => mock.reset());

const SITE = "https://acme.atlassian.net";
const cfg = { site: SITE, board: 7, keychain: "kelpie-test" };
const me = { accountId: "me-1", displayName: "Me" };
const ISSUES = [
  { key: "ACME-1", fields: { summary: "A story", issuetype: { name: "Story", subtask: false }, status: { id: "1" }, assignee: me } },
  { key: "ACME-2", fields: { summary: "Its subtask", issuetype: { name: "Sub-task", subtask: true }, status: { id: "3" }, parent: { key: "ACME-1" }, assignee: me } },
];
const answer = (code, body) => ({ code: 0, stdout: JSON.stringify({ site: SITE, code, authed: true, body }), stderr: "" });
const REFUSED = answer(400, { errorMessages: ["The board does not support sprints"] });

// `type`: what Jira says the board is; `sprints`: whether it answers the sprint question.
function fakeJira({ type = "kanban", sprints = false, filter = { id: "10040" }, subQuery = { query: "fixVersion in unreleasedVersions() OR fixVersion is EMPTY" } } = {}) {
  const asked = [];
  mock.on.exec = (cmd, args) => {
    if (cmd !== "sh" || !String(args[0]).endsWith("jira.sh")) return undefined;
    const [what, a] = args.slice(3);
    asked.push(`${what} ${a}`);
    if (what === "get" && a.endsWith("/configuration")) return answer(200, { filter, subQuery, columnConfig: { columns: [{ name: "Backlog", statuses: [{ id: "1" }] }, { name: "In progress", statuses: [{ id: "3" }] }, { name: "Done", statuses: [{ id: "5" }] }] } });
    if (what === "get" && a.includes("/sprint")) return sprints ? answer(200, { values: [{ id: 3, name: "Sprint  3" }] }) : REFUSED;
    if (what === "get" && a === "/rest/agile/1.0/board/7") return answer(200, { id: 7, name: "Team  flow", type });
    if (what === "search") return answer(200, { issues: /^key in/.test(a) ? ISSUES : ISSUES.slice(1), isLast: true });
    return answer(404, { errorMessages: ["Not found"] });
  };
  return asked;
}

describe("activeSprints: a board that refuses the sprint question", () => {
  test("a Kanban board comes back as the board itself, marked kanban", async () => {
    fakeJira();
    const r = await activeSprints(cfg);
    assert.equal(r.kanban, true);
    assert.equal(r.body.name, "Team  flow");
  });
  test("a team-managed board with sprints off (Jira's `simple`) counts as Kanban too", async () => {
    fakeJira({ type: "simple" });
    assert.equal((await activeSprints(cfg)).kanban, true);
  });
  test("a scrum board whose sprint question fails keeps Jira's own error", async () => {
    fakeJira({ type: "scrum" });
    await assert.rejects(activeSprints(cfg), /does not support sprints/);
  });
  test("a board that can't be read at all keeps the sprint question's error", async () => {
    mock.on.exec = (cmd, args) => (String(args[0]).endsWith("jira.sh") ? REFUSED : undefined);
    await assert.rejects(activeSprints(cfg), /does not support sprints/);
  });
  test("a board that answers it is a scrum board, whatever its type", async () => {
    fakeJira({ type: "simple", sprints: true });
    const r = await activeSprints(cfg);
    assert.equal(r.kanban, undefined);
    assert.deepEqual(r.body.values.map((s) => s.id), [3]);
  });
});

describe("boardScope: a Kanban board's current work", () => {
  const config = (body) => ({ body });
  test("its filter and sub-filter, less what was done more than 14 days ago; the board is the one sprint", () => {
    const s = boardScope({ kanban: true, body: { name: "Team \n flow" } }, config({ filter: { id: "10040" }, subQuery: { query: " fixVersion is EMPTY " } }));
    assert.deepEqual(s.sprints, [{ id: null, name: "Team flow", kanban: true }]);
    assert.equal(s.jql, "filter = 10040 AND (fixVersion is EMPTY) AND (statusCategory != Done OR statusCategoryChangedDate >= -14d)");
  });
  test("no sub-filter: the filter alone", () => {
    const s = boardScope({ kanban: true, body: { name: "Flow" } }, config({ filter: { id: "9" } }));
    assert.equal(s.jql, "filter = 9 AND (statusCategory != Done OR statusCategoryChangedDate >= -14d)");
  });
  test("no filter to read says so in plain words", () => {
    assert.throws(() => boardScope({ kanban: true, body: {} }, config({})), /Kanban board's filter can't be read/);
  });
  test("a scrum board with no sprint running asks for nothing", () => {
    assert.deepEqual(boardScope({ body: { values: [] } }, config({ filter: { id: "9" } })), { sprints: [], jql: null });
  });
});

describe("loadBoard on a Kanban board", () => {
  test("searches the board's filter for your work and gives the stories under the board's name", async () => {
    const asked = fakeJira();
    const d = await loadBoard(boardOf({ jira: cfg }));
    const first = asked.find((a) => a.startsWith("search "));
    assert.equal(first, "search filter = 10040 AND (fixVersion in unreleasedVersions() OR fixVersion is EMPTY) AND (statusCategory != Done OR statusCategoryChangedDate >= -14d) AND assignee = currentUser() ORDER BY Rank");
    assert.deepEqual(d.sprints, [{ id: null, name: "Team flow", kanban: true }]);
    assert.equal(d.site, SITE);
    assert.deepEqual(d.parents.map((p) => p.key), ["ACME-1"]);
    assert.deepEqual(d.children.map((c) => c.key), ["ACME-2"]);
    assert.deepEqual(d.columns.map((c) => c.name), ["Backlog", "In progress", "Done"]);
  });
  test("an empty list names the board, not a sprint", () => {
    assert.equal(noneToDo({ sprints: [{ id: null, name: "Team flow", kanban: true }] }, []), "Nothing on Team flow is yours yet: tickets assigned to you show here.");
  });
});
