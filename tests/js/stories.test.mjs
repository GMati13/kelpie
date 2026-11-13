// Story building (stories.js build() and what it feeds: keyIn, need, ordered, sunk, progress) and the
// pull request states (ui.js prState): what the sidebar lists, in which order, and what it says.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { agentsByKey, askFor, build, finished, keyIn, lastSessions, need, needQueue, noneToDo, ordered, underWay, progress, projectsOf, pullsOf, settleTalking, suggestSnapshot, sunk } from "../../mods/kelpie/stories.js";
import { sunkWords } from "../../mods/kelpie/config.js";
import { prState } from "../../mods/kelpie/ui.js";
import { COLUMNS, DEMO_PROFILE, DEMO_PROJECT_PROFILE, data, demoData, issue, pr } from "../lib/stories.mjs";

beforeEach(() => mock.reset());

const byKey = (items) => Object.fromEntries(items.map((it) => [it.key, it]));
const keys = (list) => list.map((x) => x.it?.key ?? x.key);

describe("keyIn: the ticket a title names", () => {
  const known = new Set(["ABC"]);
  test("a key of one of the board's projects counts, the first one", () => {
    assert.equal(keyIn("ABC-12 and ABC-13: fix login", known), "ABC-12");
    assert.equal(keyIn("Fix login (ABC-7)", known), "ABC-7");
  });
  test("UTF-8 or SHA-256 in a title isn't a ticket once the projects are known", () => {
    assert.equal(keyIn("Read UTF-8 names", known), null);
    assert.equal(keyIn("Use SHA-256 for ABC-4", known), "ABC-4");
  });
  test("a leading [KEY] counts whatever its project", () => {
    assert.equal(keyIn("[OPS-3] Rotate the keys", known), "OPS-3");
    assert.equal(keyIn("  [OPS-3] ABC-1", known), "OPS-3");
    assert.equal(keyIn("Rotate the keys [OPS-3]", known), null, "only a leading tag");
  });
  test("with no project known yet, any key counts", () => {
    assert.equal(keyIn("Read UTF-8 names", new Set()), "UTF-8");
    assert.equal(keyIn("Read UTF-8 names"), "UTF-8");
    assert.equal(keyIn(null, known), null);
  });
  test("projectsOf: the projects of every issue the load has", () => {
    const d = data({ mine: ["ABC-2"], parents: [issue("ABC-1")], children: [issue("XY-9", "todo", "ABC-1")] });
    assert.deepEqual([...projectsOf(d)].sort(), ["ABC", "XY"]);
  });
});

describe("build: stories from issues and subtasks", () => {
  const board = (over = {}) => data({
    mine: ["ABC-2", "ABC-3", "ABC-10"],
    parents: [issue("ABC-1", "doing"), issue("ABC-10", "doing")],
    children: [issue("ABC-2", "doing", "ABC-1"), issue("ABC-3", "todo", "ABC-1"), issue("ABC-4", "done", "ABC-1")],
    ...over,
  });
  test("a story holds its subtasks, in order, marking yours", () => {
    const { "ABC-1": s } = byKey(build(board(), new Map()));
    assert.equal(s.story, true);
    assert.equal(s.title, "ABC-1 title");
    assert.deepEqual(s.subs.map((x) => [x.key, x.mine]), [["ABC-2", true], ["ABC-3", true], ["ABC-4", false]]);
  });
  test("a task without subtasks stands alone, as its own single sub", () => {
    const { "ABC-10": t } = byKey(build(board(), new Map()));
    assert.equal(t.story, false);
    assert.deepEqual(t.subs.map((x) => x.key), ["ABC-10"]);
  });
  test("the board's order is kept", () => {
    assert.deepEqual(build(board(), new Map()).map((it) => it.key), ["ABC-1", "ABC-10"]);
  });
  test("a finished story leaves, unless it has a space or an open pull request", () => {
    const d = (prs = []) => data({ mine: ["ABC-1"], parents: [issue("ABC-1", "done")], prs });
    assert.deepEqual(build(d(), new Map()), []);
    assert.deepEqual(build(d([pr("ABC-1 x", { merged: true })]), new Map()), []);
    assert.equal(build(d([pr("ABC-1 x")]), new Map()).length, 1);
    assert.equal(build(d(), new Map(), {}, new Map([["ABC-1", { id: "s1" }]])).length, 1);
  });
  test("with `done`, the finished stories the list leaves out instead, still reachable", () => {
    const d = data({ mine: ["ABC-1", "ABC-5", "ABC-7", "ABC-8"], prs: [pr("ABC-1 x", { merged: true }), pr("ABC-7 y")],
      parents: [issue("ABC-1", "done"), issue("ABC-5", "doing"), issue("ABC-7", "done"), issue("ABC-8", "done")] });
    const spaces = new Map([["ABC-8", { id: "s8" }]]);
    assert.deepEqual(build(d, new Map(), {}, spaces).map((it) => it.key), ["ABC-5", "ABC-7", "ABC-8"], "an open pull request or a space keeps one in the list");
    assert.deepEqual(build(d, new Map(), {}, spaces, null, { done: true }).map((it) => it.key), ["ABC-1"], "done, nothing open: the Done group's");
  });
});

describe("build: pull requests attach by the key in their title", () => {
  const d = (prs) => data({ mine: ["ABC-2"], parents: [issue("ABC-1", "doing")], children: [issue("ABC-2", "doing", "ABC-1")], prs });
  test("a subtask's key attaches to that subtask, the story's to the story", () => {
    const [s] = build(d([pr("ABC-2 Login form", { number: 1 }), pr("ABC-1: shared bits", { number: 2 })]), new Map());
    assert.deepEqual(s.subs[0].prs.map((p) => [p.number, p.key]), [[1, "ABC-2"]]);
    assert.deepEqual(s.prs.map((p) => [p.number, p.key]), [[2, "ABC-1"]]);
  });
  test("a task's pull requests go on its single sub", () => {
    const [t] = build(data({ mine: ["ABC-9"], parents: [issue("ABC-9", "doing")], prs: [pr("ABC-9 fix")] }), new Map());
    assert.equal(t.prs.length, 0);
    assert.equal(t.subs[0].prs.length, 1);
  });
  test("an open one for a ticket not in the list is its own row, after the board's, never sunk", () => {
    const items = build(d([pr("ABC-77 Elsewhere", { number: 7 }), pr("[OPS-3] Rotate keys", { number: 8 })]), new Map());
    assert.deepEqual(items.map((it) => it.key), ["ABC-1", "ABC-77", "OPS-3"]);
    const { "OPS-3": ops } = byKey(items);
    assert.equal(ops.title, "Rotate keys", "the [KEY] tag is left out of the title");
    assert.deepEqual([ops.pr, ops.sunk, ops.story, ops.type], [true, false, false, "Pull request"]);
  });
  test("a merged one for a ticket not in the list makes no row", () => {
    assert.deepEqual(build(d([pr("ABC-77 Elsewhere", { merged: true })]), new Map()).map((it) => it.key), ["ABC-1"]);
  });
  test("a title naming no ticket of the board (UTF-8) attaches nowhere and shows on its own", () => {
    const dd = d([pr("Read UTF-8 file names", { number: 5 })]);
    const [s] = build(dd, new Map());
    assert.equal(s.subs[0].prs.length + s.prs.length, 0);
    assert.deepEqual(pullsOf(dd).map((it) => it.key), ["pull:api#5"]);
  });
});

describe("build and agentsByKey: agents and sessions", () => {
  const profile = { id: "w", name: "W", folder: "/w" };
  beforeEach(() => {
    mock.state.shared.set("kelpie.profiles", { w: profile });
    mock.state.spaces = [{ id: "s1", name: "ABC-1", folder: "/w", tabs: [] }, { id: "s2", name: "Elsewhere", folder: "/other", tabs: [] }];
  });
  test("an agent counts for the key its tab names, else for its space's story", () => {
    mock.state.agents = [{ space: "s1", tab_name: "ABC-2", status: "idle" }, { space: "s1", tab_name: "Terminal", status: "working" }];
    const map = agentsByKey(profile);
    assert.equal(map.get("ABC-2").status, "idle");
    assert.equal(map.get("ABC-1").status, "working");
  });
  test("a blocked agent outranks the others on its key", () => {
    mock.state.agents = [{ space: "s1", tab_name: "x", status: "working" }, { space: "s1", tab_name: "y", status: "blocked" }, { space: "s1", tab_name: "z", status: "done" }];
    assert.equal(agentsByKey(profile).get("ABC-1").status, "blocked");
  });
  test("another profile's spaces don't count", () => {
    mock.state.agents = [{ space: "s2", tab_name: "ABC-2", status: "working" }];
    assert.equal(agentsByKey(profile).size, 0);
  });
  test("build puts each agent on its key; one open hides that key's paused entry and last session", () => {
    const d = data({ mine: ["ABC-2", "ABC-3"], parents: [issue("ABC-1", "doing")], children: [issue("ABC-2", "doing", "ABC-1"), issue("ABC-3", "doing", "ABC-1")],
      sessions: [{ id: "a", title: "x", first: ["ABC-2"], updated: 2 }, { id: "b", title: "Work on ABC-3", first: [], updated: 1 }] });
    const agent = { status: "working" };
    const [s] = build(d, new Map([["ABC-2", agent]]), { "ABC-2": [{ sessionId: "p" }], "ABC-3": [{ sessionId: "q" }] });
    assert.equal(s.subs[0].agent, agent);
    assert.equal(s.subs[0].paused, null);
    assert.equal(s.subs[0].last, null);
    assert.deepEqual(s.subs[1].paused, [{ sessionId: "q" }]);
    assert.equal(s.subs[1].last, null, "a paused key offers Resume, not its last session");
  });
  test("lastSessions: the newest not-running session on each key, from its first message or its title", () => {
    const list = [{ id: "run", running: true, first: ["ABC-1"] }, { id: "new", first: ["ABC-1"], title: "" }, { id: "old", first: ["ABC-1"] }, { id: "t", first: [], title: "Look at ABC-2 and UTF-8" }];
    const map = lastSessions(list, new Set(["ABC"]));
    assert.equal(map.get("ABC-1").id, "new");
    assert.equal(map.get("ABC-2").id, "t");
    assert.equal(map.has("UTF-8"), false);
  });
});

describe("need: what a story needs from you, most urgent first", () => {
  const story = (prs = [], agent = null, paused = null) => build(data({ mine: ["ABC-2"], parents: [issue("ABC-1", "doing")], children: [issue("ABC-2", "doing", "ABC-1")], prs }),
    agent ? new Map([["ABC-2", agent]]) : new Map(), paused ? { "ABC-2": paused } : {})[0];
  const rank = (it) => need(it)[0];
  test("an agent waiting for you comes first, whatever its pull requests say", () => {
    const it = story([pr("ABC-2 x", { review: "CHANGES_REQUESTED", checks: "FAILURE" })], { status: "blocked" });
    assert.deepEqual(need(it), [0, "ABC-2's agent needs you", "working"]);
  });
  test("changes requested before failing checks, before ready to merge", () => {
    assert.equal(rank(story([pr("ABC-2 x", { checks: "FAILURE", number: 1 }), pr("ABC-2 y", { review: "CHANGES_REQUESTED", number: 2 })])), 1);
    assert.match(need(story([pr("ABC-2 y", { review: "CHANGES_REQUESTED", number: 2 })]))[1], /^Changes requested on ABC-2 \(api#2\)$/);
    assert.equal(rank(story([pr("ABC-2 x", { checks: "FAILURE", number: 1 }), pr("ABC-2 y", { checks: "SUCCESS", review: "APPROVED", number: 2 })])), 2);
    assert.equal(rank(story([pr("ABC-2 x", { checks: "ERROR" })])), 2);
    assert.deepEqual(need(story([pr("ABC-2 x", { checks: "SUCCESS", review: "APPROVED" })])), [3, "Approved, checks pass · ready to merge", "done"]);
  });
  test("an approved pull request in a repo with no checks is ready to merge too", () => {
    assert.deepEqual(need(story([pr("ABC-2 x", { review: "APPROVED" })])), [3, "Approved, no checks · ready to merge", "done"]);
  });
  test("ready to merge needs checks passing (or none), an approval and no draft", () => {
    assert.equal(rank(story([pr("ABC-2 x", { checks: "PENDING", review: "APPROVED" })])), 6);
    assert.equal(rank(story([pr("ABC-2 x", { checks: "SUCCESS", review: "APPROVED", draft: true })])), 6);
    assert.equal(rank(story([pr("ABC-2 x", { checks: "SUCCESS" })])), 6);
  });
  test("merged pull requests need nothing", () => {
    assert.equal(rank(story([pr("ABC-2 x", { checks: "FAILURE", merged: true })])), 6);
  });
  test("then an agent working, the rest, and paused stories", () => {
    assert.equal(rank(story([], { status: "working" })), 5);
    assert.deepEqual(need(story()), [6, "1 subtask · 1 in progress", "dim"]);
    assert.equal(rank(story([], null, [{ sessionId: "p" }])), 7);
    assert.match(need(story([pr("ABC-2 x", { checks: "FAILURE" })], null, [{ sessionId: "p" }]))[1], /^Paused · Checks failing/);
  });
});

describe("ordered and needQueue: the list's order and Next's", () => {
  // In board order: A (nothing), B (ready to merge), C (sunk), D (changes requested), E (agent waiting).
  const items = () => build(data({
    mine: ["AA-1", "BB-1", "CC-1", "DD-1", "EE-1"],
    parents: [issue("AA-1", "doing"), issue("BB-1", "doing"), issue("CC-1", "qa"), issue("DD-1", "doing"), issue("EE-1", "doing")],
    prs: [pr("BB-1 x", { checks: "SUCCESS", review: "APPROVED", number: 1 }), pr("DD-1 y", { review: "CHANGES_REQUESTED", number: 2 })],
  }), new Map([["EE-1", { status: "blocked" }]]));
  test("what needs you first, then the rest, then what's sunk, each in the board's order", () => {
    assert.deepEqual(keys(ordered(items())), ["BB-1", "DD-1", "EE-1", "AA-1", "CC-1"]);
  });
  test("Next goes by urgency, then the reviews", () => {
    const review = { key: "review:web#3" };
    assert.deepEqual(keys(needQueue(ordered(items()), [review])), ["EE-1", "DD-1", "BB-1", "review:web#3"]);
  });
  test("a sunk story that needs you isn't sunk", () => {
    const [it] = build(data({ mine: ["CC-1"], parents: [issue("CC-1", "qa")], prs: [pr("CC-1 x", { checks: "FAILURE" })] }), new Map());
    assert.equal(it.sunk, true);
    assert.equal(sunk(it), false);
    assert.deepEqual(keys(ordered([it])), ["CC-1"]);
  });
});

describe("what the sunk group says", () => {
  test("with a team, they wait on others", () => {
    assert.deepEqual(sunkWords({ cfg: {} }), { heading: "Waiting on others" });
    assert.equal(sunkWords(null).heading, "Waiting on others", "no board");
  });
  test("working alone, nobody else has them: they're built, whatever the columns are called", () => {
    assert.deepEqual(sunkWords({ cfg: { solo: true } }), { heading: "Built" });
  });
});

// KELPIE-123: a story handed over (or done) whose agent the person is still talking to stays at hand,
// in In progress, until its agent has been quiet a while; its board status doesn't change.
describe("a handed-over story still being talked to", () => {
  const profile = { id: "w", name: "W", folder: "/w" };
  beforeEach(() => {
    mock.state.shared.set("kelpie.profiles", { w: profile });
    mock.state.spaces = [{ id: "s1", name: "ABC-1", folder: "/w", tabs: [] }, { id: "s9", name: "ABC-9", folder: "/w", tabs: [] }];
  });
  const agent = (status, tab = "ABC-2", space = "s1") => ({ address: `t-${tab}`, space, tab_name: tab, status });
  // ABC-1's subtask of yours is in QA (handed over); ABC-9 is a story in progress.
  const items = (status = "qa") => build(data({ mine: ["ABC-2", "ABC-9"], parents: [issue("ABC-1", "doing"), issue("ABC-9", "doing")], children: [issue("ABC-2", status, "ABC-1")] }), agentsByKey(profile));
  const it = (status) => items(status)[0];
  for (const status of ["working", "blocked", "done"]) {
    test(`its agent ${status}: not sunk, in progress, its board status unchanged`, () => {
      mock.state.agents = [agent(status)];
      const story = it();
      assert.equal(story.sunk, true, "handed over on the board");
      assert.equal(sunk(story), false);
      assert.equal(underWay(story), true);
      assert.equal(story.subs[0].status, "In QA");
      assert.deepEqual(keys(ordered(items())).at(-1), "ABC-9", "not after the stories in progress");
    });
  }
  test("the row says why it's here", () => {
    mock.state.agents = [agent("done")];
    const [rank, line, color] = need(it());
    assert.equal(rank, 6, "it needs nothing of you");
    assert.match(line, /^Its agent finished a turn · /);
    assert.equal(color, "accent");
    mock.state.agents = [agent("idle")];
    mock.state.shared.set("kelpie.talking", { "t-ABC-2": Date.now() - 60_000 });
    assert.match(need(it())[1], /^Still talking to its agent · /);
  });
  test("an agent only ever seen idle isn't talked to: the story sinks", () => {
    mock.state.agents = [agent("idle")];
    settleTalking();
    assert.equal(sunk(it()), true);
    assert.equal(mock.sharedValue("kelpie.talking"), null, "nothing noted");
  });
  test("once quiet it stays at hand a while, then sinks again", () => {
    const t0 = Date.now();
    mock.state.agents = [agent("working")];
    settleTalking(t0);
    assert.deepEqual(mock.sharedValue("kelpie.talking"), { "t-ABC-2": 0 });
    mock.state.agents = [agent("idle")];
    settleTalking(t0);
    assert.deepEqual(mock.sharedValue("kelpie.talking"), { "t-ABC-2": t0 }, "noted when it went quiet");
    assert.equal(sunk(it()), false, "just went quiet: still at hand");
    settleTalking(t0 + 14 * 60_000);
    assert.deepEqual(mock.sharedValue("kelpie.talking"), { "t-ABC-2": t0 }, "kept, not rewritten");
    settleTalking(t0 + 16 * 60_000);
    assert.deepEqual(mock.sharedValue("kelpie.talking"), {}, "dropped once quiet for long");
    assert.equal(sunk(it()), true, "back with the handed-over stories");
  });
  test("talking again starts it over; a terminal gone is forgotten", () => {
    mock.state.shared.set("kelpie.talking", { "t-ABC-2": Date.now() - 60_000, "t-gone": 0 });
    mock.state.agents = [agent("working")];
    settleTalking();
    assert.deepEqual(mock.sharedValue("kelpie.talking"), { "t-ABC-2": 0 });
  });
  test("any agent on the story counts, not only the one its row shows", () => {
    mock.state.agents = [agent("idle", "ABC-2"), { ...agent("working", "Notes"), address: "t-notes" }];
    assert.equal(sunk(it()), false);
  });
  test("a done story whose agent is still talked to stays out of the Done group", () => {
    // Its agent's tab named after it in another space of the profile; the story has no space here.
    mock.state.spaces = [{ id: "s2", name: "Desk", folder: "/w", tabs: [] }];
    const d = data({ mine: ["ABC-5"], parents: [issue("ABC-5", "done")] });
    const listed = () => build(d, agentsByKey(profile)).map((x) => x.key);
    const doneGroup = () => build(d, agentsByKey(profile), {}, new Map(), null, { done: true }).map((x) => x.key);
    mock.state.agents = [agent("idle", "ABC-5", "s2")];
    assert.deepEqual([listed(), doneGroup()], [[], ["ABC-5"]]);
    mock.state.agents = [agent("done", "ABC-5", "s2")];
    assert.deepEqual([listed(), doneGroup()], [["ABC-5"], []]);
  });
  test("renaming its agent's tab after another key moves the conversation to that story", () => {
    mock.state.agents = [agent("working", "ABC-9")];
    const [one, nine] = items();
    assert.equal(one.subs[0].agent, null);
    assert.equal(sunk(one), true, "the first story sinks back");
    assert.equal(nine.subs[0].agent.status, "working");
  });
});

describe("sinking at the handover column", () => {
  const story = (statuses, { handover = null, mine = statuses.map((_, i) => `ABC-${i + 2}`) } = {}) => build(data({
    mine, parents: [issue("ABC-1", "doing")], children: statuses.map((s, i) => issue(`ABC-${i + 2}`, s, "ABC-1")),
  }), new Map(), {}, new Map(), handover)[0];
  test("by default the first column sounding like testing (QA here)", () => {
    assert.equal(story(["qa", "done"]).sunk, true);
    assert.equal(story(["qa", "doing"]).sunk, false);
  });
  test("the profile's handover column instead", () => {
    assert.equal(story(["qa"], { handover: "Done" }).sunk, false);
    assert.equal(story(["doing"], { handover: "In Progress" }).sunk, true);
    assert.equal(story(["done"], { handover: "Done" }).sunk, true);
  });
  test("only subtasks assigned to you count", () => {
    assert.equal(story(["qa", "todo"], { mine: ["ABC-2"] }).sunk, true);
  });
  test("with none of yours, by the story's own status; a task by its own", () => {
    assert.equal(story(["todo"], { mine: [] }).sunk, false, "the story is In Progress");
    const task = (s) => build(data({ mine: ["ABC-9"], parents: [issue("ABC-9", s)] }), new Map())[0];
    assert.equal(task("qa").sunk, true);
    assert.equal(task("doing").sunk, false);
  });
  test("a done status always counts, even with no columns known", () => {
    const [it] = build(data({ columns: [], mine: ["ABC-2"], parents: [issue("ABC-1", "doing")], children: [issue("ABC-2", "done", "ABC-1")] }), new Map());
    assert.equal(it.sunk, true);
  });
  test("with no testing column, the board's last", () => {
    const columns = [{ name: "To Do", statuses: ["1"] }, { name: "Doing", statuses: ["2", "3"] }, { name: "Shipped", statuses: ["4"] }];
    const [it] = build(data({ columns, mine: ["ABC-9"], parents: [issue("ABC-9", "qa")] }), new Map());
    assert.equal(it.sunk, false);
  });
});

describe("progress: where a story's subtasks are", () => {
  test("each subtask has a stage by its column, for the row's bar", () => {
    const [s] = build(data({
      mine: ["ABC-2", "ABC-3", "ABC-4", "ABC-5", "ABC-6"], parents: [issue("ABC-1", "doing")],
      children: [issue("ABC-2", "todo", "ABC-1"), issue("ABC-3", "doing", "ABC-1"), issue("ABC-4", "blocked", "ABC-1"), issue("ABC-5", "qa", "ABC-1"), issue("ABC-6", "done", "ABC-1")],
    }), new Map());
    assert.deepEqual(s.subs.map((x) => x.stage), ["todo", "doing", "blocked", "testing", "past"]);
  });
  test("a column right of the handover one is past it", () => {
    const [s] = build(data({ mine: ["ABC-2"], parents: [issue("ABC-1", "doing")], children: [issue("ABC-2", "qa", "ABC-1")] }), new Map(), {}, new Map(), "In Progress");
    assert.equal(s.subs[0].stage, "past");
  });
  test("the words: subtasks by state, a task by its pull requests", () => {
    const [s] = build(data({
      mine: ["ABC-2"], parents: [issue("ABC-1", "doing")],
      children: [issue("ABC-2", "doing", "ABC-1"), issue("ABC-3", "doing", "ABC-1"), issue("ABC-4", "todo", "ABC-1"), issue("ABC-5", "done", "ABC-1")],
      prs: [pr("ABC-2 x")],
    }), new Map());
    assert.equal(progress(s), "4 subtasks · 1 in review · 1 in progress · 1 to do · 1 done");
    const task = (prs) => progress(build(data({ mine: ["ABC-9"], parents: [issue("ABC-9", "doing")], prs }), new Map())[0]);
    assert.equal(task([]), "No PR yet");
    assert.equal(task([pr("ABC-9 a", { number: 1 })]), "PR in review");
    assert.equal(task([pr("ABC-9 a", { number: 1 }), pr("ABC-9 b", { number: 2 })]), "2 PRs in review");
    assert.equal(task([pr("ABC-9 a", { merged: true })]), "Merged");
  });
  test("finished: done in Jira, or every pull request merged", () => {
    const it = (status, prs) => build(data({ mine: ["ABC-9"], parents: [issue("ABC-9", status)], prs }), new Map(), {}, new Map([["ABC-9", { id: "s" }]]))[0];
    assert.equal(finished(it("done", [])), true);
    assert.equal(finished(it("doing", [pr("ABC-9 a", { merged: true })])), true);
    assert.equal(finished(it("doing", [pr("ABC-9 a", { merged: true, number: 1 }), pr("ABC-9 b", { number: 2 })])), false);
    assert.equal(finished(it("doing", [])), false);
  });
});

describe("askFor: what a pull request's button asks its agent", () => {
  test("changes requested comes before failing checks, as in need() and the marks", () => {
    const both = pr("AB-2: x", { checks: "FAILURE", review: "CHANGES_REQUESTED" });
    assert.equal(askFor(both), "comments");
    // The header's main action is need()'s kind, and only pull requests asking for it get the button:
    // one in both states once left the header with no main action.
    const [it] = build(data({ parents: [issue("AB-1", "doing")], children: [issue("AB-2", "doing", "AB-1")], mine: ["AB-2"], prs: [both] }), new Map());
    assert.match(need(it)[1], /^Changes requested/);
    assert.equal(askFor(pr("AB-2: x", { checks: "FAILURE" })), "fix");
    assert.equal(askFor(pr("AB-2: x", { checks: "SUCCESS", review: "APPROVED" })), "merge");
    assert.equal(askFor(pr("AB-2: x", { checks: "FAILURE", review: "CHANGES_REQUESTED", merged: true })), null);
  });
});

describe("prState: a pull request's mark", () => {
  const t = mock.state.theme;
  const state = (o) => prState(t, { merged: false, isDraft: false, reviewDecision: null, ...o }, o.checks ?? null)[0];
  test("changes requested outranks failing checks, failing an approval, an approval the rest", () => {
    assert.equal(state({ reviewDecision: "CHANGES_REQUESTED", checks: "FAILURE" }), "pr-changes");
    assert.equal(state({ reviewDecision: "APPROVED", checks: "FAILURE" }), "pr-failing");
    assert.equal(state({ checks: "ERROR" }), "pr-failing");
    assert.equal(state({ reviewDecision: "APPROVED", checks: "PENDING" }), "pr-approved", "approved even while checks run");
    assert.equal(state({ reviewDecision: "APPROVED", isDraft: true }), "pr-approved");
    assert.equal(state({ isDraft: true, checks: "PENDING" }), "pr-draft");
    assert.equal(state({ checks: "PENDING" }), "pr-running");
    assert.equal(state({ checks: "EXPECTED" }), "pr-running");
    assert.equal(state({ checks: "SUCCESS" }), "pr-review");
    assert.equal(state({ merged: true, reviewDecision: "CHANGES_REQUESTED", checks: "FAILURE" }), "pr-merged");
  });
  test("its words say both when changes are requested and checks fail", () => {
    assert.equal(prState(t, { reviewDecision: "CHANGES_REQUESTED" }, "FAILURE")[1], "Changes requested, and checks failing");
    assert.equal(prState(t, { reviewDecision: "APPROVED" }, "SUCCESS")[1], "Approved, checks pass: ready to merge");
  });
});

describe("the demo's stories, as the list builds them", () => {
  test("its stories, in the list's order, with what each needs", async () => {
    const d = await demoData();
    const list = ordered(build(d, new Map(), {}, new Map(), null));
    assert.deepEqual(list.map((x) => [x.it.key, x.n[0], sunk(x.it, x.n)]), [
      ["ACME-151", 2, false], ["ACME-160", 1, false], ["ACME-171", 3, false],
      // In progress by last activity (#141): ACME-175's pull request changed most recently.
      ["ACME-175", 6, false], ["ACME-142", 6, false], ["ACME-138", 6, false], ["ACME-184", 6, false], ["ACME-180", 6, false], ["ACME-176", 6, false], ["ACME-178", 6, false],
      ["ACME-129", 6, true], ["ACME-126", 6, true],
    ]);
  });
  // ACME-126 is handed over (its subtask of yours in QA), but its agent finished a
  // turn the person hasn't seen yet: it stays among the stories in progress.
  test("a handed-over story whose agent finished a turn stays in progress", async () => {
    const d = await demoData();
    const it = build(d, new Map([["ACME-127", { status: "done", talking: true }]])).find((x) => x.key === "ACME-126");
    assert.equal(it.sunk, true);
    assert.equal(sunk(it), false);
    assert.match(need(it)[1], /^Its agent finished a turn · /);
  });
  // What next?'s snapshot: a story past the handover column (ACME-129) is the person's own to check
  // when they work alone, not "my part is done".
  test("What next? is told what the sunk stories wait on: others, or the person working alone", async () => {
    const d = await demoData();
    const snap = (jira) => {
      const profile = { ...DEMO_PROFILE, jira };
      return suggestSnapshot({ data: d, profile, setup: { profile, jira, github: profile.github } }, ordered(build(d, new Map())), []);
    };
    const team = snap(DEMO_PROFILE.jira);
    assert.match(team, /; my part is done from QA$/m);
    assert.match(team, /^- ACME-129 .* · my part is done$/m);
    const alone = snap({ ...DEMO_PROFILE.jira, solo: true });
    assert.match(alone, /; I work alone: from QA on, a ticket waits on me to check it$/m);
    assert.match(alone, /^- ACME-129 .* · built, mine to check$/m);
    assert.doesNotMatch(alone, /my part is done/);
  });
  test("the done story with no space has left; the PR naming no ticket shows on its own", async () => {
    const d = await demoData();
    assert.ok(!build(d, new Map()).some((it) => it.key === "ACME-122"));
    assert.deepEqual(pullsOf(d).map((it) => it.key), ["pull:docs#58"]);
  });
  test("who each story and subtask is assigned to: a story's own assignee too, not only yours", async () => {
    const it = byKey(build(await demoData(), new Map()));
    // ACME-142 reaches the list only as the parent of your subtasks, whose embedded parent names no one.
    assert.equal(it["ACME-142"].assignee, "Priya Nair");
    assert.equal(it["ACME-142"].mine, false);
    assert.deepEqual(it["ACME-142"].subs.map((s) => [s.key, s.assignee, s.mine]), [
      ["ACME-143", "Alex Morgan", true], ["ACME-144", "Alex Morgan", true], ["ACME-145", "Tomás Ruiz", false],
    ]);
    assert.equal(byKey(it["ACME-129"].subs)["ACME-131"].assignee, null, "unassigned");
    assert.deepEqual([it["ACME-175"].assignee, it["ACME-175"].mine], ["Alex Morgan", true], "a task of yours");
  });
});

describe("noneToDo: why To do is empty", () => {
  test("no sprint, nothing of yours in it, or everything started", () => {
    assert.equal(noneToDo({ sprints: [] }, []), "No sprint running right now.");
    assert.equal(noneToDo({ sprints: [{ id: 1, name: "Sprint 1" }] }, []), "Nothing in Sprint 1 is yours yet: tickets assigned to you show here.");
    assert.equal(noneToDo({ sprints: [{ id: null, name: "Kelpie", kanban: true }] }, []), "Nothing on Kelpie is yours yet: tickets assigned to you show here.");
    assert.equal(noneToDo({ sprints: [{ id: 1, name: "Sprint 1" }] }, [{ it: {} }]), "Nothing left to start.");
  });
});

// The sidebar groups by where the work is on the board, not by whether this machine has a space for
// it: a story in progress on the board with nothing open here is In progress, not To do.
describe("underWay: the sidebar's In progress and To do", () => {
  const one = (parents, children = [], mine = [], spaces = new Map()) => byKey(build(data({ parents, children, mine }), new Map(), {}, spaces));
  test("in progress on the board, with no space, agent, session or pull request here", () => {
    const { "AB-1": s } = one([issue("AB-1", "doing")], [issue("AB-2", "doing", "AB-1")], ["AB-2"]);
    assert.equal(s.space, null);
    assert.equal(underWay(s), true);
  });
  test("a story still to do whose subtask has started is under way", () => {
    assert.equal(underWay(one([issue("AB-1")], [issue("AB-2", "doing", "AB-1")], ["AB-2"])["AB-1"]), true);
  });
  test("a space here counts, whatever the board says", () => {
    assert.equal(underWay(one([issue("AB-1")], [], ["AB-1"], new Map([["AB-1", { id: "s1" }]]))["AB-1"]), true);
  });
  test("to do on the board, its subtasks too, and nothing here: not under way", () => {
    assert.equal(underWay(one([issue("AB-1")], [issue("AB-2", "todo", "AB-1")], ["AB-2"])["AB-1"]), false);
  });
  test("an earlier session alone leaves it to do", () => {
    const d = data({ parents: [issue("AB-1")], children: [issue("AB-2", "todo", "AB-1")], mine: ["AB-2"], sessions: [{ id: "x", title: "A sketch", first: ["AB-2"], updated: Date.now() - 3600e3 }] });
    const s = byKey(build(d, new Map()))["AB-1"];
    assert.ok(s.subs[0].last, "the session is found");
    assert.equal(underWay(s), false);
  });
  for (const [what, profile] of [["a Jira board", DEMO_PROFILE], ["a GitHub Project", DEMO_PROJECT_PROFILE]]) {
    test(`the demo on ${what}: a story worked on elsewhere is in progress, not to do`, async () => {
      const d = await demoData(profile);
      const list = ordered(build(d, new Map(), {}, new Map(), null));
      const it = list.find((x) => x.it.key === "ACME-184")?.it;
      assert.ok(it, "the fixture's story in progress with nothing here");
      assert.equal(it.space, null);
      assert.equal(underWay(it), true);
      assert.deepEqual(list.filter((x) => !sunk(x.it, x.n) && !underWay(x.it)).map((x) => x.it.key), ["ACME-180", "ACME-176", "ACME-178"], "only the stories nobody started are to do");
    });
  }
});
