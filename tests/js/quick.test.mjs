// The quick read (quickPulls() in stories.js, readPulls() in pulls.js): an agent's turn ending, and
// every 20 s while something is in flight, reads the profile's open pull requests again by id, and
// what they say now shows at once, not after the next full load (throttled, and searches lag). A
// load that began before that read doesn't put the older state back (settlePulls()).
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock, setShared } from "herdr";
import { StoryList, settlePulls } from "../../mods/kelpie/stories.js";
import { readPulls } from "../../mods/kelpie/pulls.js";
import { demoReadPulls } from "../../mods/kelpie/demo.js";
import { fakeCx, setupDemoWorld } from "../lib/views.mjs";
import { data, pr } from "../lib/stories.mjs";

const WEB423 = "https://github.com/kelpie--demo/web/pull/423";
const checksOf = (p) => p?.commits.nodes[0].commit.statusCheckRollup.state ?? null;
const shown = (url) => mock.sharedValue("kelpie.stories.data").demo.data.prs.find((p) => p.url === url);

describe("readPulls: one constant question, the ids as variables", () => {
  beforeEach(() => mock.reset());
  test("each id a variable, never in the query; bad ids dropped; nothing asked for none", async () => {
    mock.on.exec = () => ({ code: 0, stdout: JSON.stringify({ data: { nodes: [] } }), stderr: "" });
    await readPulls(["PR_kwA1", "x) { secret }", "PR_kwA1", 7]);
    const [[, args]] = mock.of("exec");
    assert.deepEqual(args.filter((a) => a.startsWith("ids[]=")), ["ids[]=PR_kwA1"]);
    const query = args.find((a) => a.startsWith("query="));
    assert.match(query, /^query=query KelpiePulls\(\$ids: \[ID!\]!\)/);
    assert.ok(!query.includes("PR_kwA1") && !query.includes("secret"));
    mock.calls = [];
    assert.deepEqual(await readPulls(["bad id!"]), []);
    assert.deepEqual(mock.of("exec"), []);
  });
});

describe("the demo's pull request that changes while shown", () => {
  beforeEach(() => mock.reset());
  test("web#423's checks run until 20 s after kelpie.demo made the demo, then pass", async () => {
    assert.equal(checksOf((await demoReadPulls(["demo-pr-web-423"]))[0]), "PENDING", "no demo made: the fixture as it is");
    setShared("kelpie.demo.at", Date.now() - 5000);
    assert.equal(checksOf((await demoReadPulls(["demo-pr-web-423"]))[0]), "PENDING");
    setShared("kelpie.demo.at", Date.now() - 21000);
    assert.equal(checksOf((await demoReadPulls(["demo-pr-web-423"]))[0]), "SUCCESS");
  });
});

describe("an agent's turn ending reads the pull requests again at once", () => {
  let list, cx;
  beforeEach(async () => {
    setupDemoWorld();
    cx = fakeCx();
    list = new StoryList();
    list.init(cx);
    await cx.settle(10);
    if (cx.errors.length) throw cx.errors[0];
    settlePulls(null, Infinity); // nothing read again by another test
  });

  test("checks turned green show without waiting for the next full load", async () => {
    assert.equal(checksOf(shown(WEB423)), "PENDING");
    setShared("kelpie.demo.at", Date.now() - 21000); // they turned green meanwhile
    list.fullAt = Date.now(); // a full load just ran: the next waits its 30 s
    let loads = 0;
    const fetch = list.fetch.bind(list);
    list.fetch = (ctx) => { loads++; return fetch(ctx); };
    list.loadAfterAgent(cx);
    await cx.settle(10);
    assert.equal(checksOf(shown(WEB423)), "SUCCESS");
    assert.equal(loads, 0, "no full load: that waits its turn");
  });

  test("checks running count as in flight, so the 20 s timer reads them", () => {
    assert.equal(list.inFlight(list.context()), true);
  });
});

describe("settlePulls: a quick read wins over a load that began before it", () => {
  const P = (checks, extra = {}) => ({ ...pr("ACME-1 add it", { checks, ...extra }), id: "PR_1" });
  beforeEach(async () => {
    setupDemoWorld();
    settlePulls(null, Infinity);
  });
  const quick = async (n) => {
    mock.on.exec = () => ({ code: 0, stdout: JSON.stringify({ data: { nodes: [n] } }), stderr: "" });
    const list = new StoryList();
    list.loader = true;
    const cx = fakeCx();
    setShared("kelpie.profiles", { demo: { ...mock.sharedValue("kelpie.profiles").demo, github: { owner: "kelpie--demo" } } });
    const ctx = list.context();
    list.cache[ctx.key] = { data: data({ prs: [P("PENDING")] }), at: Date.now(), error: null };
    setShared("kelpie.stories.data", { demo: { key: ctx.key, data: data({ prs: [P("PENDING")] }), at: Date.now(), error: null } });
    list.quickPulls(cx);
    await cx.settle(5);
  };
  test("a load that began before keeps what was read; one that began after is believed", async () => {
    const began = Date.now() - 1000;
    await quick({ ...P("SUCCESS"), state: "OPEN" });
    assert.equal(checksOf(settlePulls(data({ prs: [P("PENDING")] }), began).prs[0]), "SUCCESS");
    assert.equal(checksOf(settlePulls(data({ prs: [P("FAILURE")] }), Date.now() + 1).prs[0]), "FAILURE");
  });
  test("a merge read here stays until a load shows it, as the search lags behind a merge", async () => {
    await quick({ ...P("SUCCESS"), state: "MERGED" });
    assert.equal(settlePulls(data({ prs: [P("SUCCESS")] }), Date.now() + 1).prs[0].merged, true);
    assert.equal(settlePulls(data({ prs: [P("SUCCESS", { merged: true })] }), Date.now() + 2).prs[0].merged, true);
    assert.equal(settlePulls(data({ prs: [P("SUCCESS")] }), Date.now() + 3).prs[0].merged, false, "then forgotten");
  });
  test("one closed without merging leaves the lists", async () => {
    await quick({ ...P("SUCCESS"), state: "CLOSED" });
    assert.deepEqual(settlePulls(data({ prs: [P("PENDING")] }), Date.now() - 1000).prs, []);
  });
});

test("a quick read that finds nothing new doesn't write the shared stories, so nothing redraws", async () => {
  setupDemoWorld();
  settlePulls(null, Infinity);
  const cx = fakeCx();
  const list = new StoryList();
  list.init(cx);
  await cx.settle(10);
  mock.calls = [];
  list.quickPulls(cx);
  await cx.settle(5);
  assert.equal(mock.of("setShared").filter(([key]) => key === "kelpie.stories.data").length, 0);
});
