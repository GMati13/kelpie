// Ordering the groups worked through by time (#141): In progress by last activity, Built / Waiting on
// others by when the work was handed over, the Done group by when it was done, the latest first, those
// with no time after, in the board's order; where the times come from (Jira's dates, a Project's Status
// value, agents' turns, the story shown, pull requests, sessions, paused agents), and that In progress
// moves only when the list loads.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { QUERIES } from "../../mods/kelpie/project.js";
import { saveProfile } from "../../mods/kelpie/config.js";
import { activityOf, build, byDone, movedOf, noteActivity, noteMoved, ordered, settleMoved, sunk, underWay } from "../../mods/kelpie/stories.js";
import { DEMO_PROFILE, DEMO_PROJECT_PROFILE, data, demoData, issue } from "../lib/stories.mjs";

beforeEach(() => mock.reset());

const NOW = Date.now(); // build() drops a time in the future, so the times here are before now
const H = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
// An issue that last moved `hoursAgo` hours ago, as Jira says it (its last change; done: its category's).
const at = (i, hoursAgo) => ({ ...i, fields: { ...i.fields, updated: iso(NOW - hoursAgo * H), statuscategorychangedate: iso(NOW - hoursAgo * H) } });
const keysOf = (list) => list.map((x) => x.it.key);
const sunkKeys = (list) => list.filter((x) => sunk(x.it, x.n)).map((x) => x.it.key);

describe("when a ticket moved", () => {
  test("Jira: a done ticket's status category change is exact; otherwise its last change, a guess", () => {
    const f = (key, extra) => ({ status: { statusCategory: { key } }, statuscategorychangedate: "2026-11-10T10:00:00Z", updated: "2026-11-11T10:00:00Z", ...extra });
    assert.deepEqual(movedOf(f("done"), NOW), { at: Date.parse("2026-11-10T10:00:00Z"), exact: true });
    assert.deepEqual(movedOf(f("indeterminate"), NOW), { at: Date.parse("2026-11-11T10:00:00Z"), exact: false });
  });
  test("a Project's own time is kept as it says", () => {
    assert.deepEqual(movedOf({ moved: { at: "2026-11-12T09:00:00Z", exact: true } }, NOW), { at: Date.parse("2026-11-12T09:00:00Z"), exact: true });
  });
  test("nothing, a date that doesn't parse, or one in the future is no time", () => {
    assert.equal(movedOf({}, NOW), null);
    assert.equal(movedOf({ updated: "yesterday-ish" }, NOW), null);
    assert.equal(movedOf({ updated: iso(NOW + 24 * H) }, NOW), null);
  });
  test("a Project's load asks for its Status value's time, in the constant query", () => {
    for (const q of [QUERIES.user, QUERIES.org]) assert.match(q, /fieldValueByName\(name: "Status"\) \{ \.\.\. on ProjectV2ItemFieldSingleSelectValue \{ optionId name updatedAt \} \}/);
  });
});

describe("Built / Waiting on others", () => {
  // AA-1, BB-1, CC-1 past the handover column (QA), DD-1 in progress; board order AA, BB, CC, DD.
  const board = (times) => data({
    mine: ["AA-1", "BB-1", "CC-1", "DD-1"],
    parents: [["AA-1", "qa"], ["BB-1", "qa"], ["CC-1", "qa"], ["DD-1", "doing"]].map(([k, s]) => (times[k] === undefined ? issue(k, s) : at(issue(k, s), times[k]))),
  });
  const list = (times) => ordered(build(board(times), new Map()));

  test("the most recently handed over first", () => {
    assert.deepEqual(sunkKeys(list({ "AA-1": 30, "BB-1": 2, "CC-1": 10 })), ["BB-1", "CC-1", "AA-1"]);
  });
  test("one the board gives no time for goes after, in the board's order", () => {
    assert.deepEqual(sunkKeys(list({ "BB-1": 5 })), ["BB-1", "AA-1", "CC-1"]);
    assert.deepEqual(sunkKeys(list({})), ["AA-1", "BB-1", "CC-1"], "no times: the board's order");
  });
  test("the other groups keep the board's order, whatever their times", () => {
    const d = data({ mine: ["AA-1", "BB-1"], parents: [at(issue("AA-1", "doing"), 30), at(issue("BB-1", "doing"), 1)] });
    assert.deepEqual(keysOf(ordered(build(d, new Map()))), ["AA-1", "BB-1"]);
  });
  test("a story goes by your subtasks past the handover column, the latest of them", () => {
    const d = data({
      mine: ["S1-2", "S1-3", "S2-2"],
      parents: [issue("S1-1", "doing"), issue("S2-1", "doing")],
      children: [at(issue("S1-2", "qa", "S1-1"), 20), at(issue("S1-3", "done", "S1-1"), 3), at(issue("S1-4", "doing", "S1-1"), 0), at(issue("S2-2", "qa", "S2-1"), 1)],
    });
    const it = build(d, new Map()).find((x) => x.key === "S1-1");
    assert.equal(it.handed.at, NOW - 3 * H, "S1-3's, not the later move of someone else's S1-4");
    assert.deepEqual(sunkKeys(ordered(build(d, new Map()))), ["S2-1", "S1-1"], "S2-1 handed over an hour ago, S1-1 three");
  });
});

describe("a move made from Kelpie", () => {
  test("counts from when it was made, until the board's answer shows it", () => {
    const d = data({ mine: ["AA-1", "BB-1"], parents: [at(issue("AA-1", "qa"), 1), at(issue("BB-1", "doing"), 50)] });
    noteMoved({ id: "p" }, "BB-1", { to: "In QA", category: "indeterminate", toId: "3" }, { kind: "jira" });
    assert.deepEqual(sunkKeys(ordered(build(settleMoved(d), new Map()))), ["BB-1", "AA-1"], "BB-1 just moved");
  });
});

describe("the Done group", () => {
  test("the most recently done first, those with no time after, as they were", () => {
    const d = data({ mine: ["AA-1", "BB-1", "CC-1"], parents: [at(issue("AA-1", "done"), 48), issue("BB-1", "done"), at(issue("CC-1", "done"), 1)] });
    assert.deepEqual(byDone(build(d, new Map(), {}, new Map(), null, { done: true })).map((it) => it.key), ["CC-1", "AA-1", "BB-1"]);
  });
});

describe("the demo", () => {
  for (const [what, profile, exact] of [["a Jira board", DEMO_PROFILE, false], ["a GitHub Project", DEMO_PROJECT_PROFILE, true]]) {
    test(`on ${what}: Waiting on others by handover, Done by when done`, async () => {
      const d = await demoData(profile);
      const all = build(d, new Map(), {}, new Map(), null, { all: true });
      const items = ordered(all.filter((it) => it.key !== "ACME-118"));
      assert.deepEqual(sunkKeys(items).filter((k) => ["ACME-122", "ACME-129", "ACME-116"].includes(k)), ["ACME-122", "ACME-116", "ACME-129"]);
      assert.equal(all.find((x) => x.key === "ACME-129").handed.exact, exact, "a Jira ticket in QA has only its last change");
      assert.deepEqual(byDone(all.filter((x) => ["ACME-118", "ACME-116"].includes(x.key))).map((x) => x.key), ["ACME-116", "ACME-118"]);
    });
  }
});

describe("In progress by last activity", () => {
  // AA-1, BB-1, CC-1 in progress, DD-1 to do; board order AA, BB, CC, DD.
  const board = (active) => ({ ...data({ mine: ["AA-1", "BB-1", "CC-1", "DD-1"], parents: [issue("AA-1", "doing"), issue("BB-1", "doing"), issue("CC-1", "doing"), issue("DD-1")] }), active });
  const going = (d) => ordered(build(d, new Map())).filter((x) => !sunk(x.it, x.n) && underWay(x.it)).map((x) => x.it.key);

  test("the most recently worked on first; never worked on after, in the board's order", () => {
    assert.deepEqual(going(board({ "CC-1": NOW - H, "AA-1": NOW - 5 * H })), ["CC-1", "AA-1", "BB-1"]);
    assert.deepEqual(going(board({})), ["AA-1", "BB-1", "CC-1"]);
  });
  test("a story counts its subtasks' activity", () => {
    const d = { ...data({ mine: ["AA-2", "BB-2"], parents: [issue("AA-1", "doing"), issue("BB-1", "doing")], children: [issue("AA-2", "doing", "AA-1"), issue("BB-2", "doing", "BB-1")] }), active: { "BB-2": NOW - H } };
    assert.deepEqual(going(d), ["BB-1", "AA-1"]);
  });
  test("what needs you keeps its place first, and To do its own order", () => {
    const d = board({ "BB-1": NOW - H, "DD-1": NOW });
    const keys = ordered(build(d, new Map([["CC-1", { status: "blocked" }]]))).map((x) => x.it.key);
    assert.deepEqual(keys, ["CC-1", "BB-1", "AA-1", "DD-1"]);
  });

  describe("what counts, as of a load", () => {
    const profile = { id: "p" };
    const loaded = (extra = {}) => ({ ...data({ mine: ["AA-1", "BB-1", "CC-1", "DD-1"], parents: ["AA-1", "BB-1", "CC-1", "DD-1"].map((k) => issue(k, "doing")) }), ...extra });
    test("what was noted, a pull request changing, a session writing, a paused agent; only loaded tickets", () => {
      mock.state.shared.set("kelpie.stories.active", { p: { "AA-1": NOW - 4 * H, "ZZ-9": NOW } });
      mock.state.shared.set("kelpie.paused", { p: { "DD-1": [{ at: NOW - 3 * H }] } });
      const d = loaded({
        prs: [{ number: 1, title: "BB-1 a change", url: "https://github.com/acme/api/pull/1", updatedAt: iso(NOW - 2 * H), repository: { name: "api" } }],
        sessions: [{ id: "s", title: "work", first: ["CC-1"], updated: NOW - H }],
      });
      assert.deepEqual(activityOf(profile, d, NOW), { "AA-1": NOW - 4 * H, "BB-1": NOW - 2 * H, "CC-1": NOW - H, "DD-1": NOW - 3 * H });
    });
    test("a time in the future or that doesn't parse counts for nothing", () => {
      const d = loaded({ sessions: [{ id: "s", title: "", first: ["AA-1"], updated: NOW + 24 * H }, { id: "t", title: "", first: ["BB-1"], updated: "soon" }] });
      assert.deepEqual(activityOf(profile, d, NOW), {});
    });
  });

  describe("noted as it happens", () => {
    // The tracking copy remembers each agent it saw (by address), so each test has its own agent.
    const setup = (address) => {
      saveProfile("p", { name: "P", folder: "/work/p", jira: { url: "https://acme.atlassian.net/jira/software/projects/A/boards/1", site: "https://acme.atlassian.net", board: 1, keychain: "k" } });
      mock.state.spaces = [{ id: "s1", name: "AA-1", folder: "/work/p" }];
      mock.state.agents = [{ address, space: "s1", tab_name: "AA-2", status: "working" }];
    };
    const noted = () => (mock.state.shared.get("kelpie.stories.active") ?? {}).p ?? {};
    test("an agent's turn starting or ending notes its tab's key; first seen notes nothing", () => {
      setup("t1");
      noteActivity(null, NOW);
      assert.deepEqual(noted(), {}, "first seen");
      mock.state.agents[0].status = "done";
      noteActivity(null, NOW + 1000);
      assert.deepEqual(noted(), { "AA-2": NOW + 1000 });
    });
    test("at most once a minute per ticket, as each write redraws every copy", () => {
      setup("t2");
      noteActivity(null, NOW);
      mock.state.agents[0].status = "done";
      noteActivity(null, NOW + 1000);
      mock.state.agents[0].status = "working";
      noteActivity(null, NOW + 30e3);
      assert.deepEqual(noted(), { "AA-2": NOW + 1000 });
    });
    test("the story the person shows is noted when it's shown", () => {
      setup("t3");
      mock.state.agents = [];
      noteActivity({ profile: { id: "p" }, space: null }, NOW);
      mock.state.shared.set("kelpie.stories.preview", { p: "CC-1" });
      noteActivity({ profile: { id: "p" }, space: null }, NOW + 1000);
      assert.deepEqual(noted(), { "CC-1": NOW + 1000 });
    });
  });

  test("the list moves only when it loads: what's noted after a load waits for the next", () => {
    const d = { ...board({}), active: activityOf({ id: "p" }, board({}), NOW) };
    const before = going(d);
    mock.state.shared.set("kelpie.stories.active", { p: { "CC-1": NOW } });
    assert.deepEqual(going(d), before, "the loaded data's snapshot still decides");
    assert.deepEqual(going({ ...d, active: activityOf({ id: "p" }, d, NOW) })[0], "CC-1", "the next load takes it");
  });
});
