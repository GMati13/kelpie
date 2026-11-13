// A story's pull requests waiting for your review, reviewed together from its heading under Reviews
// for you (KELPIE-118, stories.js startStoryReview()): each is checked out as Start review does, one
// agent in the Reviews space, started in the profile's folder, never in a checkout, with every pull
// request and its checkout named; with one pull request it's that one's own review. Nothing is posted
// or approved by starting it.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { until } from "../lib/helpers.mjs";
import { mock } from "herdr";
import { OTHERS } from "../../mods/kelpie/config.js";
import { reviewTaskRows, sendStoryReview, startStoryReview, storyTaskRows, tabKey } from "../../mods/kelpie/stories.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";

const profile = { id: "w", name: "W", folder: "/work/acme", github: { owner: "acme" } };
const story = { key: "ABC-1", title: "Show times in each zone", subs: [] };
const pr = (repo, n, title) => ({ url: `https://github.com/acme/${repo}/pull/${n}`, repository: { name: repo }, number: n, title, author: { login: "sam" } });
const prs = [pr("web", 4, "ABC-2 Label the times"), pr("api", 9, "ABC-2 Return each stop's zone")];
const checkouts = () => mock.of("exec").filter(([cmd, args]) => cmd === "sh" && String(args[1]).includes("worktree add")).map(([, args]) => args.slice(-2).join("#"));

beforeEach(() => {
  mock.reset();
  mock.state.shared.set("kelpie.profiles", { w: profile });
  mock.on.exec = (cmd, args) => (cmd === "sh" && String(args[1]).includes("worktree add") ? { code: 0, stdout: `ok:/work/acme/worktrees/review-${args.at(-2)}-${args.at(-1)}\n`, stderr: "" } : undefined);
  mock.on.hc = (args) => (args[0] === "get" ? { code: 0, stdout: JSON.stringify({ foreground: { name: "claude" } }), stderr: "" } : { code: 0, stdout: "{}", stderr: "" });
});

describe("Review on a story's heading", () => {
  test("checks out each pull request, then one agent in the Reviews space names them all", async () => {
    startStoryReview(profile, story, prs);
    const [, args] = await until(() => mock.of("run").find(([n]) => n === "space.new"), 3000, "space.new");
    assert.deepEqual(checkouts(), ["web#4", "api#9"]);
    assert.equal(args.name, "Reviews");
    assert.equal(args.tab, "Review ABC-1");
    assert.equal(args.folder, "/work/acme", "the profile's folder, never a checkout");
    for (const p of prs) assert.ok(args.task.includes(p.url), p.url);
    assert.match(args.task, /is in \/work\/acme\/worktrees\/review-web-4: read it there/);
    assert.match(args.task, /is in \/work\/acme\/worktrees\/review-api-9: read it there/);
    assert.match(args.task, /--- the pull requests, as written there ---/);
    assert.ok(args.task.endsWith(`\n\n${OTHERS}`));
  });
  test("starting it posts and approves nothing", async () => {
    startStoryReview(profile, story, prs);
    await until(() => mock.of("run").find(([n]) => n === "space.new"), 3000, "space.new");
    assert.deepEqual(mock.of("exec").filter(([cmd, args]) => cmd !== "sh" || !String(args[1]).includes("worktree")), []);
    assert.equal(mock.of("hc").filter(([a]) => a[0] === "send").length, 0);
  });
  test("with one pull request it's that one's own review, a tab of its own", async () => {
    startStoryReview(profile, story, [prs[0]]);
    const [, args] = await until(() => mock.of("run").find(([n]) => n === "space.new"), 3000, "space.new");
    assert.equal(args.tab, "PR web#4");
  });
  test("an open story review is shown again, not started twice", () => {
    mock.state.spaces = [{ id: "s1", name: "Reviews", folder: "/work/acme", tabs: [{ id: "t1", name: "Review ABC-1" }], active: false }];
    startStoryReview(profile, story, prs);
    assert.deepEqual(mock.of("run").map(([n, a]) => [n, a.id]), [["space.select", "s1"], ["tab.select", "t1"]]);
    assert.deepEqual(checkouts(), []);
  });
  test("its menu offers the agents already reviewing its pull requests first, then a new agent", () => {
    mock.state.agents = [{ address: "a1", space: "s1", pane: "p1", tab: "t2", tab_name: "PR api#9", status: "idle" }, { address: "a2", space: "s2", pane: "p2", tab: "t3", tab_name: "ABC-1", status: "idle" }];
    const rows = reviewTaskRows(profile, story, prs);
    assert.deepEqual(rows.map((r) => r.header ?? r.label), ["Review ABC-1's 2 pull requests: send it to", "PR api#9", "Or start", "New agent"]);
  });
  test("sent to an agent reviewing one of them, the whole review goes after the checkouts", async () => {
    await sendStoryReview(profile, story, prs, { address: "a1", space: "s1", pane: "p1", tab_name: "PR api#9", status: "idle" });
    assert.deepEqual(checkouts(), ["web#4", "api#9"]);
    const [[args]] = mock.of("hc").filter(([a]) => a[0] === "send");
    assert.equal(args.at(-2), "a1");
    for (const p of prs) assert.ok(args.at(-1).includes(p.url));
  });
  test("not to an agent waiting for your answer", async () => {
    await sendStoryReview(profile, story, prs, { address: "a1", space: "s1", pane: "p1", tab_name: "PR api#9", status: "blocked" });
    assert.equal(mock.of("hc").filter(([a]) => a[0] === "send").length, 0);
    assert.deepEqual(checkouts(), []);
  });
  test("a story's review agent doesn't count as the story's own agent", () => {
    assert.equal(tabKey("Review ABC-1"), null);
    assert.equal(tabKey("ABC-1 merge"), "ABC-1");
    assert.equal(tabKey("Review ABC-1 changes"), "ABC-1");
  });
  test("a story's Merge and Request approval menus don't offer the agent reviewing its pull requests", () => {
    mock.state.spaces = [{ id: "s1", name: "ABC-1", tabs: [] }, { id: "s2", name: "Reviews", tabs: [] }];
    mock.state.agents = [
      { address: "t1", tab_name: "ABC-1 fix the form", space: "s1", pane: "p1", status: "idle", title: "" },
      { address: "t2", tab_name: "Review ABC-1", space: "s2", pane: "p2", status: "idle", title: "" },
    ];
    const rows = storyTaskRows(skinTheme(), profile, { ...story, space: { id: "s1" } }, "merge", prs);
    const offered = rows.filter((r) => r.action && r.label !== "New agent").map((r) => r.label);
    assert.deepEqual(offered, ["ABC-1 fix the form"]);
  });
});
