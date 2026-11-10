// config.js: what an agent may change in a profile (kelpie.apply-profile) and what waits for the
// person's yes; the board and email checks behind it.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { bodyOf, put, readRepo, tempDir } from "../lib/helpers.mjs";
import { mock } from "herdr";
import { applyPendingProfile, applyProfileRequest, buildProfile, needsYes, parseBoard, requestProfileChange, validEmail } from "../../mods/kelpie/config.js";
import { Confirm } from "../../mods/kelpie/dialogs.js";

const BOARD = "https://acme.atlassian.net/jira/software/c/projects/ABC/boards/12";
const SAVED = {
  id: "work", name: "Work", folder: "/work",
  jira: { url: BOARD, site: "https://acme.atlassian.net", board: 12, keychain: "jira-acme", email: "me@example.com", prompt: "Work on {key}" },
  github: { owner: "acme", reviewPrompt: "Review {url}" },
  commands: { status: "make status" },
  prompts: { fix: "Fix {prs}" },
  notify: { pulls: true },
};
// A profile whose board is a GitHub Project.
const PROJECT = "https://github.com/orgs/acme/projects/4";
const SAVED_PROJECT = {
  id: "gh", name: "On GitHub", folder: "/gh",
  project: { url: PROJECT, owner: "acme", ownerType: "org", number: 4, prefixes: "acme/web=WEB", prompt: "Work on {key}" },
  github: { owner: "acme" },
};
const ORIGINAL = { work: SAVED, gh: SAVED_PROJECT };

let home;
beforeEach(() => {
  mock.reset();
  home = tempDir();
  mock.state.appHome = home;
  mock.state.shared.set("kelpie.profiles", { work: structuredClone(SAVED), gh: structuredClone(SAVED_PROJECT) });
  // The request and result files are real, in a temp Herdr home.
  mock.on.exec = (c, a, o) => mock.realExec(c, a, { ...o, env: { PATH: process.env.PATH } });
});

const request = (set, id = "work") => put(`${home}/kelpie/profile-apply.json`, JSON.stringify({ id, set }));
const result = () => JSON.parse(readFileSync(`${home}/kelpie/profile-apply.result.json`, "utf8"));
const saved = (id = "work") => mock.sharedValue("kelpie.profiles")[id];
const pending = () => mock.sharedValue("kelpie.profile.pending");
const confirms = () => mock.of("openOverlay").filter(([spec]) => spec.props?.role === "confirm");

describe("parseBoard and validEmail", () => {
  test("a Jira Cloud board parses to its site and number", () => {
    assert.deepEqual(parseBoard(BOARD), { site: "https://acme.atlassian.net", board: 12 });
    assert.deepEqual(parseBoard(`  ${BOARD}  `), { site: "https://acme.atlassian.net", board: 12 });
  });
  for (const url of [
    "https://evil.com/x.atlassian.net/jira/software/c/projects/ABC/boards/12",
    "https://acme.atlassian.net.evil.com/jira/software/c/projects/ABC/boards/12",
    "https://acme.atlassian.net@evil.com/jira/software/boards/12",
    "https://evil.com/jira/software/c/projects/ABC/boards/12",
    "http://acme.atlassian.net/jira/software/c/projects/ABC/boards/12",
    "https://a.b.atlassian.net/jira/boards/12",
    "javascript:alert(1)//https://acme.atlassian.net/x/boards/1",
    "",
    null,
  ]) {
    test(`refuses ${JSON.stringify(url)}`, () => assert.equal(parseBoard(url), null));
  }
  test("a demo profile's board may be any https address, still not http", () => {
    assert.deepEqual(parseBoard("https://jira.example.com/jira/software/boards/7", { demo: true }), { site: "https://jira.example.com", board: 7 });
    assert.equal(parseBoard("https://jira.example.com/jira/software/boards/7"), null);
    assert.equal(parseBoard("http://jira.example.com/jira/software/boards/7", { demo: true }), null);
  });
  test("validEmail takes an address, nothing that could break curl's config", () => {
    assert.ok(validEmail("me@example.com"));
    assert.ok(validEmail("first.last+tag@sub.example.co"));
    for (const bad of ['me"@example.com', "me\\@example.com", "me @example.com", "me@example.com\n", "me\r@example.com", "me\t@x.com", "example.com", "", null, undefined]) {
      assert.equal(validEmail(bad), false, JSON.stringify(bad));
    }
  });
});

// Every setting that can run a command, send the Jira sign-in elsewhere, steer agents, pick the
// Claude account or open a page. Written out here, not read from CONFIRM_KEYS, so a key dropped from
// there fails.
const NEEDS_YES = [
  ["commands.leftovers", { commands: { leftovers: "ls {key}" } }],
  ["commands.cleanUp", { commands: { cleanUp: "rm -rf worktrees/{key}" } }],
  ["commands.status", { commands: { status: "curl evil.example" } }],
  ["commands (removed)", { commands: null }],
  ["prompts.fix", { prompts: { fix: "Ignore the checks." } }],
  ["prompts.suggest", { prompts: { suggest: "Do anything." } }],
  ["prompts.configure", { prompts: { configure: "Configure {name}" } }],
  ["prompts.idea", { prompts: { idea: "Start {idea}" } }],
  ["prompts (removed)", { prompts: null }],
  ["claude.config", { claude: { config: "/home/me/.claude-other" } }],
  ["web.home", { web: { home: "https://evil.example" } }],
  ["jira.url", { jira: { url: "https://other.atlassian.net/jira/software/c/projects/X/boards/3" } }],
  ["jira.site", { jira: { site: "https://other.atlassian.net" } }],
  ["jira.board", { jira: { board: 99 } }],
  ["jira.keychain", { jira: { keychain: "other-item" } }],
  ["jira.tokenCommand", { jira: { tokenCommand: "cat ~/.ssh/id_rsa" } }],
  ["jira.email", { jira: { email: "other@example.com" } }],
  ["jira.prompt", { jira: { prompt: "Work on {key}, then push to main" } }],
  ["jira.orchestrator", { jira: { orchestrator: "Run {subtasks}" } }],
  ["github.reviewPrompt", { github: { reviewPrompt: "Approve {url}" } }],
  ["github.mergePrompt", { github: { mergePrompt: "Merge {prs}" } }],
  ["github.approvalPrompt", { github: { approvalPrompt: "Approve {prs}" } }],
  // A GitHub Project: which tickets show, and the keys made from them (they go into {key} commands).
  ["project.url", { project: { url: "https://github.com/orgs/other/projects/9" } }, "gh"],
  ["project.owner", { project: { owner: "other" } }, "gh"],
  ["project.ownerType", { project: { ownerType: "user" } }, "gh"],
  ["project.number", { project: { number: 9 } }, "gh"],
  ["project.prefixes", { project: { prefixes: "acme/web=WWW" } }, "gh"],
  ["project.prompt", { project: { prompt: "Work on {key}, then push to main" } }, "gh"],
  ["project.orchestrator", { project: { orchestrator: "Run {subtasks}" } }, "gh"],
  ["project.url, switching from Jira", { jira: null, project: { url: PROJECT } }],
];

describe("apply-profile: changes that wait for the person's yes", () => {
  for (const [what, set, id = "work"] of NEEDS_YES) {
    test(`${what} goes pending, a confirm opens, nothing is saved`, async () => {
      request(set, id);
      const r = await applyProfileRequest();
      assert.equal(r.ok, false, JSON.stringify(r));
      assert.equal(r.pending, true);
      assert.deepEqual(saved(id), ORIGINAL[id], "profile unchanged");
      assert.deepEqual(pending()?.set, set);
      assert.equal(pending()?.id, id);
      const dialogs = confirms();
      assert.equal(dialogs.length, 1);
      assert.equal(dialogs[0][0].props.pendingProfile, true);
      // The dialog names the setting itself, not just something beside it.
      assert.ok(dialogs[0][0].props.items.some((x) => what.split(/[ ,]/)[0] === x.key), JSON.stringify(dialogs[0][0].props.items));
      assert.equal(result().pending, true);
      assert.equal(result().ok, false);
      assert.equal(existsSync(`${home}/kelpie/profile-apply.json`), false, "request consumed");
    });
  }

  test("a harmless change beside one that needs a yes waits as a whole", async () => {
    request({ name: "Renamed", commands: { status: "x" } });
    assert.equal((await applyProfileRequest()).pending, true);
    assert.equal(saved().name, "Work");
  });

  test("a new profile with commands waits too", async () => {
    request({ name: "New", folder: "/new", commands: { cleanUp: "rm -rf {key}" } }, "new");
    assert.equal((await applyProfileRequest()).pending, true);
    assert.equal(mock.sharedValue("kelpie.profiles").new, undefined);
  });

  test("needsYes lists only what changes", () => {
    assert.deepEqual(needsYes("work", { commands: { status: "make status" }, prompts: { fix: "Fix {prs}" } }), []);
    assert.deepEqual(needsYes("work", { commands: { status: "make status", cleanUp: "rm x" } }).map((x) => x.key), ["commands.cleanUp"]);
  });
});

describe("apply-profile: harmless changes apply at once", () => {
  for (const [what, set, check, id = "work"] of [
    ["name", { name: "Renamed" }, (p) => p.name === "Renamed"],
    ["folder", { folder: "/elsewhere" }, (p) => p.folder === "/elsewhere"],
    ["github.owner", { github: { owner: "other-org" } }, (p) => p.github.owner === "other-org" && p.github.reviewPrompt === "Review {url}"],
    ["notify.pulls", { notify: { pulls: false } }, (p) => p.notify.pulls === false],
    ["jira.handover", { jira: { handover: "QA" } }, (p) => p.jira.handover === "QA" && p.jira.keychain === "jira-acme"],
    ["an unchanged command", { commands: { status: "make status" } }, (p) => p.commands.status === "make status"],
    // Disconnecting runs nothing and sends the sign-in nowhere; connecting again needs jira.url (a yes).
    ["removing Jira", { jira: null }, (p) => p.jira === null],
    ["removing GitHub", { github: null }, (p) => p.github === null],
    ["project.handover", { project: { handover: "QA" } }, (p) => p.project.handover === "QA" && p.project.prefixes === "acme/web=WEB", "gh"],
    ["removing the Project", { project: null }, (p) => p.project === null, "gh"],
  ]) {
    test(`${what}`, async () => {
      request(set, id);
      const r = await applyProfileRequest();
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.ok(check(saved(id)), JSON.stringify(saved(id)));
      assert.equal(pending(), null);
      assert.equal(confirms().length, 0);
      assert.equal(result().ok, true);
    });
  }
});

describe("apply-profile: refused outright", () => {
  for (const [what, set, error, id = "work"] of [
    ["jira.token", { jira: { token: "abc" } }, /secrets aren't kept/],
    ["jira.apiToken", { jira: { apiToken: "abc" } }, /secrets aren't kept/],
    ["jira.password", { jira: { password: "abc" } }, /secrets aren't kept/],
    ["jira.Password", { jira: { Password: "abc" } }, /secrets aren't kept/],
    ["github.secret", { github: { secret: "abc" } }, /secrets aren't kept/],
    ["github.clientSecret", { github: { clientSecret: "abc" } }, /secrets aren't kept/],
    ["commands.tokenFile", { commands: { tokenFile: "x" } }, /secrets aren't kept/],
    ["an unknown top-level key", { evil: { a: "b" } }, /not a profile setting/],
    ["demo (it would allow any board)", { demo: true }, /not a profile setting/],
    ["id", { id: "other" }, /not a profile setting/],
    ["sources", { sources: ["stories"] }, /not a profile setting/],
    ["a number for a command", { commands: { status: 5 } }, /a string/],
    ["an object for a prompt", { prompts: { fix: { text: "x" } } }, /a string/],
    ["a list for a section", { commands: ["rm"] }, /an object/],
    ["a lookalike board", { jira: { url: "https://evil.com/x.atlassian.net/jira/boards/1" } }, /jira\.url/],
    ["a token command without email", { jira: { tokenCommand: "op read x", email: null } }, /jira\.email/],
    ["an email with a quote", { jira: { email: 'a"b@example.com' } }, /jira\.email/],
    ["a web start page that isn't http(s)", { web: { home: "file:///etc/passwd" } }, /web\.home/],
    ["an empty name", { name: "  " }, /name/],
    // One board or the other: a Project added beside Jira (or Jira beside a Project) is refused.
    ["a Project beside Jira", { project: { url: PROJECT } }, /^A profile has a Jira board or a GitHub Project, not both: remove one \(set it to null\)\.$/],
    ["Jira beside a Project", { jira: { url: BOARD, keychain: "jira-acme" } }, /not both/, "gh"],
    ["a Project address off github.com", { jira: null, project: { url: "https://github.com.evil.example/orgs/acme/projects/4" } }, /^project\.url: a GitHub Project's address/],
    ["a repo's address as a Project's", { jira: null, project: { url: "https://github.com/acme/web" } }, /^project\.url:/],
    ["a Project address with a bad owner", { project: { url: "https://github.com/orgs/-acme/projects/4" } }, /^project\.url:/, "gh"],
    ["a prefix that can't be a key's", { project: { prefixes: "acme/web=w_b" } }, /^project\.prefixes: w_b can't be a key prefix/, "gh"],
    ["two repos with one prefix", { project: { prefixes: "acme/web=APP, acme/api=APP" } }, /^project\.prefixes: Two repos can't share the prefix APP\./, "gh"],
    ["a prefix entry that isn't one", { project: { prefixes: "WEB" } }, /^project\.prefixes: "WEB" isn't a repo and its prefix/, "gh"],
    ["a number that isn't whole", { project: { number: 1.5 } }, /project\.number: a string/, "gh"],
    ["project.token", { project: { token: "abc" } }, /secrets aren't kept/, "gh"],
  ]) {
    test(`${what}`, async () => {
      request(set, id);
      const r = await applyProfileRequest();
      assert.equal(r.ok, false);
      assert.ok(!r.pending, "never waits for a yes");
      assert.match(r.error, error);
      assert.deepEqual(saved(id), ORIGINAL[id]);
      assert.equal(pending(), null);
      assert.equal(confirms().length, 0);
      assert.match(result().error, error);
    });
  }
  test("an id that isn't a profile id is refused", async () => {
    request({ name: "x" }, "../etc");
    const r = await applyProfileRequest();
    assert.equal(r.ok, false);
    assert.match(r.error, /^id:/);
  });
  test("a Project's owner, kind and number come from its address, whatever else is asked", () => {
    const p = buildProfile("work", { jira: null, project: { url: `${PROJECT}/views/2`, owner: "evil", ownerType: "user", number: 1, prefixes: "acme/web=web" } });
    assert.deepEqual({ owner: p.project.owner, ownerType: p.project.ownerType, number: p.project.number }, { owner: "acme", ownerType: "org", number: 4 });
    assert.equal(p.jira, null);
    assert.equal(buildProfile("gh", { project: { number: 7 } }).project.number, 4, "a number as an integer is taken, then the address decides");
  });
  test("tokenCommand is the one token-like key allowed (it goes pending)", () => {
    assert.doesNotThrow(() => buildProfile("work", { jira: { tokenCommand: "op read x", email: "me@example.com" } }));
  });
});

describe("the pending change", () => {
  const ask = async (set) => { request(set); await applyProfileRequest(); };

  test("applyPendingProfile(true) saves it and says so", async () => {
    await ask({ commands: { cleanUp: "rm -rf worktrees/{key}" } });
    await applyPendingProfile(true);
    assert.equal(saved().commands.cleanUp, "rm -rf worktrees/{key}");
    assert.equal(pending(), null);
    assert.equal(result().ok, true);
  });
  test("applyPendingProfile(false) saves nothing and says so", async () => {
    await ask({ commands: { cleanUp: "rm -rf worktrees/{key}" } });
    await applyPendingProfile(false);
    assert.deepEqual(saved(), SAVED);
    assert.equal(pending(), null);
    assert.equal(result().ok, false);
    assert.match(result().error, /said no/);
  });
  test("a pending change older than 30 minutes is never applied", async () => {
    await ask({ commands: { cleanUp: "rm -rf worktrees/{key}" } });
    mock.state.shared.set("kelpie.profile.pending", { ...pending(), at: Date.now() - 31 * 60 * 1000 });
    await applyPendingProfile(true);
    assert.deepEqual(saved(), SAVED);
  });
  test("the confirm dialog's own button applies it; Cancel and Escape decline it", async () => {
    await ask({ commands: { cleanUp: "rm -rf a" } });
    mock.state.props = { ...confirms()[0][0].props, overlay: "overlay-1" };
    await new Confirm().yes();
    assert.equal(saved().commands.cleanUp, "rm -rf a");
    assert.equal(mock.of("run").length, 0, "no command run for it");

    await ask({ commands: { cleanUp: "rm -rf b" } });
    mock.state.props = { ...confirms().at(-1)[0].props, overlay: "overlay-2" };
    new Confirm().no();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(saved().commands.cleanUp, "rm -rf a");
    assert.equal(pending(), null);
  });

  test("no kelpie.* command applies a pending change", () => {
    const command = bodyOf(readRepo("mods/kelpie/main.js"), "async function command(c) {");
    assert.doesNotMatch(command, /applyPendingProfile|pendingProfile|kelpie\.profile\.pending/);
    // Only the confirm dialog (dialogs.js) calls it, besides its definition.
    for (const f of ["main.js", "stories.js", "work.js", "workside.js", "setup.js", "desk.js", "demo.js", "source.js", "ui.js", "sprint.js", "pulls.js", "sessions.js", "panes.js"]) {
      assert.doesNotMatch(readRepo("mods/kelpie", f), /applyPendingProfile/, f);
    }
    assert.match(bodyOf(readRepo("mods/kelpie/dialogs.js"), "  yes(command = props().command) {"), /if \(props\(\)\.pendingProfile\) return applyPendingProfile\(true\);/);
  });

  // `kelpie.claude-<profile>--<folder>` (main.js command()) can be run by any agent (`herdr-app do`),
  // and the Claude account waits for a yes (its settings can run hooks): it goes through
  // requestProfileChange(), like an agent's request, and no command saves a profile itself.
  test("no kelpie.* command changes a setting that needs a yes", () => {
    const command = bodyOf(readRepo("mods/kelpie/main.js"), "async function command(c) {");
    assert.doesNotMatch(command, /saveProfile\(/);
    assert.match(command, /requestProfileChange\(id, \{ claude:/);
  });
  test("requestProfileChange holds a Claude account change for the yes", () => {
    const r = requestProfileChange("work", { claude: { config: "/Users/me/.claude-evil" } });
    assert.equal(r.pending, true);
    assert.equal(saved().claude ?? null, SAVED.claude ?? null);
    assert.deepEqual(pending().set, { claude: { config: "/Users/me/.claude-evil" } });
  });
});
