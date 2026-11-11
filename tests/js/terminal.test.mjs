// A story's Terminal (the tab bar's + menu, ⌥⌘T; stories.js openTerminal()): every press opens a new
// shell tab in the story's space, each named so the tab bar can tell them apart.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { until } from "../lib/helpers.mjs";
import { openTerminal } from "../../mods/kelpie/stories.js";

beforeEach(() => mock.reset());

const profile = { id: "w", name: "W", folder: "/work/acme" };
const newTabs = () => mock.of("run").filter(([n]) => n === "tab.new").map(([, a]) => a);

describe("a story's Terminal", () => {
  test("opens another tab when the story already has a terminal, never just shows the first", async () => {
    mock.state.spaces = [{ id: "s1", name: "ABC-1", folder: "/work/acme", active: true, tabs: [{ id: "t1", name: "ABC-1 terminal" }] }];
    await openTerminal(profile, { key: "ABC-1", subs: [], space: { id: "s1" } });
    assert.equal(mock.of("run").filter(([n]) => n === "tab.select").length, 0, "the first terminal isn't just shown again");
    const [tab] = newTabs();
    assert.equal(tab?.space, "s1");
    assert.equal(tab.name, "ABC-1 terminal 2");
    assert.equal(tab.folder, "/work/acme");
  });
  test("names each new one after the lowest number free", async () => {
    mock.state.spaces = [{ id: "s1", name: "ABC-1", folder: "/work/acme", active: true, tabs: [
      { id: "t1", name: "ABC-1 claude" }, { id: "t2", name: "ABC-1 terminal 2" },
    ] }];
    await openTerminal(profile, { key: "ABC-1", subs: [], space: { id: "s1" } });
    mock.state.spaces[0].tabs.push({ id: "t3", name: "ABC-1 terminal" });
    await openTerminal(profile, { key: "ABC-1", subs: [], space: { id: "s1" } });
    assert.deepEqual(newTabs().map((a) => a.name), ["ABC-1 terminal", "ABC-1 terminal 3"]);
  });
  test("presses right after each other each open one", async () => {
    mock.state.spaces = [{ id: "s1", name: "ABC-1", folder: "/work/acme", active: true, tabs: [] }];
    await openTerminal(profile, { key: "ABC-1", subs: [], space: { id: "s1" } });
    mock.state.spaces[0].tabs.push({ id: "t1", name: "ABC-1 terminal" });
    await openTerminal(profile, { key: "ABC-1", subs: [], space: { id: "s1" } });
    assert.equal(newTabs().length, 2);
  });
  test("starts in the story's ticket folder when it has one", async () => {
    mock.on.exec = (cmd, args) => (cmd === "sh" && args.includes("ABC-1") ? { code: 0, stdout: "/work/acme/worktrees/ABC-1", stderr: "" } : undefined);
    mock.state.spaces = [{ id: "s1", name: "ABC-1", folder: "/work/acme", active: true, tabs: [{ id: "t1", name: "ABC-1 terminal" }] }];
    await openTerminal(profile, { key: "ABC-1", subs: [], space: { id: "s1" } });
    assert.equal(newTabs()[0].folder, "/work/acme/worktrees/ABC-1");
  });
  test("none opens while the story is being cleaned up, as its space is closing", async () => {
    mock.state.spaces = [{ id: "s1", name: "ABC-1", folder: "/work/acme", active: true, tabs: [] }];
    mock.state.shared.set("kelpie.busy", { "ABC-1": { kind: "clean", keys: ["ABC-1"], step: "Cleaning up ABC-1…", at: Date.now(), until: Date.now() + 60e3 } });
    await openTerminal(profile, { key: "ABC-1", subs: [], space: { id: "s1" } });
    assert.equal(newTabs().length, 0);
    assert.equal(mock.sharedValue("kelpie.stories.note")?.w?.text, "ABC-1 is being cleaned up: wait for that to finish.");
  });
  test("a story with no space gets one, with its terminal as the first tab", async () => {
    openTerminal(profile, { key: "ABC-1", subs: [] });
    const [, args] = await until(() => mock.of("run").find(([n]) => n === "space.new"), 3000, "space.new");
    assert.equal(args.tab, "ABC-1 terminal");
  });
});
