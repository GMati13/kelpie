// main.js watchPlaying: a profile's browser playing sound for PLAYING_AFTER seconds or more is noted
// in shared kelpie.web.playing (by its folder), from macOS's "Playing audio" power assertions
// (pmset) and the playing process's environment (ps eww). The tab bar's globe then shows moving bars.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { PLAYING_AFTER, playingFolders, playingPids, watchPlaying } from "../../mods/kelpie/main.js";

// What `pmset -g assertions` prints while a browser plays (trimmed from a real Mac's output).
const PMSET = `Listed by owning process:
   pid 712(coreaudiod): [0x0009a94000019aa3] 00:01:54 PreventUserIdleSystemSleep named: "com.apple.audio.AppleUSBAudioEngine:Scarlett:1,2.context.preventuseridlesleep"
	Resources: audio-in audio-out
   pid 42152(terminal-browser): [0x0009a94000019beb] 00:01:53 NoIdleSleepAssertion named: "Playing audio"
   pid 50111(terminal-browser): [0x0009a94000019bec] 00:00:03 NoIdleSleepAssertion named: "Playing audio"
   pid 6020(Music): [0x0009a94000019bed] 01:00:00 PreventUserIdleSystemSleep named: "Playing music"
`;
const PS = "/x/terminal-browser --daemon TERM=xterm XDG_RUNTIME_DIR=/Users/me/.local/share/kelpie/web/dotfiles/run TERMINAL_BROWSER_APPDATA=/Users/me/.local/share/kelpie/web/dotfiles/data\n";

test("only processes playing audio long enough count, not a notification's ping", () => {
  assert.equal(PLAYING_AFTER, 10);
  assert.deepEqual(playingPids(PMSET), ["42152"], "the 3 s one and other assertions are left out");
  assert.deepEqual(playingPids(""), []);
  assert.deepEqual(playingPids(undefined), []);
});

test("a playing process's profile is the browser folder its environment names", () => {
  assert.deepEqual(playingFolders(PS), ["dotfiles"]);
  assert.deepEqual(playingFolders("/Applications/Music.app/Contents/MacOS/Music HOME=/Users/me\n"), [], "not a Kelpie browser");
  assert.deepEqual(playingFolders("a /h/.local/share/kelpie/web/b/run c /h/.local/share/kelpie/web/a/data"), ["a", "b"]);
});

const WEB = { id: "root", children: [{ id: "panel", hidden: true, children: [{ id: "panel-body", active: "files", children: [{ id: "files" }, { id: "web" }] }] }] };
beforeEach(() => {
  mock.reset();
  mock.state.layout = WEB;
});

test("the playing profiles are noted in shared state, once, and cleared when the sound stops", async () => {
  let pmset = PMSET;
  mock.on.exec = (cmd, args) => (cmd === "pmset" ? { code: 0, stdout: pmset, stderr: "" }
    : cmd === "ps" ? { code: 0, stdout: args.at(-1) === "42152" ? PS : "", stderr: "" } : undefined);
  await watchPlaying();
  assert.deepEqual(mock.state.shared.get("kelpie.web.playing"), ["dotfiles"]);
  assert.deepEqual(mock.of("exec").find(([c]) => c === "ps")[1], ["eww", "-o", "command=", "-p", "42152"], "no shell, the pid alone");
  const writes = () => mock.of("setShared").filter(([k]) => k === "kelpie.web.playing").length;
  await watchPlaying();
  assert.equal(writes(), 1, "unchanged: not written again (a write per check would redraw every copy)");
  pmset = "";
  await watchPlaying();
  assert.deepEqual(mock.state.shared.get("kelpie.web.playing"), []);
});

test("without pmset (not a Mac) or a Web panel, nothing is noted", async () => {
  mock.on.exec = (cmd) => (cmd === "pmset" ? Promise.reject(new Error("pmset: not found")) : undefined);
  await watchPlaying();
  assert.equal(mock.state.shared.get("kelpie.web.playing"), undefined);
  mock.state.layout = { id: "root", children: [] };
  mock.on.exec = () => { throw new Error("nothing should run without a Web panel"); };
  await watchPlaying();
  assert.equal(mock.of("exec").length, 1);
});

test("the demo has no browser: its fixture's web.playing says whether its globe shows the bars", async () => {
  const { demoFixture } = await import("../../mods/kelpie/demo.js");
  const fixture = JSON.parse((await import("node:fs")).readFileSync(new URL("../../mods/kelpie/demo/demo.json", import.meta.url), "utf8"));
  assert.equal(fixture.web?.playing, false, "off by default, so screenshots of the demo stay still");
  mock.state.shared.set("kelpie.profiles", { demo: { id: "demo", name: "Acme", folder: "/w", demo: true } });
  mock.on.exec = (cmd) => (cmd === "pmset" ? { code: 0, stdout: "", stderr: "" } : undefined);
  for (const playing of [true, false]) {
    mock.on.readTextFile = () => JSON.stringify({ ...fixture, web: { playing } });
    await demoFixture();
    await watchPlaying();
    assert.deepEqual(mock.state.shared.get("kelpie.web.playing") ?? [], playing ? ["demo"] : []);
  }
});
