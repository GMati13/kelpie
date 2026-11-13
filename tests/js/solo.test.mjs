// KELPIE-91: on a board worked alone (the board's `solo`, "I work alone"), every ticket in scope is the
// person's, assigned to anyone or nobody: the stories' load asks with no assignee filter (board.js
// loadBoard(), project.js loadProject()), and build() counts every ticket as theirs, so the subtask
// groups, the progress bar, sinking and Move to Done go over all of them. A team's board stays as it
// was: only the person's own. The demo's ACME-195 (Jordan Blake's, with an unassigned subtask) and
// ACME-198 (unassigned) are the person's only when the board is worked alone.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { texts } from "gpui-kit";
import { loadBoard } from "../../mods/kelpie/board.js";
import { QUERIES } from "../../mods/kelpie/project.js";
import { boardOf } from "../../mods/kelpie/config.js";
import { StoryBody, StoryList, build, donePlan } from "../../mods/kelpie/stories.js";
import { DEMO, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { byId, render } from "../lib/snapshot.mjs";
import { skinTheme } from "../../mods/kelpie/skins/index.js";
import { DEMO_PROFILE, DEMO_PROJECT_PROFILE, data, demoData, issue } from "../lib/stories.mjs";

beforeEach(() => mock.reset());

const alone = (profile) => profile.jira
  ? { ...profile, jira: { ...profile.jira, solo: true } }
  : { ...profile, project: { ...profile.project, solo: true } };
const keys = (list) => list.map((i) => i.key);
const NOT_MINE = ["ACME-195", "ACME-198"];

for (const [board, team] of [["Jira", DEMO_PROFILE], ["a GitHub Project", DEMO_PROJECT_PROFILE]]) {
  describe(`what shows on ${board}`, () => {
    test("a team's board: only the person's own stories, as before", async () => {
      const d = await demoData(team);
      assert.equal(d.solo, undefined);
      for (const k of NOT_MINE) assert.ok(!keys(d.parents).includes(k), `${k} isn't the person's`);
      assert.ok(!keys(d.children).includes("ACME-196"));
      assert.ok(!keys(d.mine).includes("ACME-145"), "someone else's subtask isn't yours");
    });

    test("worked alone: every story in scope, whoever has it or nobody", async () => {
      const d = await demoData(alone(team));
      assert.equal(d.solo, true);
      for (const k of NOT_MINE) assert.ok(keys(d.parents).includes(k), `${k} shows`);
      assert.ok(keys(d.children).includes("ACME-196"), "with its subtasks");
      for (const k of ["ACME-145", "ACME-195", "ACME-196", "ACME-198"]) assert.ok(keys(d.mine).includes(k), `${k} counts as the person's`);
    });

    test("worked alone: every ticket is the person's, and the avatar still says who has it", async () => {
      const items = build(await demoData(alone(team)), new Map(), {}, new Map(), null, { all: true });
      const it = (k) => items.find((x) => x.key === k);
      for (const x of items.filter((x) => !x.pr)) {
        assert.equal(x.mine, true, `${x.key} is the person's`);
        for (const s of x.subs) assert.equal(s.mine, true, `${s.key} is the person's`);
      }
      assert.equal(it("ACME-195").assignee, "Jordan Blake");
      assert.equal(it("ACME-198").assignee, null, "unassigned");
      assert.equal(it("ACME-142").subs.find((s) => s.key === "ACME-145").assignee, "Tomás Ruiz");
      // Nothing says "(you)": a load of everyone's doesn't ask whose they are.
      assert.ok(items.every((x) => !x.you && (x.subs ?? []).every((s) => !s.you)));
      // A story out of scope kept for what's here isn't "reassigned": it's still the person's.
      assert.ok(items.every((x) => !x.reassigned));
    });
  });
}

describe("what counts as yours, worked alone", () => {
  const items = async (profile) => build(await demoData(profile), new Map(), {}, new Map(), null, { all: true });
  const one = (list, k) => list.find((x) => x.key === k);

  test("build() counts every ticket of a solo load as the person's, whatever its `mine` says", () => {
    // A story of someone else's: one subtask yours in QA, one unassigned in progress.
    const d = data({ parents: [issue("ACME-1", "doing")], children: [issue("ACME-2", "qa", "ACME-1"), issue("ACME-3", "doing", "ACME-1")], mine: ["ACME-2"] });
    const team = build(d, new Map())[0], solo = build({ ...d, solo: true }, new Map())[0];
    assert.deepEqual(team.subs.map((s) => s.mine), [true, false]);
    assert.equal(team.sunk, true);
    assert.deepEqual(keys(donePlan(team).others), ["ACME-3"]);
    assert.deepEqual(solo.subs.map((s) => s.mine), [true, true]);
    assert.equal(solo.mine, true);
    assert.equal(solo.sunk, false, "the unassigned subtask is the person's too, still in progress");
    assert.deepEqual(keys(donePlan(solo).mine), ["ACME-2", "ACME-3"]);
    assert.deepEqual(team.subs.map((s) => s.you), [true, false], "a team's says who's you");
    assert.deepEqual(solo.subs.map((s) => s.you), [false, false]);
  });

  test("sinking goes by every subtask: an unassigned one still in progress keeps the story up", async () => {
    // ACME-129: yours in QA (the handover column), an unassigned one in progress.
    assert.equal(one(await items(DEMO_PROFILE), "ACME-129").sunk, true, "a team's: your part is done");
    assert.equal(one(await items(alone(DEMO_PROFILE)), "ACME-129").sunk, false, "alone: one of yours is still in progress");
  });

  test("Move to Done moves every open subtask, then the story", async () => {
    // ACME-180: ACME-181 yours, ACME-182 Tomás's, both to do.
    const team = donePlan(one(await items(DEMO_PROFILE), "ACME-180"));
    assert.deepEqual(keys(team.mine), ["ACME-181"]);
    assert.deepEqual(keys(team.others), ["ACME-182"]);
    assert.equal(team.story, false, "someone else's subtask is open");
    const solo = donePlan(one(await items(alone(DEMO_PROFILE)), "ACME-180"));
    assert.deepEqual(keys(solo.mine), ["ACME-181", "ACME-182"]);
    assert.deepEqual(solo.others, []);
    assert.equal(solo.story, true);
  });

  test("the subtasks are one list, with no Assigned to you / Everyone else headings", async () => {
    const body = async (profile) => {
      setupDemoWorld({ profile });
      const stories = await loadStories(StoryList);
      setupDemoWorld({ profile, stories });
      mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-142" });
      return (await draw(new StoryBody())).el;
    };
    const order = (el) => render(el, skinTheme()).split("\n").map((l) => /#(subs-mine|subs-others|sub-row-[A-Z]+-\d+)\b/.exec(l)?.[1]).filter(Boolean);
    assert.deepEqual(order(await body({})), ["subs-mine", "sub-row-ACME-143", "sub-row-ACME-144", "subs-others", "sub-row-ACME-145"]);
    const el = await body({ jira: { ...DEMO_PROFILE.jira, solo: true } });
    assert.deepEqual(order(el), ["sub-row-ACME-143", "sub-row-ACME-144", "sub-row-ACME-145"]);
    assert.ok(byId(el, "sub-assignee-ACME-145"), "who has it still shows");
  });
});

describe("the loads' questions", () => {
  // jira.sh answering every search with nothing, keeping the JQL asked.
  function fakeJira() {
    const jql = [];
    mock.on.exec = (cmd, args) => {
      if (cmd !== "sh" || !String(args[0]).endsWith("/jira.sh")) return undefined;
      const [what, a] = args.slice(3).filter((x) => !String(x).startsWith("--"));
      if (what === "search") jql.push(a);
      const body = what === "search" ? { issues: [{ key: "ACME-1", fields: { summary: "x", issuetype: { name: "Story", subtask: false }, status: { id: "1", name: "To Do", statusCategory: { key: "new" } } } }], isLast: true }
        : /sprint\?state=active/.test(a) ? { values: [{ id: 3, name: "Sprint 3" }] }
        : /configuration$/.test(a) ? { columnConfig: { columns: [] } } : {};
      return { code: 0, stdout: JSON.stringify({ site: "https://acme.atlassian.net", code: 200, authed: true, body }), stderr: "" };
    };
    return jql;
  }
  const JIRA = { url: "https://acme.atlassian.net/jira/software/projects/ACME/boards/7", site: "https://acme.atlassian.net", board: 7, keychain: "kelpie-jira" };

  test("Jira: the sprint's search has the assignee clause only for a team", async () => {
    let jql = fakeJira();
    await loadBoard(boardOf({ jira: JIRA }));
    assert.match(jql[0], /^sprint in \(3\) AND assignee = currentUser\(\) ORDER BY Rank$/);
    jql = fakeJira();
    const d = await loadBoard(boardOf({ jira: { ...JIRA, solo: true } }));
    assert.equal(jql[0], "sprint in (3) ORDER BY Rank");
    assert.equal(d.solo, true);
    // Only true counts: anything else is a team's board.
    jql = fakeJira();
    await loadBoard(boardOf({ jira: { ...JIRA, solo: "true" } }));
    assert.match(jql[0], /assignee = currentUser\(\)/);
  });

  test("GitHub Project: constant queries, the person's items or every issue", () => {
    assert.match(QUERIES.user, /^query KelpieProjectUser\(/);
    assert.match(QUERIES.user, /query: "assignee:@me is:issue"/);
    assert.match(QUERIES.userAll, /^query KelpieProjectUserAll\(/);
    assert.match(QUERIES.orgAll, /^query KelpieProjectOrgAll\(/);
    for (const q of [QUERIES.userAll, QUERIES.orgAll]) {
      assert.match(q, /query: "is:issue"/);
      assert.doesNotMatch(q, /query: "[^"]*assignee/);
      assert.match(q, /\$owner: String!, \$number: Int!, \$cursor: String/, "values as variables");
    }
  });

  test("GitHub Project: a board read past its page limit says how much was read", async () => {
    const calls = [];
    const page = (n) => ({
      id: "PVT_b", title: "Board", url: "https://github.com/users/alex/projects/3", field: { id: "F", options: [{ id: "o1", name: "Todo" }] }, fields: { nodes: [] },
      items: { pageInfo: { hasNextPage: true, endCursor: `c${n + 1}` }, nodes: Array.from({ length: 100 }, (_, i) => ({ id: `PVTI_${n}_${i}`, type: "DRAFT_ISSUE", isArchived: false, content: {} })) },
    });
    mock.on.exec = (cmd, args) => {
      if (cmd !== "sh" || !String(args[0]).endsWith("/gh.sh")) return undefined;
      const gh = args.slice(2), q = gh.find((x) => String(x).startsWith("query="));
      const cursor = gh.find((x) => String(x).startsWith("cursor="))?.slice(8) ?? "c0";
      calls.push(/^query=query (\w+)/.exec(q)?.[1]);
      return { code: 0, stdout: JSON.stringify({ data: { user: { projectV2: page(Number(cursor.slice(1))) }, nodes: [] } }), stderr: "" };
    };
    const d = await loadBoard(boardOf({ project: { url: "https://github.com/users/alex/projects/3", owner: "alex", ownerType: "user", number: 3, solo: true }, github: { owner: "acme" } }));
    assert.equal(calls.filter((op) => op === "KelpieProjectUserAll").length, 10, "ten pages at most");
    assert.ok(!calls.includes("KelpieProjectUser"));
    assert.equal(d.cut, 1000);
  });
});

test("the list says when a board was read only in part", async () => {
  setupDemoWorld();
  const stories = await loadStories(StoryList);
  setupDemoWorld({ stories });
  const { el, view, cx } = await draw(new StoryList());
  assert.equal(byId(el, "stories-cut"), null, "a whole read says nothing");
  // The list draws from its own copy of the load (the shared one only starts it).
  const key = Object.keys(view.cache).find((k) => view.cache[k]?.data === stories.data) ?? Object.keys(view.cache)[0];
  view.cache[key] = { ...view.cache[key], data: { ...view.cache[key].data, cut: 1000 } };
  assert.deepEqual(texts(byId(view.render(cx), "stories-cut")), ["Only the first 1,000 items of the board were read: stories further down its order don't show."]);
});
