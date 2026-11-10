// Next's queue (stories.js needQueueOf, nextIn) and What next?'s picks (applyPicks, suggestedIn):
// what cmd-shift-j goes through, in which order, and which of Claude's picks are kept.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { applyPicks, build, needQueueOf, nextIn, ordered } from "../../mods/kelpie/stories.js";
import { demoFixture } from "../../mods/kelpie/demo.js";
import { DEMO_PROFILE, data, demoData, issue, pr } from "../lib/stories.mjs";

const profile = { id: "w", name: "W", folder: "/w", jira: { site: "https://jira.example.com", board: 1, keychain: "k" } };
const SUGGESTED = "kelpie.next.suggested";
beforeEach(() => {
  mock.reset();
  mock.state.shared.set("kelpie.profiles", { w: profile });
});
const keys = (q) => q.map((x) => x.key);

// The board: AA-1 changes requested, BB-1 agent waiting, CC-1 nothing, DD-1 sunk (in QA), EE-1 done
// with a space (to clean up), FF-1 a story whose subtask FF-2 is yours.
const board = () => data({
  mine: ["AA-1", "BB-1", "CC-1", "DD-1", "EE-1", "FF-2"],
  parents: [issue("AA-1", "doing"), issue("BB-1", "doing"), issue("CC-1", "doing"), issue("DD-1", "qa"), issue("EE-1", "done"), issue("FF-1", "doing")],
  children: [issue("FF-2", "doing", "FF-1"), issue("FF-3", "todo", "FF-1")],
  prs: [pr("AA-1 x", { review: "CHANGES_REQUESTED" })],
});
const items = () => ordered(build(board(), new Map([["BB-1", { status: "blocked" }]]), {}, new Map([["EE-1", { id: "s-ee" }]])));

describe("needQueueOf: what Next goes through", () => {
  test("needs you by urgency, then one clean-up item; reviews aren't in it (the sidebar lists them)", () => {
    const q = needQueueOf(profile, items());
    assert.deepEqual(keys(q), ["BB-1", "AA-1", "clean"]);
    assert.deepEqual(q[2].clean.map((it) => it.key), ["EE-1"]);
  });
  test("every finished story with something to clean goes in the one item", () => {
    const list = ordered(build(data({ mine: ["AA-1", "BB-1"], parents: [issue("AA-1", "done"), issue("BB-1", "done")] }), new Map(), {},
      new Map([["AA-1", { id: "a" }], ["BB-1", { id: "b" }]])));
    const q = needQueueOf(profile, list);
    assert.deepEqual(keys(q), ["clean"]);
    assert.deepEqual(q[0].clean.map((it) => it.key), ["AA-1", "BB-1"]);
  });
  test("a finished story with an agent working in its space isn't cleaned up yet", () => {
    mock.state.agents = [{ space: "s-ee", status: "working", tab_name: "x" }];
    assert.ok(!keys(needQueueOf(profile, items())).includes("clean"));
  });
  test("the Desk goes after what needs you while one of its agents waits for you", () => {
    mock.state.shared.set("kelpie.desk", { w: "d1" });
    mock.state.spaces = [{ id: "d1", name: "Desk", folder: "/w", tabs: [] }];
    mock.state.agents = [{ space: "d1", status: "working" }];
    assert.ok(!keys(needQueueOf(profile, items())).includes("desk"));
    mock.state.agents = [{ space: "d1", status: "blocked" }];
    assert.deepEqual(keys(needQueueOf(profile, items())), ["BB-1", "AA-1", "desk", "clean"]);
  });
  test("Claude's picks come last, and drop out once their story needs you, is sunk or finished", () => {
    const pick = (key) => ({ key, action: `Do ${key}`, why: "", title: "", url: "" });
    mock.state.shared.set(SUGGESTED, { w: { at: Date.now(), items: ["CC-1", "AA-1", "DD-1", "EE-1", "XX-9", "pr:web#4"].map(pick) } });
    const q = needQueueOf(profile, items());
    assert.deepEqual(keys(q), ["BB-1", "AA-1", "clean", "suggest:CC-1", "suggest:XX-9", "suggest:pr:web#4"]);
    assert.equal(q[3].it.key, "CC-1", "a pick the list has carries its story");
    assert.equal(q[4].it, null, "one it doesn't opens on the web");
  });
  test("picks older than a day are gone", () => {
    mock.state.shared.set(SUGGESTED, { w: { at: Date.now() - 25 * 3600e3, items: [{ key: "CC-1", action: "x" }] } });
    assert.deepEqual(keys(needQueueOf(profile, items())), ["BB-1", "AA-1", "clean"]);
  });
});

describe("nextIn: the item after the one shown", () => {
  const q = [{ key: "a" }, { key: "b" }, { key: "c" }];
  test("goes on, and wraps around", () => {
    assert.equal(nextIn(q, "a").key, "b");
    assert.equal(nextIn(q, "c").key, "a");
  });
  test("the first when the one shown isn't in it; nothing in an empty queue", () => {
    assert.equal(nextIn(q, "zz").key, "a");
    assert.equal(nextIn(q, null).key, "a");
    assert.equal(nextIn([], "a"), null);
  });
});

describe("applyPicks: Claude's picks checked against the sidebar's rules", () => {
  // Jira, for keys not in the list: AA-50 a subtask of AA-40, AA-60 a story whose parent is its epic
  // AA-1000; anything else unknown.
  const JIRA = {
    "AA-50": { key: "AA-50", fields: { summary: "Sub", issuetype: { subtask: true }, parent: { key: "AA-40", fields: { summary: "Its story" } } } },
    "AA-60": { key: "AA-60", fields: { summary: "Backlog story", issuetype: { subtask: false }, parent: { key: "AA-1000", fields: { summary: "Epic" } } } },
  };
  beforeEach(() => {
    mock.state.shared.set("kelpie.stories.data", { w: { data: board() } });
    mock.on.exec = (cmd, args) => {
      if (cmd !== "sh" || !String(args[0]).endsWith("jira.sh")) return undefined;
      const key = /\/issue\/([^?]+)/.exec(args.at(-1))?.[1];
      const body = JIRA[key];
      return { code: 0, stdout: JSON.stringify(body ? { code: 200, authed: true, body } : { code: 404, authed: true, body: { errorMessages: ["Issue does not exist"] } }), stderr: "" };
    };
  });
  const pick = (o) => ({ action: "Do it", why: "Because", ...o });
  const saved = () => mock.sharedValue(SUGGESTED).w.items;

  test("a subtask in the list becomes its story, saying where it came from", async () => {
    const { kept } = await applyPicks(profile, [pick({ key: "ff-2" })]);
    assert.deepEqual(kept, [{ key: "FF-1", title: "FF-1 title", action: "Do it", why: "Because", url: "https://jira.example.com/browse/FF-1", from: "FF-2" }]);
    assert.deepEqual(saved(), kept);
  });
  test("a subtask not in the list becomes its story, as Jira says; a story's parent (its epic) isn't followed", async () => {
    const { kept } = await applyPicks(profile, [pick({ key: "AA-50" }), pick({ key: "AA-60" })]);
    assert.deepEqual(kept.map((x) => [x.key, x.title, x.from]), [["AA-40", "Its story", "AA-50"], ["AA-60", "Backlog story", undefined]]);
  });
  test("unknown keys, non-keys and picks without an action are dropped, saying why", async () => {
    const { kept, dropped } = await applyPicks(profile, [pick({ key: "AA-99" }), pick({ key: "hello" }), pick({ key: "CC-1", action: " " }), pick({})]);
    assert.deepEqual(kept, []);
    assert.deepEqual(dropped.map((d) => d.why), ["unknown to Jira", "not a Jira key", "no action", "no Jira key, pull request link or idea"]);
  });
  test("one pick per story", async () => {
    const { kept, dropped } = await applyPicks(profile, [pick({ key: "FF-1" }), pick({ key: "FF-3" }), pick({ key: "FF-2" })]);
    assert.deepEqual(kept.map((x) => x.key), ["FF-1"]);
    assert.equal(dropped.length, 2);
    assert.match(dropped[0].why, /second pick/);
  });
  test("pull requests are github.com links, keyed pr:<repo>#<n>", async () => {
    const { kept, dropped } = await applyPicks(profile, [
      pick({ url: "https://github.com/kelpie--demo/web/pull/421" }), pick({ url: "https://github.com/kelpie--demo/api/pull/7/" }),
      pick({ url: "https://gitlab.com/kelpie--demo/web/pull/1" }), pick({ url: "https://github.com/kelpie--demo/web/pull/421/files" }),
      pick({ url: "https://github.com/kelpie--demo/web/pull/421" }),
    ]);
    assert.deepEqual(kept.map((x) => [x.key, x.url]), [["pr:web#421", "https://github.com/kelpie--demo/web/pull/421"], ["pr:api#7", "https://github.com/kelpie--demo/api/pull/7/"]]);
    assert.equal(dropped.length, 3);
  });
  test("ideas are kept as they are, 3 at most, always after tickets and pull requests", async () => {
    const idea = (n) => pick({ idea: `Idea ${n}`, where: "web", action: `Idea ${n}` });
    const { kept, dropped } = await applyPicks(profile, [idea(1), pick({ key: "CC-1" }), idea(2), idea(3), idea(4), pick({ url: "https://github.com/o/web/pull/2" })]);
    assert.deepEqual(kept.map((x) => x.key), ["CC-1", "pr:web#2", "idea:0", "idea:2", "idea:3"]);
    assert.deepEqual(kept.filter((x) => x.idea).map((x) => [x.idea, x.where]), [["Idea 1", "web"], ["Idea 2", "web"], ["Idea 3", "web"]]);
    assert.deepEqual(dropped.map((d) => d.why), ["only 3 ideas are kept"]);
  });
  test("8 at most", async () => {
    const urls = Array.from({ length: 10 }, (_, n) => pick({ url: `https://github.com/o/web/pull/${n + 1}` }));
    const { kept, dropped } = await applyPicks(profile, urls);
    assert.equal(kept.length, 8);
    assert.deepEqual(dropped.map((d) => d.why), ["only 8 are kept", "only 8 are kept"]);
  });
  test("they replace the profile's earlier picks, leaving other profiles' alone", async () => {
    mock.state.shared.set(SUGGESTED, { w: { at: 1, items: [{ key: "AA-1" }] }, other: { at: 1, items: [{ key: "ZZ-1" }] } });
    await applyPicks(profile, [pick({ key: "CC-1" })]);
    const all = mock.sharedValue(SUGGESTED);
    assert.deepEqual(all.w.items.map((x) => x.key), ["CC-1"]);
    assert.deepEqual(all.other.items, [{ key: "ZZ-1" }]);
  });
  test("long or odd text is trimmed onto one line", async () => {
    const { kept } = await applyPicks(profile, [pick({ key: "CC-1", action: `  Do\n\n it ${"x".repeat(200)}`, why: 7 })]);
    assert.equal(kept[0].action.length, 120);
    assert.match(kept[0].action, /^Do it x/);
    assert.equal(kept[0].why, "");
  });
  test("refuses before the stories have loaded", async () => {
    mock.state.shared.set("kelpie.stories.data", {});
    await assert.rejects(applyPicks(profile, [pick({ key: "CC-1" })]), /haven't loaded/);
  });
  test("the demo's picks: a story, a pull request and an idea", async () => {
    mock.state.shared.set("kelpie.profiles", { demo: DEMO_PROFILE });
    mock.state.shared.set("kelpie.stories.data", { demo: { data: await demoData() } });
    const { kept, dropped } = await applyPicks(DEMO_PROFILE, (await demoFixture()).suggest);
    assert.deepEqual(dropped, []);
    assert.deepEqual(kept.map((x) => x.key), ["ACME-180", "pr:web#421", "idea:2"]);
    assert.equal(kept[0].from, "ACME-181");
  });
});
