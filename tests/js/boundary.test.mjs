// The account boundary (boundary.js, #254): who asks through the plugin, and which profiles it may
// see. Two profiles on two Claude accounts (Work on ~/.claude-work, Home on Claude's own ~/.claude),
// each with a space and an agent, and a plain space of no profile with an agent of its own.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { accountKey, agentProfilesFor, allowedFor, crossedTo, whoAsks, mayReach, mayReachAgent, profileFor } from "../../mods/kelpie/boundary.js";
import { saveProfile, setShare, sharedWith } from "../../mods/kelpie/config.js";

const WORK = "/home/test/.claude-work";
const agent = (address, space) => ({ address, space, tab: `t-${address}`, pane: `p-${address}`, tab_name: address, status: "idle", title: "", program: { name: "Claude Code", agent: true } });
let sessions;
// What each terminal's own Claude session says of its account (claudeSession: config null is ~/.claude).
const session = async (address) => (address in sessions ? { sessionId: `id-${address}`, config: sessions[address] } : null);
const ask = (req) => whoAsks(req, { session });

beforeEach(() => {
  mock.reset();
  mock.state.home = "/home/test";
  mock.state.spaces = [
    { id: "sw", name: "WORK-1", folder: "/work", tabs: [] },
    { id: "sh", name: "HOME-1", folder: "/home-projects", tabs: [] },
    { id: "sp", name: "Scratch", folder: "/elsewhere", tabs: [] },
  ];
  mock.state.agents = [agent("aw", "sw"), agent("ah", "sh"), agent("ap", "sp")];
  mock.state.panes = [];
  mock.state.shared.set("kelpie.profiles", {
    work: { id: "work", name: "Work", folder: "/work", claude: { config: WORK } },
    home: { id: "home", name: "Home", folder: "/home-projects", claude: null },
  });
  mock.state.shared.set("kelpie.space.profile", { sw: "work", sh: "home" });
  sessions = { aw: WORK, ah: null, ap: null };
});

describe("who asks", () => {
  test("an agent in a profile's space, on that profile's account, is that profile's", async () => {
    const a = await ask({ terminal: "aw", account: WORK });
    assert.equal(a.profile?.id, "work");
    assert.equal(a.how, "terminal");
    assert.equal((await ask({ terminal: "ah", account: "" })).profile?.id, "home");
  });

  test("the terminal's space wins over what the environment names", async () => {
    sessions.aw = WORK;
    const a = await ask({ terminal: "aw", profile: "home", account: "" });
    assert.equal(a.profile?.id, "work", "KELPIE_PROFILE naming another profile changes nothing");
  });

  test("the terminal's own Claude session says the account, not the request", async () => {
    // A Claude on Claude's own account in Work's space, claiming Work's account: refused.
    sessions.aw = null;
    const a = await ask({ terminal: "aw", account: WORK });
    assert.equal(a.profile, null);
    assert.match(a.why, /another Claude account/);
    assert.deepEqual(allowedFor(a), [], "nor the profiles of the account it does run on");
  });

  test("a Claude on another account than its space's profile gets no profile", async () => {
    sessions.ah = WORK;
    const a = await ask({ terminal: "ah" });
    assert.equal(a.profile, null);
    assert.equal(a.account, WORK);
    assert.match(a.why, /^You run on another Claude account than the profile this space belongs to/);
    assert.ok(!a.why.includes("Home"), "the profile it's kept from isn't named");
  });

  test("with no terminal Kelpie knows, KELPIE_PROFILE counts, on that profile's account only", async () => {
    const a = await ask({ profile: "work", account: `${WORK}/` });
    assert.equal(a.profile?.id, "work");
    assert.equal(a.how, "environment");
    assert.equal((await ask({ profile: "work", account: "" })).profile, null);
    assert.equal((await ask({ profile: "home", account: "/home/test/.claude" })).profile?.id, "home", "~/.claude is Claude's own");
  });

  test("an account Kelpie can't tell is no account: nothing", async () => {
    sessions = {};
    const a = await ask({ profile: "work" });
    assert.equal(a.profile, null);
    assert.match(a.why, /which Claude account/);
    assert.deepEqual(allowedFor(a), []);
    assert.deepEqual(allowedFor(await ask({})), []);
  });

  test("the profile shown on screen is never taken for the asker's", async () => {
    mock.state.spaces[0].active = true;
    mock.state.shared.set("kelpie.profile.chosen", { id: "work", space: "sw" });
    const a = await ask({ account: "" });
    assert.equal(a.profile, null);
    const none = await ask({ account: "/home/test/.claude-nobody" });
    assert.throws(() => profileFor(none), /can't tell which of its profiles/);
  });
});

describe("what it may see", () => {
  test("its own profile only, even beside another profile on the same account", async () => {
    mock.state.shared.set("kelpie.profiles", { ...mock.state.shared.get("kelpie.profiles"), side: { id: "side", name: "Side", folder: "/side", claude: { config: WORK } } });
    const a = await ask({ terminal: "aw" });
    assert.deepEqual(allowedFor(a).map((p) => p.id), ["work"]);
    assert.ok(mayReach(a, { id: "work" }));
    assert.ok(!mayReach(a, { id: "side" }), "a profile is the unit, the account only a check");
    assert.ok(!mayReach(a, { id: "home" }));
  });

  test("a Claude in no profile's space: the profiles on its own account", async () => {
    const a = await ask({ terminal: "ap", account: WORK });
    assert.equal(a.profile, null);
    assert.equal(a.account, "", "its own session says Claude's own account");
    assert.deepEqual(allowedFor(a).map((p) => p.id), ["home"]);
    assert.equal(profileFor(a).id, "home");
    assert.deepEqual(allowedFor(await ask({ account: WORK })).map((p) => p.id), ["work"]);
  });

  test("more than one profile on its account: none picked for it", async () => {
    mock.state.shared.set("kelpie.profiles", { ...mock.state.shared.get("kelpie.profiles"), side: { id: "side", name: "Side", folder: "/side", claude: { config: WORK } } });
    const a = await ask({ account: WORK });
    assert.deepEqual(allowedFor(a).map((p) => p.id).sort(), ["side", "work"]);
    assert.throws(() => profileFor(a), /more than one runs on your Claude account/);
  });

  test("an agent in a plain space: only for an asker on that agent's own account", async () => {
    const work = await ask({ terminal: "aw" }), home = await ask({ terminal: "ah" });
    assert.ok(mayReachAgent(home, { profile: null, account: "" }));
    assert.ok(!mayReachAgent(work, { profile: null, account: "" }));
    assert.ok(!mayReachAgent(home, { profile: null, account: null }), "an agent whose account isn't known: nobody");
    assert.ok(mayReachAgent(work, { profile: { id: "work" }, account: null }));
    assert.ok(!mayReachAgent(work, { profile: { id: "home" }, account: "" }));
  });

  test("accounts compare however they're written", () => {
    assert.equal(accountKey(undefined), null);
    assert.equal(accountKey(5), null);
    assert.equal(accountKey(null), "");
    assert.equal(accountKey(""), "");
    assert.equal(accountKey("/home/test/.claude/"), "");
    assert.equal(accountKey(`${WORK}//`), WORK);
  });
});

// Two profiles the person paired in the profile dialog (config.js SHARE): agents only.
describe("a pair the person allowed", () => {
  test("its Claudes reach each other's agents, both ways, and nothing else", async () => {
    setShare("work", "home", true);
    assert.deepEqual(mock.sharedValue("kelpie.share"), ["home|work"], "one entry for both sides");
    const work = await ask({ terminal: "aw" }), home = await ask({ terminal: "ah" });
    assert.deepEqual(agentProfilesFor(work).map((p) => p.id), ["work", "home"]);
    assert.deepEqual(agentProfilesFor(home).map((p) => p.id), ["home", "work"]);
    assert.ok(mayReachAgent(work, { profile: { id: "home" } }));
    assert.ok(crossedTo(work, { id: "home" }), "said to cross");
    assert.ok(!crossedTo(work, { id: "work" }));
    assert.deepEqual(allowedFor(work).map((p) => p.id), ["work"], "settings, Next and stories stay its own");
    assert.ok(!mayReach(work, { id: "home" }));
  });

  test("unpaired, or paired with a third, it reaches nothing more", async () => {
    mock.state.shared.set("kelpie.profiles", { ...mock.state.shared.get("kelpie.profiles"), side: { id: "side", name: "Side", folder: "/side", claude: null } });
    setShare("home", "side", true);
    const work = await ask({ terminal: "aw" });
    assert.deepEqual(agentProfilesFor(work).map((p) => p.id), ["work"]);
    assert.ok(!mayReachAgent(work, { profile: { id: "home" } }));
    setShare("home", "side", false);
    assert.deepEqual(mock.sharedValue("kelpie.share"), []);
  });

  test("a stray entry in the shared key counts for nothing; a deleted profile's pairs go with it", () => {
    mock.state.shared.set("kelpie.share", ["work|home|side", "work", 5, "work|work", "home|work"]);
    assert.deepEqual(sharedWith("work"), ["home"]);
    saveProfile("home", null);
    assert.deepEqual(mock.sharedValue("kelpie.share"), ["work|home|side", "work", 5, "work|work"].filter((k) => typeof k === "string" && /^[a-z0-9-]+\|[a-z0-9-]+$/.test(k) && !k.split("|").includes("home")));
    assert.deepEqual(sharedWith("work"), []);
  });
});
