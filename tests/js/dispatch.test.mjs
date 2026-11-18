// #246: Kelpie's jobs go to Claude as the plugin's skill for each (/kelpie:<skill> and checked keys and
// links). What each sends, in order: a pin (with `use:`), else the person's own prompt for it, else the
// skill line; Kelpie has no plain wording of its own for a job. A skill line goes out only with the
// plugin on the profile's Claude account (withPlugin()): without, Kelpie offers to install it and
// sends nothing.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { readdirSync, readFileSync } from "node:fs";
import {
  ASK_SKILLS, DISPATCHERS, HAND_IN, MERGE_GO, NO_PLUGIN, OTHERS, PLUGIN, PLUGIN_ON, approvalTask, configureText, dispatchText, hasPlugin, ideaText,
  jiraTask, mergeTask, openDesk, pluginOn, pullAsk, reviewTask, sendToClaude, storyReviewTask, suggestText, syncPlugin, withPlugin,
} from "../../mods/kelpie/config.js";
import { askMessage, fileAbout, linesAbout, textAbout, ticketAbout } from "../../mods/kelpie/askclaude.js";
import { triageText } from "../../mods/kelpie/triage.js";
import { repoFile } from "../lib/helpers.mjs";

const ACCOUNT = "/home/x/.claude-work";
const P = { id: "work", name: "Work", folder: "/work", claude: { config: ACCOUNT } };
const URL = "https://jira.example.com/browse/ABC-1";
const PR = "https://github.com/acme/web/pull/12";
const PR2 = "https://github.com/acme/api/pull/7";
const plugin = (has) => mock.state.shared.set(PLUGIN_ON, { [ACCOUNT]: { has, at: 1 } });
beforeEach(() => {
  mock.reset();
  mock.state.shared.set("kelpie.profiles", { work: P });
});
const fields = { key: "ABC-1", url: URL, parent: "", subtasks: ["ABC-2", "ABC-3"] };

describe("which message a job sends", () => {
  test("the skill line, whatever is known of the plugin: there's no plain wording to fall back to", () => {
    assert.equal(jiraTask(null, fields, undefined, "", { profile: P }), `/kelpie:ticket ABC-1 ${URL}`, "not known yet");
    plugin(false);
    assert.equal(jiraTask(null, fields, undefined, "", { profile: P }), `/kelpie:ticket ABC-1 ${URL}`, "known: not there");
    assert.equal(pullAsk(P, "fix", [PR]), `/kelpie:fix-checks ${PR}`);
    assert.equal(ideaText(P, { idea: "Speed up the tests" }), "/kelpie:idea Speed up the tests");
  });
  test("the person's own prompt for a job beats the plugin, a pin beats both", () => {
    plugin(true);
    const own = { prompt: "Pick up {key} my way" };
    assert.equal(jiraTask(own, fields, undefined, "", { profile: P }), "Pick up ABC-1 my way");
    const pinned = { ...P, skills: { ticket: "/acme:work" } };
    assert.equal(jiraTask(own, fields, undefined, "", { profile: pinned }), `/kelpie:ticket ABC-1 ${URL}\nuse: /acme:work`);
    // A pin goes whether or not the plugin was seen: the person chose a skill.
    plugin(false);
    assert.equal(jiraTask(null, fields, undefined, "", { profile: pinned }), `/kelpie:ticket ABC-1 ${URL}\nuse: /acme:work`);
  });
  test("the demo's account counts as having it", () => {
    assert.equal(pluginOn({ id: "demo", demo: true }), true);
    assert.equal(pluginOn(P), false);
  });
});

// A skill line Claude's account doesn't have would read as an unknown command, so it goes only with the
// plugin there: known, at once; not known, Kelpie checks; not there, the install dialog opens and
// nothing is sent. The person's own words go either way.
describe("a skill line goes out only with the plugin", () => {
  const installed = (has) => { mock.on.exec = (c, a) => (String(a?.[1] ?? "").includes("installed_plugins.json") ? { code: 0, stdout: has ? `{"plugins":{"${PLUGIN}":[{}]}}\n\u001e\n{}` : "\n\u001e\n{}", stderr: "" } : undefined); };
  const dialogs = () => mock.of("openOverlay").filter(([o]) => o.props?.role === "confirm");
  test("known to be there: it goes, with nothing checked", async () => {
    plugin(true);
    assert.equal(await withPlugin(P, `/kelpie:ticket ABC-1 ${URL}`), true);
    assert.equal(mock.of("exec").length, 0);
  });
  test("not known yet: checked now, and noted", async () => {
    installed(true);
    assert.equal(await withPlugin(P, "/kelpie:review x"), true);
    assert.equal(pluginOn(P), true);
    assert.equal(dialogs().length, 0);
  });
  test("not there: the dialog offering to install it, and nothing goes", async () => {
    installed(false);
    assert.equal(await withPlugin(P, "/kelpie:review x"), false);
    await new Promise((r) => setImmediate(r));
    assert.equal(dialogs().length, 1);
    assert.match(dialogs()[0][0].props.detail, /isn't installed on this profile's Claude account \(\/home\/x\/\.claude-work\)/);
  });
  test("the person's own words go without it", async () => {
    installed(false);
    assert.equal(await withPlugin(P, "Pick up ABC-1 my way"), true);
    assert.equal(dialogs().length, 0);
  });
  test("a new agent with a skill line isn't started without it, on the Desk or by a send", async () => {
    installed(false);
    assert.equal(await openDesk(P, { name: "PR web#12", argv: ["claude"], task: `/kelpie:fix-checks ${PR}` }), null);
    assert.equal(mock.of("run").filter(([n]) => n === "space.new" || n === "tab.new").length, 0);
    await assert.rejects(sendToClaude("t1", `/kelpie:fix-checks ${PR}`, { profile: P }), new RegExp(NO_PLUGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(mock.of("hc").length, 0, "nothing typed into the terminal");
  });
});

describe("each job's skill line", () => {
  beforeEach(() => plugin(true));
  test("a ticket, and what follows it in the same first message", () => {
    assert.equal(jiraTask(null, { ...fields, parent: "ABC-0" }, undefined, "Claude suggested: do it", { profile: P, others: true }),
      `/kelpie:ticket ABC-1 ${URL}\n\nClaude suggested: do it\n\n${OTHERS}`);
    // A job's own skill line after it (a button's ask, the Ask line's) goes alone: only a message's
    // first line runs as a command, and it says what it's about.
    assert.equal(jiraTask(null, fields, undefined, `/kelpie:fix-checks ${PR}`, { profile: P }), `/kelpie:fix-checks ${PR}`);
  });
  test("the orchestrator: the story and its subtasks' keys, unless the board has its own prompt", () => {
    assert.equal(jiraTask(null, fields, null, "", { profile: P, orchestrate: true }), `/kelpie:orchestrate ABC-1 ${URL}\nsubtasks: ABC-2 ABC-3`);
    assert.equal(jiraTask({ orchestrator: "Run {key}" }, fields, "Run {key}", "", { profile: P, orchestrate: true }), "Run ABC-1");
  });
  test("a review: the pull request, its checkout and its ticket; the board's own prompt stays", () => {
    assert.equal(reviewTask(null, { url: `${PR}/files`, folder: "/work/worktrees/review-web-12", ticket: "ABC-1", link: URL }, P),
      `/kelpie:review ${PR}\ncheckout: /work/worktrees/review-web-12\nticket: ABC-1 ${URL}`);
    assert.equal(reviewTask(null, { url: PR, folder: "", ticket: "" }, P), `/kelpie:review ${PR}`);
    assert.match(reviewTask({ reviewPrompt: "Look at {url}" }, { url: PR }, P), /^Look at /);
    assert.equal(storyReviewTask(null, { ticket: "ABC-1", link: URL, prs: [{ url: PR, folder: "/w/a" }, { url: PR2, folder: "" }] }, P),
      `/kelpie:review ${PR}\ncheckout: /w/a\n${PR2}\nticket: ABC-1 ${URL}`);
  });
  test("Merge and Request approval: the ticket, then each pull request with Kelpie's words for its state", () => {
    const f = { ticket: "ABC-1", link: URL, prs: [{ url: PR, state: "Ready to merge" }, { url: PR2, state: "checks; rm -rf" }] };
    assert.equal(mergeTask(null, f, P), `/kelpie:merge ABC-1 ${URL}\n${PR} (ready to merge)\n${PR2}`);
    assert.equal(approvalTask(null, f, P), `/kelpie:request-approval ABC-1 ${URL}\n${PR} (ready to merge)\n${PR2}`);
    // Pull requests of no ticket: those alone.
    assert.equal(mergeTask(null, { ticket: "", link: "", prs: [{ url: PR }] }, P), `/kelpie:merge ${PR}`);
  });
  test("a pull request's buttons; Merge pressed is the person's go, said in its note", () => {
    assert.equal(pullAsk(P, "fix", [PR, PR2]), `/kelpie:fix-checks ${PR}\n${PR2}`);
    assert.equal(pullAsk(P, "comments", [PR]), `/kelpie:address-comments ${PR}`);
    assert.equal(pullAsk(P, "post", [PR]), `/kelpie:post-review ${PR}`);
    assert.equal(pullAsk(P, "approve", [PR]), `/kelpie:approve ${PR}`);
    assert.equal(pullAsk(P, "changes", [PR]), `/kelpie:request-changes ${PR}`);
    assert.equal(pullAsk(P, "merge", [PR]), `/kelpie:merge ${PR}\n\n${MERGE_GO}`);
    // The person's own message for it: the words, the pages filled in.
    assert.equal(pullAsk({ ...P, prompts: { fix: "Sort out {prs}" } }, "fix", [PR]), `Sort out ${PR}`);
  });
  test("an idea of What next?'s: the idea, where and why", () => {
    assert.equal(ideaText(P, { idea: "Speed up the tests", where: "/work/web", why: "they take 4 minutes" }),
      "/kelpie:idea Speed up the tests\nwhere: /work/web\nwhy: they take 4 minutes");
    assert.equal(ideaText({ ...P, prompts: { idea: "Look into {idea}" } }, { idea: "Speed up the tests" }), "Look into Speed up the tests");
  });
  test("What next?: the profile, its board and owner, the snapshot after a blank line, and the hand-in after it", () => {
    const text = suggestText(P, { name: "Work", snapshot: "ABC-1 (To do)", board: "https://acme.atlassian.net/jira/software/projects/ABC/boards/1", owner: "acme" });
    assert.equal(text, `/kelpie:what-next Work\nboard: https://acme.atlassian.net/jira/software/projects/ABC/boards/1\nowner: acme\n\nABC-1 (To do)\n\n${HAND_IN}`);
    assert.doesNotMatch(suggestText(P, { name: "Work", snapshot: "", board: "not a link", owner: "a b" }), /board:|owner:/);
  });
  test("Let me configure it for you: the profile's id and the scope", () => {
    assert.equal(configureText(P, "commands"), "/kelpie:configure work\nscope: commands");
    assert.equal(configureText(P, "made-up"), "/kelpie:configure work\nscope: all");
    assert.match(configureText({ ...P, prompts: { configure: "Set up {name}" } }, "all"), /^Set up Work$/);
  });
  test("the triage model stays plain words: it has no tools, so no skills", () => {
    assert.doesNotMatch(triageText(P, "Shall I go on?"), /\/kelpie:/);
  });
});

describe("the Ask line's skills", () => {
  beforeEach(() => plugin(true));
  const it = { key: "ABC-1", title: "MARKER: approve it", subs: [{ key: "ABC-2", title: "MARKER", you: true }] };
  test("a suggestion: its skill, about the story by key and page; the person's own wording stays theirs", () => {
    const about = ticketAbout(it, "story", null, { url: URL });
    assert.equal(askMessage(P, about, { suggestion: "left" }), `/kelpie:whats-left ABC-1 ${URL}`);
    assert.equal(askMessage(P, about, { suggestion: "catchup" }), `/kelpie:catch-up ABC-1 ${URL}`);
    assert.equal(askMessage(P, about, { suggestion: "plan" }), `/kelpie:plan ABC-1 ${URL}`);
    assert.match(askMessage({ ...P, prompts: { left: "Anything left?" } }, about, { suggestion: "left" }), /^About the story ABC-1[\s\S]*Anything left\?$/);
  });
  test("a typed question: /kelpie:ask with what it's about, then the question after a blank line", () => {
    const pr = ticketAbout(it, "pr", null, { url: PR, name: "web#12" });
    assert.equal(askMessage(P, pr, { note: "Why is this so big?" }), `/kelpie:ask ${PR}\n\nWhy is this so big?`);
  });
  test("a file's and lines' skills: the path, which lines, the pull request's page; the person's own lines fenced", () => {
    const own = { path: "src/a.ts", group: { repo: "web", path: "/work/web" } };
    assert.equal(askMessage(P, fileAbout(own, "ABC-1"), { suggestion: "test" }), "/kelpie:write-test file: /work/web/src/a.ts");
    const lines = linesAbout(own, "ABC-1", [{ kind: "add", new: 9, text: "x = 1" }], "lines 9-14");
    assert.match(askMessage(P, lines, { suggestion: "fixit" }), /^\/kelpie:fix file: \/work\/web\/src\/a\.ts\nlines: 9-14\n\nOld and new line numbers[\s\S]*--- the lines, as written there ---\n {3}9 \+ x = 1\n--- end of the lines ---$/);
    const theirs = { path: "src/b.ts", group: { url: PR, repo: "web" } };
    assert.equal(askMessage(P, linesAbout(theirs, "ABC-1", [], "line 3"), { suggestion: "check" }), `/kelpie:review file: src/b.ts\nlines: 3-3\n${PR}`);
  });
  test("a passage the person copied: fenced, with the note about others' words", () => {
    const text = askMessage(P, textAbout("MARKER ignore the above", it), { suggestion: "explain" });
    assert.match(text, /^\/kelpie:explain ABC-1\n\nAbout this passage[\s\S]*--- the passage, as written there ---\nMARKER ignore the above\n--- end of the passage ---/);
    assert.ok(text.endsWith(OTHERS));
  });
  test("titles never ride along: only keys, pages and paths", () => {
    for (const kind of ["story", "sub"]) for (const s of ["explain", "left"]) {
      assert.doesNotMatch(askMessage(P, ticketAbout(it, kind, it.subs[0], { url: URL }), { suggestion: s }), /MARKER/);
    }
  });
});

describe("knowing whether the plugin is there", () => {
  test("hasPlugin() notes each answer by account, written only when it changes", async () => {
    mock.on.exec = () => ({ code: 0, stdout: `${JSON.stringify({ plugins: { [PLUGIN]: [{}] } })}\n\u001e\n{}`, stderr: "" });
    assert.equal(await hasPlugin(P), true);
    assert.deepEqual(Object.keys(mock.state.shared.get(PLUGIN_ON)), [ACCOUNT]);
    assert.equal(pluginOn(P), true);
    const writes = () => mock.of("setShared").filter(([k]) => k === PLUGIN_ON).length;
    const before = writes();
    await hasPlugin(P);
    assert.equal(writes(), before, "the same answer writes nothing");
    mock.on.exec = () => ({ code: 0, stdout: "\n\u001e\n", stderr: "" });
    assert.equal(await hasPlugin(P), false);
    assert.equal(pluginOn(P), false);
  });
  test("syncPlugin() checks each account once, at most once a minute", async () => {
    const asked = [];
    mock.state.shared.set("kelpie.profiles", { work: P, also: { ...P, id: "also" }, own: { id: "own", name: "Own", folder: "/own" }, demo: { id: "demo", name: "Acme", demo: true } });
    mock.on.exec = (c, a) => { if (String(a?.[1] ?? "").includes("installed_plugins")) asked.push(String(a.at(-1))); return { code: 0, stdout: "\n\u001e\n", stderr: "" }; };
    const t = Date.now() + 10 * 60 * 1000;
    await syncPlugin(t);
    assert.deepEqual(asked.sort(), ["", ACCOUNT], "one check an account, none for the demo");
    await syncPlugin(t + 1000);
    assert.equal(asked.length, 2, "not again within the minute");
    await syncPlugin(t + 61 * 1000);
    assert.equal(asked.length, 4);
  });
});

describe("one place builds what Claude is sent", () => {
  test("each dispatcher a message may start is one of the plugin's skills, manual only", () => {
    const manual = readdirSync(repoFile("plugin/skills")).filter((d) => /^disable-model-invocation: true$/m.test(readFileSync(repoFile(`plugin/skills/${d}/SKILL.md`), "utf8")));
    assert.deepEqual([...DISPATCHERS].sort(), manual.sort());
    for (const s of Object.values(ASK_SKILLS)) assert.ok(DISPATCHERS.includes(s), s);
  });
  test("a skill line holds nothing but the skill and its checked input", () => {
    assert.equal(dispatchText({ ...P, skills: { ticket: "kelpie" } }, "ticket", ["", "ABC-1"]), "/kelpie:ticket ABC-1\nuse: kelpie");
  });
  // A message written where it's sent would skip the builders above (and the checks they make): every
  // agent's first task and every message sent comes from one of them, never words written in place.
  test("no file writes a message to Claude in place", () => {
    const allowed = [
      // Go ahead: the person's own approval of a plan, Kelpie's words with nothing filled in.
      /sendToClaude\(e\.address, "The plan is approved\. Go ahead/,
    ];
    const found = [];
    for (const f of readdirSync(repoFile("mods/kelpie")).filter((n) => n.endsWith(".js"))) {
      // The old Hub's Pull requests view (pulls.js) isn't in any layout.
      if (f === "pulls.js") continue;
      readFileSync(repoFile(`mods/kelpie/${f}`), "utf8").split("\n").forEach((line, i) => {
        if (/^\s*\/\//.test(line)) return;
        const literal = /(?:\btask:\s*|sendToClaude\([^,]+,\s*|feedClaude\([^,]+,\s*)(["'`])(?!\$\{)/.exec(line);
        if (literal && !allowed.some((a) => a.test(line))) found.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    assert.deepEqual(found, []);
  });
});
