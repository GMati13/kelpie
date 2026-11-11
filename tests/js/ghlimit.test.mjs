// KELPIE-129: GitHub's API limits (ghlimit.js, around every gh call pulls.js gh() makes). Kelpie used
// up an account's budget, and then nothing loaded, for the person's own agents and scripts either. A
// call GitHub refuses for its limits stops the rest until it can be asked again, said in plain words
// with the time; while the budget runs low the story list loads less often; a refused load keeps the
// last stories.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock, setShared } from "herdr";
import { LIMIT, LOW_EVERY, blockedFor, guarded, limitOf, lowFor, lowMessage } from "../../mods/kelpie/ghlimit.js";
import { gh, pullBody } from "../../mods/kelpie/pulls.js";
import { StoryList } from "../../mods/kelpie/stories.js";
import { REFRESH } from "../../mods/kelpie/source.js";
import { clock12 } from "../../mods/kelpie/ui.js";
import { fakeCx, setupDemoWorld } from "../lib/views.mjs";
import { data, issue, pr } from "../lib/stories.mjs";

const NOW = Date.now();
const RESET = Math.floor(NOW / 1000) + 25 * 60; // GitHub's reset, in seconds
// GitHub's own words when the budget is used up: they name the account's user id.
const REFUSED = { code: 1, stdout: JSON.stringify({ errors: [{ type: "RATE_LIMITED", message: "API rate limit already exceeded for user ID 4242." }] }), stderr: "gh: API rate limit already exceeded for user ID 4242.\n" };
const answer = (data) => ({ code: 0, stdout: JSON.stringify({ data }), stderr: "" });
const left = (remaining, limit = 5000) => ({ rateLimit: { remaining, limit, resetAt: new Date(RESET * 1000).toISOString() } });
// gh's rate_limit: the GraphQL budget `graphql` left, REST's `core`.
const rateLimit = ({ graphql = 0, core = 4000 } = {}) => ({ code: 0, stdout: JSON.stringify({ resources: { graphql: { remaining: graphql, reset: RESET }, core: { remaining: core, reset: RESET } } }), stderr: "" });

// A run of gh that answers by what's asked and keeps every call.
function fakeRun(answers) {
  const calls = [];
  const run = async (args) => { calls.push(args); return answers(args); };
  return { calls, run };
}
const isRateLimit = (args) => args[0] === "api" && args[1] === "rate_limit";

beforeEach(() => mock.reset());

describe("a call GitHub refuses for its limits", () => {
  test("stops the rest until the budget's reset, said in plain words with the time", async () => {
    const { calls, run } = fakeRun((args) => (isRateLimit(args) ? rateLimit() : REFUSED));
    const r = await guarded("me", ["api", "graphql", "-f", "query=x"], run);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, `GitHub's limit for this account is used up: Kelpie tries again at ${clock12(new Date(RESET * 1000))}`);
    assert.doesNotMatch(r.stderr, /4242/, "not GitHub's message, which names the account's user id");
    assert.equal(blockedFor("me").until, RESET * 1000);
    const before = calls.length;
    const again = await guarded("me", ["api", "graphql", "-f", "query=y"], run);
    assert.equal(again.stderr, r.stderr);
    assert.equal(calls.length, before, "nothing asked before the reset");
    // Once the reset is past, it asks again.
    assert.equal(blockedFor("me", "graphql", RESET * 1000 + 1), null);
  });

  test("with budget left (a secondary limit), it waits a while, longer each time in a row", async () => {
    const { run } = fakeRun((args) => (isRateLimit(args) ? rateLimit({ graphql: 4400 }) : REFUSED));
    let at = NOW;
    await guarded("me", ["api", "graphql"], run, () => at);
    assert.equal(blockedFor("me", "graphql", at).until, at + 5 * 60e3);
    at += 5 * 60e3 + 1;
    await guarded("me", ["api", "graphql"], run, () => at);
    assert.equal(blockedFor("me", "graphql", at).until, at + 10 * 60e3);
  });

  test("calls refused side by side count once", async () => {
    // One call already on its way when another is refused: its own refusal comes after the wait is set.
    let release;
    const gate = new Promise((r) => { release = r; });
    const slow = fakeRun(async (args) => (isRateLimit(args) ? rateLimit({ graphql: 4400 }) : (await gate, REFUSED)));
    const fast = fakeRun((args) => (isRateLimit(args) ? rateLimit({ graphql: 4400 }) : REFUSED));
    const later = guarded("side", ["api", "graphql"], slow.run, () => NOW);
    await guarded("side", ["api", "graphql"], fast.run, () => NOW);
    release();
    assert.match((await later).stderr, /used up/);
    assert.equal(blockedFor("side", "graphql", NOW).hits, 1, "not a second time in a row");
    assert.equal(blockedFor("side", "graphql", NOW).until, NOW + 5 * 60e3);
    assert.equal(slow.calls.filter(isRateLimit).length, 0, "no second look at the budget");
  });

  test("REST and GraphQL are budgets of their own, and accounts too", async () => {
    const restRefused = { code: 1, stdout: "", stderr: "gh: API rate limit exceeded for user ID 4242. (HTTP 403)\n" };
    const { calls, run } = fakeRun((args) => (isRateLimit(args) ? rateLimit({ core: 0 }) : args[1] === "graphql" ? answer({ ok: true }) : restRefused));
    await guarded("me", ["api", "repos/acme/web/pulls/3"], run);
    assert.ok(blockedFor("me", "core"));
    assert.equal(blockedFor("me", "graphql"), null);
    assert.equal(blockedFor("someone", "core"), null);
    assert.equal((await guarded("me", ["api", "graphql"], run)).code, 0);
    const n = calls.length;
    await guarded("someone", ["api", "repos/acme/web/pulls/3"], run);
    assert.equal(calls.length, n + 2, "another account still asks (and is refused on its own)");
  });

  test("a description that talks about rate limits isn't a refusal", async () => {
    const { run } = fakeRun(() => ({ code: 0, stdout: "We hit the API rate limit exceeded error.\n", stderr: "" }));
    const r = await guarded("me", ["api", "repos/acme/web/pulls/3", "--jq", ".body"], run);
    assert.equal(r.code, 0);
    assert.equal(blockedFor("me", "core"), null);
    // Nor a failed REST call whose output says so: only gh's own message counts there.
    const gone = fakeRun(() => ({ code: 1, stdout: JSON.stringify({ errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded, says the page" }] }), stderr: "gh: Not Found (HTTP 404)\n" }));
    await guarded("me", ["api", "repos/acme/web/pulls/3"], gone.run);
    assert.equal(blockedFor("me", "core"), null);
    // Nor does a failure of another kind block anything.
    const down = fakeRun(() => ({ code: 1, stdout: "", stderr: "gh: HTTP 502: Bad Gateway\n" }));
    await guarded("me", ["api", "graphql"], down.run);
    assert.equal(blockedFor("me"), null);
  });

  test("pulls.js gh() goes through it, so a refused account runs no gh at all", async () => {
    let ran = 0;
    mock.on.exec = (cmd, args) => (cmd === "sh" && String(args[0]).endsWith("/gh.sh") ? (ran++, { code: 0, stdout: "body", stderr: "" }) : undefined);
    setShared(LIMIT, { me: { core: { until: NOW + 60e3, hits: 1 } } });
    await assert.rejects(pullBody({ url: "https://github.com/acme/web/pull/3" }, { account: "me" }), /GitHub's limit for this account is used up/);
    assert.equal(ran, 0);
    assert.equal((await gh("other", ["api", "repos/acme/web/pulls/3"])).code, 0);
    assert.equal(ran, 1);
  });
});

describe("what's left", () => {
  test("each GraphQL answer's rateLimit says when it runs low (under a tenth)", async () => {
    await guarded("low", ["api", "graphql"], async () => answer(left(320)));
    assert.equal(lowFor("low").remaining, 320);
    assert.deepEqual(limitOf("low"), { reset: RESET * 1000 });
    assert.match(lowMessage(lowFor("low")), /running low: Kelpie loads less often until \d+:\d\d [AP]M/);
    await guarded("plenty", ["api", "graphql"], async () => answer(left(4200)));
    assert.equal(lowFor("plenty"), null);
    assert.equal(limitOf("plenty"), null);
    // Past the reset, it isn't low any more.
    assert.equal(lowFor("low", RESET * 1000 + 1), null);
  });
});

// The story list of a GitHub Project's profile, on the account `work-me`.
const PROJECT_PROFILE = (account) => ({ jira: null, demo: false, project: { url: "https://github.com/users/alex/projects/3", owner: "alex", ownerType: "user", number: 3 }, github: { owner: "acme", account } });
const LOADED = () => ({ key: null, data: data({ parents: [issue("WEB-1", "doing")], mine: ["WEB-1"] }), at: NOW - 3 * 60e3, error: null });
const settle = async (cx) => { await cx.settle(); for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
// The profile on `account`, shown, with stories loaded 3 minutes ago (the shared copy the list starts from).
function world(account) {
  setupDemoWorld({ profile: PROJECT_PROFILE(account) });
  const ctx = new StoryList().context();
  setShared("kelpie.stories.data", { [ctx.profile.id]: { ...LOADED(), key: ctx.key } });
}
class Answered extends StoryList {
  constructor() { super(); this.asked = 0; }
  async fetch() { this.asked++; return LOADED().data; }
}

describe("the story list", () => {
  test("a load GitHub refuses keeps the last stories, says when it tries again, and asks nothing before", async () => {
    world("refused");
    let ghRuns = 0;
    const base = mock.on.exec;
    mock.on.exec = (cmd, args) => {
      if (cmd !== "sh" || !String(args[0]).endsWith("/gh.sh")) return base(cmd, args);
      ghRuns++;
      return isRateLimit(args.slice(2)) ? rateLimit() : REFUSED;
    };
    const cx = fakeCx();
    const list = new StoryList();
    list.init(cx);
    await settle(cx);
    const st = list.state(cx);
    assert.equal(st.error, `GitHub's limit for this account is used up: Kelpie tries again at ${clock12(new Date(RESET * 1000))}`);
    assert.deepEqual(st.data.parents.map((i) => i.key), ["WEB-1"], "the last stories stay");
    assert.equal(st.at, NOW - 3 * 60e3, "shown as old as they are, not as just loaded");
    const runs = ghRuns;
    setShared(REFRESH, Date.now());
    list.state(cx);
    list.loadAfterAgent(cx);
    await settle(cx);
    assert.equal(ghRuns, runs, "neither Refresh nor an agent's turn asks GitHub before the reset");
  });

  test("a Jira board still loads, its pull requests kept as they were while GitHub refuses them", async () => {
    setupDemoWorld();
    const demo = new StoryList().context().setup.profile;
    setupDemoWorld({ profile: { github: { ...demo.github, demo: false, account: "jira-refused" } } });
    const list = new StoryList();
    const ctx = list.context();
    const before = data({ parents: [issue("ACME-1", "doing")], mine: ["ACME-1"], prs: [pr("ACME-1 add it", { number: 7 })] });
    setShared("kelpie.stories.data", { [ctx.profile.id]: { key: ctx.key, data: before, at: NOW - 3 * 60e3, error: null } });
    setShared(LIMIT, { "jira-refused": { graphql: { until: NOW + 20 * 60e3, hits: 1 } } });
    let ghRuns = 0;
    const base = mock.on.exec;
    mock.on.exec = (cmd, args) => (cmd === "sh" && String(args[0]).endsWith("/gh.sh") ? (ghRuns++, REFUSED) : base(cmd, args));
    const cx = fakeCx();
    list.init(cx);
    await settle(cx);
    const st = list.state(cx);
    assert.equal(ghRuns, 0);
    assert.ok(st.at > NOW - 60e3, "the board loaded");
    assert.deepEqual(st.data.prs.map((p) => p.number), [7], "the pull requests stay");
    assert.equal(st.data.prError, null, "not \"didn't load, Refresh\": the note says when");
    assert.match(st.error, /used up: Kelpie tries again at/);
  });

  test("while the budget runs low it loads at most every 10 minutes, whoever asks", async () => {
    await guarded("low-list", ["api", "graphql"], async () => answer(left(200)));
    world("low-list");
    const cx = fakeCx();
    const list = new Answered();
    list.init(cx);
    await settle(cx);
    assert.equal(list.asked, 1, "a load now: the last was long enough ago");
    setShared(REFRESH, Date.now());
    list.state(cx);
    list.fullAt = 0 + Date.now() - 60e3;
    list.loadAfterAgent(cx);
    await settle(cx);
    assert.equal(list.asked, 1, "not again within 10 minutes");
    assert.match(list.state(cx).error, /running low/);
    list.fullAt = Date.now() - LOW_EVERY - 1;
    setShared(REFRESH, Date.now() + 1);
    list.state(cx);
    await settle(cx);
    assert.equal(list.asked, 2, "once they're up, it loads");
  });

  test("while it runs low or is used up, pull requests aren't read again between loads", async () => {
    for (const [account, set] of [["quick-low", () => guarded("quick-low", ["api", "graphql"], async () => answer(left(100)))], ["quick-used", () => setShared(LIMIT, { "quick-used": { graphql: { until: NOW + 60e3, hits: 1 } } })], ["quick-ok", async () => {}]]) {
      setupDemoWorld({ profile: PROJECT_PROFILE(account) });
      await set();
      const ctx = new StoryList().context();
      const prs = [{ ...pr("WEB-1 add it", { checks: "PENDING" }), id: "PR_1" }];
      setShared("kelpie.stories.data", { [ctx.profile.id]: { key: ctx.key, data: { ...LOADED().data, prs }, at: NOW, error: null } });
      let reads = 0;
      const base = mock.on.exec;
      mock.on.exec = (cmd, args) => (cmd === "sh" && String(args[0]).endsWith("/gh.sh") ? (reads++, answer({ nodes: [] })) : base(cmd, args));
      const cx = fakeCx();
      const list = new Answered();
      list.loader = true;
      list.state(cx);
      list.quickPulls(cx);
      await settle(cx);
      assert.equal(reads, account === "quick-ok" ? 1 : 0, account);
    }
  });

  test("KELPIE-146: running low, an agent's turn ending still reads its pull requests; used up, nothing", async () => {
    // Reacting to what just happened is the quick read's job: low, only the full loads and the 20 s
    // timer's reads give way.
    for (const [account, set] of [["turn-low", () => guarded("turn-low", ["api", "graphql"], async () => answer(left(100)))], ["turn-used", () => setShared(LIMIT, { "turn-used": { graphql: { until: NOW + 60e3, hits: 1 } } })]]) {
      setupDemoWorld({ profile: PROJECT_PROFILE(account) });
      await set();
      const ctx = new StoryList().context();
      const prs = [{ ...pr("WEB-1 add it", { checks: "PENDING" }), id: "PR_1" }];
      setShared("kelpie.stories.data", { [ctx.profile.id]: { key: ctx.key, data: { ...LOADED().data, prs }, at: NOW, error: null } });
      let reads = 0;
      const base = mock.on.exec;
      mock.on.exec = (cmd, args) => (cmd === "sh" && String(args[0]).endsWith("/gh.sh") ? (reads++, answer({ nodes: [] })) : base(cmd, args));
      const cx = fakeCx();
      const list = new Answered();
      list.loader = true;
      list.state(cx);
      await settle(cx);
      const loads = list.asked;
      reads = 0;
      list.loadAfterAgent(cx);
      await settle(cx);
      assert.equal(reads, account === "turn-low" ? 1 : 0, account);
      assert.equal(list.asked, loads, `${account}: no full load`);
    }
  });

  test("with room in the budget, nothing changes", async () => {
    await guarded("roomy", ["api", "graphql"], async () => answer(left(4000)));
    world("roomy");
    const cx = fakeCx();
    const list = new Answered();
    list.init(cx);
    await settle(cx);
    list.fullAt = Date.now() - 60e3;
    setShared(REFRESH, Date.now());
    list.state(cx);
    await settle(cx);
    assert.equal(list.asked, 2);
    assert.equal(list.state(cx).error, null);
  });
});

// The demo plays it from its fixture (github.limit): a Jira demo's board loads, its pull requests kept.
test("the Jira demo with its GitHub limit used up keeps its pull requests", async () => {
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(new URL("../../mods/kelpie/demo/demo.json", import.meta.url), "utf8");
  setupDemoWorld();
  const list = new StoryList();
  const ctx = list.context();
  const before = data({ parents: [issue("ACME-1", "doing")], mine: ["ACME-1"], prs: [{ ...pr("ACME-1 add it", { number: 7 }), id: "PR_7" }] });
  setShared("kelpie.stories.data", { [ctx.profile.id]: { key: ctx.key, data: before, at: NOW - 3 * 60e3, error: null } });
  const base = mock.on.readTextFile;
  mock.on.readTextFile = (path, ...rest) => (String(path).endsWith("demo/demo.json") ? JSON.stringify({ ...JSON.parse(text), github: { limit: "used" } }) : base?.(path, ...rest));
  const cx = fakeCx();
  list.init(cx);
  await settle(cx);
  const st = list.state(cx);
  assert.ok(st.data.parents.length > 1, "the board loaded from the fixture");
  assert.deepEqual(st.data.prs.map((p) => p.number), [7], "the pull requests stay");
  assert.match(st.error, /used up: Kelpie tries again at/);
});
