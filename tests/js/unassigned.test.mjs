// The sprint's work nobody has (#54): with the board's `unassigned` on, the load asks the board one
// more question (Jira `assignee is EMPTY`, a Project's `no:assignee` items) and keeps what it finds
// apart (`data.unassigned`), so the person's stories, the list's groups, its counts and Next don't
// change; the sidebar shows it last, folded, as its own section.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, texts } from "gpui-kit";
import { v_flex } from "gpui-base";
import { boardOf, showsUnassigned } from "../../mods/kelpie/config.js";
import { loadBoard, unassignedOf } from "../../mods/kelpie/board.js";
import { QUERIES } from "../../mods/kelpie/project.js";
import { Stories, StoryList, storyItems, unassignedIn } from "../../mods/kelpie/stories.js";
import { DEMO_PROFILE, DEMO_PROJECT_PROFILE, demoData } from "../lib/stories.mjs";
import { DEMO, demoProfile, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { byId, matchSnapshot, render } from "../lib/snapshot.mjs";
import { skinTheme } from "../../mods/kelpie/skins/index.js";

const ON = (p) => ({ ...p, ...(p.jira ? { jira: { ...p.jira, unassigned: true } } : {}), ...(p.project ? { project: { ...p.project, unassigned: true } } : {}) });
const keys = (list) => list.map((i) => i.key);
// The person's own part of a load: what build(), need(), Next and the counts read.
const own = (d) => ({ mine: d.mine, parents: d.parents, children: d.children, kept: d.kept, prs: d.prs, reviews: d.reviews });

describe("unassignedOf: what the section holds", () => {
  const story = (key, fields = {}) => ({ key, fields: { summary: key, issuetype: { name: "Story", subtask: false }, ...fields } });
  const sub = (key, parent, parentFields = { summary: `${parent} title` }) => ({ key, fields: { summary: key, issuetype: { name: "Sub-task", subtask: true }, parent: { key: parent, fields: parentFields } } });
  test("stories nobody has as they are, others' stories as headings over their subtasks nobody has", () => {
    const got = [sub("A-2", "A-1"), story("A-1"), sub("B-2", "B-1"), story("C-1")];
    const u = unassignedOf(got, new Set());
    assert.deepEqual(keys(u.parents), ["A-1", "B-1", "C-1"]);
    assert.equal(u.parents.find((p) => p.key === "A-1").taken, undefined, "a story nobody has isn't a heading");
    const b = u.parents.find((p) => p.key === "B-1");
    assert.equal(b.taken, true, "someone else has B-1: only its subtask's heading");
    assert.equal(b.fields.summary, "B-1 title", "made from what its subtask says of it");
    assert.deepEqual(keys(u.children), ["A-2", "B-2"]);
  });
  test("leaves out the person's own, and a subtask of one of their stories (it's in that story's details)", () => {
    const u = unassignedOf([story("A-1"), sub("M-3", "M-1"), sub("A-2", "A-1"), story("bad key")], new Set(["A-1", "M-1"]));
    assert.deepEqual(u, { parents: [], children: [] });
  });
});

describe("the demo's load, Jira and a GitHub Project", () => {
  for (const [name, profile] of [["Jira", DEMO_PROFILE], ["GitHub Project", DEMO_PROJECT_PROFILE]]) {
    test(`${name}: on, the work nobody has comes apart from yours; off, it isn't asked for`, async () => {
      const off = await demoData(profile);
      assert.equal(off.unassigned, undefined, "off: nothing asked, nothing kept");
      const on = await demoData(ON(profile));
      assert.deepEqual(own(on), own(off), "your stories are the same either way");
      // ACME-195 is Jordan's, over ACME-196 nobody has; ACME-198 nobody has (#91's, shown only when worked alone).
      assert.deepEqual(keys(on.unassigned.parents), ["ACME-195", "ACME-198", "ACME-202", "ACME-204", "ACME-207"]);
      assert.deepEqual(on.unassigned.parents.filter((p) => p.taken).map((p) => p.key), ["ACME-195", "ACME-204"], "Jordan has ACME-195, Lena ACME-204: headings");
      assert.equal(on.unassigned.parents[3].fields.summary, "An accessible date picker");
      // ACME-131 nobody has either, but it's a subtask of ACME-129, one of your stories: there already.
      assert.deepEqual(keys(on.unassigned.children), ["ACME-196", "ACME-203", "ACME-205"]);
      assert.ok(!keys(on.unassigned.children).includes("ACME-131"));
      assert.equal(on.unassigned.error, undefined);
    });
    test(`${name}: on a board worked alone, every ticket is already yours, so it isn't asked for`, async () => {
      const solo = (p) => ({ ...p, ...(p.jira ? { jira: { ...p.jira, solo: true } } : {}), ...(p.project ? { project: { ...p.project, solo: true } } : {}) });
      const alone = solo(ON(profile));
      assert.equal(showsUnassigned(alone), false, "no section");
      assert.equal(showsUnassigned(ON(profile)), true);
      assert.equal((await demoData(alone)).unassigned, undefined, "no second question");
    });
  }
});

describe("a GitHub Project's question", () => {
  const CFG = { url: "https://github.com/users/alex/projects/3", owner: "alex", ownerType: "user", number: 3 };
  const vars = (args) => Object.fromEntries(args.flatMap((a, n) => ((a === "-f" || a === "-F") ? [args[n + 1].split(/=(.*)/s).slice(0, 2)] : [])));
  const project = (items) => ({ id: "PVT", title: "Board", url: "", field: { id: "F", options: [{ id: "o1", name: "Todo" }, { id: "o2", name: "Done" }] },
    fields: { nodes: [{ id: "F_iter", name: "Sprint", configuration: { iterations: [{ id: "it", title: "Now", startDate: new Date(Date.now() - 864e5).toISOString().slice(0, 10), duration: 14 }] } }] },
    items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: items } });
  const issue = (n, { parent = null, closes = [] } = {}) => ({ id: `I_${n}`, number: n, title: `#${n}`, url: `https://github.com/alex/web/issues/${n}`, state: "OPEN", closedAt: null,
    repository: { nameWithOwner: "alex/web" }, assignees: { nodes: [] }, labels: { nodes: [] }, parent,
    closedByPullRequestsReferences: { nodes: closes.map((url) => ({ url })) }, projectItems: { nodes: [{ id: `PVTI_${n}`, project: { id: "PVT" }, fieldValueByName: { optionId: "o1", name: "Todo" } }] } });
  const item = (content, iteration = "it") => ({ id: `PVTI_${content.number}`, type: "ISSUE", isArchived: false, content, fieldValues: { nodes: [{ iterationId: iteration, field: { id: "F_iter" } }] } });
  function fakeGh(unassigned, { fail = false } = {}) {
    const calls = [];
    mock.reset();
    mock.on.exec = (cmd, args) => {
      if (cmd !== "sh" || !String(args[0]).endsWith("/gh.sh")) return undefined;
      const gh = args.slice(2), v = vars(gh), op = /^query\s+(\w+)/.exec(v.query ?? "")?.[1];
      calls.push({ op, v });
      if (op === "KelpieUnassignedUser" && fail) return { code: 1, stdout: "", stderr: "gh: Something went wrong" };
      const data = op === "KelpieUnassignedUser" ? { user: { projectV2: { items: project(unassigned).items } } } : { user: { projectV2: project([]) } };
      return { code: 0, stdout: JSON.stringify({ data }), stderr: "" };
    };
    return calls;
  }
  const board = (cfg = {}) => boardOf({ project: { ...CFG, ...cfg }, github: { owner: "alex" } });

  test("off, it isn't asked", async () => {
    const calls = fakeGh([item(issue(5))]);
    const out = await loadBoard(board());
    assert.equal(out.unassigned, undefined);
    assert.ok(!calls.some((c) => /Unassigned/.test(c.op ?? "")));
  });
  test("on: one constant question, its values as variables; the iteration's issues only; their pull requests stay off your stories", async () => {
    const parent = { id: "I_9", number: 9, title: "Someone's story", url: "https://github.com/alex/web/issues/9", state: "OPEN", repository: { nameWithOwner: "alex/web" } };
    const calls = fakeGh([item(issue(5, { closes: ["https://github.com/alex/web/pull/77"] })), item(issue(6), "old"), item(issue(7, { parent }))]);
    const out = await loadBoard(board({ unassigned: true }));
    const ask = calls.find((c) => c.op === "KelpieUnassignedUser");
    assert.equal(ask.v.query, QUERIES.unassignedUser);
    assert.deepEqual({ owner: ask.v.owner, number: ask.v.number }, { owner: "alex", number: "3" });
    assert.match(QUERIES.unassignedUser, /query: "no:assignee is:issue"/);
    for (const q of [QUERIES.unassignedUser, QUERIES.unassignedOrg]) assert.match(q, /rateLimit \{ remaining limit resetAt \}/);
    assert.deepEqual(keys(out.unassigned.parents), ["WEB-5", "WEB-9"], "#6 is in another iteration");
    assert.equal(out.unassigned.parents[1].taken, true);
    assert.equal(out.unassigned.parents[1].fields.summary, "Someone's story");
    assert.equal(out.unassigned.parents[1].url, "https://github.com/alex/web/issues/9");
    assert.deepEqual(keys(out.unassigned.children), ["WEB-7"]);
    assert.deepEqual(out.links, {}, "a pull request closing work nobody has doesn't attach to your stories");
  });
  test("its failing doesn't fail the load: the section says so", async () => {
    fakeGh([], { fail: true });
    const out = await loadBoard(board({ unassigned: true }));
    assert.deepEqual(out.parents, []);
    assert.match(out.unassigned.error, /Something went wrong/);
  });
});

describe("the sidebar's Unassigned section", async () => {
  setupDemoWorld();
  const off = await loadStories(StoryList);
  setupDemoWorld({ profile: { jira: { ...demoProfile().jira, unassigned: true } } });
  const on = await loadStories(StoryList);
  const PROFILE = { jira: { ...demoProfile().jira, unassigned: true } };

  test("unassignedIn: each marked, a heading's subs only its open ones nobody has", () => {
    const list = unassignedIn(on.data, null).map(({ it }) => it);
    assert.deepEqual(list.map((it) => [it.key, Boolean(it.taken)]), [["ACME-195", true], ["ACME-198", false], ["ACME-202", false], ["ACME-204", true], ["ACME-207", false]]);
    assert.ok(list.every((it) => it.unassigned));
    assert.deepEqual(list[0].subs.map((s) => s.key), ["ACME-196"]);
    assert.deepEqual(list[3].subs.map((s) => s.key), ["ACME-205"]);
    // Finished work isn't there to pick up.
    const done = { ...on.data, unassigned: { ...on.data.unassigned, parents: on.data.unassigned.parents.map((p) => (p.key === "ACME-207" ? { ...p, fields: { ...p.fields, status: { id: "x", name: "Done", statusCategory: { key: "done" } } } } : p)) } };
    assert.deepEqual(unassignedIn(done, null).map(({ it }) => it.key), ["ACME-195", "ACME-198", "ACME-202", "ACME-204"]);
    assert.deepEqual(unassignedIn(off.data, null), [], "not loaded: nothing");
  });

  test("last and folded; nothing else in the list changes, neither its counts nor Next", async () => {
    setupDemoWorld({ stories: off });
    const plain = texts((await draw(new StoryList())).el);
    setupDemoWorld({ stories: on, profile: PROFILE });
    const { el } = await draw(new StoryList());
    const words = texts(el);
    assert.deepEqual(words.slice(0, plain.length), plain, "everything before it is as without it");
    assert.deepEqual(words.slice(plain.length).map((w) => w.toLowerCase()), ["unassigned", "5"], "then its heading, counting its rows (Quiet Pages sets headings in capitals)");
    assert.ok(byId(el, "stories-unassigned"));
    assert.equal(byId(el, "unassigned-ACME-202"), null, "folded at first");
    const s = storyItems();
    assert.ok(!s.items.some(({ it }) => it.unassigned), "not among your stories");
    // Turned off, the section goes even with the data still loaded.
    setupDemoWorld({ stories: on });
    assert.equal(byId((await draw(new StoryList())).el, "stories-unassigned"), null);
  });

  test("unfolded per profile: rows, a heading over someone's story; a click previews it", async () => {
    setupDemoWorld({ stories: on, profile: PROFILE });
    const { el, view, cx } = await draw(new StoryList());
    handlers(el).find((h) => h.id === "stories-unassigned").fn({}, cx);
    assert.deepEqual(mock.state.shared.get("kelpie.unassigned.open"), { [DEMO]: true });
    const open = view.render(cx);
    const ids = ["unassigned-ACME-202", "unassigned-story-ACME-204", "unassigned-ACME-205", "unassigned-ACME-207"];
    for (const id of ids) assert.ok(byId(open, id), id);
    assert.equal(byId(open, "unassigned-ACME-131"), null, "a subtask of your story stays in its details");
    assert.equal(byId(open, "unassigned-ACME-203"), null, "a story nobody has shows its subtasks in its details");
    assert.ok(texts(byId(open, "unassigned-ACME-202")).includes("Unassigned"));
    matchSnapshot("sidebar/unassigned", render(v_flex().children(["stories-unassigned", ...ids].map((id) => byId(open, id))), skinTheme()));
    handlers(open).find((h) => h.id === "unassigned-ACME-205").fn({}, cx);
    assert.equal(mock.state.shared.get("kelpie.stories.preview")[DEMO], "ACME-204", "a subtask previews its story");
    handlers(open).find((h) => h.id === "unassigned-ACME-202").fn({}, cx);
    assert.equal(mock.state.shared.get("kelpie.stories.preview")[DEMO], "ACME-202");
    // Folded again, the one shown keeps its row.
    handlers(view.render(cx)).find((h) => h.id === "stories-unassigned").fn({}, cx);
    const shut = view.render(cx);
    assert.ok(byId(shut, "unassigned-ACME-202"));
    assert.equal(byId(shut, "unassigned-ACME-207"), null);
  });

  test("previewed: its details, but nothing to start (it's taken on the board)", async () => {
    setupDemoWorld({ stories: on, profile: PROFILE });
    mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-202" });
    const { el } = await draw(new Stories());
    assert.ok(texts(el).includes("Show the day's stops on a map"));
    assert.equal(byId(el, "story-main"), null, "no filled Start work");
    mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-204" });
    const head = (await draw(new Stories())).el;
    assert.equal(byId(head, "story-assignee"), null, "who has someone's story isn't loaded: no avatar saying nobody");
  });
});
