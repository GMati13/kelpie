// Pausing the Desk (desk.js pauseDesk, #16): its agents' Claude sessions kept by profile in shared
// "kelpie.desk.paused", the Desk closed, and the sessions offered again, first, in the menu that
// opens it.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { texts } from "gpui-kit";
import { deskPaused, deskRows, pauseDesk, pauseDeskByKey, resumeDesk } from "../../mods/kelpie/desk.js";
import { saveProfile } from "../../mods/kelpie/config.js";

const profile = { id: "w", name: "W", folder: "/work/acme" };
const T = new Proxy({}, { get: () => "#808080" });

// The Desk open with two Claude agents in tabs of their own, and a profile it belongs to. Each agent's
// Claude session is found from its terminal (ui.js claudeSession): `missing` ones have none.
function world({ missing = [], status = "idle", plain = false } = {}) {
  mock.state.shared.set("kelpie.profiles", { w: profile });
  mock.state.shared.set("kelpie.desk", { w: "d1" });
  mock.state.shared.set("kelpie.space.profile", { d1: "w" });
  const tabs = [{ id: "t1", name: "Claude" }, { id: "t2", name: "Idea: tidy" }, ...(plain ? [{ id: "t3", name: "Terminal" }] : [])];
  mock.state.spaces = [{ id: "d1", name: "Desk", folder: "/work/acme", active: true, tabs }];
  mock.state.agents = [
    { address: "term-1", space: "d1", tab: "t1", pane: "p1", tab_name: "Claude", status },
    { address: "term-2", space: "d1", tab: "t2", pane: "p2", tab_name: "Idea: tidy", status: "idle" },
  ];
  mock.state.panes = [{ id: "p1", tab: "t1" }, { id: "p2", tab: "t2" }];
  const pid = { "term-1": 101, "term-2": 102 };
  mock.on.hc = (args) => (args[0] === "get" ? { code: 0, stdout: JSON.stringify({ foreground: { pid: pid[args[1]] } }), stderr: "" } : undefined);
  mock.on.exec = (cmd, args) => {
    if (cmd !== "sh" || args[0] !== "-c") return undefined;
    const p = Number(args.at(-1));
    const term = Object.keys(pid).find((k) => pid[k] === p);
    return { code: 0, stdout: `\n${missing.includes(term) ? "null" : JSON.stringify({ sessionId: `s-${p}`, cwd: "/work/acme/web" })}`, stderr: "" };
  };
}
const runs = (name) => mock.of("run").filter(([n]) => n === name).map(([, a]) => a);

beforeEach(() => mock.reset());

describe("pausing the Desk", () => {
  test("keeps every agent's session under the profile and closes the Desk", async () => {
    world();
    await pauseDesk(profile);
    assert.deepEqual(deskPaused(profile).map((p) => [p.sessionId, p.name, p.cwd]),
      [["s-101", "Claude", "/work/acme/web"], ["s-102", "Idea: tidy", "/work/acme/web"]]);
    assert.deepEqual(runs("space.close"), [{ id: "d1", confirmed: true }]);
  });
  test("an agent with no Claude session keeps the Desk open, with it; the others close", async () => {
    world({ missing: ["term-2"] });
    await pauseDesk(profile);
    assert.deepEqual(deskPaused(profile).map((p) => p.sessionId), ["s-101"]);
    assert.deepEqual(runs("space.close"), [], "the Desk stays");
    assert.deepEqual(runs("tab.close"), [{ id: "t1", confirmed: true }], "only the kept agent's tab closes");
    assert.match(mock.of("notify")[0][0].title, /Idea: tidy/);
  });
  test("pausing again doesn't keep a session twice", async () => {
    world();
    await pauseDesk(profile);
    await pauseDesk(profile);
    assert.equal(deskPaused(profile).length, 2);
  });
  test("⌥⌘P on a working Desk asks first; pressed again it pauses", async () => {
    world({ status: "working" });
    mock.state.focused = { terminal: "elsewhere" };
    const armed = { what: null, at: 0 };
    await pauseDeskByKey(profile, armed);
    assert.equal(deskPaused(profile).length, 0);
    assert.match(mock.of("notify")[0][0].title, /working/);
    await pauseDeskByKey(profile, armed);
    assert.equal(deskPaused(profile).length, 2);
    assert.equal(runs("space.close").length, 1);
  });
  test("⌥⌘P on a Desk agent pauses only it", async () => {
    world();
    mock.state.focused = { terminal: "term-2" };
    await pauseDeskByKey(profile, { what: null, at: 0 });
    assert.deepEqual(deskPaused(profile).map((p) => p.sessionId), ["s-102"]);
    assert.deepEqual(runs("tab.close"), [{ id: "t2", confirmed: true }]);
    assert.deepEqual(runs("space.close"), []);
  });
  test("tabs with no agent make it ask first, as they close with it", async () => {
    world({ plain: true });
    mock.state.focused = null;
    await pauseDeskByKey(profile, { what: null, at: 0 });
    assert.equal(deskPaused(profile).length, 0);
    assert.match(mock.of("notify")[0][0].title, /^A tab with no agent closes too$/);
  });
  test("a deleted profile's paused Desk agents go with it", () => {
    mock.state.shared.set("kelpie.desk.paused", { w: [{ sessionId: "s-1", cwd: "/x", name: "Claude", at: 1 }], v: [] });
    saveProfile("w", null);
    assert.equal(mock.sharedValue("kelpie.desk.paused").w, undefined);
  });
});

describe("resuming the Desk", () => {
  const paused = [{ sessionId: "s-101", cwd: "/work/acme/web", name: "Claude", at: Date.now() - 5 * 60e3 }, { sessionId: "s-102", cwd: "/work/acme", name: "Idea: tidy", at: Date.now() }];
  test("the closed Desk offers its paused agents first in the menu that opens it", () => {
    mock.state.shared.set("kelpie.profiles", { w: profile });
    mock.state.shared.set("kelpie.desk.paused", { w: paused });
    const words = texts(deskRows(T, {}, profile));
    assert.ok(words.includes("Open the Desk · 2 paused"), words.join(" | "));
    const open = texts(deskRows(T, { menu: "desk-open" }, profile));
    const at = (w) => open.indexOf(w);
    assert.deepEqual(open.slice(at("Paused"), at("New") + 1), ["Paused", "Resume all 2", "Claude", "5m ago", "Idea: tidy", "just now", "New"]);
  });
  test("each comes back on its session, the first opening the Desk, and leaves the paused list", async () => {
    mock.state.shared.set("kelpie.profiles", { w: profile });
    mock.state.shared.set("kelpie.desk.paused", { w: paused });
    mock.on.run = (name) => {
      if (name === "space.new") mock.state.spaces = [{ id: "d2", name: "Desk", folder: "/work/acme/web", active: true, tabs: [{ id: "t1", name: "Claude" }] }];
    };
    await resumeDesk(profile);
    const [made] = runs("space.new");
    assert.equal(made.name, "Desk");
    assert.equal(made.tab, "Claude");
    assert.deepEqual(made.argv.slice(-3), ["claude", "--resume", "s-101"]);
    assert.equal(made.folder, "/work/acme/web");
    const [tab] = runs("tab.new");
    assert.equal(tab.space, "d2");
    assert.deepEqual(tab.argv.slice(-3), ["claude", "--resume", "s-102"]);
    assert.deepEqual(deskPaused(profile), []);
  });
  test("one picked alone leaves the others paused", async () => {
    mock.state.shared.set("kelpie.profiles", { w: profile });
    mock.state.shared.set("kelpie.desk", { w: "d1" });
    mock.state.spaces = [{ id: "d1", name: "Desk", folder: "/work/acme", active: true, tabs: [{ id: "t9", name: "Terminal" }] }];
    mock.state.shared.set("kelpie.desk.paused", { w: paused });
    await resumeDesk(profile, [paused[1]]);
    assert.deepEqual(deskPaused(profile).map((p) => p.sessionId), ["s-101"]);
    assert.equal(runs("tab.new").length, 1);
  });
  test("a second click on the same row doesn't open it twice", async () => {
    mock.state.shared.set("kelpie.profiles", { w: profile });
    mock.state.shared.set("kelpie.desk", { w: "d1" });
    mock.state.spaces = [{ id: "d1", name: "Desk", folder: "/work/acme", active: true, tabs: [{ id: "t9", name: "Terminal" }] }];
    mock.state.shared.set("kelpie.desk.paused", { w: paused });
    await Promise.all([resumeDesk(profile, [paused[0]]), resumeDesk(profile, [paused[0]])]);
    assert.equal(runs("tab.new").length, 1);
  });
  test("a Desk that never shows up puts them back as paused", async () => {
    mock.state.shared.set("kelpie.profiles", { w: profile });
    mock.state.shared.set("kelpie.desk.paused", { w: paused });
    await resumeDesk(profile);
    assert.deepEqual(deskPaused(profile).map((p) => p.sessionId).sort(), ["s-101", "s-102"]);
    assert.match(mock.of("notify")[0][0].title, /didn't open/);
  });
});
