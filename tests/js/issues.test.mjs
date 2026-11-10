// A GitHub Project's issues (issues.js, through board.js): which issue a key is, its description,
// title and parent, a key the list doesn't have, and moving it among the Project's Status options from
// its chip (stories.js statusChip). gh is faked: every call is checked by its arguments, as only
// constant queries go to GitHub, with the values as variables, and every id a move sends is checked
// before gh runs.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, texts, walk } from "gpui-kit";
import { boardOf } from "../../mods/kelpie/config.js";
import { description, lookUp, movable, moveStatus, statusOptions, ticketText } from "../../mods/kelpie/board.js";
import { issueRef } from "../../mods/kelpie/issues.js";
import { demoJira } from "../../mods/kelpie/demo.js";
import { modFile } from "../../mods/kelpie/ui.js";
import { StoryBody } from "../../mods/kelpie/stories.js";
import { fakeCx, setupDemoWorld } from "../lib/views.mjs";
import { skinTheme } from "../../mods/kelpie/skins/index.js";

const PROJECT = { url: "https://github.com/orgs/acme/projects/3", owner: "acme", ownerType: "org", number: 3 };
const board = boardOf({ project: PROJECT, github: { owner: "acme", account: "me-work" } });
const status = (id, name, key) => ({ id, name, statusCategory: { key } });
const issue = (key, repo, n, item, st, parent = null) => ({ key, url: `https://github.com/acme/${repo}/issues/${n}`, item,
  fields: { summary: `${key} title`, issuetype: { name: parent ? "Sub-issue" : "Issue", subtask: Boolean(parent) }, status: st, parent: parent ? { key: parent } : null } });
// What a Project's load gives (board.js's header): WEB-1 a story with WEB-2 on the Project and API-7
// a sub-issue that isn't on it.
const data = () => ({
  site: "https://github.com",
  columns: [{ name: "Todo", statuses: ["opt_todo"] }, { name: "In Progress", statuses: ["opt_doing"] }, { name: "Testing", statuses: ["opt_test"] }, { name: "Done", statuses: ["opt_done"] }],
  repos: { WEB: "acme/web", API: "acme/api" },
  project: { id: "PVT_kwDOproj", statusField: "PVTSSF_status", title: "Acme", url: PROJECT.url },
  mine: [{ key: "WEB-2" }],
  parents: [issue("WEB-1", "web", 1, "PVTI_one", status("opt_doing", "In Progress", "indeterminate"))],
  children: [issue("WEB-2", "web", 2, "PVTI_two", status("opt_todo", "Todo", "new"), "WEB-1"), issue("API-7", "api", 7, null, status(null, "Open", "new"), "WEB-1")],
});
const gh = (...args) => ["sh", [modFile("gh.sh"), "me-work", ...args], {}];
const ghCalls = () => mock.of("exec").filter(([c, a]) => c === "sh" && String(a?.[0]).endsWith("gh.sh"));
const answer = (stdout, code = 0) => { mock.on.exec = () => ({ code, stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout), stderr: code ? "gh: Could not resolve to an Issue\n" : "" }); };
const queryOf = (call) => call[1].find((a) => String(a).startsWith("query="))?.slice(6);

beforeEach(() => mock.reset());

describe("issueRef: which issue a key is", () => {
  test("a loaded issue: its page and Project item", () => {
    assert.deepEqual(issueRef(board, data(), "WEB-2"), { owner: "acme", repo: "web", number: 2, url: "https://github.com/acme/web/issues/2", item: "PVTI_two" });
    assert.equal(issueRef(board, data(), "API-7").item, null, "off the Project");
  });
  test("a key the list doesn't have: the repo its prefix names, no item", () => {
    assert.deepEqual(issueRef(board, data(), "API-40"), { owner: "acme", repo: "api", number: 40, url: "https://github.com/acme/api/issues/40", item: null });
    assert.equal(issueRef(board, data(), "DOCS-1"), null, "a prefix no repo has");
    assert.equal(issueRef(board, null, "WEB-9"), null);
  });
  test("anything that isn't a key is refused before any address is built", () => {
    const d = { ...data(), repos: { WEB: "acme/web", "WEB-1/../../pulls": "acme/web" } };
    for (const key of ["WEB-1/../../pulls", "WEB-1; rm -rf ~", "web-1", "W-1", "-WEB-1", "WEB-", " WEB-1", "", null, 42]) {
      assert.equal(issueRef(board, d, key), null, JSON.stringify(key));
    }
  });
});

describe("a Project issue's description", () => {
  test("its body through the issues API, as the profile's account, drawn as Markdown", async () => {
    answer('## Why\nIt <b>matters</b>. [site](https://example.com) and [bad](javascript:alert(1))\n');
    const blocks = await description(board, "WEB-2", data());
    assert.deepEqual(ghCalls(), [gh("api", "repos/acme/web/issues/2", "--jq", '.body // ""')]);
    assert.equal(blocks[0].kind, "h");
    const runs = blocks[1].runs;
    assert.ok(runs.some((r) => r.link === "https://example.com"), "an https link stays a link");
    assert.ok(!runs.some((r) => /javascript/.test(r.link ?? "")), "any other is text");
    assert.ok(!runs.some((r) => /<b>/.test(r.text)), "HTML is dropped");
  });
  test("only an issue page's address is asked: anything else runs nothing", async () => {
    for (const url of ["https://evil.example/acme/web/issues/2", "https://github.com/acme/web/pull/2", "https://github.com/acme/web/issues/2/../../../user",
      "https://github.com/ac me/web/issues/2", "http://github.com/acme/web/issues/2", ""]) {
      const d = data();
      d.children[0].url = url;
      if (!url) { delete d.children[0].url; d.repos = {}; }
      await assert.rejects(description(board, "WEB-2", d), String(url));
    }
    assert.deepEqual(ghCalls(), []);
  });
  test("GitHub's refusal comes back readable", async () => {
    answer("", 1);
    await assert.rejects(description(board, "WEB-2", data()), { message: "Could not resolve to an Issue" });
  });
});

describe("a Project issue's title, parent and text (the review prompt's)", () => {
  test("one constant query, every value a variable; the parent's key from the repo's prefix", async () => {
    answer({ data: { repository: { issue: { number: 2, title: "Cache trips", body: "Do **this**.", parent: { number: 1, title: "Offline", repository: { nameWithOwner: "Acme/Web" } } } } } });
    assert.deepEqual(await ticketText(board, "WEB-2", data()), { summary: "Cache trips", parent: "WEB-1", text: "Do this." });
    const [call] = ghCalls();
    assert.deepEqual(call[1].slice(0, -1), [modFile("gh.sh"), "me-work", "api", "graphql", "-f", "owner=acme", "-f", "repo=web", "-F", "number=2", "-f"]);
    assert.match(queryOf(call), /^query KelpieIssue\(\$owner: String!, \$repo: String!, \$number: Int!\)/);
    await ticketText(board, "API-40", data());
    assert.equal(queryOf(ghCalls()[1]), queryOf(call), "the same query text whatever the key");
    assert.doesNotMatch(queryOf(call), /acme|web|\b2\b/);
  });
  test("a parent in a repo the load didn't name gets the profile's prefix for it", async () => {
    answer({ data: { repository: { issue: { number: 2, title: "t", body: "", parent: { number: 5, title: "p", repository: { nameWithOwner: "acme/docs-site" } } } } } });
    assert.equal((await ticketText(board, "WEB-2", data())).parent, "DOCSSITE-5");
  });
});

describe("lookUp: a Project key the list doesn't have", () => {
  test("a sub-issue goes to its story, as Jira's subtask does", async () => {
    answer({ data: { repository: { issue: { number: 40, title: "Sub", body: "", parent: { number: 30, title: "Its story", repository: { nameWithOwner: "acme/api" } } } } } });
    assert.deepEqual(await lookUp(board, "API-40", data()), { key: "API-40", summary: "Sub", story: { key: "API-30", summary: "Its story" } });
  });
  test("an issue with no parent is its own story", async () => {
    answer({ data: { repository: { issue: { number: 41, title: "Backlog", body: "", parent: null } } } });
    assert.deepEqual(await lookUp(board, "API-41", data()), { key: "API-41", summary: "Backlog", story: null });
  });
  test("unknown to GitHub, or a prefix no repo has: null", async () => {
    answer({ data: { repository: { issue: null } } });
    assert.equal(await lookUp(board, "API-99", data()), null);
    answer("", 1);
    assert.equal(await lookUp(board, "API-99", data()), null);
    mock.reset();
    assert.equal(await lookUp(board, "DOCS-1", data()), null);
    assert.deepEqual(ghCalls(), [], "nothing asked for an unknown prefix");
  });
});

describe("a Project issue's Status", () => {
  test("its options: the Project's Status options, but the one it's in, each with its category", async () => {
    assert.deepEqual(await statusOptions(board, "WEB-2", data()), [
      { id: "opt_doing", name: "In Progress", to: "In Progress", category: "indeterminate" },
      { id: "opt_test", name: "Testing", to: "Testing", category: "indeterminate" },
      { id: "opt_done", name: "Done", to: "Done", category: "done" },
    ]);
    assert.deepEqual(ghCalls(), [], "the loaded columns are enough");
  });
  test("an issue off the Project has none, and isn't movable; Jira always is", async () => {
    assert.deepEqual(await statusOptions(board, "API-7", data()), []);
    assert.equal(movable(board, "API-7", data()), false);
    assert.equal(movable(board, "WEB-2", data()), true);
    assert.equal(movable(boardOf({ jira: { site: "https://a.atlassian.net", board: 1 } }), "AB-1", null), true);
  });
  const option = (id, to = "Testing") => ({ id, name: to, to, category: "indeterminate" });
  test("a move: one constant mutation, the four ids as variables", async () => {
    answer({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_two" } } } });
    await moveStatus(board, "WEB-2", option("opt_test"), data());
    const [call] = ghCalls();
    assert.deepEqual(call[1].slice(0, -1), [modFile("gh.sh"), "me-work", "api", "graphql", "-f", "project=PVT_kwDOproj", "-f", "item=PVTI_two", "-f", "field=PVTSSF_status", "-f", "option=opt_test", "-f"]);
    assert.match(queryOf(call), /^mutation KelpieMove\(\$project: ID!, \$item: ID!, \$field: ID!, \$option: String!\) \{ updateProjectV2ItemFieldValue\(input: \{projectId: \$project, itemId: \$item, fieldId: \$field, value: \{singleSelectOptionId: \$option\}\}\)/);
  });
  test("every id is checked before gh runs: a malformed one moves nothing", async () => {
    const bad = ['x" } evil', "a b", "", "x".repeat(101), "id\n-f query=x"];
    const cases = [
      ...bad.map((v) => (d) => { d.project.id = v; }),
      ...bad.map((v) => (d) => { d.project.statusField = v; }),
      ...bad.map((v) => (d) => { d.children[0].item = v; }),
      ...bad.map((v) => (d) => { d.columns[2].statuses = [v]; return v; }),
      (d) => { d.project = null; },
    ];
    for (const change of cases) {
      const d = data();
      const id = change(d) ?? "opt_test";
      await assert.rejects(moveStatus(board, "WEB-2", option(id), d), /nothing was moved|isn.t on the board.s Project/);
    }
    assert.deepEqual(ghCalls(), []);
  });
  test("an option the Project doesn't have, or an issue off it, moves nothing", async () => {
    await assert.rejects(moveStatus(board, "WEB-2", option("opt_elsewhere"), data()), /isn't one of the Project's statuses/);
    await assert.rejects(moveStatus(board, "API-7", option("opt_test"), data()), /isn't on the board's Project/);
    await assert.rejects(moveStatus(board, "WEB-1; rm", option("opt_test"), data()), /isn't on the board's Project/);
    assert.deepEqual(ghCalls(), []);
  });
  test("GitHub's refusal comes back readable", async () => {
    mock.on.exec = () => ({ code: 1, stdout: "", stderr: "gh: Resource not accessible by integration\n" });
    await assert.rejects(moveStatus(board, "WEB-2", option("opt_test"), data()), { message: "Resource not accessible by integration" });
  });
});

describe("the status chip of a Project issue", () => {
  const st = (d) => ({ setup: { project: PROJECT, github: { account: "me-work" } }, data: d, profile: { id: "p" } });
  beforeEach(() => setupDemoWorld());
  test("off the Project: the lozenge alone, saying why it can't move", () => {
    const view = new StoryBody();
    const el = view.statusChip(skinTheme(), st(data()), "API-7", "Open", "new", "chip", fakeCx());
    assert.deepEqual(handlers(el), [], "not a menu");
    assert.ok(el && JSON.stringify(texts(el)).includes("Open"));
    assert.ok(tips(el).some((x) => /^Not on the board's Project/.test(x)));
  });
  test("on it: a menu of its options; a pick moves it and the new status shows at once", async () => {
    const view = new StoryBody(), cx = fakeCx(), d = data();
    assert.ok(handlers(view.statusChip(skinTheme(), st(d), "WEB-2", "Todo", "new", "chip", cx)).some((h) => h.id === "chip-more"), "a menu");
    answer({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_two" } } } });
    view.move(st(d), "WEB-2", { id: "opt_test", name: "Testing", to: "Testing", category: "indeterminate" }, cx);
    await cx.settle();
    assert.equal(ghCalls().length, 1);
    assert.ok(texts(view.statusChip(skinTheme(), st(d), "WEB-2", "Todo", "new", "chip", cx)).includes("Testing"), "shown before the stories reload");
  });
});

describe("the demo's Project answers from its fixture, running nothing", () => {
  const demo = boardOf({ project: { ...PROJECT, demo: true } });
  test("description, text and a look-up", async () => {
    const blocks = await description(demo, "ACME-180", {});
    assert.ok(blocks.length > 0);
    const t = await ticketText(demo, "ACME-181", {});
    assert.equal(t.parent, "ACME-180");
    assert.deepEqual((await lookUp(demo, "ACME-181", {})).story.key, "ACME-180");
    assert.equal(await lookUp(demo, "ACME-99999", {}), null);
    assert.deepEqual(ghCalls(), []);
  });
  test("a move sets the column's first status, as the demo's Jira shows it", async () => {
    const d = { columns: [{ name: "To Do", statuses: ["demo_todo"] }, { name: "Review", statuses: ["demo_review"] }], project: { id: "demo_project", statusField: "demo_status" },
      parents: [], children: [{ key: "ACME-181", url: "https://github.com/kelpie--demo/acme/issues/181", item: "demo_item_181", fields: { status: status("demo_todo", "To Do", "new") } }] };
    await moveStatus(demo, "ACME-181", { id: "demo_review", name: "Review", to: "Review" }, d);
    assert.equal((await demoJira(["get", "/rest/api/3/issue/ACME-181"])).body.fields.status.name, "In Review", "the Review column's first status");
    await moveStatus(demo, "ACME-181", { id: "demo_todo", name: "To Do", to: "To Do" }, d);
    assert.equal((await demoJira(["get", "/rest/api/3/issue/ACME-181"])).body.fields.status.name, "To Do");
    assert.deepEqual(ghCalls(), []);
  });
});

// The tooltips set in a tree.
const tips = (el) => walk(el).flatMap((n) => n.calls.filter(([m]) => m === "tooltip").map(([, a]) => a[0]));
