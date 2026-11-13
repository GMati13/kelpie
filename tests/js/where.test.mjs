// Where an agent runs (#106): every terminal Kelpie starts is told its profile and story
// (KELPIE_PROFILE, KELPIE_STORY: ui.js placed()), and `kelpie.get-story` / `kelpie.where-<terminal>`
// (stories.js getStoryRequest, whereRequest) answer the plugin's get_story tool and SessionStart hook
// from what Kelpie loaded.
import { DEMO, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mock } from "herdr";
import { put, tempDir } from "../lib/helpers.mjs";
import { placed, whereEnv } from "../../mods/kelpie/ui.js";
import { openDesk, shellArgv, claudeArgv } from "../../mods/kelpie/config.js";
import { StoryList, getStoryRequest, openTerminal, whereRequest } from "../../mods/kelpie/stories.js";

describe("the environment every terminal Kelpie starts gets", () => {
  beforeEach(() => mock.reset());
  const profile = { id: "w", name: "W", folder: "/work/acme", github: { account: "work-me" } };

  test("the profile's id and the story's key, given to env as arguments in front of the argv", () => {
    assert.deepEqual(whereEnv(profile, "ABC-1"), ["KELPIE_PROFILE=w", "KELPIE_STORY=ABC-1"]);
    assert.deepEqual(placed(["claude"], profile, "ABC-1"), ["env", "KELPIE_PROFILE=w", "KELPIE_STORY=ABC-1", "claude"]);
    // The shell's script stays the same: the values are env's arguments, never script.
    const shell = placed(shellArgv(profile), profile, "ABC-1");
    assert.deepEqual(shell.slice(0, 3), ["env", "KELPIE_PROFILE=w", "KELPIE_STORY=ABC-1"]);
    assert.deepEqual(shell.slice(3), shellArgv(profile));
  });
  test("no story (the Desk, another space) is an empty KELPIE_STORY, and a key that isn't one is left out", () => {
    assert.deepEqual(whereEnv(profile), ["KELPIE_PROFILE=w", "KELPIE_STORY="]);
    for (const bad of ["pull:web#4", "ABC-1; rm -rf ~", "abc-1", "ABC-1\nX=1", "-u"]) assert.deepEqual(whereEnv(profile, bad), ["KELPIE_PROFILE=w", "KELPIE_STORY="], bad);
  });
  test("a profile id that isn't one sets nothing, and the argv stays as it was", () => {
    for (const id of ["../w", "W", "w x", "-u", "", null]) assert.deepEqual(placed(["claude"], { id }, "ABC-1"), ["claude"], String(id));
    assert.deepEqual(placed(["claude"], null, "ABC-1"), ["claude"]);
  });
  test("ids and keys only: no token, nothing else of the profile", () => {
    const argv = placed(claudeArgv({ ...profile, jira: { token: "s3cret" } }), profile, "ABC-1");
    assert.ok(!argv.join(" ").includes("s3cret"));
    assert.deepEqual(argv.filter((a) => a.startsWith("KELPIE_") && !a.startsWith("KELPIE_GH_")), ["KELPIE_PROFILE=w", "KELPIE_STORY=ABC-1"]);
  });
  test("a story's terminal is told its story", async () => {
    mock.state.spaces = [{ id: "s1", name: "ABC-1", folder: "/work/acme", active: true, tabs: [] }];
    await openTerminal(profile, { key: "ABC-1", subs: [], space: { id: "s1" } });
    const [tab] = mock.of("run").filter(([n]) => n === "tab.new").map(([, a]) => a);
    assert.deepEqual(tab.argv.slice(0, 3), ["env", "KELPIE_PROFILE=w", "KELPIE_STORY=ABC-1"]);
    assert.deepEqual(tab.argv.slice(3), shellArgv(profile));
  });
  test("the Desk's first agent is told the profile, and no story", () => {
    mock.state.spaces = [];
    openDesk(profile);
    const [made] = mock.of("run").filter(([n]) => n === "space.new").map(([, a]) => a);
    assert.deepEqual(made.argv, ["env", "KELPIE_PROFILE=w", "KELPIE_STORY=", ...claudeArgv(profile)]);
  });
});

describe("kelpie.get-story and kelpie.where-<terminal>", () => {
  let stories, home, world;
  before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });
  beforeEach(() => {
    world = setupDemoWorld({ stories });
    home = tempDir();
    mock.state.appHome = home;
    mock.on.exec = (c, a, o) => mock.realExec(c, a, { ...o, env: { PATH: process.env.PATH } });
  });
  const request = (name, req) => put(`${home}/kelpie/${name}.json`, JSON.stringify(req));
  const result = (name) => JSON.parse(readFileSync(`${home}/kelpie/${name}.result.json`, "utf8"));
  const withSubs = () => stories.data.parents.find((p) => stories.data.children.some((c) => c.fields?.parent?.key === p.key));
  const subOf = (key) => stories.data.children.find((c) => c.fields?.parent?.key === key);
  const agentIn = (key) => world.agents.find((a) => world.spaces.find((s) => s.id === a.space)?.name === key);

  test("a story by key: its status, subtasks with assignees, pull requests, agents and when it loaded", async () => {
    const p = withSubs();
    request("story-get", { key: p.key });
    const r = await getStoryRequest();
    assert.equal(r.ok, true, r.error);
    assert.ok(!existsSync(`${home}/kelpie/story-get.json`), "the request is removed");
    const s = result("story-get").story;
    assert.equal(s.key, p.key);
    assert.equal(s.title, p.fields.summary);
    assert.equal(s.status, p.fields.status.name);
    assert.deepEqual(s.subtasks.map((x) => x.key), stories.data.children.filter((c) => c.fields?.parent?.key === p.key).map((c) => c.key));
    for (const x of s.subtasks) assert.ok("status" in x && "assignee" in x && typeof x.yours === "boolean", x.key);
    assert.ok(Array.isArray(s.pullRequests) && Array.isArray(s.agents));
    assert.match(s.loaded, /ago$|^just now$/);
    assert.ok(s.needs);
  });
  test("a subtask's key gives its story", async () => {
    const p = withSubs();
    request("story-get", { key: subOf(p.key).key });
    await getStoryRequest();
    assert.equal(result("story-get").story.key, p.key);
  });
  test("an unknown key, or one that isn't a key, is refused", async () => {
    for (const key of ["ZZZ-999", "ACME-1; rm"]) {
      request("story-get", { key });
      const r = await getStoryRequest();
      assert.equal(r.ok, false, key);
      assert.match(result("story-get").error, key === "ZZZ-999" ? /isn't a story or subtask/ : /^key:/);
    }
  });
  test("no key: the asking agent's own story, from its terminal, with where it runs", async () => {
    const p = withSubs();
    const space = world.spaces.find((s) => s.name === p.key) ?? world.spaces.find((s) => /^ACME-\d+$/.test(s.name));
    const agent = world.agents.find((a) => a.space === space.id);
    request("story-get", { terminal: agent.address });
    await getStoryRequest();
    const out = result("story-get");
    assert.equal(out.where.profile.id, DEMO);
    assert.equal(out.where.place, "story");
    assert.equal(out.where.key, space.name);
    assert.equal(out.story.key, space.name);
  });
  test("no key and no terminal Kelpie knows: the story the environment names", async () => {
    const p = withSubs();
    request("story-get", { profile: DEMO, story: p.key });
    await getStoryRequest();
    const out = result("story-get");
    assert.deepEqual([out.where.place, out.where.key, out.story.key], ["story", p.key, p.key]);
    assert.equal(out.where.title, p.fields.summary);
  });
  test("on the Desk: where says so, and there's no story to answer about", async () => {
    const desk = world.spaces.find((s) => s.name === "Desk");
    const agent = world.agents.find((a) => a.space === desk.id);
    request("story-get", { terminal: agent.address });
    await getStoryRequest();
    const out = result("story-get");
    assert.deepEqual(out.where, { profile: { id: DEMO, name: out.where.profile.name }, place: "desk" });
    assert.equal(out.story, null);
    assert.match(out.why, /Desk/);
  });
  test("where-<terminal>: the agent's profile, story, title and subtasks, in a file of its own", async () => {
    const space = world.spaces.find((s) => /^ACME-\d+$/.test(s.name));
    const agent = world.agents.find((a) => a.space === space.id);
    request(`where-${agent.address}`, { terminal: agent.address });
    await whereRequest(agent.address);
    const { where } = result(`where-${agent.address}`);
    assert.equal(where.profile.id, DEMO);
    assert.equal(where.place, "story");
    assert.equal(where.key, space.name);
    assert.ok(Array.isArray(where.subtasks));
  });
  test("where-<terminal>: a terminal in no Kelpie space is nowhere; a name that isn't a terminal's runs nothing", async () => {
    request("where-t999", {});
    await whereRequest("t999");
    assert.equal(result("where-t999").where, null);
    assert.equal(whereRequest("../x"), null);
  });
});
