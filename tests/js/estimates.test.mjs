// To do's and In progress's time estimates, weighed against the time left in the sprint (#90):
// estimates.js, and the estimates build() carries from the board (stories.js), the sprints' ends
// (sprint.js boardScope(), project.js) and the hours a day a profile can set (config.js).
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { DEFAULT_HOURS, estimateOf, hoursPerDay, hoursText, iterationEnd, lastDay, sprintSums, timeLeft, workLeft } from "../../mods/kelpie/estimates.js";
import { build, sunk, underWay } from "../../mods/kelpie/stories.js";
import { boardScope } from "../../mods/kelpie/sprint.js";
import { buildProfile } from "../../mods/kelpie/config.js";
import { data, issue } from "../lib/stories.mjs";

beforeEach(() => mock.reset());

const H = 3600;
// An issue with time estimates, in hours: `remaining` (Jira's timeestimate), `original`.
const est = (i, original = null, remaining = null) => ({ ...i, fields: { ...i.fields, ...(original != null ? { timeoriginalestimate: original * H } : {}), ...(remaining != null ? { timeestimate: remaining * H } : {}) } });
const items = (d) => Object.fromEntries(build(d, new Map()).map((it) => [it.key, it]));
// Tuesday 10 November 2026, 10:00 where the tests run.
const TUESDAY = new Date(2026, 10, 10, 10);

describe("hoursText: hours and minutes, never days", () => {
  test("minutes alone, hours alone, both", () => {
    assert.equal(hoursText(45 * 60), "45m");
    assert.equal(hoursText(6 * H), "6h");
    assert.equal(hoursText(6.5 * H), "6h 30m");
  });
  test("a sprint's worth stays in hours", () => {
    assert.equal(hoursText(38 * H), "38h");
    assert.equal(hoursText(200 * H), "200h");
  });
  test("rounded to the minute, minutes left out when zero", () => {
    assert.equal(hoursText(6 * H + 29), "6h");
    assert.equal(hoursText(6 * H + 31), "6h 1m");
    assert.equal(hoursText(0), "0h");
  });
});

describe("estimateOf: the remaining estimate first", () => {
  test("remaining wins over the original, even at zero", () => {
    assert.equal(estimateOf({ timeestimate: 2 * H, timeoriginalestimate: 8 * H }), 2 * H);
    assert.equal(estimateOf({ timeestimate: 0, timeoriginalestimate: 8 * H }), 0);
  });
  test("else the original; none: null", () => {
    assert.equal(estimateOf({ timeoriginalestimate: 8 * H }), 8 * H);
    assert.equal(estimateOf({}), null);
    assert.equal(estimateOf({ timeestimate: "8h", timeoriginalestimate: -1 }), null);
  });
  test("a board that estimates only in story points has none", () => {
    assert.equal(estimateOf({ customfield_10016: 5, story_points: 5 }), null);
  });
});

describe("workLeft: what a group's stories still hold", () => {
  test("a story's own estimate wins over its subtasks'", () => {
    const d = data({ parents: [est(issue("ABC-1"), 10)], children: [est(issue("ABC-2", "todo", "ABC-1"), 3)], mine: ["ABC-2"] });
    assert.equal(workLeft([items(d)["ABC-1"]]).seconds, 10 * H);
  });
  test("without one, its unfinished subtasks of yours, not others'", () => {
    const d = data({ parents: [issue("ABC-1")], children: [est(issue("ABC-2", "todo", "ABC-1"), 3), est(issue("ABC-3", "doing", "ABC-1"), 8, 2), est(issue("ABC-4", "todo", "ABC-1"), 5)], mine: ["ABC-2", "ABC-3"] });
    assert.deepEqual(workLeft([items(d)["ABC-1"]]), { seconds: 5 * H, stories: 1, missing: 0 });
  });
  test("only work not done and not at or past the handover column", () => {
    const d = data({ parents: [issue("ABC-1", "doing")], children: [est(issue("ABC-2", "doing", "ABC-1"), 3), est(issue("ABC-3", "qa", "ABC-1"), 8), est(issue("ABC-4", "done", "ABC-1"), 5)], mine: ["ABC-2", "ABC-3", "ABC-4"] });
    assert.equal(workLeft([items(d)["ABC-1"]]).seconds, 3 * H, "the subtask in QA (the handover column) and the done one count for nothing");
  });
  test("a story past the handover column itself goes by its subtasks", () => {
    const d = data({ parents: [est(issue("ABC-1", "qa"), 20)], children: [est(issue("ABC-2", "doing", "ABC-1"), 3)], mine: ["ABC-2"] });
    assert.equal(workLeft([items(d)["ABC-1"]]).seconds, 3 * H);
  });
  test("a task without subtasks counts its own", () => {
    const d = data({ parents: [est(issue("ABC-7"), 4)], mine: ["ABC-7"] });
    assert.equal(workLeft([items(d)["ABC-7"]]).seconds, 4 * H);
  });
  test("tickets without an estimate are counted apart", () => {
    const d = data({ parents: [issue("ABC-1"), est(issue("ABC-7"), 4), issue("ABC-8")], children: [est(issue("ABC-2", "todo", "ABC-1"), 3), issue("ABC-3", "todo", "ABC-1")], mine: ["ABC-2", "ABC-3", "ABC-7", "ABC-8"] });
    const all = items(d);
    assert.deepEqual(workLeft([all["ABC-1"], all["ABC-7"], all["ABC-8"]]), { seconds: 7 * H, stories: 3, missing: 2 });
  });
  test("no time estimates at all: nothing", () => {
    const d = data({ parents: [issue("ABC-1")], children: [issue("ABC-2", "todo", "ABC-1")], mine: ["ABC-2"] });
    assert.equal(workLeft([items(d)["ABC-1"]]), null);
    assert.equal(workLeft([]), null);
  });
});

describe("timeLeft: working days to the sprint's end × hours a day", () => {
  test("weekdays from today, today included, to the last day", () => {
    const left = timeLeft([{ id: 1, name: "S", end: "2026-11-13" }], 6, TUESDAY);
    assert.equal(left.days, 4, "Tue, Wed, Thu, Fri");
    assert.equal(left.seconds, 24 * H);
  });
  test("weekends don't count", () => {
    assert.equal(timeLeft([{ end: "2026-11-17" }], 6, TUESDAY).days, 6, "this week's four, Monday and Tuesday next");
  });
  test("hours a day count", () => {
    assert.equal(timeLeft([{ end: "2026-11-13" }], 7.5, TUESDAY).seconds, 30 * H);
  });
  test("a sprint whose end passed has none", () => {
    assert.equal(timeLeft([{ end: "2026-11-09" }], 6, TUESDAY).seconds, 0);
  });
  test("no end date (a Kanban board, a Project with no iteration field): null", () => {
    assert.equal(timeLeft([{ id: null, name: "Board", kanban: true }], 6, TUESDAY), null);
    assert.equal(timeLeft([], 6, TUESDAY), null);
  });
  test("with several sprints, the latest end", () => {
    assert.equal(timeLeft([{ end: "2026-11-11" }, { end: "2026-11-13" }], 6, TUESDAY).days, 4);
  });
});

describe("the sprints' ends", () => {
  test("a Jira sprint's last day is its endDate's day; one ending at midnight ends the day before", () => {
    assert.equal(lastDay(new Date(2026, 10, 13, 17).toISOString()), "2026-11-13");
    assert.equal(lastDay(new Date(2026, 10, 14, 0, 0).toISOString()), "2026-11-13");
    assert.equal(lastDay(undefined), null);
  });
  test("boardScope keeps each active sprint's end", () => {
    const { sprints } = boardScope({ body: { values: [{ id: 3, name: "Sprint 3", endDate: new Date(2026, 10, 13, 17).toISOString() }, { id: 4, name: "Sprint 4" }] } }, {});
    assert.deepEqual(sprints, [{ id: 3, name: "Sprint 3", end: "2026-11-13" }, { id: 4, name: "Sprint 4" }]);
  });
  test("a Project iteration ends its duration's last day", () => {
    assert.equal(iterationEnd("2026-11-03", 11), "2026-11-13");
    assert.equal(iterationEnd("2026-11-03", 14), "2026-11-16");
    assert.equal(iterationEnd("2026-11-03", 0), null);
  });
});

describe("sprintSums: what To do and In progress say", () => {
  const sprint = [{ id: 1, name: "S", end: "2026-11-13" }]; // 4 working days left from TUESDAY
  const story = (key, hours, extra = {}) => ({ key, story: false, estimate: hours == null ? null : hours * H, unfinished: true, subs: [], ...extra });

  test("no end date: the sum alone, its tooltip saying what's counted", () => {
    const { toDo } = sprintSums([story("A-1", 12), story("A-2", 6), story("A-3", null), story("A-4", null)], [], [{ kanban: true }], 6, TUESDAY);
    assert.equal(toDo.text, "18h");
    assert.equal(toDo.over, false);
    assert.equal(toDo.tip, "18h over 4 stories in To do; 2 tickets not estimated");
  });
  test("weighed against the time left, nothing in progress", () => {
    const { toDo } = sprintSums([story("A-1", 18)], [], sprint, 6, TUESDAY);
    assert.equal(toDo.text, "18h of 24h left");
    assert.equal(toDo.over, false);
    assert.match(toDo.tip, /about 24h of working time left until Fri 13 Nov \(4 working days × 6h, Monday to Friday, today included\)/);
  });
  test("more work than time: over, saying by how much", () => {
    const { toDo } = sprintSums([story("A-1", 30)], [], sprint, 6, TUESDAY);
    assert.equal(toDo.over, true);
    assert.match(toDo.tip, /about 6h more than fits/);
  });
  test("To do weighs against the time left minus In progress's sum", () => {
    const { toDo, going } = sprintSums([story("A-1", 18)], [story("A-5", 9.5), story("A-6", null), story("A-7", null, { pr: true })], sprint, 6, TUESDAY);
    assert.equal(going.text, "9h 30m");
    assert.equal(going.tip, "9h 30m still to do on 3 stories in progress; 1 ticket not estimated");
    assert.equal(toDo.text, "18h of 14h 30m free");
    assert.equal(toDo.over, true);
    assert.match(toDo.tip, /9h 30m of it goes to what's in progress, about 14h 30m is free for To do: about 3h 30m more than fits/);
  });
  test("In progress's work fitting leaves To do within it", () => {
    assert.equal(sprintSums([story("A-1", 10)], [story("A-5", 9.5)], sprint, 6, TUESDAY).toDo.over, false);
  });
  test("a sprint past its end has no time", () => {
    const { toDo } = sprintSums([story("A-1", 2)], [], [{ end: "2026-11-09" }], 6, TUESDAY);
    assert.equal(toDo.text, "2h of 0h left");
    assert.equal(toDo.over, true);
    assert.match(toDo.tip, /no working time left/);
  });
  test("no time estimates: nothing extra in either heading", () => {
    assert.deepEqual(sprintSums([story("A-1", null)], [story("A-5", null)], sprint, 6, TUESDAY), { toDo: null, going: null });
  });
});

describe("the groups' sums, built from the board", () => {
  // ABC-1 not started (To do), ABC-5 under way (In progress), from the same board.
  const d = data({
    parents: [issue("ABC-1"), issue("ABC-5", "doing")],
    children: [est(issue("ABC-2", "todo", "ABC-1"), 6), est(issue("ABC-6", "doing", "ABC-5"), 8, 4), est(issue("ABC-7", "todo", "ABC-5"), 3), est(issue("ABC-8", "qa", "ABC-5"), 5)],
    mine: ["ABC-2", "ABC-6", "ABC-7", "ABC-8"],
  });
  const all = build(d, new Map()).map((it) => ({ it, n: [9] }));
  const toDo = all.filter((x) => !sunk(x.it, x.n) && !underWay(x.it)).map((x) => x.it);
  const going = all.filter((x) => !sunk(x.it, x.n) && underWay(x.it)).map((x) => x.it);
  test("the sum counts only To do's stories; an In progress story's not-started subtask never", () => {
    assert.deepEqual(toDo.map((it) => it.key), ["ABC-1"]);
    const sums = sprintSums(toDo, going, [{ kanban: true }], 6, TUESDAY);
    assert.equal(sums.toDo.text, "6h");
    assert.equal(sums.going.text, "7h", "ABC-6's remaining 4h and ABC-7's 3h; ABC-8 in QA counts for nothing");
  });
});

describe("hoursPerDay: a profile setting under the board", () => {
  test("the board's own, else the default", () => {
    assert.equal(DEFAULT_HOURS, 6);
    assert.equal(hoursPerDay({ cfg: { hoursPerDay: 7.5 } }), 7.5);
    assert.equal(hoursPerDay({ cfg: {} }), 6);
    assert.equal(hoursPerDay(null), 6);
    assert.equal(hoursPerDay({ cfg: { hoursPerDay: "8" } }), 6, "only a number");
    assert.equal(hoursPerDay({ cfg: { hoursPerDay: 30 } }), 6, "a day has 24 hours");
  });
  test("an agent's change takes a number of hours, saved as it is", () => {
    mock.state.shared.set("kelpie.profiles", { p: { id: "p", name: "P", folder: "/tmp/p", jira: { url: "https://acme.atlassian.net/jira/software/projects/A/boards/1", keychain: "k" } } });
    assert.equal(buildProfile("p", { jira: { hoursPerDay: 7.5 } }).jira.hoursPerDay, 7.5);
    assert.equal(buildProfile("p", { jira: { hoursPerDay: null } }).jira.hoursPerDay, undefined);
    for (const bad of ["7", 0, -2, 25]) assert.throws(() => buildProfile("p", { jira: { hoursPerDay: bad } }), /jira\.hoursPerDay: a number of hours/, String(bad));
  });
});
