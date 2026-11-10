// main.js resetBrowser: Restart browser and Sign out of all sites end only the shown profile's
// browser processes (never the loop's shell, nor another profile's) and delete only <dir>/data.
// The scripts main.js builds are taken from what it runs and run for real, with fake pkill, sleep,
// sqlite3 and python3, in a temp HOME.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fakeBin, put, sh, tempDir } from "../lib/helpers.mjs";
import { mock } from "herdr";
import { browserCommand, profileDir, resetBrowser } from "../../mods/kelpie/main.js";

// Runs resetBrowser for profile `id` and returns { reset: [script, "sh", id, flag], loop }: the reset
// script and its arguments, and the browser loop the panel then starts.
async function capture(id, signOut) {
  mock.reset();
  mock.state.shared.set("kelpie.profiles", { [id]: { id, name: "Acme", folder: "/w" } });
  mock.state.shared.set("kelpie.profile.chosen", { id, space: null });
  mock.state.layout = { id: "root", children: [{ id: "panel", hidden: false, children: [{ id: "panel-body", active: "web", children: [{ id: "web" }] }] }] };
  mock.on.exec = (cmd, args) => (cmd === "sh" && String(args[1]).includes("command -v terminal-browser") ? { code: 0, stdout: "b\np\n", stderr: "" } : undefined);
  mock.on.hc = (args) => (args[0] === "run" ? { code: 0, stdout: '{"address":"t9"}', stderr: "" } : args[0] === "get" ? { code: 0, stdout: "{}", stderr: "" } : undefined);
  await resetBrowser(signOut);
  const reset = mock.of("exec").find(([c, a]) => c === "sh" && String(a[1]).includes("pkill"));
  const run = mock.of("hc").map(([a]) => a).find((a) => a[0] === "run");
  const script = run ? run.indexOf("-c") + 1 : -1;
  return { reset: reset[1].slice(1), loop: run?.[script], loopArgs: run?.slice(script + 1) };
}

// Runs a script in `home` with the fakes on PATH.
const fakes = () => fakeBin().add("pkill").add("sleep").add("sqlite3").add("python3");
const runIn = (home, f, args) => sh("/bin/sh", args, { env: { HOME: home, PATH: f.path } });
const matches = (pattern, line) => spawnSync("grep", ["-E", "-e", pattern], { input: `${line}\n` }).status === 0;

describe("Restart browser: which processes end", () => {
  let home, pattern, lines;
  before(async () => {
    home = tempDir();
    const { reset, loop, loopArgs } = await capture("acme", false);
    // The pattern pkill gets, from the script as main.js runs it.
    const f = fakes();
    assert.equal(runIn(home, f, ["-c", ...reset]).code, 0);
    const kills = f.calls("pkill").map((c) => c.argv);
    assert.deepEqual(kills.map((a) => a.slice(0, -1)), [["-f"], ["-9", "-f"]]);
    pattern = kills[0].at(-1);
    // The browser's own command line, from the loop the panel starts (its python3 a fake).
    assert.ok(loop?.startsWith("while :; do"), "the panel starts the browser loop");
    const command = loop.slice(loop.indexOf("clear; ") + "clear; ".length, loop.lastIndexOf("; sleep 2; done"));
    const g = fakes();
    runIn(home, g, ["-c", command, ...loopArgs]);
    const kittyfix = g.calls("python3")[0].argv;
    const web = `${home}/.local/share/kelpie/web`;
    lines = {
      kittyfix: ["python3", ...kittyfix].join(" "),
      frameworkPython: ["/Library/Frameworks/Python.framework/Versions/3.12/Resources/Python.app/Contents/MacOS/Python", ...kittyfix].join(" "),
      electron: `/opt/terminal-browser/Electron --type=renderer --user-data-dir=${web}/acme/data/electron --lang=en`,
      loopShell: ["/bin/sh", "-c", loop, ...loopArgs].join(" "),
      otherKittyfix: ["python3", ...kittyfix].join(" ").replaceAll("/web/acme/", "/web/acme-2/"),
      otherElectron: `/opt/terminal-browser/Electron --user-data-dir=${web}/acme-2/data/electron`,
      prefixElectron: `/opt/terminal-browser/Electron --user-data-dir=${web}/acmeX/data`,
      unrelatedPython: `python3 /tmp/other.py ${web}/acme/`,
      shell: "-zsh",
    };
  });

  test("the profile's kittyfix and Electron processes match", () => {
    for (const k of ["kittyfix", "frameworkPython", "electron"]) assert.ok(matches(pattern, lines[k]), `${k}: ${lines[k]}`);
  });
  test("the loop's own shell doesn't (its terminal would end while shown)", () => {
    assert.ok(lines.loopShell.includes("kittyfix.py") && lines.loopShell.includes("kelpie/web/acme/"), "the loop names both");
    assert.equal(matches(pattern, lines.loopShell), false);
  });
  test("another profile's browser doesn't, nor anything else", () => {
    for (const k of ["otherKittyfix", "otherElectron", "prefixElectron", "unrelatedPython", "shell"]) assert.equal(matches(pattern, lines[k]), false, `${k}: ${lines[k]}`);
  });
});

describe("Sign out of all sites: what's deleted", () => {
  let home, web;
  const layout = () => {
    home = tempDir();
    web = `${home}/.local/share/kelpie/web`;
    for (const p of ["acme/data/Cookies", "acme/run/sock", "acme/share/terminal-browser/terminal-browser.db", "acme-2/data/Cookies", "other/file"]) put(join(web, p), "x");
  };

  test("signing out deletes <dir>/data and nothing else", async () => {
    layout();
    const { reset } = await capture("acme", true);
    assert.deepEqual(reset.slice(2), ["acme", "1"]);
    const f = fakes();
    assert.equal(runIn(home, f, ["-c", ...reset]).code, 0);
    assert.equal(existsSync(`${web}/acme/data`), false);
    for (const p of ["acme/run/sock", "acme/share/terminal-browser/terminal-browser.db", "acme-2/data/Cookies", "other/file"]) assert.ok(existsSync(join(web, p)), p);
    // The page it would reopen is forgotten, in its own store only.
    const db = f.calls("sqlite3").map((c) => c.argv[0]);
    assert.deepEqual(db, [`${web}/acme/share/terminal-browser/terminal-browser.db`]);
  });
  test("a restart deletes nothing", async () => {
    layout();
    const { reset } = await capture("acme", false);
    assert.equal(reset.at(-1), "0");
    runIn(home, fakes(), ["-c", ...reset]);
    assert.ok(existsSync(`${web}/acme/data/Cookies`));
  });
  test("the profile's folder name can't leave the web folder", async () => {
    mock.reset();
    mock.state.shared.set("kelpie.profiles", { "../x y": { id: "../x y", name: "Odd", folder: "/w" } });
    mock.state.shared.set("kelpie.profile.chosen", { id: "../x y", space: null });
    assert.equal(profileDir(), "---x-y");
    const { reset } = await capture("../../..", true);
    assert.match(reset[2], /^[A-Za-z0-9_-]+$/);
  });
});

describe("the browser's command: the start page and kittyfix's path are arguments, never script", () => {
  const ODD = `https://example.com/?q='a'"b"$(touch pwned)\`touch pwned\`;touch pwned`;
  // Runs the browser loop's command once (no loop), as its shell gets it, with fake python3 and
  // terminal-browser in a temp HOME and folder: { python3, browser, pwned }.
  const once = ({ command, args }, cwd = tempDir()) => {
    const f = fakeBin().add("python3").add("terminal-browser");
    sh("/bin/sh", ["-c", command, "sh", ...args], { cwd, env: { HOME: tempDir(), PATH: f.path } });
    return { python3: f.calls("python3")[0]?.argv, browser: f.calls("terminal-browser")[0]?.argv, pwned: existsSync(join(cwd, "pwned")) };
  };

  test("an odd start page and kittyfix path arrive as they are and nothing in them runs", () => {
    mock.reset();
    mock.state.appHome = `/h/it's "x" $(touch pwned);touch pwned/.config/herdr-app`;
    const cmd = browserCommand(ODD, true);
    assert.equal(cmd.command, browserCommand("https://other.example/", true).command, "the script is the same whatever the values");
    assert.ok(!cmd.command.includes("example.com") && !cmd.command.includes("pwned"));
    const r = once(cmd);
    assert.equal(r.python3[0], `${mock.state.appHome}/mods/kelpie/kittyfix.py`);
    assert.equal(r.python3.at(-1), ODD);
    assert.equal(r.pwned, false);
  });
  test("without python3 the browser runs alone, with the start page; with none, no page at all", () => {
    mock.reset();
    const alone = once(browserCommand(ODD, false));
    assert.equal(alone.python3, undefined);
    assert.deepEqual(alone.browser, [ODD]);
    assert.equal(alone.pwned, false);
    assert.deepEqual(once(browserCommand("", false)).browser, []);
    assert.equal(once(browserCommand("", true)).python3.at(-1), "terminal-browser");
  });
});
