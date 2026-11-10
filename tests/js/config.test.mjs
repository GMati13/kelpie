// Profiles, spaces and what agents start with (config.js): which profile a space belongs to, the
// Desk, the handover column, prompt templates filled (placeholders, dropped lines) and the argv of
// new, resumed and plain-terminal agents on a profile's Claude account and with its GitHub account.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import {
  DEFAULT_APPROVAL_PROMPT, DEFAULT_MERGE_PROMPT, approvalTask, askText, claudeArgv, deskOf, fillLines, handoverFrom, jiraTask, mergeTask, profileOf, shellArgv, spacesOf,
} from "../../mods/kelpie/config.js";
import { resumeArgv } from "../../mods/kelpie/ui.js";
import { fakeBin, sh } from "../lib/helpers.mjs";

const W = { id: "w", name: "Work", folder: "/code/work" };
const SUB = { id: "sub", name: "Sub", folder: "/code/work/client" };
const W2 = { id: "w2", name: "Work two", folder: "/code/work2" };
const space = (id, folder, name = id, tabs = []) => ({ id, name, folder, tabs });
beforeEach(() => {
  mock.reset();
  mock.state.shared.set("kelpie.profiles", { w: W, sub: SUB, w2: W2 });
});
const owner = (s) => profileOf(s)?.id ?? null;

describe("profileOf: the profile a space belongs to", () => {
  test("the deepest profile whose folder holds the folder it began in", () => {
    assert.equal(owner(space("a", "/code/work")), "w");
    assert.equal(owner(space("b", "/code/work/api")), "w");
    assert.equal(owner(space("c", "/code/work/client")), "sub");
    assert.equal(owner(space("d", "/code/work/client/web")), "sub");
    assert.equal(owner(space("e", "/code/work2/x")), "w2", "/code/work2 isn't inside /code/work");
    assert.equal(owner(space("f", "/elsewhere")), null);
    assert.equal(profileOf(null), null);
  });
  test("a trailing slash in the profile's folder doesn't matter", () => {
    mock.state.shared.set("kelpie.profiles", { w: W, sub: { ...SUB, folder: "/code/work/client/" } });
    assert.equal(owner(space("c", "/code/work/client/web")), "sub");
    assert.equal(owner(space("c", "/code/work/client")), "sub");
  });
  test("a space opened from a profile (kelpie.space.profile) stays the profile's wherever it began", () => {
    mock.state.shared.set("kelpie.space.profile", { a: "w2" });
    assert.equal(owner(space("a", "/code/work/client")), "w2");
  });
  test("an owner since deleted falls back to the folder", () => {
    mock.state.shared.set("kelpie.space.profile", { a: "gone" });
    assert.equal(owner(space("a", "/code/work/client")), "sub");
  });
  test("an agent's cd doesn't move a space to another profile", () => {
    const s = space("a", "/code/work/client", "ABC-1", [{ id: "t1" }]);
    mock.state.panes = [{ tab: "t1", cwd: "/code/work2/elsewhere", focused: true }];
    assert.equal(owner(s), "sub");
  });
  test("only a space that began in no profile's folder goes by where it is now", () => {
    const s = space("a", "/tmp/scratch", "Scratch", [{ id: "t1" }, { id: "t2" }]);
    mock.state.panes = [{ tab: "t1", cwd: "/code/work2" }, { tab: "t2", cwd: "/code/work/api", focused: true }];
    assert.equal(owner(s), "w", "its focused terminal's folder");
    mock.state.panes = [{ tab: "t1", cwd: "/code/work2" }];
    assert.equal(owner(s), "w2");
  });
  test("spacesOf: a profile's spaces only", () => {
    mock.state.spaces = [space("a", "/code/work"), space("b", "/code/work/client/x"), space("c", "/code/work2"), space("d", "/elsewhere")];
    assert.deepEqual(spacesOf(W).map((s) => s.id), ["a"]);
    assert.deepEqual(spacesOf(SUB).map((s) => s.id), ["b"]);
    assert.deepEqual(spacesOf(null), []);
  });
});

describe("deskOf: a profile's Desk", () => {
  test("the space kelpie.desk names", () => {
    mock.state.spaces = [space("d1", "/elsewhere", "Anything")];
    mock.state.shared.set("kelpie.desk", { w: "d1" });
    assert.equal(deskOf(W).id, "d1");
  });
  test("else a space of the profile's named Desk", () => {
    mock.state.spaces = [space("x", "/code/work2", "Desk"), space("d2", "/code/work", "Desk")];
    mock.state.shared.set("kelpie.desk", { w: "closed" });
    assert.equal(deskOf(W).id, "d2");
    assert.equal(deskOf(W2).id, "x");
  });
  test("none open: null", () => {
    mock.state.spaces = [space("a", "/code/work", "ABC-1")];
    assert.equal(deskOf(W), null);
    assert.equal(deskOf(null), null);
  });
});

describe("handoverFrom: where your part of a ticket is done", () => {
  const cols = (...names) => names.map((name) => ({ name, statuses: [] }));
  test("the profile's column by name", () => {
    assert.equal(handoverFrom(cols("To Do", "Doing", "QA", "Done"), "Doing"), 1);
  });
  test("else the first that sounds like testing", () => {
    assert.equal(handoverFrom(cols("To Do", "Code review", "Ready for QA", "In testing", "Done")), 2);
    assert.equal(handoverFrom(cols("To Do", "Verification", "Done")), 1);
    assert.equal(handoverFrom(cols("To Do", "Doing", "Testing", "Done"), "Gone"), 2, "a column the board no longer has");
  });
  test("else the board's last; none known: -1", () => {
    assert.equal(handoverFrom(cols("To Do", "Doing", "Shipped")), 2);
    assert.equal(handoverFrom([], "QA"), -1);
    assert.equal(handoverFrom(null), -1);
  });
});

describe("prompt templates", () => {
  test("jiraTask: the default, the profile's own, a blank one counting as none", () => {
    const fields = { key: "ABC-1", summary: "Login", url: "https://jira.example.com/browse/ABC-1", type: "Story", status: "To Do", parent: "", subtasks: "ABC-2 — Form (To Do)" };
    assert.equal(jiraTask(null, fields), "Work on ABC-1: Login\nhttps://jira.example.com/browse/ABC-1");
    assert.equal(jiraTask({ prompt: "{type} {key} ({status})\n{subtasks}\n{other}" }, fields), "Story ABC-1 (To Do)\nABC-2 — Form (To Do)\n{other}");
    assert.equal(jiraTask({ prompt: "   " }, fields), jiraTask(null, fields));
    assert.equal(jiraTask(null, fields, "Orchestrate {key}"), "Orchestrate ABC-1");
  });
  test("fillLines: a line whose placeholders all came out empty goes, others stay", () => {
    const t = "Ticket {ticket}: {summary}\nPRs:\n{prs}\n\nKeep {other}\nPlain line";
    assert.equal(fillLines(t, ["ticket", "summary", "prs"], { ticket: "", summary: " ", prs: "" }), "PRs:\n\nKeep {other}\nPlain line");
    assert.equal(fillLines(t, ["ticket", "summary", "prs"], { ticket: "ABC-1", summary: "", prs: "a\nb" }), "Ticket ABC-1: \nPRs:\na\nb\n\nKeep {other}\nPlain line");
  });
  test("fillLines: no more than one blank line in a row, nothing around", () => {
    assert.equal(fillLines("\nA\n{x}\n\n\n{x}\n\nB\n", ["x"], {}), "A\n\nB");
  });
  test("mergeTask and approvalTask: the defaults, without their ticket lines on the Desk", () => {
    const prs = "web#1: Login (approved) https://github.com/kelpie--demo/web/pull/1";
    assert.equal(mergeTask(null, { ticket: "ABC-1", summary: "Login", prs }), DEFAULT_MERGE_PROMPT.replace("{ticket}", "ABC-1").replace("{summary}", "Login").replace("{prs}", prs));
    const desk = approvalTask({}, { ticket: "", summary: "", prs });
    assert.ok(!desk.includes("{"), desk);
    assert.ok(desk.startsWith("These pull requests aren't approved yet:\nweb#1"), desk);
    assert.equal(desk.split("\n").length, DEFAULT_APPROVAL_PROMPT.split("\n").length - 1);
  });
  test("mergeTask and approvalTask: the profile's own templates", () => {
    assert.equal(mergeTask({ mergePrompt: "Merge {prs} for {ticket}" }, { ticket: "ABC-1", prs: "x" }), "Merge x for ABC-1");
    assert.equal(approvalTask({ approvalPrompt: "Chase {prs}" }, { prs: "y" }), "Chase y");
  });
  test("askText: the profile's message, else the default; unknown placeholders left", () => {
    assert.equal(askText(null, "fix", { prs: "a and b" }), "The checks fail on a and b. Find out why and fix them.");
    assert.equal(askText({ prompts: { fix: "Fix {prs} {later}" } }, "fix", { prs: "a" }), "Fix a {later}");
    assert.equal(askText({ prompts: { fix: "  " } }, "fix", { prs: "a" }), "The checks fail on a. Find out why and fix them.");
    assert.match(askText(null, "idea", { idea: "Faster\nbuilds", where: "web", why: "slow" }), /^An idea[\s\S]*\n\nFaster\nbuilds\n\nWhere: web\nWhy: slow\n/);
  });
});

describe("the argv agents start with", () => {
  test("claudeArgv: Default is plain claude; Claude's own folder unsets CLAUDE_CONFIG_DIR; another sets it", () => {
    assert.deepEqual(claudeArgv(null), ["claude"]);
    assert.deepEqual(claudeArgv({ claude: { config: "" } }, "-p", "x"), ["claude", "-p", "x"]);
    assert.deepEqual(claudeArgv({ claude: { config: "/home/u/.claude/" } }), ["env", "-u", "CLAUDE_CONFIG_DIR", "claude"]);
    assert.deepEqual(claudeArgv({ claude: { config: "/home/u/.claude-work" } }, "--resume"), ["env", "CLAUDE_CONFIG_DIR=/home/u/.claude-work", "claude", "--resume"]);
  });
  test("claudeArgv: a demo profile starts the demo's stand-in agent", () => {
    assert.deepEqual(claudeArgv({ demo: true, claude: { config: "/x/.claude-work" } }, "-p"), ["sh", `${mock.state.appHome}/mods/kelpie/demo/agent.sh`, "idle", ""]);
  });
  test("shellArgv: the login shell with the profile's account chosen, quoted", () => {
    assert.deepEqual(shellArgv(null), ["/bin/sh", "-c", 'exec env -u CLAUDE_CONFIG_DIR CLAUDE_ACCOUNT_CHOSEN=1 "${SHELL:-/bin/sh}" -l']);
    assert.deepEqual(shellArgv({ claude: { config: "/h/.claude" } }), shellArgv(null));
    assert.equal(shellArgv({ claude: { config: "/h/it's/.claude-x" } })[2], `exec env CLAUDE_CONFIG_DIR='/h/it'\\''s/.claude-x' CLAUDE_ACCOUNT_CHOSEN=1 "\${SHELL:-/bin/sh}" -l`);
  });
  test("resumeArgv: on the session's own account; demo- sessions start the stand-in", () => {
    assert.deepEqual(resumeArgv("abc", null), ["claude", "--resume", "abc"]);
    assert.deepEqual(resumeArgv("abc", "/h/.claude-work"), ["env", "CLAUDE_CONFIG_DIR=/h/.claude-work", "claude", "--resume", "abc"]);
    assert.deepEqual(resumeArgv("demo-s2", "/h/.claude-work"), ["sh", `${mock.state.appHome}/mods/kelpie/demo/agent.sh`, "idle", ""]);
  });
  test("the profile's GitHub account goes to new and resumed agents as KELPIE_GH_ACCOUNT, a name only", () => {
    const gh = { github: { owner: "acme", account: "work-me" } };
    assert.deepEqual(claudeArgv(gh), ["env", "KELPIE_GH_ACCOUNT=work-me", "claude"]);
    assert.deepEqual(claudeArgv({ ...gh, claude: { config: "/h/.claude-work" } }, "-p"), ["env", "CLAUDE_CONFIG_DIR=/h/.claude-work", "KELPIE_GH_ACCOUNT=work-me", "claude", "-p"]);
    assert.deepEqual(resumeArgv("abc", null, "work-me"), ["env", "KELPIE_GH_ACCOUNT=work-me", "claude", "--resume", "abc"]);
    assert.deepEqual(resumeArgv("abc", "/h/.claude-work", "work-me"), ["env", "CLAUDE_CONFIG_DIR=/h/.claude-work", "KELPIE_GH_ACCOUNT=work-me", "claude", "--resume", "abc"]);
    // A name that isn't a GitHub login is left out, never passed on.
    for (const bad of ["-u", "a b", "x;y"]) assert.deepEqual(claudeArgv({ github: { account: bad } }), ["claude"], bad);
  });
  test("shellArgv: the GitHub account reaches the login shell's environment as an argument, never as script", () => {
    const argv = shellArgv({ github: { owner: "acme", account: "work-me" } });
    assert.ok(!argv[2].includes("work-me"));
    const fakes = fakeBin().add("show-env", 'env | grep -E "^(KELPIE_GH_ACCOUNT|CLAUDE_ACCOUNT_CHOSEN)=" | sort');
    const r = sh(argv[0], argv.slice(1), { env: { SHELL: `${fakes.bin}/show-env` } });
    assert.equal(r.stdout, "CLAUDE_ACCOUNT_CHOSEN=1\nKELPIE_GH_ACCOUNT=work-me\n");
    assert.deepEqual(shellArgv({ github: { owner: "acme" } }), shellArgv(null));
  });
});
