// "Let me configure it for you" (config.js configureOnDesk): a Claude on the Desk with a one-line
// message, when the profile's Claude account has the Kelpie plugin (hasPlugin); else a dialog saying
// so, whose own button installs it (installPlugin), never a command an agent could run.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { REPO, bodyOf, put, readRepo, tempDir } from "../lib/helpers.mjs";
import { CONFIGURE_PROMPT, PLUGIN, configureOnDesk, configureText, hasPlugin } from "../../mods/kelpie/config.js";
import { Confirm } from "../../mods/kelpie/dialogs.js";

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
    assert.deepEqual(space.argv, ["env", `CLAUDE_CONFIG_DIR=${home}/.claude-work`, "claude"]);
    assert.equal(dialogs().length, 0);
  });
  test("without it: nothing starts; a dialog says it's needed, with what installs it from this clone", async () => {
    await configureOnDesk(work(), "all");
    assert.equal(runs("space.new").length, 0);
    const [[spec]] = dialogs();
    assert.equal(spec.props.installPlugin, "work");
    assert.equal(spec.props.yes, "Install it");
    assert.match(spec.props.detail, /\.claude-work/, "names the account it's missing on");
    assert.deepEqual(spec.props.items.map((x) => x.text), [`claude plugin marketplace add ${REPO.replace(/\/$/, "")}`, `claude plugin install ${PLUGIN}`]);
  });
  test("its Install it runs both commands on the profile's account, values as arguments, never in the script", async () => {
    await configureOnDesk(work(), "all");
    mock.state.props = { ...dialogs()[0][0].props, overlay: "overlay-1" };
    await new Confirm().yes();
    const [space] = runs("space.new");
    assert.equal(space.tab, "Install the Kelpie plugin");
    const [env, plugin, sh, flag, script, name, source, ...claude] = space.argv;
    assert.deepEqual([env, plugin, sh, flag, name], ["env", `PLUGIN=${PLUGIN}`, "/bin/sh", "-c", "sh"]);
    assert.equal(source, REPO.replace(/\/$/, ""));
    assert.deepEqual(claude, ["env", `CLAUDE_CONFIG_DIR=${home}/.claude-work`, "claude"]);
    assert.ok(!script.includes(home) && !script.includes(source), "no value is written into the script");
    assert.match(script, /"\$@" plugin marketplace add "\$root"; "\$@" plugin install "\$PLUGIN"/);
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

describe("the plugin's install is the person's click", () => {
  test("only the confirm dialog's button installs it; no kelpie.* command does", () => {
    const command = bodyOf(readRepo("mods/kelpie/main.js"), "async function command(c) {");
    assert.doesNotMatch(command, /installPlugin/);
    for (const f of ["main.js", "stories.js", "work.js", "workside.js", "setup.js", "desk.js", "demo.js", "source.js", "ui.js", "sprint.js", "pulls.js", "sessions.js", "panes.js"]) {
      assert.doesNotMatch(readRepo("mods/kelpie", f), /installPlugin/, f);
    }
    assert.match(bodyOf(readRepo("mods/kelpie/dialogs.js"), "  yes(command = props().command) {"), /if \(props\(\)\.installPlugin\) return installPlugin\(props\(\)\.installPlugin\);/);
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
