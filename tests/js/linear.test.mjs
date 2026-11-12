// A Linear team as the board (linear.js through board.js): its address, which issues count and how
// they're dressed as Jira's, every question a constant query with its values as variables sent
// through linear.sh with the sign-in as the profile names it, and moving a ticket only to one of the
// team's states.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { boardOf, buildProfile, parseLinear } from "../../mods/kelpie/config.js";
import { description, doneOption, loadBoard, lookUp, movable, moveStatus, statusOptions, ticketText, ticketUrl } from "../../mods/kelpie/board.js";
import { QUERIES } from "../../mods/kelpie/linear.js";
import { build, issue } from "../../mods/kelpie/stories.js";
import { data as dataOf } from "../lib/stories.mjs";

beforeEach(() => mock.reset());

const TEAM = "team-1", ME = "user-me", CYCLE = "cycle-7";
const STATES = [
  { id: "s-done", name: "Done", type: "completed", position: 0 },
  { id: "s-todo", name: "Todo", type: "unstarted", position: 0 },
  { id: "s-review", name: "In Review", type: "started", position: 2 },
  { id: "s-prog", name: "In Progress", type: "started", position: 1 },
  { id: "s-back", name: "Backlog", type: "backlog", position: 0 },
  { id: "s-cancel", name: "Canceled", type: "canceled", position: 0 },
  { id: "s-triage", name: "Triage", type: "triage", position: 0 },
];
const state = (id) => { const s = STATES.find((x) => x.id === id); return { id: s.id, name: s.name, type: s.type }; };
const you = { id: ME, name: "Alex Morgan", displayName: "alex", avatarUrl: "https://public.linear.app/a.png" };
const other = { id: "user-sam", name: "Sam Lee", displayName: "sam", avatarUrl: null };
// An issue as the queries ask for it.
function li(identifier, { title = identifier, st = "s-prog", assignee = you, parent = null, labels = [], children, sortOrder = 0 } = {}) {
  return {
    id: `id-${identifier}`, identifier, number: Number(identifier.split("-")[1]), title, url: `https://linear.app/acme/issue/${identifier}/slug`,
    sortOrder, completedAt: null, canceledAt: null, state: state(st), assignee, labels: { nodes: labels },
    parent: parent ? { id: `id-${parent}`, identifier: parent } : null,
    ...(children ? { children: { nodes: children } } : {}),
  };
}

// linear.sh answering by operation name; every run kept in `calls` as { argv, request }.
function fakeLinear({ team = {}, mine = [], stories = {}, byNumber = [], answer } = {}) {
  const calls = [];
  mock.on.exec = (cmd, args) => {
    if (cmd !== "sh" || !String(args[0]).endsWith("/linear.sh")) return undefined;
    const request = JSON.parse(args.at(-1));
    calls.push({ argv: args, request });
    if (answer) return answer(request);
    const op = /^(?:query|mutation) (\w+)/.exec(request.query)[1], v = request.variables;
    const data = op === "KelpieLinearTeam" ? { viewer: { id: ME }, teams: { nodes: [{ id: TEAM, key: "ENG", name: "Engineering", cyclesEnabled: true, activeCycle: { id: CYCLE, name: "", number: 7 }, states: { nodes: STATES }, ...team }] } }
      : op === "KelpieLinearIssues" ? { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: v.filter.number ? byNumber : mine } }
      : op === "KelpieLinearStories" ? { issues: { nodes: v.filter.id.in.map((id) => stories[id]).filter(Boolean) } }
      : op === "KelpieLinearIssue" ? { issue: stories[`id-${v.id}`] ? { identifier: v.id, title: stories[`id-${v.id}`].title, description: "## Goal\n\nShip **it**.", parent: null } : null }
      : op === "KelpieLinearMove" ? { issueUpdate: { success: true } } : null;
    return { code: 0, stdout: JSON.stringify({ code: 200, body: { data } }), stderr: "" };
  };
  return calls;
}
const CFG = { url: "https://linear.app/acme/team/ENG/active", workspace: "acme", team: "ENG", keychain: "linear-acme" };
const boardWith = (cfg = {}) => boardOf({ linear: { ...CFG, ...cfg } });

// A story with two sub-issues (one yours, one Sam's), and a task of yours with none.
const SUB1 = li("ENG-11", { parent: "ENG-10", st: "s-prog", labels: [{ name: "Bug", color: "#EB5757" }] });
const SUB2 = li("ENG-12", { parent: "ENG-10", st: "s-review", assignee: other });
const STORY = li("ENG-10", { title: "Checkout", st: "s-prog", assignee: other, children: [SUB1, SUB2] });
const TASK = li("ENG-20", { title: "Docs", st: "s-todo", children: [], sortOrder: -1 });
const STORIES = { [STORY.id]: STORY, [TASK.id]: TASK };
const MINE = [li("ENG-11", { parent: "ENG-10", sortOrder: 5 }), li("ENG-20", { sortOrder: -1 })];

describe("a Linear team's address (parseLinear)", () => {
  for (const [url, want] of [
    ["https://linear.app/acme/team/ENG/active", { workspace: "acme", team: "ENG" }],
    ["https://linear.app/acme-co/team/eng2/board?x=1", { workspace: "acme-co", team: "ENG2" }],
    ["  https://linear.app/acme/team/WEB  ", { workspace: "acme", team: "WEB" }],
  ]) test(`takes ${url.trim()}`, () => assert.deepEqual(parseLinear(url), want));
  for (const url of [
    "http://linear.app/acme/team/ENG", "https://linear.app.evil.com/acme/team/ENG", "https://evil.com/linear.app/acme/team/ENG",
    "https://linear.app/acme/issue/ENG-1", "https://linear.app/acme/team/E", "https://linear.app/acme/team/1ENG",
    "https://linear.app/Acme/team/ENG", "https://linear.app/acme/team/EN_G", "", null,
  ]) test(`refuses ${JSON.stringify(url)}`, () => assert.equal(parseLinear(url), null));
});

describe("a Linear team as a profile's board", () => {
  test("boardOf names it, with its prompts and handover", () => {
    const b = boardOf({ linear: { ...CFG, prompt: "P", orchestrator: "O", handover: "In Review" } });
    assert.deepEqual({ kind: b.kind, name: b.name, prompt: b.prompt, orchestrator: b.orchestrator, handover: b.handover }, { kind: "linear", name: "Linear", prompt: "P", orchestrator: "O", handover: "In Review" });
  });
  test("a saved Linear team and another board can't both be set", () => {
    mock.state.shared.set("kelpie.profiles", { w: { id: "w", name: "W", folder: "/w", linear: CFG } });
    assert.throws(() => buildProfile("w", { jira: { url: "https://acme.atlassian.net/jira/software/projects/A/boards/3", keychain: "k" } }), /one board/);
    assert.throws(() => buildProfile("w", { project: { url: "https://github.com/orgs/acme/projects/3" } }), /one board/);
    assert.equal(buildProfile("w", { name: "Work" }).linear.team, "ENG");
  });
  test("a saved Linear team with a bad address or no sign-in is refused", () => {
    mock.state.shared.set("kelpie.profiles", { w: { id: "w", name: "W", folder: "/w", linear: { ...CFG, url: "https://evil.com/acme/team/ENG" } } });
    assert.throws(() => buildProfile("w", { name: "Work" }), /linear\.url/);
    mock.state.shared.set("kelpie.profiles", { w: { id: "w", name: "W", folder: "/w", linear: { url: CFG.url } } });
    assert.throws(() => buildProfile("w", { name: "Work" }), /needs keychain, or tokenCommand/);
  });
  test("agents can't set it yet: it isn't a setting they may change", () => {
    mock.state.shared.set("kelpie.profiles", { w: { id: "w", name: "W", folder: "/w" } });
    assert.throws(() => buildProfile("w", { linear: CFG }), /not a profile setting/);
  });
});

describe("loading a Linear team (loadBoard)", () => {
  test("the columns are its states in Linear's board order, without triage and canceled", async () => {
    fakeLinear({ mine: MINE, stories: STORIES });
    const d = await loadBoard(boardWith());
    assert.deepEqual(d.columns.map((c) => c.name), ["Backlog", "Todo", "In Progress", "In Review", "Done"]);
    assert.deepEqual(d.columns.map((c) => c.statuses), [["s-back"], ["s-todo"], ["s-prog"], ["s-review"], ["s-done"]]);
    assert.deepEqual(d.columns.map((c) => c.category), ["new", "new", "indeterminate", "indeterminate", "done"]);
  });
  test("the active cycle is the sprint, and only your issues in it are asked for", async () => {
    const calls = fakeLinear({ mine: MINE, stories: STORIES });
    const d = await loadBoard(boardWith());
    assert.deepEqual(d.sprints, [{ id: CYCLE, name: "Cycle 7" }]);
    const ask = calls.find((c) => c.request.query === QUERIES.issues);
    assert.deepEqual(ask.request.variables.filter, { team: { id: { eq: TEAM } }, assignee: { isMe: { eq: true } }, cycle: { id: { eq: CYCLE } } });
    assert.equal(d.site, "https://linear.app/acme");
  });
  test("stories are your issues' parents, else the issues, in the board's order, with all their sub-issues", async () => {
    fakeLinear({ mine: MINE, stories: STORIES });
    const d = await loadBoard(boardWith());
    assert.deepEqual(d.parents.map((i) => i.key), ["ENG-20", "ENG-10"]);
    assert.deepEqual(d.children.map((i) => [i.key, i.fields.parent.key]), [["ENG-11", "ENG-10"], ["ENG-12", "ENG-10"]]);
    assert.deepEqual(d.mine.map((i) => i.key), ["ENG-20", "ENG-11"]);
    assert.deepEqual(d.kept, []);
  });
  test("each issue is dressed as Jira's: status by the state's type, assignee, labels without their #", async () => {
    fakeLinear({ mine: MINE, stories: STORIES });
    const d = await loadBoard(boardWith());
    const sub = d.children.find((i) => i.key === "ENG-11");
    assert.deepEqual(sub.fields.status, { id: "s-prog", name: "In Progress", statusCategory: { key: "indeterminate" } });
    assert.deepEqual(sub.fields.issuetype, { name: "Sub-issue", subtask: true, madeUp: true });
    assert.deepEqual(sub.fields.labels, [{ name: "Bug", color: "EB5757" }]);
    assert.equal(sub.fields.assignee.displayName, "Alex Morgan");
    assert.equal(sub.url, "https://linear.app/acme/issue/ENG-11/slug");
    assert.equal(d.parents.find((i) => i.key === "ENG-20").fields.status.statusCategory.key, "new");
  });
  test("what it loads builds the story list as Jira's does", async () => {
    fakeLinear({ mine: MINE, stories: STORIES });
    const d = await loadBoard(boardWith());
    const items = build({ ...dataOf({ parents: d.parents.map(issue), children: d.children.map(issue), mine: d.mine.map((i) => i.key), columns: d.columns }) }, new Map());
    const story = items.find((x) => x.key === "ENG-10");
    assert.deepEqual(story.subs.map((s) => [s.key, s.mine]), [["ENG-11", true], ["ENG-12", false]]);
    assert.ok(story.subs[0].tags.some((t) => /bug/i.test(t.name ?? t)), JSON.stringify(story.subs[0].tags));
  });
  test("an identifier that isn't a key is left out", async () => {
    const odd = li("ENG-30", {});
    odd.identifier = "eng-30; rm -rf";
    fakeLinear({ mine: [odd], stories: { [odd.id]: { ...odd, children: { nodes: [] } } } });
    const d = await loadBoard(boardWith());
    assert.deepEqual([...d.parents, ...d.children, ...d.mine], []);
  });
  test("a team that runs cycles with none active shows nothing, asking for no issues", async () => {
    const calls = fakeLinear({ team: { activeCycle: null }, mine: MINE, stories: STORIES });
    const d = await loadBoard(boardWith());
    assert.deepEqual(d.sprints, []);
    assert.deepEqual(d.parents, []);
    assert.ok(!calls.some((c) => c.request.query === QUERIES.issues));
  });
  test("a team without cycles is the board as a whole: open work and work completed lately", async () => {
    const calls = fakeLinear({ team: { cyclesEnabled: false, activeCycle: null }, mine: MINE, stories: STORIES });
    const d = await loadBoard(boardWith());
    assert.deepEqual(d.sprints, [{ id: null, name: "Engineering", kanban: true }]);
    const { filter } = calls.find((c) => c.request.query === QUERIES.issues).request.variables;
    assert.deepEqual(filter.and[0], { team: { id: { eq: TEAM } }, assignee: { isMe: { eq: true } } });
    assert.deepEqual(filter.and[1].or[0], { completedAt: { null: true }, canceledAt: { null: true } });
    assert.ok(Date.now() - Date.parse(filter.and[1].or[1].completedAt.gt) > 13 * 864e5);
  });
  test("kept stories: the team's keys by number, a sub-issue's story taken, yours counted; other teams' keys skipped", async () => {
    const GONE = li("ENG-41", { parent: "ENG-40", assignee: you });
    const KEPT = li("ENG-40", { title: "Reassigned", assignee: other, children: [GONE] });
    const calls = fakeLinear({ mine: MINE, stories: { ...STORIES, [KEPT.id]: KEPT }, byNumber: [GONE] });
    const d = await loadBoard(boardWith(), { keys: ["ENG-41", "WEB-3", "ENG-10", "nope"] });
    const asked = calls.find((c) => c.request.variables.filter?.number).request.variables.filter;
    assert.deepEqual(asked, { team: { id: { eq: TEAM } }, number: { in: [41] } });
    assert.deepEqual(d.kept, ["ENG-40"]);
    assert.ok(d.children.some((i) => i.key === "ENG-41"));
    assert.ok(d.mine.some((i) => i.key === "ENG-41"), "assigned to you");
  });
  test("a team key the profile can't have asks nothing", async () => {
    const calls = fakeLinear();
    await assert.rejects(loadBoard(boardWith({ team: "eng" })), /no valid key/);
    assert.deepEqual(calls, []);
  });
  test("a team Linear doesn't give says so", async () => {
    fakeLinear({ answer: () => ({ code: 0, stdout: JSON.stringify({ code: 200, body: { data: { viewer: { id: ME }, teams: { nodes: [] } } } }) }) });
    await assert.rejects(loadBoard(boardWith()), /no team ENG/);
  });
});

describe("what Linear is sent", () => {
  test("every question is one of the constant queries, its values as variables", async () => {
    const calls = fakeLinear({ mine: MINE, stories: STORIES });
    const board = boardWith();
    const d = await loadBoard(board, { keys: ["ENG-99"] });
    await description(board, "ENG-10", d);
    await moveStatus(board, "ENG-11", (await statusOptions(board, "ENG-11", d))[0], d);
    const known = Object.values(QUERIES);
    for (const c of calls) assert.ok(known.includes(c.request.query), c.request.query.slice(0, 40));
    for (const c of calls) assert.ok(!c.request.query.includes("ENG") && !c.request.query.includes(TEAM), "no value in a query's text");
  });
  test("the sign-in goes as the profile names it: its Keychain item, or its token command", async () => {
    let calls = fakeLinear({ mine: [], stories: {} });
    await loadBoard(boardWith());
    assert.deepEqual(calls[0].argv.slice(1, -1), ["linear-acme"]);
    calls = fakeLinear({ mine: [], stories: {} });
    await loadBoard(boardWith({ keychain: undefined, tokenCommand: "op read op://x/linear" }));
    assert.deepEqual(calls[0].argv.slice(1, -1), ["--token-command", "op read op://x/linear", ""]);
  });
  const said = (body, code = 200) => fakeLinear({ answer: () => ({ code: 0, stdout: JSON.stringify({ code, body }) }) });
  test("a key Linear refuses says to check the sign-in", async () => {
    said({ errors: [{ message: "Authentication required", extensions: { code: "AUTHENTICATION_ERROR" } }] }, 400);
    await assert.rejects(loadBoard(boardWith()), /Linear didn't accept the sign-in\. Check the Keychain item "linear-acme"/);
  });
  test("no key found says where one comes from", async () => {
    fakeLinear({ answer: () => ({ code: 0, stdout: JSON.stringify({ code: 0, body: null, error: "missing" }) }) });
    await assert.rejects(loadBoard(boardWith()), /No Linear sign-in.*Personal API keys/);
  });
  test("Linear's own message is passed on when it refuses a question", async () => {
    said({ errors: [{ message: "x", extensions: { userPresentableMessage: "Team not found" } }] }, 400);
    await assert.rejects(loadBoard(boardWith()), { message: "Team not found" });
  });
});

describe("a Linear ticket's link, text and status", () => {
  const board = boardWith();
  const loaded = async () => { fakeLinear({ mine: MINE, stories: STORIES }); return loadBoard(board); };
  test("its page is the one loaded, else made from the workspace and key", async () => {
    const d = await loaded();
    assert.equal(ticketUrl(board, d, "ENG-11"), "https://linear.app/acme/issue/ENG-11/slug");
    assert.equal(ticketUrl(board, d, "ENG-77"), "https://linear.app/acme/issue/ENG-77");
    assert.equal(ticketUrl(board, d, "eng-77/../x"), null);
  });
  test("its description is Linear's Markdown, as the reader's blocks; its text for the review prompt", async () => {
    const d = await loaded();
    const blocks = await description(board, "ENG-10", d);
    assert.ok(blocks.length >= 2 && blocks[0].kind === "h", JSON.stringify(blocks[0]));
    const text = await ticketText(board, "ENG-10", d);
    assert.deepEqual({ summary: text.summary, parent: text.parent }, { summary: "Checkout", parent: null });
    assert.match(text.text, /Ship it/);
    assert.deepEqual(await lookUp(board, "ENG-10", d), { key: "ENG-10", summary: "Checkout", story: null });
  });
  test("a key that isn't one is never asked about", async () => {
    const calls = fakeLinear();
    await assert.rejects(description(board, "ENG-1; x", {}), /isn't a ticket key/);
    assert.equal(await lookUp(board, "nope", {}), null);
    assert.deepEqual(calls, []);
  });
  test("it moves to any of the team's states but its own; Move to Done lands in the last column", async () => {
    const d = await loaded();
    assert.ok(movable(board, "ENG-11", d));
    const options = await statusOptions(board, "ENG-11", d);
    assert.deepEqual(options.map((o) => o.name), ["Backlog", "Todo", "In Review", "Done"]);
    assert.ok(options.every((o) => o.toId === o.id));
    assert.equal((await doneOption(board, "ENG-11", d)).id, "s-done");
  });
  test("a move sends the key and the state as variables, only for one of the loaded states", async () => {
    const d = await loaded();
    const calls = fakeLinear();
    await moveStatus(board, "ENG-11", { id: "s-done" }, d);
    assert.deepEqual(calls.map((c) => [c.request.query, c.request.variables]), [[QUERIES.move, { id: "ENG-11", state: "s-done" }]]);
    for (const [key, option] of [["ENG-11", { id: "s-elsewhere" }], ["ENG-11", { id: "s-done\"}" }], ["ENG-11; rm", { id: "s-done" }]]) {
      await assert.rejects(moveStatus(board, key, option, d), /isn't one of the team's states|isn't a ticket key/);
    }
    assert.equal(calls.length, 1, "nothing else was sent");
  });
  test("a move Linear doesn't take says so", async () => {
    const d = await loaded();
    fakeLinear({ answer: () => ({ code: 0, stdout: JSON.stringify({ code: 200, body: { data: { issueUpdate: { success: false } } } }) }) });
    await assert.rejects(moveStatus(board, "ENG-11", { id: "s-done" }, d), /didn't take the move/);
  });
});
