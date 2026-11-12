// "Let me configure it for you" (config.js configureOnDesk): a Claude on the Desk with a one-line
// message, when the profile's Claude account has the Kelpie plugin (hasPlugin); else a dialog saying
// so, whose own button installs it (installPlugin), never a command an agent could run.
import { beforeEach, describe, test } from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { REPO, bodyOf, put, readRepo, tempDir } from "../lib/helpers.mjs";
import { CONFIGURE_PROMPT, PLUGIN, configureOnDesk, configureText, hasPlugin } from "../../mods/kelpie/config.js";
import { Confirm } from "../../mods/kelpie/dialogs.js";
import { Setup } from "../../mods/kelpie/setup.js";
import { fakeCx } from "../lib/views.mjs";

let home;
const work = () => ({ id: "work", name: "Work", folder: "/work", claude: { config: `${home}/.claude-work` } });
beforeEach(() => {
  mock.reset();
  home = tempDir();
  mock.state.home = home;
  mock.state.appHome = `${home}/.config/herdr-app`;
  mock.state.shared.set("kelpie.profiles", { work: work(), own: { id: "own", name: "Own", folder: "/own" } });
  // The shell's $HOME is the temp one, so Claude's own ~/.claude is in it too.
  mock.on.exec = (c, a, o) => mock.realExec(c, a, { ...o, env: { PATH: process.env.PATH, HOME: home } });
});
const installed = (dir, plugins = { [PLUGIN]: [{ scope: "user", version: "0.2.0" }] }) => put(`${dir}/plugins/installed_plugins.json`, JSON.stringify({ version: 2, plugins }));
const dialogs = () => mock.of("openOverlay").filter(([spec]) => spec.props?.role === "confirm");
const runs = (name) => mock.of("run").filter(([n]) => n === name).map(([, args]) => args);

describe("hasPlugin: the profile's Claude account has the Kelpie plugin", () => {
  test("not when nothing is installed there", async () => {
    assert.equal(await hasPlugin(work()), false);
  });
  test("when that account's installed_plugins.json lists it", async () => {
    installed(`${home}/.claude-work`);
    assert.equal(await hasPlugin(work()), true);
  });
  test("another account having it doesn't count", async () => {
    installed(`${home}/.claude`);
    assert.equal(await hasPlugin(work()), false);
    assert.equal(await hasPlugin({ id: "own", folder: "/own" }), true, "Default is Claude's own ~/.claude");
  });
  test("not when it's listed with no installs, or turned off in the account's settings", async () => {
    installed(`${home}/.claude-work`, { [PLUGIN]: [] });
    assert.equal(await hasPlugin(work()), false);
    installed(`${home}/.claude-work`);
    put(`${home}/.claude-work/settings.json`, JSON.stringify({ enabledPlugins: { [PLUGIN]: false } }));
    assert.equal(await hasPlugin(work()), false);
    put(`${home}/.claude-work/settings.json`, JSON.stringify({ enabledPlugins: { [PLUGIN]: true } }));
    assert.equal(await hasPlugin(work()), true);
  });
  test("files that aren't JSON count as not installed", async () => {
    put(`${home}/.claude-work/plugins/installed_plugins.json`, "{oops");
    assert.equal(await hasPlugin(work()), false);
  });
  test("the demo's stand-in agents need none", async () => {
    assert.equal(await hasPlugin({ id: "demo", demo: true }), true);
  });
});

describe("configureOnDesk", () => {
  test("with the plugin: a Claude on the Desk, its first message one line naming the profile and scope", async () => {
    installed(`${home}/.claude-work`);
    await configureOnDesk(work(), "status");
    const [space] = runs("space.new");
    assert.equal(space.task, 'Configure my Kelpie profile "Work" (id work). Scope: status (Story commands: status only).');
    assert.equal(space.tab, "Configure status");
    // Told it's the profile's and in no story (the Desk), then on the profile's account.
    assert.deepEqual(space.argv, ["env", "KELPIE_PROFILE=work", "KELPIE_STORY=", "env", `CLAUDE_CONFIG_DIR=${home}/.claude-work`, "claude"]);
    assert.equal(dialogs().length, 0);
  });
  test("without it: nothing starts; a dialog says it's needed, with what installs it from this clone", async () => {
    await configureOnDesk(work(), "all");
    assert.equal(runs("space.new").length, 0);
    const [[spec]] = dialogs();
    assert.equal(spec.props.installPlugin, "work");
    assert.equal(spec.props.yes, "Install it");
    assert.match(spec.props.detail, /\.claude-work/, "names the account it's missing on");
    // On the profile's account: a plain claude would install it on ~/.claude instead.
    const claude = `CLAUDE_CONFIG_DIR=${home}/.claude-work claude`;
    assert.deepEqual(spec.props.items.map((x) => x.text), [`${claude} plugin marketplace add ${REPO.replace(/\/$/, "")}`, `${claude} plugin install ${PLUGIN}`]);
  });
  test("on the Default account the commands to copy are plain claude; a folder with a space is quoted", async () => {
    await configureOnDesk({ id: "own", name: "Own", folder: "/own" }, "all");
    assert.deepEqual(dialogs()[0][0].props.items.map((x) => x.text.split(" plugin ")[0]), ["claude", "claude"]);
    mock.reset();
    mock.on.exec = (c, a, o) => mock.realExec(c, a, { ...o, env: { PATH: process.env.PATH, HOME: home } });
    await configureOnDesk({ id: "x", name: "X", folder: "/x", claude: { config: `${home}/.claude-my work` } }, "all");
    assert.equal(dialogs()[0][0].props.items[1].text, `CLAUDE_CONFIG_DIR='${home}/.claude-my work' claude plugin install ${PLUGIN}`);
  });
  test("its Install it runs both commands on the profile's account, values as arguments, never in the script", async () => {
    await configureOnDesk(work(), "status");
    assert.equal(dialogs()[0][0].props.installThen, "status", "what to set up once it's installed");
    assert.match(dialogs()[0][0].props.detail, /Install it, and a Claude on the Desk then starts setting it up with you\./);
    mock.state.props = { ...dialogs()[0][0].props, overlay: "overlay-1" };
    await new Confirm().yes();
    const [space] = runs("space.new");
    assert.equal(space.tab, "Configure");
    assert.deepEqual(space.argv.slice(0, 3), ["env", "KELPIE_PROFILE=work", "KELPIE_STORY="], "told where it runs: the Desk");
    const [env, plugin, sh, flag, script, name, source, task, ...claude] = space.argv.slice(3);
    assert.deepEqual([env, plugin, sh, flag, name], ["env", `PLUGIN=${PLUGIN}`, "/bin/sh", "-c", "sh"]);
    assert.equal(source, REPO.replace(/\/$/, ""));
    assert.equal(task, 'Configure my Kelpie profile "Work" (id work). Scope: status (Story commands: status only).');
    assert.deepEqual(claude, ["env", `CLAUDE_CONFIG_DIR=${home}/.claude-work`, "claude"]);
    assert.ok(!script.includes(home) && !script.includes(source) && !script.includes("Configure my"), "no value is written into the script");
    assert.match(script, /"\$@" plugin marketplace add "\$root"; if "\$@" plugin install "\$PLUGIN"; then/);
  });
  // The script itself, run with a fake claude: a good install goes on into Claude with the task as
  // its first message; a failed one doesn't start it; with no task, it says to press the button again.
  test("Install it's script: Claude starts with the task only once the install succeeded", async () => {
    await configureOnDesk(work(), "all");
    mock.state.props = { ...dialogs()[0][0].props, overlay: "overlay-1" };
    await new Confirm().yes();
    const [, , , , script] = runs("space.new")[0].argv.slice(3);
    const runIt = (task, fail) => {
      const dir = tempDir();
      put(`${dir}/claude`, `#!/bin/sh\nprintf '%s|' "$@" >> "${dir}/calls"; echo >> "${dir}/calls"; [ "$1" = plugin ] && [ "$2" = install ] && exit ${fail ? 1 : 0}; exit 0\n`);
      execFileSync("chmod", ["+x", `${dir}/claude`]);
      const out = execFileSync("/bin/sh", ["-c", script, "sh", "/repo", task, `${dir}/claude`], { env: { PATH: process.env.PATH, PLUGIN, SHELL: "/usr/bin/true" } }).toString();
      return { out, calls: readFileSync(`${dir}/calls`, "utf8").trim().split("\n") };
    };
    const ok = runIt("Configure it", false);
    assert.deepEqual(ok.calls, ["plugin|marketplace|add|/repo|", `plugin|install|${PLUGIN}|`, "Configure it|"]);
    const failed = runIt("Configure it", true);
    assert.equal(failed.calls.length, 2, "no Claude after a failed install");
    assert.match(failed.out, /The plugin didn't install: Claude's message above says why\./, "a failed install says so in Kelpie's words too");
    assert.doesNotMatch(failed.out, /Installed/);
    const plain = runIt("", false);
    assert.equal(plain.calls.length, 2);
    assert.match(plain.out, /press the button again/);
  });
  test("the message goes to one of the Desk's Claudes when one was picked, also only with the plugin", async () => {
    const agent = { address: "a1", space: "d1", pane: "p1", tab_name: "Claude" };
    await configureOnDesk(work(), "web", agent);
    assert.equal(mock.of("hc").length, 0, "nothing sent without the plugin");
    installed(`${home}/.claude-work`);
    mock.on.hc = (args) => (args[0] === "get" ? { code: 0, stdout: JSON.stringify({ program: { name: "Claude Code", agent: true } }), stderr: "" } : undefined);
    await configureOnDesk(work(), "web", agent);
    assert.deepEqual(runs("space.select"), [{ id: "d1" }]);
  });
});

// A dialog's tasks are cancelled once it closes (Herdr), so both buttons do their work in a task of
// their own dialog and close it last: closing first left them doing nothing.
describe("the buttons close their dialog only after their work", () => {
  const order = () => mock.calls.map((c) => (c.fn === "closeOverlay" ? `close ${c.args[0]}` : c.fn === "openOverlay" ? "dialog" : c.fn === "run" && c.args[0] === "space.new" ? "desk" : null)).filter(Boolean);
  const press = async (fn) => { const cx = fakeCx(); fn(cx); await cx.settle(20); return cx; };
  test("Let me configure it for you, without the plugin: the dialog saying so opens before the profile dialog closes", async () => {
    mock.state.props = { role: "setup", profile: "work", overlay: "setup-1" };
    const d = new Setup(); d.init(fakeCx());
    const cx = await press((cx) => d.configure("all", cx));
    assert.deepEqual(cx.errors, []);
    assert.deepEqual(order(), ["dialog", "close setup-1"]);
  });
  test("with the plugin: the Desk's Claude starts before it closes", async () => {
    installed(`${home}/.claude-work`);
    mock.state.props = { role: "setup", profile: "work", overlay: "setup-1" };
    const d = new Setup(); d.init(fakeCx());
    await press((cx) => d.configure("all", cx));
    assert.deepEqual(order(), ["desk", "close setup-1"]);
  });
  test("Install it: the Desk's terminal opens before its dialog closes", async () => {
    mock.state.props = { role: "confirm", installPlugin: "work", overlay: "confirm-1" };
    await press((cx) => new Confirm().yes(undefined, cx));
    assert.deepEqual(order(), ["desk", "close confirm-1"]);
  });
});

describe("the plugin's install is the person's click", () => {
  test("only the confirm dialog's button installs it; no kelpie.* command does", () => {
    const command = bodyOf(readRepo("mods/kelpie/main.js"), "async function command(c) {");
    assert.doesNotMatch(command, /installPlugin/);
    for (const f of ["main.js", "stories.js", "work.js", "workside.js", "setup.js", "desk.js", "demo.js", "source.js", "ui.js", "sprint.js", "pulls.js", "sessions.js", "panes.js"]) {
      assert.doesNotMatch(readRepo("mods/kelpie", f), /installPlugin/, f);
    }
    const yes = bodyOf(readRepo("mods/kelpie/dialogs.js"), "  yes(command = props().command, cx = null) {");
    assert.match(yes, /const \{ overlay, installPlugin: install, installThen: then = null(, doneStory)?(, runPicks: picks)?(, closeStories: closing)? \} = props\(\);/);
    assert.match(yes, /cx\.spawn\(async \(\) => \{ await installPlugin\(install, then\)/);
  });
});

describe("configureText", () => {
  test("the default is one line, the skill does the rest", () => {
    assert.ok(!CONFIGURE_PROMPT.includes("\n"));
    assert.equal(configureText({ id: "w", name: "W" }, "jira"), 'Configure my Kelpie profile "W" (id w). Scope: jira (Jira: board, sign-in, your part).');
  });
  test("a saved prompt naming {guide} still reads", () => {
    assert.equal(configureText({ id: "w", name: "W", prompts: { configure: "Set up {name}, following {guide}." } }, "all"), "Set up W, following Kelpie's configure-profile skill.");
  });
});
