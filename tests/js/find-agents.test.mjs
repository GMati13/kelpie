// The agents Kelpie knows, found and shown through the Claude plugin (stories.js findAgentsRequest,
// showAgentRequest): what `kelpie.find-agents` and `kelpie.show-agent` take from their request files
// (any program can run the commands, so every value is checked), what they answer, and that only an
// agent in Herdr's own list is shown. The demo's agents say what they work on from the fixture's
// `work`; two of them changed web/src/theme/tokens.ts in the same folder.
import { DEMO, FOLDER, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mock } from "herdr";
import { put, tempDir } from "../lib/helpers.mjs";
import { StoryList, claudeOf, findAgentsRequest, showAgentRequest } from "../../mods/kelpie/stories.js";

let stories, home, world;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });
beforeEach(() => {
  world = setupDemoWorld({ stories });
  home = tempDir();
  mock.state.appHome = home;
  // The request and result files are real, in a temp Herdr home.
  mock.on.exec = (c, a, o) => mock.realExec(c, a, { ...o, env: { PATH: process.env.PATH } });
});

const request = (name, req) => put(`${home}/kelpie/${name}.json`, typeof req === "string" ? req : JSON.stringify(req));
const result = (name) => JSON.parse(readFileSync(`${home}/kelpie/${name}.result.json`, "utf8"));
const agentOf = (tab) => world.agents.find((a) => a.tab_name === tab);
const find = async (req) => { request("agents-find", req); return findAgentsRequest(); };

describe("kelpie.find-agents: the agents Kelpie knows", () => {
  test("every agent, with its tab, space, profile, story, state, folder and what it works on; the request removed", async () => {
    const r = await find({});
    assert.equal(r.ok, true);
    assert.equal(result("agents-find").ok, true);
    assert.ok(!existsSync(`${home}/kelpie/agents-find.json`), "the request is removed");
    assert.equal(r.agents.length, world.agents.length);
    const a = r.agents.find((x) => x.tab === "ACME-143");
    assert.equal(a.id, agentOf("ACME-143").address);
    assert.equal(a.space, "ACME-142");
    assert.equal(a.profile, "Acme");
    assert.equal(a.key, "ACME-143");
    assert.equal(a.story, "ACME-142");
    assert.equal(a.state, "waiting for you");
    assert.equal(a.folder, FOLDER);
    assert.equal(a.title, "Cache trips for offline use");
    assert.equal(a.first, "Work on Jira ACME-143: Cache trips in IndexedDB");
    assert.deepEqual(a.changed.map((f) => f.path), [`${FOLDER}/ACME-142/web/src/trips/store.ts`, `${FOLDER}/ACME-142/web/src/trips/cache.ts`]);
    assert.match(a.changed[0].at, /^\d{4}-\d\d-\d\dT/);
    assert.equal(a.you, undefined, "nobody asked from a terminal");
  });

  test("the asking agent is marked as itself", async () => {
    const r = await find({ terminal: agentOf("ACME-175").address });
    assert.equal(r.agents.find((x) => x.you)?.tab, "ACME-175");
    assert.equal(r.agents.filter((x) => x.you).length, 1);
  });

  test("by a file: the agents whose sessions changed it, a relative path or a full one", async () => {
    for (const file of ["web/src/theme/tokens.ts", `${FOLDER}/web/src/theme/tokens.ts`]) {
      const r = await find({ file });
      assert.deepEqual(r.agents.map((x) => x.tab).sort(), ["ACME-172", "Claude"], file);
      assert.deepEqual(r.agents.map((x) => x.changed.map((f) => f.path)), [[`${FOLDER}/web/src/theme/tokens.ts`], [`${FOLDER}/web/src/theme/tokens.ts`]]);
    }
    // A path ending only part of a folder's name doesn't count.
    assert.deepEqual((await find({ file: "theme/okens.ts" })).agents, []);
  });

  test("by a ticket key: its own, or its story's", async () => {
    assert.deepEqual((await find({ key: "ACME-143" })).agents.map((x) => x.tab), ["ACME-143"]);
    assert.deepEqual((await find({ key: "acme-142" })).agents.map((x) => x.tab), ["ACME-143"]);
    assert.deepEqual((await find({ key: "ACME-999" })).agents, []);
  });

  test("by a folder: working in it, under it, or it inside theirs", async () => {
    assert.equal((await find({ folder: FOLDER })).agents.length, world.agents.length);
    assert.equal((await find({ folder: `${FOLDER}/web/src` })).agents.length, world.agents.length);
    assert.deepEqual((await find({ folder: "/somewhere/else" })).agents, []);
    assert.match((await find({ folder: "web" })).error, /^folder:/);
  });

  test("by words, in its names, title, ticket or first message", async () => {
    assert.deepEqual((await find({ words: "web BUNDLE" })).agents.map((x) => x.tab), ["Claude"]);
    assert.deepEqual((await find({ words: "dark mode" })).agents.map((x) => x.tab), ["ACME-172"]);
  });

  test("with `here`, the asking agent's profile's only", async () => {
    world.agents.push({ address: "x9", space: "sx", tab: "tx", pane: "px", tab_name: "Elsewhere", status: "working", title: "", program: { name: "Claude Code", agent: true } });
    mock.state.agents = world.agents;
    mock.state.spaces.push({ id: "sx", name: "Other", folder: "/other", tabs: [{ id: "tx", name: "Elsewhere" }] });
    assert.ok((await find({})).agents.some((x) => x.tab === "Elsewhere"), "everywhere by default, its profile none");
    const r = await find({ here: true, terminal: agentOf("ACME-175").address });
    assert.equal(r.profile, "Acme");
    assert.ok(!r.agents.some((x) => x.tab === "Elsewhere"));
  });

  test("the shown profile's agents are read first, so a crowd of other windows' agents can't push them past the cut", async () => {
    // herdr-core lists every Herdr window's agents; in a live run 64 were open and the demo's came last.
    const crowd = Array.from({ length: 120 }, (_, i) => ({ address: `x${i}`, space: "sx", tab: "tx", pane: `px${i}`, tab_name: `Other ${i}`, status: "idle", title: "", program: { name: "Claude Code", agent: true } }));
    world.agents.unshift(...crowd);
    mock.state.agents = world.agents;
    mock.state.spaces.unshift({ id: "sx", name: "Other", folder: "/other", tabs: [{ id: "tx", name: "Other" }] });
    const r = await find({ file: "web/src/theme/tokens.ts" });
    assert.deepEqual(r.agents.map((x) => x.tab).sort(), ["ACME-172", "Claude"]);
    assert.ok(r.more > 0, "the rest are said to be left out");
  });

  test("a real agent's work comes from its own Claude session, read by agent-work.py", async () => {
    setupDemoWorld({ stories, profile: { demo: false } });
    mock.state.appHome = home;
    const sid = "0b6d8f9e-1c2a-4e5f-9a7b-3c4d5e6f7a8b", fake = tempDir();
    const at = "2026-01-01T10:00:00Z";
    put(`${fake}/.claude/projects/-acme/${sid}.jsonl`, [
      { type: "user", message: { role: "user", content: "Trim the bundle" } },
      { type: "assistant", timestamp: at, message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "/acme/web/vite.config.ts" } }] } },
    ].map((x) => JSON.stringify(x)).join("\n") + "\n");
    const asked = mock.state.agents.find((a) => a.tab_name === "Claude").address;
    // Only that terminal's foreground process has a session record (ui.js claudeSession).
    mock.on.hc = (args) => (args[0] === "get" ? { code: 0, stdout: JSON.stringify(args[1] === asked ? { foreground: { pid: 4242 } } : {}), stderr: "" } : undefined);
    mock.on.exec = (c, a, o) => {
      if (c === "sh" && String(a[1]).includes("/sessions/")) return { code: 0, stdout: `\n${JSON.stringify({ pid: 4242, sessionId: sid, cwd: "/acme", name: "acme-bundle", messagingSocketPath: "/tmp/cc-socks/4242.sock" })}`, stderr: "" };
      return mock.realExec(c, a, { ...o, env: { PATH: process.env.PATH, HOME: fake } });
    };
    const r = await find({ file: "web/vite.config.ts" });
    assert.deepEqual(r.agents.map((x) => [x.tab, x.first, x.changed]), [["Claude", "Trim the bundle", [{ path: "/acme/web/vite.config.ts", at }]]]);
    // The Claude agent itself, as another Claude reaches it: its session's name and messaging address.
    assert.deepEqual(r.agents[0].claude, { name: "acme-bundle", address: "uds:/tmp/cc-socks/4242.sock", session: sid });
    const python = mock.of("exec").filter(([c]) => c === "python3");
    assert.equal(python.length, 1, "one run for the machine");
    assert.deepEqual(python[0][1].slice(3), ["", sid], "only the session's own account and id go to the script");
    assert.deepEqual((await find({ words: "acme-bundle" })).agents.map((x) => x.tab), ["Claude"], "found by its session's name too");
  });

  test("the demo's agents are stand-ins: no Claude to reach", async () => {
    const r = await find({ key: "ACME-172" });
    assert.equal(r.agents[0].tab, "ACME-172");
    assert.equal(r.agents[0].claude, undefined);
  });

  describe("claudeOf: the Claude agent from its session record, each part only in its expected shape", () => {
    const rec = { pid: 5910, sessionId: "3bd7e161-bb18-4641-befd-8da94b9f5b68", name: "kelpie-70-0d", messagingSocketPath: "/tmp/cc-socks/5910.sock" };
    test("name, address and session", () => {
      assert.deepEqual(claudeOf(rec, true), { name: "kelpie-70-0d", address: "uds:/tmp/cc-socks/5910.sock", session: rec.sessionId });
    });
    test("an agent on another machine gets no address: its socket isn't a file here", () => {
      assert.deepEqual(claudeOf(rec, false), { name: "kelpie-70-0d", session: rec.sessionId });
    });
    for (const path of ["/tmp/cc-socks/1.sock", "tmp/cc-socks/5910.sock", "/tmp/cc-socks/../x/5910.sock", "/tmp/cc socks/5910.sock", "/tmp/cc-socks/5910.sock;rm", "/tmp/cc-socks/5910.sock\n", 42]) {
      test(`refuses the socket ${JSON.stringify(path)}`, () => {
        assert.equal(claudeOf({ ...rec, messagingSocketPath: path }, true).address, undefined);
      });
    }
    test("refuses a name with control characters and an id of other characters; nothing left is null", () => {
      assert.equal(claudeOf({ ...rec, name: "evil\u001b]0;x\u0007" }, true).name, undefined);
      assert.equal(claudeOf({ ...rec, sessionId: "../../x" }, true).session, undefined);
      assert.equal(claudeOf({ pid: 1 }, true), null);
      assert.equal(claudeOf(null, true), null);
    });
  });

  for (const key of ["../../etc/passwd", "ACME-180; rm -rf ~", "acme", "-ACME-1"]) {
    test(`refuses the key ${JSON.stringify(key)}`, async () => {
      assert.match((await find({ key })).error, /^key:/);
    });
  }
  test("a request that isn't JSON fails in words", async () => {
    request("agents-find", "{not json");
    assert.equal((await findAgentsRequest()).ok, false);
  });
});

describe("kelpie.find-agents by a ticket key nobody of its own works on (#237)", () => {
  const tabs = (r) => r.agents.map((x) => x.tab);
  test("a subtask with its own tab's agent: only that one, not marked", async () => {
    const r = await find({ key: "ACME-143" });
    assert.deepEqual(tabs(r), ["ACME-143"]);
    assert.equal(r.agents[0].via, undefined);
    assert.equal(r.nobody, undefined);
  });
  test("a story's key: every agent of its space, as before", async () => {
    const r = await find({ key: "ACME-142" });
    assert.deepEqual(tabs(r), ["ACME-143"]);
    assert.equal(r.agents[0].via, undefined);
  });
  test("a subtask without: its story's agents, each marked as the story's", async () => {
    const r = await find({ key: "ACME-144" });
    assert.deepEqual(tabs(r), ["ACME-143"]);
    assert.equal(r.agents[0].via, "story");
    assert.equal(r.agents[0].note, "On the story ACME-142, not on ACME-144 itself.");
    assert.equal(r.nobody, undefined);
  });
  test("nobody on the subtask or its story: said so, with its earlier session to resume", async () => {
    const r = await find({ key: "ACME-181" });
    assert.deepEqual(r.agents, []);
    assert.equal(r.nobody, "Nobody is working on ACME-181 or its story ACME-180 right now.");
    assert.deepEqual(r.resumable.map((x) => [x.kind, x.key, x.title]), [["session", "ACME-181", "Sketch the PDF itinerary layout"]]);
    assert.match(r.resumable[0].at, /^\d{4}-\d\d-\d\dT/);
  });
  test("a paused agent on the story counts, listed once with its session's title", async () => {
    const r = await find({ key: "ACME-139" });
    assert.deepEqual(r.resumable.map((x) => [x.kind, x.key, x.title]), [["paused", "ACME-138", "Token bucket per API key"]]);
  });
  test("nobody and nothing to resume: only said so", async () => {
    const r = await find({ key: "ACME-182" });
    assert.equal(r.nobody, "Nobody is working on ACME-182 or its story ACME-180 right now.");
    assert.equal(r.resumable, undefined);
  });
  test("a key the board doesn't know: no story to fall back on, none", async () => {
    const r = await find({ key: "ACME-999" });
    assert.deepEqual(r.agents, []);
    assert.equal(r.nobody, "Nobody is working on ACME-999 right now.");
    assert.equal(r.resumable, undefined);
  });
});

describe("kelpie.show-agent: an agent's pane shown", () => {
  test("its space selected and its pane focused, no other profile picked over it, no preview covering it", async () => {
    mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-180" });
    mock.state.shared.set("kelpie.profile.chosen", { id: "other", space: null });
    const a = agentOf("ACME-172");
    request("agent-show", { id: a.address });
    const r = await showAgentRequest();
    assert.deepEqual(r, { ok: true, shown: { tab: "ACME-172", space: "ACME-171", profile: "Acme", state: "idle" } });
    assert.ok(!existsSync(`${home}/kelpie/agent-show.json`), "the request is removed");
    assert.deepEqual(mock.of("run").filter(([n]) => n === "space.select" || n === "pane.focus"), [["space.select", { id: a.space }], ["pane.focus", { pane: a.pane }]]);
    assert.equal(mock.sharedValue("kelpie.stories.preview")?.[DEMO] ?? null, null);
    assert.equal(mock.sharedValue("kelpie.profile.chosen"), null);
  });

  test("a story space showing its Changes shows its terminals again", async () => {
    const a = agentOf("ACME-172");
    mock.state.shared.set("kelpie.view", { [a.space]: "changes" });
    request("agent-show", { id: a.address });
    await showAgentRequest();
    assert.equal(mock.sharedValue("kelpie.view")[a.space], "agent");
  });

  // An id is only compared with Herdr's own list: anything else shows nothing and runs nothing.
  for (const id of ["a99-9", "s0", "p0-0", "; rm -rf ~", "", null, 42, { address: "a0-0" }]) {
    test(`refuses the id ${JSON.stringify(id)}, running nothing`, async () => {
      request("agent-show", { id });
      const r = await showAgentRequest();
      assert.equal(r.ok, false);
      assert.match(r.error, /find_agents/);
      assert.deepEqual(mock.of("run"), []);
    });
  }
});
