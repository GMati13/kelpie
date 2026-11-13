// A ticket's comments (board.js comments(), issues.js issueComments(), stories.js StoryBody.comments()):
// asked of either board when shown, newest last, the authors' names cleaned, and drawn under the
// description as a folded "Comments · n" that opens to the newest few, with "Show all n".
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, texts } from "gpui-kit";
import { boardOf } from "../../mods/kelpie/config.js";
import { comments } from "../../mods/kelpie/board.js";
import { modFile } from "../../mods/kelpie/ui.js";
import { StoryBody, StoryList } from "../../mods/kelpie/stories.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";
import { byId, matchSnapshot, render } from "../lib/snapshot.mjs";
import { DEMO, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";

const SITE = "https://acme.atlassian.net";
const jiraBoard = boardOf({ jira: { site: SITE, board: 3, keychain: "k" } });
const jiraCalls = () => mock.of("exec").filter(([c, a]) => c === "sh" && String(a?.[0]).endsWith("jira.sh"));
const ghCalls = () => mock.of("exec").filter(([c, a]) => c === "sh" && String(a?.[0]).endsWith("gh.sh"));
const reply = (body, code = 200) => { mock.on.exec = () => ({ code: 0, stdout: JSON.stringify({ site: SITE, code, authed: true, body }), stderr: "" }); };
const adf = (text) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("a Jira ticket's comments", () => {
  beforeEach(() => mock.reset());
  test("the newest asked for, shown newest last, each with its author, time and text", async () => {
    reply({ total: 2, comments: [
      { id: "11", author: { displayName: "Ana Lima", avatarUrls: { "48x48": "https://secure.gravatar.com/avatar/a" } }, created: "2026-11-10T09:00:00.000+0000", body: adf("Second") },
      { id: "10", author: { displayName: "Tom\u0007 \n Ruiz" }, created: "2026-11-09T09:00:00.000+0000", body: adf("First") },
    ] });
    const c = await comments(jiraBoard, "ACME-12");
    const [call] = jiraCalls();
    assert.deepEqual(call[1].slice(3), ["get", "/rest/api/3/issue/ACME-12/comment?orderBy=-created&maxResults=50"]);
    assert.equal(c.total, 2);
    assert.deepEqual(c.list.map((x) => [x.id, x.author, x.at]), [["10", "Tom Ruiz", Date.parse("2026-11-09T09:00:00Z")], ["11", "Ana Lima", Date.parse("2026-11-10T09:00:00Z")]]);
    assert.equal(c.list[1].avatar, "https://secure.gravatar.com/avatar/a");
    assert.equal(c.list[0].blocks[0].runs[0].text, "First");
  });
  test("a comment with no author is someone's", async () => {
    reply({ total: 1, comments: [{ id: "1", created: "x", body: null }] });
    assert.deepEqual((await comments(jiraBoard, "ACME-12")).list, [{ id: "1", author: "Someone", avatar: null, at: null, blocks: [] }]);
  });
  // The key goes into the request's path: anything else runs nothing.
  test("anything that isn't a key is refused before jira.sh runs", async () => {
    for (const key of ["ACME-1/../../myself", "acme-1", "ACME-1?x=1", "", null]) await assert.rejects(comments(jiraBoard, key), String(key));
    assert.deepEqual(jiraCalls(), []);
  });
  test("Jira's refusal comes back readable", async () => {
    reply({ errorMessages: ["Issue does not exist or you do not have permission to see it."] }, 404);
    await assert.rejects(comments(jiraBoard, "ACME-12"), /Issue does not exist/);
  });
  test("the demo's Jira answers from its fixture, oldest first, running nothing", async () => {
    const c = await comments(boardOf({ jira: { site: SITE, board: 3, demo: true } }), "ACME-142");
    assert.deepEqual(c.list.map((x) => x.author), ["Tomás Ruiz", "Priya Nair", "Lena Fischer", "Priya Nair"]);
    assert.ok(c.list.every((x, i) => i === 0 || x.at >= c.list[i - 1].at), "newest last");
    assert.deepEqual((await comments(boardOf({ jira: { site: SITE, board: 3, demo: true } }), "ACME-144")).list, []);
    assert.deepEqual(jiraCalls(), []);
  });
});

describe("a GitHub Project issue's comments", () => {
  beforeEach(() => mock.reset());
  const board = boardOf({ project: { url: "https://github.com/orgs/acme/projects/3", owner: "acme", ownerType: "org", number: 3 }, github: { owner: "acme", account: "me-work" } });
  const data = { repos: { WEB: "acme/web" }, parents: [], children: [] };
  test("one constant query, every value a variable; the bodies drawn as Markdown", async () => {
    mock.on.exec = () => ({ code: 0, stderr: "", stdout: JSON.stringify({ data: { repository: { issue: { comments: { totalCount: 70, nodes: [
      { id: "IC_1", createdAt: "2026-11-09T09:00:00Z", body: "Use `tripsStore`, see [docs](https://example.com) and [bad](javascript:alert(1))", author: { login: "ana", name: "Ana Lima", avatarUrl: "https://avatars.githubusercontent.com/u/1?s=48" } },
      { id: "IC_2", createdAt: "2026-11-10T09:00:00Z", body: "", author: null },
    ] } } } } }) });
    const c = await comments(board, "WEB-7", data);
    const [call] = ghCalls();
    const query = call[1].find((a) => String(a).startsWith("query=")).slice(6);
    assert.deepEqual(call[1].slice(0, -1), [modFile("gh.sh"), "me-work", "api", "graphql", "-f", "owner=acme", "-f", "repo=web", "-F", "number=7", "-f"]);
    assert.match(query, /^query KelpieComments\(\$owner: String!, \$repo: String!, \$number: Int!\)/);
    assert.match(query, /rateLimit/, "it says what's left of the budget");
    assert.doesNotMatch(query, /acme|web|\b7\b/);
    assert.equal(c.total, 70, "more than were sent: the rest are only on GitHub");
    assert.deepEqual(c.list.map((x) => x.author), ["Ana Lima", "Someone"]);
    const runs = c.list[0].blocks[0].runs;
    assert.ok(runs.some((r) => r.code && r.text === "tripsStore"), "code kept");
    assert.ok(runs.some((r) => r.link === "https://example.com") && !runs.some((r) => /javascript/.test(r.link ?? "")), "only http(s) links");
  });
  test("a key whose repo isn't known asks nothing", async () => {
    await assert.rejects(comments(board, "DOCS-1", data), /which repo/);
    await assert.rejects(comments(board, "WEB-1/../x", data), /which repo/);
    assert.deepEqual(ghCalls(), []);
  });
  test("the demo's Project answers from its fixture", async () => {
    const c = await comments(boardOf({ project: { url: "https://github.com/users/kelpie--demo/projects/1", demo: true } }), "ACME-143", {});
    assert.deepEqual(c.list.map((x) => x.author), ["Tomás Ruiz"]);
    assert.deepEqual(ghCalls(), []);
  });
});

describe("a Linear issue's comments", () => {
  beforeEach(() => mock.reset());
  const board = boardOf({ linear: { url: "https://linear.app/acme/team/ENG/active", workspace: "acme", team: "ENG", keychain: "linear-acme" } });
  const linearCalls = () => mock.of("exec").filter(([c, a]) => c === "sh" && String(a?.[0]).endsWith("/linear.sh"));
  test("one constant query by key; oldest first whatever order Linear sends; Markdown kept", async () => {
    mock.on.exec = () => ({ code: 0, stderr: "", stdout: JSON.stringify({ code: 200, body: { data: { issue: { comments: { nodes: [
      { id: "c2", createdAt: "2026-11-10T09:00:00Z", body: "Second, with `code`", user: { name: "Sam Lee", displayName: "sam", avatarUrl: null } },
      { id: "c1", createdAt: "2026-11-09T09:00:00Z", body: "First", user: null },
    ] } } } } }) });
    const c = await comments(board, "ENG-12");
    const [call] = linearCalls();
    const request = JSON.parse(call[1].at(-1));
    assert.match(request.query, /^query KelpieLinearComments\(\$id: String!\)/);
    assert.deepEqual(request.variables, { id: "ENG-12" });
    assert.doesNotMatch(request.query, /ENG/, "the key is a variable, never in the query's text");
    assert.deepEqual(c.list.map((x) => [x.id, x.author]), [["c1", "Someone"], ["c2", "Sam Lee"]]);
    assert.equal(c.total, 2);
    assert.ok(c.list[1].blocks[0].runs.some((r) => r.code && r.text === "code"));
  });
  test("anything that isn't a key asks nothing", async () => {
    for (const key of ["ENG-1/x", "eng-1", "", null]) await assert.rejects(comments(board, key), String(key));
    assert.deepEqual(linearCalls(), []);
  });
});

describe("the comments in a story's details", () => {
  let stories;
  const snap = (name, el) => matchSnapshot(name, render(el, skinTheme()));
  const press = (el, id, cx) => handlers(el).find((h) => h.id === id).fn({}, cx);
  async function body(preview) {
    if (!stories) { setupDemoWorld(); stories = await loadStories(StoryList); }
    setupDemoWorld({ stories });
    mock.state.shared.set("kelpie.stories.preview", { [DEMO]: preview });
    const out = await draw(new StoryBody());
    // draw() renders once and lets the loads finish: the comments come in on the next render.
    out.el = out.view.render(out.cx);
    return out;
  }

  test("folded under the description: a heading with how many", async () => {
    const { el } = await body("ACME-142");
    assert.deepEqual(texts(byId(el, "story-talk")), ["Comments · 4"]);
    assert.equal(byId(el, "story-talk-0"), null, "no comment shows folded");
  });
  test("opened: the newest three, newest last, with Show all 4; then all of them", async () => {
    const { el, view, cx } = await body("ACME-142");
    press(el, "story-talk-head", cx);
    const open = view.render(cx);
    assert.equal(byId(open, "story-talk-0"), null);
    const shown = ["story-talk-1", "story-talk-2", "story-talk-3"].map((id) => texts(byId(open, id)));
    // Each: the author's initials (no picture in the demo), name and how long ago, then the text.
    assert.deepEqual(shown.map((x) => x.slice(0, 2)), [["PN", "Priya Nair"], ["LF", "Lena Fischer"], ["PN", "Priya Nair"]]);
    assert.ok(shown.every((x) => /^(\d+[mhd] ago|just now)$/.test(x[2])), shown.map((x) => x[2]).join(", "));
    assert.deepEqual(texts(byId(open, "story-talk-all")), ["Show all 4"]);
    snap("body/comments", byId(open, "story-talk"));
    press(open, "story-talk-all", cx);
    const all = view.render(cx);
    assert.ok(byId(all, "story-talk-0") && !byId(all, "story-talk-all"));
    assert.match(render(byId(all, "story-talk-0"), skinTheme()), /Should the banner say how long ago/);
    // Put back: kept per key for every copy in this process.
    view.allTalk.delete("ACME-142");
    press(all, "story-talk-head", cx);
  });
  test("a subtask's show with its description, opened from its title", async () => {
    const { el, view, cx } = await body("ACME-142");
    assert.equal(byId(el, "sub-talk-ACME-143"), null, "not until its title is clicked");
    press(el, "sub-title-ACME-143", cx);
    view.render(cx);
    await cx.settle();
    const open = view.render(cx);
    assert.deepEqual(texts(byId(open, "sub-talk-ACME-143")), ["Comments · 1"]);
    press(open, "sub-title-ACME-143", cx);
  });
  test("none: no heading at all", async () => {
    const { el } = await body("ACME-151");
    assert.equal(byId(el, "story-talk"), null);
  });
  test("comments that didn't load say so", async () => {
    const view = new StoryBody();
    view.threads = { "ACME-1": { error: "Jira answered 500.", at: Date.now() } };
    const st = { at: 0, setup: {}, data: {} };
    const el = view.comments(skinTheme(), st, "ACME-1", null, { id: "t" });
    assert.deepEqual(texts(el), ["Couldn't load the comments"]);
  });
});
