// Working by priority (#122): where a ticket's priority comes from (Jira's priority field and the
// site's levels, a GitHub Project's single-select field), how the story list orders by it (what needs
// you still first, tickets without one last, in the board's order) and marks it, and the profile
// settings that turn each on, both off by default.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { walk } from "gpui-kit";
import { boardOf, buildProfile, needsYes, priorityOf, saveProfile } from "../../mods/kelpie/config.js";
import { loadBoard } from "../../mods/kelpie/board.js";
import { QUERIES } from "../../mods/kelpie/project.js";
import { selectsOf } from "../../mods/kelpie/project-check.js";
import { build, ordered, priorityLook, priorityRanks, suggestSnapshot } from "../../mods/kelpie/stories.js";
import { DEMO_PROFILE, DEMO_PROJECT_PROFILE, data, demoData, issue } from "../lib/stories.mjs";

beforeEach(() => mock.reset());

const LEVELS = [{ id: "1", name: "Highest" }, { id: "2", name: "High" }, { id: "3", name: "Medium" }, { id: "4", name: "Low" }, { id: "5", name: "Lowest" }];
const withPriority = (i, id) => ({ ...i, fields: { ...i.fields, priority: LEVELS.find((l) => l.id === id) } });
const keysOf = (list) => list.map((x) => x.it.key);

describe("a ticket's priority", () => {
  test("is ranked by the board's levels, by id, else by name; none or unknown is null", () => {
    const rank = priorityRanks(LEVELS);
    assert.deepEqual(rank({ id: "2", name: "High" }), { name: "High", rank: 1, of: 5 });
    assert.deepEqual(rank({ id: "renamed", name: "Low" }), { name: "Low", rank: 3, of: 5 }, "by name when the id isn't the board's");
    assert.equal(rank({ id: "9", name: "Blocker" }), null);
    assert.equal(rank(null), null);
    assert.equal(priorityRanks(undefined)({ id: "1", name: "Highest" }), null, "no levels loaded: no priority");
  });
  test("the levels' order is the board's, not guessed from their names", () => {
    // A site whose levels read upside down by name still ranks by its own list.
    const odd = [{ id: "a", name: "Lowest" }, { id: "b", name: "Highest" }];
    assert.equal(priorityRanks(odd)({ id: "a", name: "Lowest" }).rank, 0);
  });
});

describe("ordering by priority", () => {
  // AA-1 Low, BB-1 Highest, CC-1 none, DD-1 High: all in progress; EE-1 Low with an agent waiting.
  const board = () => data({
    mine: ["AA-1", "BB-1", "CC-1", "DD-1", "EE-1"],
    parents: [withPriority(issue("AA-1", "doing"), "4"), withPriority(issue("BB-1", "doing"), "1"), issue("CC-1", "doing"), withPriority(issue("DD-1", "doing"), "2"), withPriority(issue("EE-1", "doing"), "4")],
  });
  const list = (byPriority) => ordered(build({ ...board(), priorities: LEVELS }, new Map([["EE-1", { status: "blocked" }]])), byPriority);

  test("off, the board's order stays (what needs you first)", () => {
    assert.deepEqual(keysOf(list(false)), ["EE-1", "AA-1", "BB-1", "CC-1", "DD-1"]);
  });
  test("on, the highest first in each group, tickets with none last; what needs you stays first", () => {
    assert.deepEqual(keysOf(list(true)), ["EE-1", "BB-1", "DD-1", "AA-1", "CC-1"]);
  });
  test("equal priorities keep the board's order", () => {
    const d = data({ mine: ["AA-1", "BB-1", "CC-1"], parents: [withPriority(issue("AA-1", "doing"), "3"), withPriority(issue("BB-1", "doing"), "3"), withPriority(issue("CC-1", "doing"), "1")] });
    assert.deepEqual(keysOf(ordered(build({ ...d, priorities: LEVELS }, new Map()), true)), ["CC-1", "AA-1", "BB-1"]);
  });
  test("a board without priority is unchanged by the setting", () => {
    const d = board();
    assert.deepEqual(keysOf(ordered(build(d, new Map([["EE-1", { status: "blocked" }]])), true)), keysOf(list(false)));
  });
  test("what's sunk stays after the rest, whatever its priority", () => {
    const d = data({ mine: ["AA-1", "BB-1"], parents: [withPriority(issue("AA-1", "qa"), "1"), withPriority(issue("BB-1", "doing"), "5")] });
    assert.deepEqual(keysOf(ordered(build({ ...d, priorities: LEVELS }, new Map()), true)), ["BB-1", "AA-1"]);
  });
});

describe("the priority mark", () => {
  const look = (rank, of) => priorityLook({ name: "x", rank, of });
  test("up above the middle (the highest doubled, amber), none in the middle, down below", () => {
    assert.deepEqual([0, 1, 2, 3, 4].map((r) => look(r, 5)), [
      { icon: "chevrons-up", color: "working" }, { icon: "chevron-up", color: "muted" }, null,
      { icon: "chevron-down", color: "dim" }, { icon: "chevrons-down", color: "dim" },
    ]);
    assert.deepEqual([0, 1, 2, 3].map((r) => look(r, 4)?.icon), ["chevrons-up", "chevron-up", "chevron-down", "chevrons-down"], "P0-P3 have no middle");
  });
  test("nothing red, and nothing for no priority or a single level", () => {
    for (let r = 0; r < 5; r++) assert.notEqual(look(r, 5)?.color, "blocked");
    assert.equal(priorityLook(null), null);
    assert.equal(look(0, 1), null);
  });
});

describe("the settings", () => {
  test("both off by default; a Project has none without its field", () => {
    assert.deepEqual(priorityOf(DEMO_PROFILE), { order: false, show: false, field: null });
    assert.deepEqual(priorityOf({ project: { byPriority: true, showPriority: true } }), { order: false, show: false, field: null });
    assert.deepEqual(priorityOf({ project: { byPriority: true, priorityField: " Priority " } }), { order: true, show: false, field: "Priority" });
    assert.deepEqual(priorityOf({ jira: { showPriority: true } }), { order: false, show: true, field: null });
  });
  test("true or false only; the field a string; all saved at once, as handover is", () => {
    saveProfile("w", { name: "W", folder: "/w", jira: { url: "https://acme.atlassian.net/jira/software/projects/A/boards/1", site: "https://acme.atlassian.net", board: 1, keychain: "k" } });
    assert.throws(() => buildProfile("w", { jira: { byPriority: "true" } }), /jira\.byPriority: true or false/);
    assert.throws(() => buildProfile("w", { jira: { showPriority: 1 } }), /jira\.showPriority: true or false/);
    assert.equal(buildProfile("w", { jira: { byPriority: true, showPriority: false } }).jira.byPriority, true);
    assert.deepEqual(needsYes("w", { jira: { byPriority: true, showPriority: true } }), []);
    saveProfile("gh", { name: "G", folder: "/g", github: { owner: "acme" }, project: { url: "https://github.com/orgs/acme/projects/3" } });
    assert.equal(buildProfile("gh", { project: { priorityField: "Priority" } }).project.priorityField, "Priority");
    assert.deepEqual(needsYes("gh", { project: { priorityField: "Priority", byPriority: true } }), []);
  });
});

describe("the demo's Jira board", () => {
  test("loads no levels while the profile doesn't use priority", async () => {
    const d = await demoData();
    assert.equal(d.priorities, undefined);
  });
  test("with ordering on: the site's levels in its order, each ticket's own, one without", async () => {
    const d = await demoData({ ...DEMO_PROFILE, jira: { ...DEMO_PROFILE.jira, byPriority: true } });
    assert.deepEqual(d.priorities.map((l) => l.name), ["Highest", "High", "Medium", "Low", "Lowest"]);
    const by = Object.fromEntries([...d.parents, ...d.children].map((i) => [i.key, i.fields.priority?.name ?? null]));
    assert.equal(by["ACME-151"], "Highest");
    assert.equal(by["ACME-173"], "Lowest");
    assert.equal(by["ACME-138"], null);
    const items = ordered(build(d, new Map()), true).map((x) => x.it);
    const it = items.find((x) => x.key === "ACME-151");
    assert.deepEqual(it.priority, { name: "Highest", rank: 0, of: 5 });
    assert.deepEqual(it.subs.find((s) => s.key === "ACME-152").priority, { name: "High", rank: 1, of: 5 }, "subtasks keep their own");
  });
  test("What next?'s snapshot names the levels and each ticket's priority", async () => {
    const profile = { ...DEMO_PROFILE, jira: { ...DEMO_PROFILE.jira, showPriority: true } };
    const d = await demoData(profile);
    const items = ordered(build(d, new Map()), false);
    const text = suggestSnapshot({ data: d, setup: profile, profile }, items, []);
    assert.match(text, /Priority levels, highest first: Highest → High → Medium → Low → Lowest/);
    assert.match(text, /- ACME-151 [^\n]*· priority Highest/);
    assert.match(text, /  - ACME-152 [^\n]*\[In Review\] · priority High/);
    assert.doesNotMatch(text, /- ACME-138 [^\n]*priority/);
  });
});

describe("a GitHub Project's priority field", () => {
  const project = (extra) => ({ ...DEMO_PROJECT_PROFILE, project: { ...DEMO_PROJECT_PROFILE.project, ...extra } });
  test("the field's options are the levels, each issue its value there", async () => {
    const d = await demoData(project({ priorityField: "Priority", showPriority: true }));
    assert.deepEqual(d.priorities.map((l) => l.name), ["Highest", "High", "Medium", "Low", "Lowest"]);
    assert.equal(d.parents.find((i) => i.key === "ACME-175").fields.priority.name, "Highest");
    assert.equal(d.parents.find((i) => i.key === "ACME-138").fields.priority, undefined);
  });
  test("no field named, a field the Project lacks, or the settings off: no priority", async () => {
    for (const extra of [{ showPriority: true }, { priorityField: "Urgency", showPriority: true }, { priorityField: "Priority" }]) {
      const d = await demoData(project(extra));
      assert.ok(!d.priorities?.length, JSON.stringify(extra));
      assert.ok(d.parents.every((i) => !i.fields.priority), JSON.stringify(extra));
    }
  });
  test("the field's name goes as a variable, never into the query's text, and isn't asked for unless used", async () => {
    const calls = [];
    mock.on.exec = (cmd, args) => {
      if (cmd !== "sh" || !String(args[0]).endsWith("/gh.sh")) return undefined;
      calls.push(args.slice(2));
      return { code: 0, stdout: JSON.stringify({ data: { user: { projectV2: { id: "P", title: "T", url: "", field: null, fields: { nodes: [] }, items: { pageInfo: {}, nodes: [] } } } } }), stderr: "" };
    };
    const cfg = { url: "https://github.com/users/alex/projects/3", owner: "alex", ownerType: "user", number: 3 };
    const name = 'Prio" } } evil { x';
    await loadBoard(boardOf({ project: { ...cfg, priorityField: name, byPriority: true }, github: { owner: "acme" } }));
    assert.ok(calls[0].includes(`priority=${name}`) && calls[0].includes("withPriority=true"));
    assert.ok(calls[0].includes(`query=${QUERIES.user}`), "the constant query");
    assert.ok(!QUERIES.user.includes(name));
    calls.length = 0;
    await loadBoard(boardOf({ project: { ...cfg, priorityField: name }, github: { owner: "acme" } }));
    assert.ok(!calls[0].some((a) => a.startsWith("priority=") || a.startsWith("withPriority=")), "off: not asked for");
  });
  test("Check lists the single-select fields but Status, with their options in order", () => {
    assert.deepEqual(selectsOf([
      { __typename: "ProjectV2SingleSelectField", name: "Status", options: [{ name: "Todo" }] },
      { __typename: "ProjectV2SingleSelectField", name: "Priority", options: [{ name: "P0" }, { name: "P1\u0007" }] },
      { __typename: "ProjectV2IterationField", name: "Sprint" },
      {},
    ]), [{ name: "Priority", levels: ["P0", "P1"] }]);
  });
});

describe("the story list's rows", async () => {
  const { setupDemoWorld, loadStories, draw, demoProfile } = await import("../lib/views.mjs");
  const { StoryList } = await import("../../mods/kelpie/stories.js");
  const ids = (el) => walk(el).map((n) => n.calls.find(([m]) => m === "id")?.[1][0]).filter((id) => typeof id === "string");
  const drawn = async (jira) => {
    const profile = { jira: { ...demoProfile().jira, ...jira } };
    setupDemoWorld({ profile });
    const stories = await loadStories(StoryList);
    setupDemoWorld({ profile, stories });
    return ids((await draw(new StoryList())).el);
  };
  test("show the mark after the key only while Show priority is on", async () => {
    assert.ok(!(await drawn({ byPriority: true })).some((id) => id.startsWith("prio-")), "off: no marks");
    const on = await drawn({ showPriority: true });
    assert.ok(on.includes("prio-ACME-175"), "Highest is marked");
    assert.ok(!on.includes("prio-ACME-160"), "Medium, the middle, isn't");
  });
  test("are ordered by priority within a group while ordering is on", async () => {
    const rows = (list) => list.filter((id) => /^story-ACME-\d+$/.test(id));
    const off = rows(await drawn({})), on = rows(await drawn({ byPriority: true }));
    assert.deepEqual([...on].sort(), [...off].sort(), "the same stories");
    assert.notDeepEqual(on, off, "in another order");
  });
});
