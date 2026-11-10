// Next through the Claude plugin (stories.js addNextRequest, suggestNextRequest, getNextRequest):
// what `kelpie.add-next`, `kelpie.suggest-next` and `kelpie.get-next` take from their request files
// (any program can run the commands, so every value is checked), and how an agent's ask shows in Next.
import { DEMO, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mock } from "herdr";
import { handlers } from "gpui-kit";
import { put, tempDir } from "../lib/helpers.mjs";
import { byId } from "../lib/snapshot.mjs";
import { StoryList, addAsk, addNextRequest, getNextRequest, needQueueOf, storyItems, suggestNextRequest } from "../../mods/kelpie/stories.js";
import { profileById } from "../../mods/kelpie/config.js";

let stories, home, world;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });
beforeEach(() => {
  world = setupDemoWorld({ stories });
  // No ask from the fixture: each test makes its own.
  mock.state.shared.set("kelpie.next.asks", {});
  home = tempDir();
  mock.state.appHome = home;
  // The request and result files are real, in a temp Herdr home.
  mock.on.exec = (c, a, o) => mock.realExec(c, a, { ...o, env: { PATH: process.env.PATH } });
});

const request = (name, req) => put(`${home}/kelpie/${name}.json`, typeof req === "string" ? req : JSON.stringify(req));
const result = (name) => JSON.parse(readFileSync(`${home}/kelpie/${name}.result.json`, "utf8"));
const asks = () => mock.sharedValue("kelpie.next.asks")?.[DEMO] ?? [];
const agentOf = (tab) => world.agents.find((a) => a.tab_name === tab);
const queue = () => { const s = storyItems(); return needQueueOf(s.st.profile, s.items, s.reviews); };
const demo = () => profileById(DEMO);

describe("kelpie.add-next: an agent asks the person for something", () => {
  test("kept for the asking agent's profile, under its tab's name, linked to its story; the request removed", async () => {
    const asker = agentOf("ACME-175");
    request("next-add", { action: "Pick how trips are stored offline", why: "Two ways: I'd like your choice.", key: "ACME-175", terminal: asker.address });
    const r = await addNextRequest();
    assert.equal(r.ok, true);
    assert.equal(result("next-add").ok, true);
    assert.ok(!existsSync(`${home}/kelpie/next-add.json`), "the request is removed");
    const [ask] = asks();
    assert.equal(ask.action, "Pick how trips are stored offline");
    assert.equal(ask.key, "ACME-175");
    assert.equal(ask.terminal, asker.address);
    assert.equal(ask.tab, "ACME-175");
    assert.equal(ask.url, `${stories.data.site}/browse/ACME-175`);
  });

  test("in Next after the stories that need you, before the reviews", async () => {
    addAsk(demo(), { action: "Read my plan", terminal: agentOf("ACME-175").address });
    const keys = queue().map((x) => x.key);
    const at = keys.indexOf(`ask:${asks()[0].id}`);
    assert.ok(at > 0, "queued");
    assert.ok(keys.slice(0, at).every((k) => /^ACME-/.test(k)), "after the stories");
    assert.ok(keys.indexOf("review:web#421") > at, "before the reviews");
  });

  test("a subtask's key becomes its story's", () => {
    const sub = stories.data.children.find((c) => c.fields?.parent?.key);
    addAsk(demo(), { action: "Look at this", key: sub.key });
    assert.equal(asks()[0].key, sub.fields.parent.key);
  });

  for (const [what, req, error] of [
    ["a key that isn't a Jira key", { action: "Look", key: "ACME-1; rm -rf ~" }, /^key:/],
    ["a link off GitHub and the profile's Jira", { action: "Look", url: "https://evil.example/login" }, /^url:/],
    ["a link that looks like Jira's but isn't", { action: "Look", url: "https://jira.example.com.evil.example/x" }, /^url:/],
    ["a link that isn't https", { action: "Look", url: "javascript:alert(1)" }, /^url:/],
    ["no action", { action: " ", key: "ACME-175" }, /^action:/],
  ]) {
    test(`refuses ${what}, keeping nothing`, async () => {
      request("next-add", req);
      const r = await addNextRequest();
      assert.equal(r.ok, false);
      assert.match(result("next-add").error, error);
      assert.deepEqual(asks(), []);
    });
  }

  test("takes GitHub links and the profile's Jira, and strips control characters", () => {
    addAsk(demo(), { action: "Review\u001b[2J it\nnow", url: "https://github.com/kelpie--demo/web/pull/421" });
    addAsk(demo(), { action: "Read it", url: `${stories.data.site}/browse/ACME-180` });
    assert.deepEqual(asks().map((a) => [a.action, a.url]), [["Review [2J it now", "https://github.com/kelpie--demo/web/pull/421"], ["Read it", `${stories.data.site}/browse/ACME-180`]]);
  });

  test("an agent keeps its newest three; the same action again replaces its last", () => {
    const terminal = agentOf("ACME-175").address;
    for (const n of [1, 2, 3, 4]) addAsk(demo(), { action: `Ask number ${n}`, terminal });
    assert.deepEqual(asks().map((a) => a.action), ["Ask number 2", "Ask number 3", "Ask number 4"]);
    addAsk(demo(), { action: "Ask number 3", terminal });
    assert.deepEqual(asks().map((a) => a.action), ["Ask number 2", "Ask number 4", "Ask number 3"]);
  });

  test("goes once its agent's terminal is gone", () => {
    addAsk(demo(), { action: "Read my plan", terminal: agentOf("ACME-175").address });
    assert.ok(queue().some((x) => x.ask));
    mock.state.agents = mock.state.agents.filter((a) => a.tab_name !== "ACME-175");
    assert.ok(!queue().some((x) => x.ask));
  });

  test("a profile with no Jira board has no Next: refused, saying so", async () => {
    mock.state.shared.set("kelpie.profiles", { ...mock.state.shared.get("kelpie.profiles"), plain: { id: "plain", name: "Plain", folder: "/tmp/plain" } });
    request("next-add", { action: "Read my plan", profile: "plain" });
    assert.match((await addNextRequest()).error, /Plain has no Jira board/);
  });

  test("clicked in the open queue: it goes, and its story shows", async () => {
    addAsk(demo(), { action: "Read my plan", key: "ACME-180" });
    const { view, cx } = await draw(new StoryList());
    view.queueOpen = true;
    const el = view.render(cx);
    const id = `queue-ask:${asks()[0].id}`;
    assert.ok(byId(el, id));
    handlers(el).find((h) => h.id === id).fn({}, cx);
    assert.deepEqual(asks(), []);
    assert.equal(mock.sharedValue("kelpie.stories.preview")?.[DEMO], "ACME-180");
  });
});

describe("kelpie.suggest-next: Claude's picks handed in", () => {
  test("checked as What next?'s are, for the profile named, with what was kept and dropped", async () => {
    request("next-suggest", { profile: DEMO, items: [{ key: "ACME-180", action: "Start the PDF export", why: "next" }, { key: "nope", action: "x" }] });
    const r = await suggestNextRequest();
    assert.equal(r.ok, true);
    assert.deepEqual(r.kept, ["ACME-180: Start the PDF export"]);
    assert.deepEqual(r.dropped, [{ item: "nope", why: "not a Jira key" }]);
    assert.deepEqual(mock.sharedValue("kelpie.next.suggested")[DEMO].items.map((x) => x.key), ["ACME-180"]);
    assert.ok(!existsSync(`${home}/kelpie/next-suggest.json`));
  });
  test("refuses anything but a list of picks", async () => {
    request("next-suggest", { items: "ACME-180" });
    assert.match((await suggestNextRequest()).error, /^items:/);
    assert.equal(mock.sharedValue("kelpie.next.suggested") ?? null, null);
  });
});

describe("kelpie.get-next: the queue, for an agent to read", () => {
  test("Next's items in order, each with its kind, what to do and its link", async () => {
    addAsk(demo(), { action: "Read my plan", key: "ACME-175", terminal: agentOf("ACME-175").address });
    request("next-get", {});
    const r = await getNextRequest();
    assert.equal(r.ok, true);
    assert.equal(r.profile, "Acme");
    const kinds = r.items.map((x) => x.kind);
    assert.equal(kinds[0], "story");
    assert.ok(kinds.indexOf("agent-ask") < kinds.indexOf("review"));
    const story = r.items[0];
    assert.equal(story.url, `${stories.data.site}/browse/${story.key}`);
    const review = r.items.find((x) => x.kind === "review");
    assert.equal(review.key, "web#421");
    assert.match(review.url, /^https:\/\/github\.com\//);
    assert.deepEqual(r.items.find((x) => x.kind === "agent-ask"), { kind: "agent-ask", key: "ACME-175", action: "Read my plan", detail: `ACME-175 · ${stories.data.parents.find((p) => p.key === "ACME-175")?.fields.summary}`, url: `${stories.data.site}/browse/ACME-175` });
  });
  test("for the asking agent's profile, by its terminal", async () => {
    request("next-get", { terminal: agentOf("ACME-175").address });
    assert.equal((await getNextRequest()).profile, "Acme");
  });
});
