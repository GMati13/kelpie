// KELPIE-47: a story reassigned to someone else used to drop out of the sidebar at the next load (the
// board's search is by assignee), and pruneShared() then dropped its paused agents. It stays listed
// while something of it is here (a space, a paused agent, an open pull request of yours), marked with
// who has it now, until it's cleaned up: on Jira (board.js loadBoard()) and on a GitHub Project
// (project.js). The demo's ACME-190 is such a story, with a space and a paused agent.
import { DEMO, FIXTURE, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { byId } from "../lib/snapshot.mjs";
import { texts } from "gpui-kit";
import { StoryList, build, cleanBlockers, hereKeys, need, storyItems } from "../../mods/kelpie/stories.js";
import { loadBoard } from "../../mods/kelpie/board.js";
import { data, issue, pr } from "../lib/stories.mjs";

const PROJECT = { jira: null, project: { url: "https://github.com/users/kelpie--demo/projects/1", owner: "kelpie--demo", ownerType: "user", number: 1, demo: true } };
const story = (key) => storyItems()?.items.map((x) => x.it).find((x) => x.key === key) ?? null;

for (const [board, profile] of [["Jira", {}], ["a GitHub Project", PROJECT]]) {
  describe(`a reassigned story on ${board}`, () => {
    test("stays listed while its space and paused agent are here, marked with who has it now", async () => {
      setupDemoWorld({ profile });
      const stories = await loadStories(StoryList);
      assert.deepEqual(stories.data.kept, ["ACME-190"], "asked for by key, as the search by assignee leaves it out");
      setupDemoWorld({ profile, stories });
      const it = story("ACME-190");
      assert.ok(it, "still in the list");
      assert.deepEqual(it.reassigned, { to: ["Jordan Blake"] });
      assert.equal(it.subs[0].mine, false);
      assert.match(need(it)[1], /^Reassigned to Jordan Blake · /);
      assert.ok(it.space, "its space is the story's");
      assert.equal(it.paused?.length, 1, "and its paused agent");
      // Stories of yours aren't marked.
      assert.equal(story("ACME-142").reassigned, null);
    });

    test("its paused agent isn't pruned", async () => {
      setupDemoWorld({ profile });
      await loadStories(StoryList);
      assert.ok(mock.sharedValue("kelpie.paused")[DEMO]["ACME-190"], "kept for Resume");
    });

    test("goes once nothing of it is here", async () => {
      const { "ACME-190": _, ...paused } = FIXTURE.paused;
      setupDemoWorld({ profile, paused, spaces: FIXTURE.spaces.filter((s) => s.name !== "ACME-190") });
      const stories = await loadStories(StoryList);
      assert.equal(stories.data.kept, undefined);
      assert.ok(!stories.data.parents.some((p) => p.key === "ACME-190"));
    });
  });
}

describe("what a reassigned story offers", () => {
  test("the broom, in the list's row: cleaning it up is the person's", async () => {
    setupDemoWorld();
    const stories = await loadStories(StoryList);
    setupDemoWorld({ stories });
    const { el } = await draw(new StoryList());
    const row = byId(el, "story-ACME-190");
    assert.ok(byId(row, "clean-ACME-190"), "its broom");
    assert.ok(byId(row, "gone-ACME-190"), "who has it now, as their avatar");
    assert.ok(!texts(row).includes("Start work"));
  });

  test("not done on the board doesn't block its clean-up; an open pull request still does", () => {
    const d = { ...data({ parents: [issue("ACME-9", "doing")], children: [issue("ACME-10", "doing", "ACME-9")], prs: [pr("ACME-10 open work", { number: 3 })] }), kept: ["ACME-9"] };
    const it = build(d, new Map(), {}, new Map([["ACME-9", { id: "s1" }]]), null, { all: true })[0];
    assert.ok(it.reassigned);
    assert.deepEqual(cleanBlockers(it), ["a pull request of it is still open"]);
    const quiet = build({ ...d, prs: [] }, new Map(), {}, new Map([["ACME-9", { id: "s1" }]]), null, { all: true })[0];
    assert.deepEqual(cleanBlockers(quiet), []);
  });

  test("a kept story still yours (out of the sprint, say) isn't marked", () => {
    const d = { ...data({ parents: [issue("ACME-9", "doing")], children: [issue("ACME-10", "doing", "ACME-9")], mine: ["ACME-10"] }), kept: ["ACME-9"] };
    assert.equal(build(d, new Map(), {})[0].reassigned, null);
    // A story the load gave as yours is never marked, whoever its subtasks are assigned to.
    const listed = data({ parents: [issue("ACME-9", "doing")], children: [issue("ACME-10", "doing", "ACME-9")] });
    assert.equal(build(listed, new Map(), {})[0].reassigned, null);
  });
});

describe("which keys the load asks for", () => {
  test("a space's, a paused agent's and a story's with an open pull request of yours; only ticket keys", () => {
    setupDemoWorld({ spaces: [...FIXTURE.spaces, { name: "not a key", tabs: [] }] });
    const prior = data({ parents: [issue("ACME-7", "doing")], prs: [pr("ACME-7 work", { number: 9 })] });
    const keys = hereKeys({ id: DEMO }, prior);
    for (const k of ["ACME-190", "ACME-142", "ACME-138", "ACME-117", "ACME-7"]) assert.ok(keys.includes(k), k);
    assert.ok(keys.every((k) => /^[A-Z][A-Z0-9_]*-\d+$/.test(k)), keys.join(" "));
  });

  // A Jira board answered by a fake jira.sh: the searches as JQL, for what's asked by key.
  const SITE = "https://acme.atlassian.net";
  const cfg = { site: SITE, board: 7, keychain: "kelpie-test" };
  const me = { accountId: "me-1", displayName: "Me" }, ana = { accountId: "ana-2", displayName: "Ana Lima" };
  const ISSUES = [
    { key: "ACME-1", fields: { summary: "Mine", issuetype: { name: "Story", subtask: false }, status: { id: "1" }, assignee: me } },
    { key: "ACME-5", fields: { summary: "Ana's now", issuetype: { name: "Story", subtask: false }, status: { id: "1" }, assignee: ana } },
    { key: "ACME-6", fields: { summary: "Its subtask", issuetype: { name: "Sub-task", subtask: true }, status: { id: "1" }, parent: { key: "ACME-5" }, assignee: ana } },
    { key: "ACME-8", fields: { summary: "Mine, out of the sprint", issuetype: { name: "Story", subtask: false }, status: { id: "1" }, assignee: me } },
  ];
  function fakeJira(searches) {
    mock.on.exec = (cmd, args) => {
      if (cmd !== "sh" || !String(args[0]).endsWith("jira.sh")) return undefined;
      const [what, a] = args.slice(3);
      const body = (b) => ({ code: 0, stdout: JSON.stringify({ site: SITE, code: 200, authed: true, body: b }), stderr: "" });
      if (what === "get" && a.endsWith("/configuration")) return body({ columnConfig: { columns: [{ name: "To Do", statuses: [{ id: "1" }] }] } });
      if (what === "get") return body({ values: [{ id: 3, name: "Sprint 3" }] });
      searches.push(a);
      if (/currentUser/.test(a)) return body({ issues: [ISSUES[0]], isLast: true });
      if (/ACME-404/.test(a)) return { code: 0, stdout: JSON.stringify({ site: SITE, code: 400, authed: true, body: { errorMessages: ["An issue with key 'ACME-404' does not exist."] } }), stderr: "" };
      const named = [...a.matchAll(/ACME-\d+/g)].map((m) => m[0]);
      return body({ issues: ISSUES.filter((i) => named.includes(i.key) || named.includes(i.fields.parent?.key)), isLast: true });
    };
  }

  test("Jira: by key, a subtask's story too, yours known by your own issues' assignee", async () => {
    mock.reset();
    const searches = [];
    fakeJira(searches);
    const r = await loadBoard({ kind: "jira", cfg }, { keys: ["ACME-6", "ACME-8", "ACME-1"] });
    assert.deepEqual(r.kept, ["ACME-8", "ACME-5"]);
    assert.deepEqual(r.children.map((i) => i.key), ["ACME-6"]);
    assert.deepEqual(r.mine.map((i) => i.key), ["ACME-1", "ACME-8"], "ACME-8 is still yours, ACME-5 isn't");
  });

  test("Jira: another project's key isn't asked for; a key Jira doesn't know doesn't fail the load", async () => {
    mock.reset();
    const searches = [];
    fakeJira(searches);
    const r = await loadBoard({ kind: "jira", cfg }, { keys: ["OTHER-3", "ACME-404", "ACME-5", "ACME-1;DROP"] });
    assert.ok(!searches.some((s) => /OTHER|DROP/.test(s)), searches.join("\n"));
    assert.deepEqual(r.kept, ["ACME-5"], "asked again alone, the known key still comes");
  });
});
