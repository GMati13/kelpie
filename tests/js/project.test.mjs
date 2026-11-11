// A GitHub Project as the board (project.js loadProject(), through board.js loadBoard()): which of its
// issues count and how they're dressed as Jira's, the keys they get, the pull requests their closing
// links attach, every gh call a constant query with its values as variables, and the demo loaded both
// ways building the same stories.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { boardOf } from "../../mods/kelpie/config.js";
import { loadBoard, ticketUrl } from "../../mods/kelpie/board.js";
import { QUERIES } from "../../mods/kelpie/project.js";
import { build, issue, need, ordered, pullsOf, sunk } from "../../mods/kelpie/stories.js";
import { DEMO_PROFILE, DEMO_PROJECT_PROFILE, data as dataOf, demoData, pr } from "../lib/stories.mjs";

beforeEach(() => mock.reset());

const PID = "PVT_board";
const OPTIONS = [{ id: "o1", name: "Todo" }, { id: "o2", name: "In Progress" }, { id: "o3", name: "QA" }, { id: "o4", name: "Done" }];
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const NOW_IT = { id: "it-now", title: "Sprint 5", startDate: day(-3), duration: 14 };
const OLD_IT = { id: "it-old", title: "Sprint 4", startDate: day(-30), duration: 14 };
const NEXT_IT = { id: "it-next", title: "Sprint 6", startDate: day(11), duration: 14 };

// An issue as the queries ask for it. `option`: its Status in this Project (undefined: not on it).
function ghIssue(repo, number, { title, state = "OPEN", closedAt = null, assignee = null, parent = null, option, closes = [], subs, labels = [] } = {}) {
  const items = [{ id: "PVTI_elsewhere", project: { id: "PVT_other" }, fieldValueByName: { optionId: "x1", name: "Elsewhere" } }];
  if (option !== undefined) items.unshift({ id: `PVTI_${number}`, project: { id: PID }, fieldValueByName: option ? { optionId: option, name: OPTIONS.find((o) => o.id === option).name } : null });
  return {
    id: `I_${repo.replace(/\W/g, "_")}_${number}`, number, title: title ?? `${repo}#${number}`, url: `https://github.com/${repo}/issues/${number}`, state, closedAt,
    repository: { nameWithOwner: repo }, assignees: { nodes: assignee ? [assignee] : [] }, labels: { nodes: labels },
    parent: parent ? { id: parent.id, number: parent.number, repository: parent.repository } : null,
    closedByPullRequestsReferences: { nodes: closes.map((url) => ({ url })) }, projectItems: { nodes: items },
    ...(subs ? { subIssues: { nodes: subs } } : {}),
  };
}
const item = (content, { type = "ISSUE", iteration = null, archived = false } = {}) => ({
  id: `PVTI_${content?.number ?? "draft"}`, type, isArchived: archived, content,
  fieldValues: { nodes: iteration ? [{}, { iterationId: iteration, field: { id: "F_iter" } }] : [{}] },
});
const projectOf = ({ items = [], iterations, next = null }) => ({
  id: PID, title: "Team board", url: "https://github.com/orgs/acme/projects/3",
  field: { id: "F_status", options: OPTIONS },
  fields: { nodes: [{}, ...(iterations ? [{ id: "F_iter", name: "Sprint", configuration: { iterations } }] : [])] },
  items: { pageInfo: { hasNextPage: Boolean(next), endCursor: next }, nodes: items },
});

// The variables of a gh graphql call, as gh reads its -f/-F fields.
function vars(args) {
  const out = {};
  for (let n = 0; n < args.length; n++) {
    if (args[n] !== "-f" && args[n] !== "-F") continue;
    const [, name, value] = /^([^=]+)=([\s\S]*)$/.exec(args[++n]);
    if (name.endsWith("[]")) (out[name.slice(0, -2)] ??= []).push(value); else out[name] = value;
  }
  return out;
}
const opOf = (args) => /^query\s+(\w+)/.exec(vars(args).query ?? "")?.[1];
// gh answering from `pages` (the Project, page by page: by cursor, null first) and `stories` (by node
// id); every call kept in `calls` as gh's own arguments.
function fakeGh({ pages = {}, stories = {}, answer } = {}) {
  const calls = [];
  mock.on.exec = (cmd, args) => {
    if (cmd !== "sh" || !String(args[0]).endsWith("/gh.sh")) return undefined;
    calls.push({ account: args[1], args: args.slice(2) });
    if (answer) return answer(args.slice(2));
    const gh = args.slice(2), v = vars(gh), op = opOf(gh);
    const data = op === "KelpieStories" ? { nodes: v.ids.map((id) => stories[id] ?? null) }
      : op === "KelpieProjectOrg" ? { organization: { projectV2: pages[v.cursor ?? null] ?? null } }
      : { user: { projectV2: pages[v.cursor ?? null] ?? null } };
    return { code: 0, stdout: JSON.stringify({ data }), stderr: "" };
  };
  return calls;
}
const CFG = { url: "https://github.com/users/alex/projects/3", owner: "alex", ownerType: "user", number: 3 };
const boardWith = (cfg = {}, account = "work-me") => boardOf({ project: { ...CFG, ...cfg }, github: { owner: "acme", account } });
const ME = { login: "alex", name: "Alex Morgan", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4&s=48" };

// A story on acme/web with three sub-issues: one of yours in the current iteration, one off the
// Project and closed, one done on it; and a story of yours from an older iteration.
function sprintBoard() {
  const story = ghIssue("acme/web", 10, { title: "Offline mode", assignee: { login: "priya", name: "Priya Nair", avatarUrl: null }, option: "o2",
    labels: [{ name: "bug", color: "d73a4a" }, { name: "mobile", color: "0e8a16" }] });
  const a = ghIssue("acme/web", 11, { title: "Cache trips", assignee: ME, parent: story, option: "o2", closes: ["https://github.com/acme/web/pull/5"] });
  const b = ghIssue("acme/web", 12, { title: "Banner", parent: story, state: "CLOSED", closedAt: new Date().toISOString() });
  const c = ghIssue("acme/web", 13, { title: "Icons", assignee: { login: "tomas", name: "", avatarUrl: null }, parent: story, option: "o4", state: "CLOSED", closedAt: new Date().toISOString() });
  const old = ghIssue("acme/api", 20, { title: "Old work", assignee: ME, option: "o2" });
  const pages = { null: projectOf({ iterations: [OLD_IT, NOW_IT, NEXT_IT], items: [item(a, { iteration: NOW_IT.id }), item(old, { iteration: OLD_IT.id })] }) };
  return { pages, stories: { [story.id]: { ...story, subIssues: { nodes: [a, b, c] } } } };
}

describe("loading a GitHub Project", () => {
  test("the current iteration's issues of yours, their stories and sub-issues, dressed as Jira's", async () => {
    const calls = fakeGh(sprintBoard());
    const d = await loadBoard(boardWith());
    assert.equal(d.site, "https://github.com");
    assert.deepEqual(d.sprints, [{ id: "it-now", name: "Sprint 5" }]);
    assert.deepEqual(d.columns, OPTIONS.map((o) => ({ name: o.name, statuses: [o.id] })));
    assert.deepEqual(d.project, { id: PID, statusField: "F_status", title: "Team board", url: "https://github.com/orgs/acme/projects/3" });
    assert.deepEqual(d.repos, { WEB: "acme/web" });
    assert.deepEqual(d.mine.map((i) => i.key), ["WEB-11"]);
    assert.deepEqual(d.parents.map((i) => i.key), ["WEB-10"]);
    assert.deepEqual(d.children.map((i) => i.key), ["WEB-11", "WEB-12", "WEB-13"]);
    const [story] = d.parents;
    assert.deepEqual(story, {
      key: "WEB-10", url: "https://github.com/acme/web/issues/10", item: "PVTI_10",
      fields: { summary: "Offline mode", issuetype: { name: "Issue", subtask: false }, status: { id: "o2", name: "In Progress", statusCategory: { key: "indeterminate" } }, parent: null,
        labels: [{ name: "bug", color: "d73a4a" }, { name: "mobile", color: "0e8a16" }],
        assignee: { displayName: "Priya Nair", avatarUrls: { "48x48": null } } },
    });
    const [a, b, c] = d.children;
    assert.deepEqual(a.fields.issuetype, { name: "Sub-issue", subtask: true });
    assert.deepEqual(a.fields.parent, { key: "WEB-10" });
    assert.equal(a.item, "PVTI_11");
    assert.deepEqual(a.fields.assignee, { displayName: "Alex Morgan", avatarUrls: { "48x48": ME.avatarUrl } });
    // Off the Project: open or closed, no Status of its own, no item.
    assert.deepEqual(b.fields.status, { id: null, name: "Closed", statusCategory: { key: "done" } });
    assert.equal(b.item, null);
    assert.equal(b.fields.assignee, undefined);
    assert.deepEqual(c.fields.status, { id: "o4", name: "Done", statusCategory: { key: "done" } });
    assert.equal(c.fields.assignee.displayName, "tomas", "a person with no name shows by their login");
    assert.deepEqual(d.links, { "https://github.com/acme/web/pull/5": "WEB-11" });
    assert.deepEqual(calls.map((x) => opOf(x.args)), ["KelpieProjectUser", "KelpieStories"]);
    assert.ok(calls.every((x) => x.account === "work-me"), "as the profile's GitHub account");
  });
  test("what the list keeps of it: the issue's page and its Project item", async () => {
    fakeGh(sprintBoard());
    const d = await loadBoard(boardWith());
    const kept = issue(d.children[0]);
    assert.equal(kept.url, "https://github.com/acme/web/issues/11");
    assert.equal(kept.item, "PVTI_11");
    assert.deepEqual(kept.fields.assignee, { displayName: "Alex Morgan", avatar: ME.avatarUrl });
    assert.equal(issue(d.children[1]).item, null);
    assert.equal("url" in issue({ key: "ABC-1", fields: {} }), false, "a Jira issue keeps no more than before");
  });
  test("no iteration field: the board as a whole, open work and work closed in the last two weeks", async () => {
    const open = ghIssue("acme/web", 1, { assignee: ME, option: "o1" });
    const lately = ghIssue("acme/web", 2, { assignee: ME, option: "o4", state: "CLOSED", closedAt: new Date(Date.now() - 3 * 864e5).toISOString() });
    const long = ghIssue("acme/web", 3, { assignee: ME, option: "o4", state: "CLOSED", closedAt: new Date(Date.now() - 30 * 864e5).toISOString() });
    fakeGh({ pages: { null: projectOf({ items: [item(open), item(lately), item(long)] }) }, stories: Object.fromEntries([open, lately, long].map((i) => [i.id, { ...i, subIssues: { nodes: [] } }])) });
    const d = await loadBoard(boardWith());
    assert.deepEqual(d.sprints, [{ id: null, name: "Team board", kanban: true }]);
    assert.deepEqual(d.mine.map((i) => i.key), ["WEB-1", "WEB-2"]);
    assert.deepEqual(d.parents.map((i) => i.key), ["WEB-1", "WEB-2"]);
    assert.equal(d.parents[1].fields.status.statusCategory.key, "done");
  });
  test("an iteration field with none running: no sprint, no stories, nothing more asked", async () => {
    const a = ghIssue("acme/web", 1, { assignee: ME, option: "o1" });
    const calls = fakeGh({ pages: { null: projectOf({ iterations: [OLD_IT, NEXT_IT], items: [item(a, { iteration: OLD_IT.id })] }) } });
    const d = await loadBoard(boardWith());
    assert.deepEqual(d.sprints, []);
    assert.deepEqual([d.mine, d.parents, d.children], [[], [], []]);
    assert.deepEqual(calls.map((x) => opOf(x.args)), ["KelpieProjectUser"]);
  });
  test("draft issues, pull requests, archived items and ones it can't read don't count", async () => {
    const a = ghIssue("acme/web", 1, { assignee: ME, option: "o1" });
    const pull = { id: "PR_1", number: 7, title: "A pull request" };
    fakeGh({ pages: { null: projectOf({ items: [item({ title: "Draft" }, { type: "DRAFT_ISSUE" }), item(pull, { type: "PULL_REQUEST" }), item(ghIssue("acme/web", 2, { assignee: ME, option: "o1" }), { archived: true }), item(null, { type: "REDACTED" }), item(a)] }) }, stories: { [a.id]: { ...a, subIssues: { nodes: [] } } } });
    const d = await loadBoard(boardWith());
    assert.deepEqual(d.mine.map((i) => i.key), ["WEB-1"]);
    assert.deepEqual(d.parents.map((i) => i.key), ["WEB-1"]);
  });
  test("a sub-issue of yours makes its story count once, however many of its sub-issues are yours", async () => {
    const story = ghIssue("acme/web", 10, { option: "o1" });
    const a = ghIssue("acme/web", 11, { assignee: ME, parent: story, option: "o1" });
    const b = ghIssue("acme/web", 12, { assignee: ME, parent: story, option: "o2" });
    const calls = fakeGh({ pages: { null: projectOf({ items: [item(a), item(b)] }) }, stories: { [story.id]: { ...story, subIssues: { nodes: [a, b] } } } });
    const d = await loadBoard(boardWith());
    assert.deepEqual(vars(calls[1].args).ids, [story.id]);
    assert.deepEqual(d.parents.map((i) => i.key), ["WEB-10"]);
    assert.deepEqual(d.children.map((i) => i.key), ["WEB-11", "WEB-12"]);
  });
  test("your items page by page, in the Project's order, at most ten pages", async () => {
    const issues = [1, 2, 3].map((n) => ghIssue("acme/web", n, { assignee: ME, option: "o1" }));
    const calls = fakeGh({
      pages: { null: projectOf({ items: [item(issues[0]), item(issues[1])], next: "c1" }), c1: projectOf({ items: [item(issues[2])] }) },
      stories: Object.fromEntries(issues.map((i) => [i.id, { ...i, subIssues: { nodes: [] } }])),
    });
    const d = await loadBoard(boardWith());
    assert.deepEqual(d.mine.map((i) => i.key), ["WEB-1", "WEB-2", "WEB-3"]);
    assert.deepEqual(calls.slice(0, 2).map((x) => vars(x.args).cursor), [undefined, "c1"]);
    // A Project that always says there's more stops after ten pages.
    const endless = fakeGh({ answer: () => ({ code: 0, stderr: "", stdout: JSON.stringify({ data: { user: { projectV2: projectOf({ items: [], next: "again" }) } } }) }) });
    await loadBoard(boardWith());
    assert.equal(endless.length, 10);
  });
  test("a user's Project and an organisation's are asked with their own query", async () => {
    const calls = fakeGh({ pages: { null: projectOf({}) } });
    await loadBoard(boardWith({ ownerType: "org", owner: "acme" }));
    assert.equal(opOf(calls[0].args), "KelpieProjectOrg");
    assert.equal(vars(calls[0].args).query, QUERIES.org);
    await loadBoard(boardWith());
    assert.equal(vars(calls[1].args).query, QUERIES.user);
  });
  test("a Project gh can't read, or GitHub's error, says so", async () => {
    fakeGh({ pages: {} });
    await assert.rejects(loadBoard(boardWith()), /no Project 3 of alex/);
    fakeGh({ answer: () => ({ code: 1, stdout: "", stderr: "gh: Could not resolve to a ProjectV2 with the number 3.\n" }) });
    await assert.rejects(loadBoard(boardWith()), /^Error: Could not resolve to a ProjectV2/);
  });
});

describe("its gh calls: constant queries, every value a variable", () => {
  test("each query is a constant with its own operation name, and no value goes into one", async () => {
    for (const [name, q] of Object.entries({ user: "KelpieProjectUser", org: "KelpieProjectOrg", stories: "KelpieStories" })) assert.match(QUERIES[name], new RegExp(`^query ${q}\\(`));
    const calls = fakeGh(sprintBoard());
    await loadBoard(boardWith({ owner: "someone-else", number: 42 }));
    for (const { args } of calls) {
      assert.deepEqual(args.slice(0, 2), ["api", "graphql"]);
      const rest = args.slice(2);
      for (let n = 0; n < rest.length; n += 2) {
        assert.ok(["-f", "-F"].includes(rest[n]), rest[n]);
        assert.match(rest[n + 1], /^(owner|number|cursor|ids\[\]|query)=/, rest[n + 1]);
      }
      const v = vars(args);
      assert.ok(Object.values(QUERIES).includes(v.query), "the query is one of the constants");
      assert.doesNotMatch(v.query, /someone-else|42|I_acme/);
    }
    assert.deepEqual(vars(calls[0].args), { owner: "someone-else", number: "42", query: QUERIES.user });
    assert.ok(calls[0].args.includes("-F") && calls[0].args[calls[0].args.indexOf("-F") + 1] === "number=42", "the number goes as a number");
  });
  test("an owner or number that isn't one is refused before gh runs", async () => {
    const calls = fakeGh(sprintBoard());
    for (const cfg of [{ owner: 'acme") { x }' }, { owner: "-acme" }, { owner: "" }, { number: "3 } }" }, { number: 0 }, { number: 1.5 }]) {
      await assert.rejects(loadBoard(boardWith(cfg)), /set its address again/, JSON.stringify(cfg));
    }
    assert.equal(calls.length, 0);
  });
  test("a story id that isn't a GitHub node id isn't sent", async () => {
    const story = { ...ghIssue("acme/web", 10, { option: "o1" }), id: "I_1) { evil }" };
    const a = ghIssue("acme/web", 11, { assignee: ME, parent: story, option: "o1" });
    const calls = fakeGh({ pages: { null: projectOf({ items: [item(a)] }) } });
    await loadBoard(boardWith());
    assert.deepEqual(calls.map((x) => opOf(x.args)), ["KelpieProjectUser"]);
  });
});

describe("keys", () => {
  const load = async (repos, cfg = {}) => {
    const issues = repos.map((repo, n) => ghIssue(repo, n + 1, { assignee: ME, option: "o1" }));
    fakeGh({ pages: { null: projectOf({ items: issues.map((i) => item(i)) }) }, stories: Object.fromEntries(issues.map((i) => [i.id, { ...i, subIssues: { nodes: [] } }])) });
    return loadBoard(boardWith(cfg));
  };
  test("the repo's name in capitals, or the profile's own prefix", async () => {
    assert.deepEqual((await load(["acme/my-app", "acme/web"])).mine.map((i) => i.key), ["MYAPP-1", "WEB-2"]);
    const d = await load(["acme/my-app", "acme/web"], { prefixes: "acme/web=FRONT" });
    assert.deepEqual(d.mine.map((i) => i.key), ["MYAPP-1", "FRONT-2"]);
    assert.deepEqual(d.repos, { MYAPP: "acme/my-app", FRONT: "acme/web" });
  });
  test("an issue whose repo makes no prefix is left out, and so are its story's sub-issues", async () => {
    assert.deepEqual((await load(["acme/123", "acme/x", "acme/web"])).mine.map((i) => i.key), ["WEB-3"]);
    const story = ghIssue("acme/123", 10, { option: "o1" });
    const a = ghIssue("acme/123", 11, { assignee: ME, parent: story, option: "o1" });
    fakeGh({ pages: { null: projectOf({ items: [item(a)] }) }, stories: { [story.id]: { ...story, subIssues: { nodes: [a] } } } });
    const d = await loadBoard(boardWith());
    assert.deepEqual([d.mine, d.parents, d.children], [[], [], []]);
  });
  test("two repos with one prefix: the load fails, saying to give one its own", async () => {
    await assert.rejects(load(["acme/web", "other/web"]), /acme\/web and other\/web both make keys starting WEB: give one of them its own prefix/);
    assert.deepEqual((await load(["acme/web", "other/web"], { prefixes: "other/web=OWEB" })).mine.map((i) => i.key), ["WEB-1", "OWEB-2"]);
  });
  test("a malformed prefix setting fails the load with why", async () => {
    await assert.rejects(load(["acme/web"], { prefixes: "acme/web=1X" }), /can't be a key prefix/);
  });
});

describe("pull requests attached by GitHub's closing links", () => {
  const STORY = { key: "WEB-10", fields: { summary: "Story", issuetype: { name: "Issue", subtask: false }, status: { id: "o2", name: "In Progress", statusCategory: { key: "indeterminate" } }, parent: null } };
  const sub = (key) => ({ key, fields: { summary: key, issuetype: { name: "Sub-issue", subtask: true }, status: { id: "o2", name: "In Progress", statusCategory: { key: "indeterminate" } }, parent: { key: "WEB-10" } } });
  const linked = pr("Make it fast", { repo: "web", number: 5 });
  const titled = pr("WEB-12 Icons", { repo: "web", number: 6 });
  const d = () => ({ ...dataOf({ parents: [STORY], children: [sub("WEB-11"), sub("WEB-12")], mine: ["WEB-11"], prs: [linked, titled] }), links: { [linked.url]: "WEB-11", [titled.url]: "WEB-11" } });
  test("a pull request that closes an issue attaches to it; a key in the title still wins", () => {
    const [story] = build(d(), new Map());
    const by = Object.fromEntries(story.subs.map((s) => [s.key, s.prs.map((p) => p.number)]));
    assert.deepEqual(by, { "WEB-11": [5], "WEB-12": [6] });
    assert.equal(story.subs[0].prs[0].key, "WEB-11");
  });
  test("so it isn't shown on its own as one naming no ticket", () => {
    assert.deepEqual(pullsOf(d()), []);
    assert.deepEqual(pullsOf({ ...d(), links: {} }).map((x) => x.pull.number), [5]);
  });
  test("without links (a Jira board), only titles count, as before", () => {
    const { links: _, ...jira } = d();
    const [story] = build(jira, new Map());
    assert.deepEqual(story.subs.map((s) => s.prs.map((p) => p.number)), [[], [6]]);
  });
});

describe("a Project issue's link", () => {
  const board = boardWith();
  const data = { parents: [{ key: "WEB-10", url: "https://github.com/acme/web/issues/10", fields: {} }], children: [], repos: { WEB: "acme/web" } };
  test("the page the load gave it, else made from its repo, else none", () => {
    assert.equal(ticketUrl(board, data, "WEB-10"), "https://github.com/acme/web/issues/10");
    assert.equal(ticketUrl(board, data, "WEB-99"), "https://github.com/acme/web/issues/99");
    assert.equal(ticketUrl(board, data, "API-1"), null);
    assert.equal(ticketUrl(board, null, "WEB-10"), null);
    assert.equal(ticketUrl(board, data, "web-1/../x"), null);
  });
});

describe("the demo as a GitHub Project", () => {
  test("it loads from the fixture, running nothing, with links, repos and the Project", async () => {
    const d = await demoData(DEMO_PROJECT_PROFILE);
    assert.deepEqual(mock.of("exec"), []);
    assert.deepEqual(d.sprints, [{ id: "iter-24", name: "Trips Sprint 24" }]);
    assert.deepEqual(d.repos, { ACME: "kelpie--demo/acme" });
    assert.equal(d.project.title, "Acme");
    assert.equal(d.links["https://github.com/kelpie--demo/web/pull/412"], "ACME-143");
    assert.ok([...d.parents, ...d.children].every((i) => i.url.startsWith("https://github.com/kelpie--demo/acme/issues/")));
  });
  // What a Status move (board.js moveStatus) relies on: the status is the option (its id one of a
  // column's, its name the column's), and every id it sends is one GitHub's ids look like.
  test("each issue's status is its Status option, and every id a move sends is a plain id", async () => {
    const d = await demoData(DEMO_PROJECT_PROFILE);
    const ID = /^[A-Za-z0-9_=-]{1,100}$/;
    assert.match(d.project.id, ID);
    assert.match(d.project.statusField, ID);
    for (const c of d.columns) { assert.equal(c.statuses.length, 1); assert.match(c.statuses[0], ID); }
    for (const i of [...d.parents, ...d.children]) {
      const col = d.columns.find((c) => c.statuses[0] === i.fields.status.id);
      assert.ok(col, `${i.key}: its status is a column's option`);
      assert.equal(i.fields.status.name, col.name, i.key);
      assert.match(i.item, ID, i.key);
    }
    assert.equal(d.parents.find((i) => i.key === "ACME-160").fields.status.name, "Review", "a Jira status shows as the column holding it");
  });
  test("a moved issue shows in the option of the column its new status is in", async () => {
    const { demoJira } = await import("../../mods/kelpie/demo.js");
    await demoJira(["transition", "ACME-144", "10101"]); // In Review, the Review column
    const d = await demoData(DEMO_PROJECT_PROFILE);
    assert.deepEqual(d.children.find((i) => i.key === "ACME-144").fields.status, { id: "opt-2", name: "Review", statusCategory: { key: "indeterminate" } });
    await demoJira(["transition", "ACME-144", "10000"]);
  });
  test("its stories are the Jira demo's: the same keys, order, subtasks, needs and pull requests", async () => {
    const jira = await demoData(DEMO_PROFILE);
    const project = await demoData(DEMO_PROJECT_PROFILE);
    // The one pull request linked only by GitHub's closing reference (its title names no ticket) is
    // the Project's alone.
    const linked = "https://github.com/kelpie--demo/web/pull/412";
    const view = (d, drop = null) => ordered(build({ ...d, prs: d.prs.filter((p) => p.url !== drop) }, new Map(), {}, new Map(), null)).map(({ it, n }) => ({
      key: it.key, title: it.title, category: it.category, mine: it.mine, sunk: sunk(it, n), story: it.story, need: need(it), assignee: it.assignee,
      prs: it.prs.map((p) => p.url),
      subs: it.subs.map((s) => ({ key: s.key, title: s.title, category: s.category, mine: s.mine, stage: s.stage, assignee: s.assignee, prs: s.prs.map((p) => p.url) })),
    }));
    assert.ok(view(jira).length > 3);
    assert.deepEqual(view(project, linked), view(jira));
    const sub = build(project, new Map()).flatMap((it) => it.subs).find((s) => s.key === "ACME-143");
    assert.ok(sub.prs.some((p) => p.url === linked), "the linked pull request attaches to its issue");
    assert.ok(!build(jira, new Map()).flatMap((it) => it.subs).some((s) => s.prs.some((p) => p.url === linked)), "Jira knows nothing of it");
  });
});

describe("an issue on the Project with no Status set", () => {
  test("reads as No status, to do, and keeps its item so it can be moved", async () => {
    const own = ghIssue("acme/web", 20, { assignee: ME, option: null });
    fakeGh({ pages: { null: projectOf({ items: [item(own)] }) }, stories: { [own.id]: { ...own, subIssues: { nodes: [] } } } });
    const d = await loadBoard(boardWith());
    assert.deepEqual(d.parents[0].fields.status, { id: null, name: "No status", statusCategory: { key: "new" } });
    assert.equal(d.parents[0].item, "PVTI_20");
  });
});

// KELPIE-47: stories something of which is still here (stories.js hereKeys()) that your items left
// out, reassigned since, are asked for by key, through a constant query with its values as variables.
describe("kept stories, by key", () => {
  const PRIYA = { login: "priya", name: "Priya Nair", avatarUrl: null };
  // `down`: GitHub fails the kept question for another reason than an issue not being there.
  function keptBoard({ down = false } = {}) {
    const { pages, stories } = sprintBoard();
    const gone = ghIssue("acme/web", 30, { title: "Saved filters", assignee: PRIYA, option: "o2" });
    const sub = ghIssue("acme/web", 31, { title: "Save them", assignee: PRIYA, parent: gone, option: "o2" });
    const back = ghIssue("acme/web", 40, { title: "Mine still", assignee: ME, option: "o2" });
    const all = { ...stories, [gone.id]: { ...gone, subIssues: { nodes: [sub] } }, [back.id]: { ...back, subIssues: { nodes: [] } } };
    const issues = { 30: gone, 31: sub, 40: back };
    return fakeGh({ answer: (gh) => {
      const v = vars(gh);
      const json = (data) => ({ code: 0, stdout: JSON.stringify({ data }), stderr: "" });
      if (opOf(gh) === "KelpieStories") return json({ nodes: v.ids.map((id) => all[id] ?? null) });
      if (opOf(gh) !== "KelpieKept") return json({ user: { projectV2: pages[v.cursor ?? null] ?? null } });
      if (down) return { code: 1, stdout: "", stderr: "gh: HTTP 502: Bad Gateway" };
      const i = v.owner === "acme" && v.repo === "web" ? issues[v.number] : null;
      if (!i) return { code: 1, stdout: JSON.stringify({ data: { viewer: { login: "alex" }, repository: { issue: null } }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to an Issue" }] }), stderr: "" };
      return { code: 0, stdout: JSON.stringify({ data: { viewer: { login: "alex" }, repository: { issue: { id: i.id, parent: i.parent ? { id: i.parent.id } : null } } } }), stderr: "" };
    } });
  }

  test("a sub-issue's key brings its story; yours are the viewer's; the rest is someone else's", async () => {
    const calls = keptBoard();
    const d = await loadBoard(boardWith(), { keys: ["WEB-31", "WEB-40", "WEB-11", "WEB-99", "OTHER-5"] });
    assert.deepEqual(d.kept, ["WEB-30", "WEB-40"]);
    assert.ok(d.children.some((i) => i.key === "WEB-31"));
    assert.deepEqual(d.mine.map((i) => i.key), ["WEB-11", "WEB-40"]);
    const kept = calls.filter((c) => opOf(c.args) === "KelpieKept");
    assert.deepEqual(kept.map((c) => vars(c.args).number), ["31", "40", "99"], "WEB-11 is loaded, OTHER has no repo");
    for (const { args } of kept) {
      assert.deepEqual(Object.keys(vars(args)).sort(), ["number", "owner", "query", "repo"]);
      assert.equal(vars(args).query, QUERIES.kept);
      assert.equal(args[args.indexOf(`number=${vars(args).number}`) - 1], "-F", "the number goes as a number");
    }
    const loaded = { ...dataOf({ mine: d.mine.map((i) => i.key), parents: d.parents.map(issue), children: d.children.map(issue) }), kept: d.kept };
    const items = build(loaded, new Map(), {});
    assert.deepEqual(items.find((x) => x.key === "WEB-30").reassigned, { to: ["Priya Nair"] });
    assert.equal(items.find((x) => x.key === "WEB-40").reassigned, null);
  });

  test("a kept question GitHub can't answer fails the load, so nothing is pruned", async () => {
    keptBoard({ down: true });
    await assert.rejects(loadBoard(boardWith(), { keys: ["WEB-31"] }), /Bad Gateway/);
  });

  test("a key that isn't one isn't sent", async () => {
    const calls = keptBoard();
    await loadBoard(boardWith(), { keys: ["WEB-31 }", "web-31", "WEB-", "-WEB-3"], repos: { WEB: "acme/web" } });
    assert.ok(!calls.some((c) => opOf(c.args) === "KelpieKept"));
  });
});
