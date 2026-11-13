// A story's Claude Artifacts (stories.js storyArtifacts, openArtifact; main.js syncWebOpen, openInWeb):
// read from its sessions' logs (artifacts.py, the demo's from its fixture), only claude.ai Artifact
// links kept, and opened in the shown profile's own browser, or the person's when the panel can't.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fakeBin, sh, tempDir } from "../lib/helpers.mjs";
import { mock } from "herdr";
import { openArtifact, storyArtifacts } from "../../mods/kelpie/stories.js";
import { openInWeb, syncWebOpen } from "../../mods/kelpie/main.js";
import { ARTIFACT_LINK, WEB_OPEN } from "../../mods/kelpie/ui.js";

const LINK = "https://claude.ai/artifact/Ab3_x-9";
const SID = "0f1e2d3c-aaaa-bbbb-cccc-000000000001";
beforeEach(() => mock.reset());

describe("storyArtifacts: what the story's sessions published", () => {
  const st = { profile: { id: "acme" }, space: null };
  const sessions = [{ id: SID, key: "ACME-12", terminal: "t3" }, { id: "not-a-session; rm -rf ~", key: "ACME-13" }];

  test("artifacts.py runs on the session ids only, and each Artifact gets its session's key and agent", async () => {
    mock.on.exec = (cmd) => (cmd === "python3" ? { code: 0, stdout: JSON.stringify([{ url: LINK, title: "Plan", session: SID, count: 2, last: 1 }]), stderr: "" } : undefined);
    const list = await storyArtifacts(st, sessions);
    const [[cmd, args]] = mock.of("exec");
    assert.equal(cmd, "python3");
    assert.deepEqual([args[0], args[1]], ["-I", "-c"]);
    assert.match(args[2], /Claude Artifacts some Claude sessions published/, "the script itself");
    assert.deepEqual(args.slice(3), [SID], "only a session id goes to the script");
    assert.deepEqual(list.map((a) => [a.url, a.key, a.terminal]), [[LINK, "ACME-12", "t3"]]);
  });

  test("anything but an Artifact's own claude.ai link is dropped", async () => {
    const urls = ["https://claude.ai.evil.example/artifact/x", "http://claude.ai/artifact/x", "https://claude.ai/artifact/x/../../settings",
      "https://claude.ai/chat/x", "javascript:alert(1)", null, "https://claude.ai/code/artifact/0e1f-22"];
    mock.on.exec = () => ({ code: 0, stdout: JSON.stringify(urls.map((url) => ({ url, session: SID }))), stderr: "" });
    assert.deepEqual((await storyArtifacts(st, sessions)).map((a) => a.url), ["https://claude.ai/code/artifact/0e1f-22"]);
  });

  test("no sessions, nothing run; a failed read says so", async () => {
    assert.deepEqual(await storyArtifacts(st, []), []);
    assert.deepEqual(mock.of("exec"), []);
    mock.on.exec = () => ({ code: 1, stdout: "", stderr: "boom" });
    await assert.rejects(storyArtifacts(st, sessions), /couldn't be read/);
  });

  test("a demo profile's come from its fixture, running nothing", async () => {
    const list = await storyArtifacts({ profile: { id: "demo", demo: true } }, [{ id: "demo-s7", key: "ACME-190" }]);
    assert.deepEqual(list.map((a) => [a.title, a.count, a.key]), [["Saved filters: what a new search reads back", 3, "ACME-190"], ["Filter edge cases", 1, "ACME-190"]]);
    assert.match(list[1].config, /\/\.claude-personal$/, "made on another account");
    assert.ok(list.every((a) => ARTIFACT_LINK.test(a.url)));
    assert.deepEqual(mock.of("exec"), []);
  });
});

describe("openArtifact and syncWebOpen: asking the leading copy to open it", () => {
  const shownIs = (id) => {
    mock.state.shared.set("kelpie.profiles", { [id]: { id, name: "Acme", folder: "/w" } });
    mock.state.shared.set("kelpie.profile.chosen", { id, space: null });
  };

  test("only an Artifact's link is asked for", () => {
    openArtifact({ id: "acme" }, "https://evil.example/");
    openArtifact({ id: "acme" }, `${LINK}?x=1`);
    assert.equal(mock.sharedValue(WEB_OPEN), null);
    openArtifact({ id: "acme" }, LINK);
    assert.deepEqual({ ...mock.sharedValue(WEB_OPEN), at: 0 }, { profile: "acme", url: LINK, at: 0 });
  });

  test("taken once, and only for the profile shown, fresh, with an Artifact's link", () => {
    shownIs("acme");
    for (const ask of [{ profile: "other", url: LINK, at: Date.now() }, { profile: "acme", url: LINK, at: Date.now() - 60e3 },
      { profile: "acme", url: "https://evil.example/", at: Date.now() }]) {
      mock.state.shared.set(WEB_OPEN, ask);
      syncWebOpen();
      assert.equal(mock.sharedValue(WEB_OPEN), null, "cleared");
    }
    assert.deepEqual(mock.of("exec"), [], "nothing opened");
    mock.state.shared.set(WEB_OPEN, { profile: "acme", url: LINK, at: Date.now() });
    syncWebOpen();
    assert.equal(mock.sharedValue(WEB_OPEN), null);
    assert.ok(mock.of("exec").length > 0, "it opens");
  });
});

describe("openInWeb: the profile's own browser, else the person's", () => {
  const panel = () => {
    mock.state.shared.set("kelpie.profiles", { acme: { id: "acme", name: "Acme", folder: "/w" } });
    mock.state.shared.set("kelpie.profile.chosen", { id: "acme", space: null });
    mock.state.layout = { id: "root", children: [{ id: "panel", hidden: true, children: [{ id: "panel-body", active: "files", children: [{ id: "files" }, { id: "web" }] }] }] };
    mock.on.hc = (args) => (args[0] === "run" ? { code: 0, stdout: '{"address":"t9"}', stderr: "" } : args[0] === "get" ? { code: 0, stdout: "{}", stderr: "" } : undefined);
  };
  const browserRuns = () => mock.of("exec").filter(([c, a]) => c === "sh" && String(a[1]).includes("exec terminal-browser"));

  test("a new tab of the profile's browser, its key and the link as arguments", async () => {
    panel();
    mock.on.exec = (cmd, args) => {
      if (cmd === "sh" && String(args[1]).includes("command -v terminal-browser")) return { code: 0, stdout: "b\np\n", stderr: "" };
      if (cmd === "sh" && args.includes("ls")) return { code: 0, stdout: JSON.stringify({ browsers: [{ key: "4242-1" }] }), stderr: "" };
      return undefined;
    };
    await openInWeb(LINK);
    const runs = browserRuns();
    assert.deepEqual(runs.map(([, a]) => a.slice(2)), [["sh", "acme", "ls", "--all", "--json"], ["sh", "acme", "new-tab", "--browser", "4242-1", LINK]]);
    assert.ok(runs.every(([, a]) => !a[1].includes(LINK)), "the link is never in the script");
    assert.ok(mock.of("run").some(([name, a]) => name === "layout.show" && a.id === "panel"), "the panel shows");
    assert.deepEqual(mock.of("notify"), []);
  });

  test("a key that isn't one is never passed on: it opens in the person's browser instead", async () => {
    panel();
    mock.on.exec = (cmd, args) => {
      if (cmd === "sh" && String(args[1]).includes("command -v terminal-browser")) return { code: 0, stdout: "b\n", stderr: "" };
      if (cmd === "sh" && args.includes("ls")) return { code: 0, stdout: JSON.stringify({ browsers: [{ key: "--help; rm" }] }), stderr: "" };
      return undefined;
    };
    await openInWeb(LINK);
    assert.ok(!browserRuns().some(([, a]) => a.includes("new-tab")));
    assert.ok(mock.of("exec").some(([c, a]) => c === "open" && a[0] === LINK), "opened in the person's browser");
    assert.match(mock.of("notify")[0][0].body, /didn't open it/);
  });

  test("without terminal-browser: the person's browser, saying why", async () => {
    panel();
    await openInWeb(LINK);
    assert.ok(mock.of("exec").some(([c, a]) => c === "open" && a[0] === LINK));
    assert.equal(browserRuns().length, 0);
    assert.match(mock.of("notify")[0][0].body, /needs terminal-browser/);
  });

  test("the script runs terminal-browser in the profile's own folders, with the arguments as given", async () => {
    panel();
    mock.on.exec = (cmd, args) => (cmd === "sh" && String(args[1]).includes("command -v terminal-browser") ? { code: 0, stdout: "b\n", stderr: "" } : undefined);
    await openInWeb(LINK);
    const [[, args]] = browserRuns();
    const home = tempDir();
    const f = fakeBin().add("terminal-browser");
    assert.equal(sh("/bin/sh", [...args.slice(0, 3), "acme", "new-tab", "--browser", "1-1", "$(touch pwned)"], { env: { HOME: home, PATH: f.path } }).code, 0);
    const [run] = f.calls("terminal-browser");
    assert.deepEqual(run.argv, ["new-tab", "--browser", "1-1", "$(touch pwned)"]);
    const dir = `${home}/.local/share/kelpie/web/acme`;
    for (const v of [`XDG_RUNTIME_DIR=${dir}/run`, `TERMINAL_BROWSER_APPDATA=${dir}/data`, `XDG_DATA_HOME=${dir}/share`]) assert.ok(run.env.includes(v), v);
  });
});
