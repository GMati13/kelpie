// What Kelpie's dialogs draw (dialogs.js Confirm and StoryPicker), opened the way the views open them,
// pinned as snapshots (tests/README.md, Snapshots): the clean-up confirm with its leftovers, Clean up
// all, the close dialog of a story's last tab, an agent's profile change waiting for a yes, the
// story picker, and the profile dialog's Agents, GitHub and Board pages (accounts, with their guides; Jira
// or a GitHub Project), and how the profile dialog fits the window it opens in.
import { DEMO, demoProfile, fakeCx, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, isElement, nodeOf, texts } from "gpui-kit";
import { byId, matchSnapshot, render } from "../lib/snapshot.mjs";
import { Stories, StoryList } from "../../mods/kelpie/stories.js";
import { CHANGE_FIT, Confirm, StoryPicker, lineDiff } from "../../mods/kelpie/dialogs.js";
import { FIT, Setup } from "../../mods/kelpie/setup.js";
import { needsYes, openProfile, requestProfileChange } from "../../mods/kelpie/config.js";
import Quiet from "../../mods/kelpie/main.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";

const snap = (name, el) => matchSnapshot(name, render(el, skinTheme()));
let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

// A profile with a leftovers check and a clean-up command, and what the check found for ACME-122
// (as checkLeftovers() keeps it: `ask` says what was asked, so it isn't asked again).
const COMMANDS = { leftovers: "check-leftovers {key}", cleanUp: "clean-up {key}" };
const LEFTOVERS = { [DEMO]: { at: Date.now(), ask: `3|${COMMANDS.leftovers}|${COMMANDS.cleanUp}|ACME-116 ACME-118 ACME-122 ACME-129 ACME-190`,
  found: { "ACME-122": { "ACME-123": ["worktrees/ACME-123/api: 2 files not pushed", "a branch ACME-123 in api"] } } } };

// The dialog the last openOverlay() asked for, drawn as Herdr would: its props, then Confirm.
function lastDialog(Role = Confirm) {
  const [spec] = mock.of("openOverlay").at(-1);
  mock.state.props = { ...spec.props, overlay: "overlay-1" };
  const d = new Role();
  d.init(fakeCx());
  return { spec, el: d.render(fakeCx()) };
}
const press = (el, id, cx = fakeCx()) => { for (const h of handlers(el).filter((x) => x.id === id)) h.fn({}, cx); };

test("the clean-up confirm lists what goes, its leftovers by key", async () => {
  setupDemoWorld({ stories, profile: { commands: COMMANDS } });
  mock.state.shared.set("kelpie.clean.leftovers", LEFTOVERS);
  const { el } = await draw(new StoryList());
  press(el, "clean-ACME-122");
  const { spec, el: dialog } = lastDialog();
  assert.equal(spec.props.title, "Clean up ACME-122?");
  assert.deepEqual(texts(byId(dialog, "confirm-yes")), ["Clean up"]);
  snap("dialogs/clean-up", dialog);
});

test("Clean up all lists every finished story with something left", async () => {
  setupDemoWorld({ stories });
  const { el } = await draw(new StoryList());
  press(el, "stories-clean-all");
  snap("dialogs/clean-up-all", lastDialog().el);
});

// Move to Done from a built story's row: each ticket and where it goes, and Clean up afterwards.
test("Move to Done lists each ticket, with Clean up afterwards", async () => {
  setupDemoWorld({ stories });
  const { el } = await draw(new StoryList());
  press(el, "finish-ACME-129-button");
  const { spec, el: dialog } = lastDialog();
  assert.equal(spec.props.title, "Move ACME-129 to Done?");
  assert.equal(spec.props.check, null, "ACME-131 is someone else's and still open, so the story stays and nothing can be cleaned up");
  snap("dialogs/move-to-done", dialog);
});
test("Move to Done of a story that will be done offers Clean up afterwards", async () => {
  setupDemoWorld({ stories });
  mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-138" });
  const { el } = await draw(new Stories());
  press(el, "story-finish");
  const { el: dialog } = lastDialog();
  assert.ok(byId(dialog, "confirm-check"));
  snap("dialogs/move-to-done-clean", dialog);
});

test("closing a story's last tab asks: Pause, or Close", () => {
  setupDemoWorld({ stories, shown: "ACME-122", props: { role: "toolbar" } });
  const cx = { ...fakeCx(), spawn() {} };
  const bar = new Quiet({});
  bar.init({}, cx);
  // Hovering the tab turns its mark into the ✕.
  handlers(bar.render(cx), "on_hover").find((h) => h.id === "tab-t5-0").fn(true, cx);
  press(bar.render(cx), "close-t5-0", cx);
  const { spec, el } = lastDialog();
  assert.equal(spec.props.title, "Leave ACME-122?");
  snap("dialogs/leave-story", el);
  mock.state.props = { role: "toolbar" };
  handlers(bar.render(cx), "on_hover").find((h) => h.id === "tab-t5-0").fn(false, cx);
});

test("an agent's profile change waits for the person's yes", () => {
  setupDemoWorld({ stories });
  const r = requestProfileChange(DEMO, { commands: { status: "git -C {key} status --short" }, prompts: { fix: "Fix the checks of {prs}." } });
  assert.equal(r.pending, true);
  const { el } = lastDialog();
  assert.deepEqual(texts(byId(el, "confirm-yes")), ["Save these changes"]);
  assert.deepEqual(texts(byId(el, "confirm-no")), ["Cancel"]);
  snap("dialogs/profile-change", el);
});

// Issue #56: the dialog for an agent's profile change is sized to what it says, names each setting
// as the profile dialog does, shows a changed value's old and new lines, and says why it waits in
// words that fit what changes.
const MERGE_WAS = "Check {prs} are ready to merge.\n\nThen write a merge plan:\n- the order\n- what to deploy";
const MERGE_NOW = "Check {prs} are ready to merge.\n\nThen merge them yourself, now:\n- the order\n- what to deploy\n- skip the checks";

test("a changed prompt shows under its page and name, its lines removed and added", () => {
  setupDemoWorld({ stories, profile: { github: { ...demoProfile().github, mergePrompt: MERGE_WAS } } });
  requestProfileChange(DEMO, { github: { mergePrompt: MERGE_NOW } });
  const { spec, el } = lastDialog();
  assert.deepEqual(spec.props.changes.map((c) => [c.key, c.page, c.label, c.kind]), [["github.mergePrompt", "Prompts", "Merge", "prompt"]]);
  assert.equal(spec.props.changes[0].was, MERGE_WAS);
  assert.equal(spec.props.changes[0].now, MERGE_NOW, "the whole value, as written");
  assert.ok(texts(byId(el, "confirm-change-0")).includes("Prompts · Merge"));
  assert.match(spec.props.detail, /a prompt steers your agents/);
  assert.doesNotMatch(spec.props.detail, /command|Jira|sign-in/, "only why this change waits");
  snap("dialogs/profile-change-prompt", el);
});

test("a changed command shows in monospace, saying a command runs on this machine", () => {
  setupDemoWorld({ stories, profile: { commands: { cleanUp: "rm -rf worktrees/{key}" } } });
  requestProfileChange(DEMO, { commands: { cleanUp: "rm -rf worktrees/{key} ~/backups" } });
  const { spec, el } = lastDialog();
  assert.equal(spec.props.changes[0].label, "Clean-up command");
  assert.match(spec.props.detail, /a command runs on this machine/);
  assert.doesNotMatch(spec.props.detail, /prompt|Jira/);
  snap("dialogs/profile-change-command", el);
});

test("each kind of setting says why it waits in its own words", () => {
  setupDemoWorld({ stories });
  const why = (set) => { requestProfileChange(DEMO, set); return mock.of("openOverlay").at(-1)[0].props.detail; };
  assert.match(why({ jira: { keychain: "other-item" } }), /where your Jira token goes/);
  assert.match(why({ web: { home: "https://example.com" } }), /opens in your browser/);
  assert.match(why({ github: { account: "someone-else" } }), /who Kelpie acts as/);
  assert.match(why({ commands: { status: "x" }, prompts: { fix: "y" } }), /a command runs on this machine and a prompt steers your agents/);
});

test("a long value is kept whole, a new one and a removed one say so, a prompt unset is its default", () => {
  setupDemoWorld({ stories, profile: { commands: { status: "make status" } } });
  const long = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of the prompt.`).join("\n");
  const asks = needsYes(DEMO, { prompts: { fix: long }, commands: { status: null, leftovers: long } });
  assert.deepEqual(asks.map((x) => [x.key, x.label, x.was, x.now === long ? "long" : x.now, x.from ?? null]), [
    ["prompts.fix", "Fix checks", "The checks fail on {prs}. Find out why and fix them.", "long", "default"],
    ["commands.status", "Status command", "make status", null, null],
    ["commands.leftovers", "Leftovers check", null, "long", null]]);
  requestProfileChange(DEMO, { prompts: { fix: long }, commands: { status: null, leftovers: long } });
  const { el } = lastDialog();
  assert.ok(texts(byId(el, "confirm-change-0")).includes("replacing the default"));
  assert.ok(texts(byId(el, "confirm-change-1")).includes("removed"));
  assert.ok(texts(byId(el, "confirm-change-2")).includes("new"));
  assert.ok(byId(el, "confirm-change-2-39"), "all 40 lines drawn");
  // A prompt removed goes back to its default, shown as what it becomes.
  setupDemoWorld({ stories, profile: { prompts: { fix: "Fix it." } } });
  const [back] = needsYes(DEMO, { prompts: null });
  assert.deepEqual([back.was, back.now, back.to], ["Fix it.", "The checks fail on {prs}. Find out why and fix them.", "default"]);
});

test("lineDiff keeps the lines in common and puts each run's removed lines first", () => {
  assert.deepEqual(lineDiff("a\nb\nc", "a\nB\nc\nd"), [
    { kind: "same", text: "a" }, { kind: "del", text: "b" }, { kind: "add", text: "B" }, { kind: "same", text: "c" }, { kind: "add", text: "d" }]);
  assert.deepEqual(lineDiff(null, "x"), [{ kind: "add", text: "x" }]);
  assert.deepEqual(lineDiff("x", null), [{ kind: "del", text: "x" }]);
});

test("the profile-change dialog is a card sized to its content, up to the window, only its changes scrolling", () => {
  setupDemoWorld({ stories });
  requestProfileChange(DEMO, { commands: { status: "git -C {key} status --short" } });
  const { spec, el } = lastDialog();
  assert.equal(spec.frame, "none", "it draws its own card");
  assert.ok(spec.width <= 1 && spec.height <= 1, `a share of the window, not px: ${spec.width}×${spec.height}`);
  assert.ok(calls(nodeOf(el), "p").some(([m]) => m === CHANGE_FIT.margin), "a margin to the window's edges");
  const card = nodeOf(byId(el, "kelpie-confirm"));
  assert.deepEqual(calls(card, "max_w"), [[CHANGE_FIT.w]]);
  assert.equal(calls(card, "max_h_full").length, 1, "never taller than the window's room");
  assert.equal(calls(card, "h").length + calls(card, "size").length + calls(card, "size_full").length + calls(card, "h_full").length, 0, "as tall as what it holds");
  assert.ok(scrolls(pathTo(el, "confirm-detail").at(-1)), "the changes scroll past that");
  assert.equal(calls(pathTo(el, "confirm-detail").at(-1), "flex_1").length, 0, "the changes take their own height, not the card's");
  for (const id of ["confirm-yes", "confirm-no"]) assert.equal(pathTo(el, id).filter(scrolls).length, 0, `${id} is outside the scroll`);
});

// Herdr's scroll area takes no height from what it holds (on screen the changes collapsed to
// nothing): the changes measure themselves, and that, unzoomed, is the scroll area's height.
test("the profile-change list is as tall as its changes as drawn, divided by the zoom", () => {
  setupDemoWorld({ stories });
  requestProfileChange(DEMO, { commands: { status: "git -C {key} status --short" } });
  const [spec] = mock.of("openOverlay").at(-1);
  mock.state.props = { ...spec.props, overlay: "overlay-1" };
  const d = new Confirm();
  const cx = fakeCx();
  d.init(cx);
  const heightOf = (el) => calls(nodeOf(byId(el, "confirm-detail")), "h").at(-1)?.[0];
  let el = d.render(cx);
  assert.ok(heightOf(el) > 0, "a guess before it's measured, never nothing");
  const sized = (id, size) => handlers(el, "on_size_change").find((h) => h.id === id).fn(size, cx);
  sized("confirm-zoom-probe", { width: 120, height: 0 });
  sized("confirm-changes", { width: 800, height: 300 });
  el = d.render(cx);
  assert.equal(heightOf(el), 250);
});

test("the story picker: every story, then filtered", () => {
  setupDemoWorld({ stories, props: { role: "story-picker", overlay: "overlay-1" } });
  const picker = new StoryPicker();
  const cx = fakeCx();
  picker.init(cx);
  snap("dialogs/story-picker", picker.render(cx));
  picker.filter = "pay";
  const filtered = picker.render(cx);
  assert.ok(byId(filtered, "sp-ACME-151"));
  assert.equal(byId(filtered, "sp-ACME-142"), null);
  snap("dialogs/story-picker-filtered", byId(filtered, "sp-list"));
});

test("the story picker finds a finished story the list left out, saying it's done", () => {
  setupDemoWorld({ stories, props: { role: "story-picker", overlay: "overlay-1" } });
  const picker = new StoryPicker();
  const cx = fakeCx();
  picker.init(cx);
  picker.filter = "currency";
  const row = byId(picker.render(cx), "sp-ACME-118");
  assert.ok(row, "ACME-118 is found");
  assert.ok(texts(row).includes("Done"));
});

test("Kelpie-Plain: the story picker and a confirm", () => {
  setupDemoWorld({ stories, layout: "Kelpie-Plain", props: { role: "story-picker", overlay: "overlay-1" } });
  const picker = new StoryPicker();
  picker.init(fakeCx());
  snap("plain/dialogs/story-picker", picker.render(fakeCx()));
  requestProfileChange(DEMO, { commands: { status: "git -C {key} status --short" } });
  snap("plain/dialogs/profile-change", lastDialog().el);
});

// The profile dialog opened on a page, as `herdr-app do kelpie.edit-profile-<page>` opens it.
// `filled`: the stub's inputs start empty (gpui-base's InputState and TextareaState ignore `value`),
// so each is given the value the dialog started it with, and the dialog's starting point is taken
// again, as init() takes it in Herdr.
function profileDialog(focus, profile = {}, { filled = false } = {}) {
  setupDemoWorld({ stories, profile, props: { role: "setup", profile: DEMO, focus, overlay: "overlay-1" } });
  const d = new Setup();
  const cx = fakeCx();
  d.init(cx);
  if (filled) {
    const states = [...Object.values(d), ...Object.values(d.asks), ...Object.values(d.prefixes).map((x) => x.state)];
    for (const s of states) {
      const start = s?.__state?.args?.[0]?.value;
      if (typeof start === "string" && !s.value()) s.set_value(start);
    }
    d.initial = JSON.stringify(d.draft().profile);
  }
  return { d, cx };
}
function profilePage(focus, profile = {}) {
  const { d, cx } = profileDialog(focus, profile);
  return d.render(cx);
}

test("the profile dialog's Agents page: the Claude account, and how to add another", () => {
  const el = profilePage("agents");
  const words = texts(el).join("\n");
  for (const s of ["Claude account", "Another Claude account", "CLAUDE_CONFIG_DIR=~/.claude-demo claude", "claude-statusline.sh", "CLAUDE_ACCOUNT_CHOSEN"]) assert.ok(words.includes(s), s);
  snap("dialogs/profile-agents", el);
});

test("the profile dialog's GitHub page: with an account picked, the shell function to copy and its check", () => {
  const el = profilePage("github", { github: { owner: "kelpie--demo", demo: true, account: "kelpie-demo" } });
  const words = texts(el).join("\n");
  for (const s of ["GitHub account", "KELPIE_GH_ACCOUNT=kelpie-demo", "Check my shell"]) assert.ok(words.includes(s), s);
  assert.ok(byId(el, "setup-gh-copy"));
  snap("dialogs/profile-github", el);
});

// The Board page: Jira or a GitHub Project (tab id `jira`, also opened as `board` or `project`).
const DEMO_PROJECT = { url: "https://github.com/users/kelpie--demo/projects/1", owner: "kelpie--demo", ownerType: "user", number: 1, demo: true };

test("the profile dialog's Board page on Jira: the choice of board, then Jira's form", () => {
  const { d: board, cx: bcx } = profileDialog("jira", {}, { filled: true });
  const el = board.render(bcx);
  assert.equal(texts(byId(el, "setup-tab-jira"))[0], "Board");
  assert.deepEqual(texts(byId(el, "setup-board-kind-0")), ["Jira"]);
  assert.deepEqual(texts(byId(el, "setup-board-kind-1")), ["GitHub Project"]);
  assert.ok(byId(el, "setup-jira-check"));
  assert.equal(byId(el, "setup-project-check"), null);
  snap("dialogs/profile-board-jira", el);
});

test("the profile dialog's Board page on a GitHub Project: after a Check, each repo's key prefix and the Status options", async () => {
  const { d, cx } = profileDialog("project", { jira: null, project: DEMO_PROJECT }, { filled: true });
  assert.equal(d.tab, "jira");
  press(d.render(cx), "setup-project-check", cx);
  await cx.settle();
  assert.equal(mock.of("exec").filter(([, a]) => String(a?.[0] ?? "").endsWith("gh.sh")).length, 0, "the demo runs nothing");
  const el = d.render(cx);
  const words = texts(el).join("\n");
  for (const s of ["Project address", "Ticket keys", "kelpie--demo/acme", "Done from column", "GitHub · Acme"]) assert.ok(words.includes(s), s);
  assert.equal(byId(el, "setup-jira-check"), null);
  assert.equal(d.checks.project.ok, true);
  snap("dialogs/profile-board-project", el);
});

test("the Board page's other names open it", () => {
  for (const focus of ["board", "project", "jira"]) assert.equal(profileDialog(focus).d.tab, "jira", focus);
  // A profile with Jira stays on Jira's form, even opened as `project`.
  assert.equal(profileDialog("project").d.boardKind, "jira");
});

test("choosing a GitHub Project: Save keeps it and drops Jira, the board's prompt moving with it", () => {
  const { d, cx } = profileDialog("jira", { jira: { ...demoProfile().jira, prompt: "Do {key}", handover: "QA" } }, { filled: true });
  assert.equal(d.dirty(), false);
  press(d.render(cx), "setup-board-kind-1", cx);
  d.projectUrl.set_value(`${DEMO_PROJECT.url}/views/3`);
  const { error, profile } = d.draft();
  assert.equal(error, null);
  assert.equal(profile.jira, null);
  assert.deepEqual(profile.project, { url: `${DEMO_PROJECT.url}/views/3`, owner: "kelpie--demo", ownerType: "user", number: 1, prompt: "Do {key}", handover: "QA", demo: true });
  assert.equal(d.dirty(), true);
  assert.equal(d.tabStatus("jira"), "GitHub · kelpie--demo/1");
  // And back: Jira again, the Project dropped.
  press(d.render(cx), "setup-board-kind-0", cx);
  assert.equal(d.draft().profile.project, null);
  assert.equal(d.draft().profile.jira.prompt, "Do {key}");
});

test("I work alone: the Board page's toggle saves solo with the board, and off drops it", () => {
  const { d, cx } = profileDialog("jira", {}, { filled: true });
  assert.equal(d.draft().profile.jira.solo, undefined, "a team by default");
  press(d.render(cx), "setup-solo", cx);
  assert.equal(d.draft().profile.jira.solo, true);
  assert.equal(d.dirty(), true);
  assert.ok(texts(d.render(cx)).some((x) => x.includes('they\'re under "Built"')), "the hint names what the list will say");
  // It moves with the board, as the handover column does.
  press(d.render(cx), "setup-board-kind-1", cx);
  d.projectUrl.set_value(DEMO_PROJECT.url);
  assert.equal(d.draft().profile.project.solo, true);
  press(d.render(cx), "setup-board-kind-0", cx);
  press(d.render(cx), "setup-solo", cx);
  assert.equal(d.draft().profile.jira.solo, undefined);
  assert.equal(profileDialog("jira", { jira: { ...demoProfile().jira, solo: true } }).d.solo, true, "a saved one opens on");
});

test("Move to Done: the Board page's toggle, on by default, saves moveToDone false only when off", () => {
  const { d, cx } = profileDialog("jira", {}, { filled: true });
  assert.equal(d.draft().profile.jira.moveToDone, undefined, "on by default, nothing saved");
  press(d.render(cx), "setup-move-to-done", cx);
  assert.equal(d.draft().profile.jira.moveToDone, false);
  assert.ok(texts(d.render(cx)).some((x) => x.startsWith("Off: tickets move only one at a time")));
  press(d.render(cx), "setup-move-to-done", cx);
  assert.equal(d.draft().profile.jira.moveToDone, undefined);
  assert.equal(profileDialog("jira", { jira: { ...demoProfile().jira, moveToDone: false } }).d.moveToDone, false, "a saved off opens off");
});

test("a Project's address that isn't one, and prefixes that can't be keys, stop Save with a reason", () => {
  const { d } = profileDialog("project", { jira: null, project: DEMO_PROJECT }, { filled: true });
  d.projectUrl.set_value("https://github.com/kelpie--demo/acme");
  assert.deepEqual(d.draft().error, ["project", "That isn't a GitHub Project's address: https://github.com/users/<you>/projects/<number>, or /orgs/<org>/projects/<number>."]);
  d.projectUrl.set_value(DEMO_PROJECT.url);
  d.addPrefix("kelpie--demo/acme");
  d.addPrefix("kelpie--demo/web");
  assert.equal(d.draft().error, null);
  assert.equal(d.draft().profile.project.prefixes, undefined, "a repo's own prefix isn't saved");
  d.prefixes["kelpie--demo/web"].state.set_value("acme");
  assert.deepEqual(d.draft().error, ["project", "The key prefix of kelpie--demo/web: kelpie--demo/acme has ACME too: give one of them its own."]);
  d.prefixes["kelpie--demo/web"].state.set_value("w_b");
  assert.match(d.draft().error[1], /a letter, then letters or digits/);
  d.prefixes["kelpie--demo/web"].state.set_value("site");
  assert.equal(d.draft().error, null);
  assert.equal(d.draft().profile.project.prefixes, "kelpie--demo/web=SITE");
});

test("saved prefixes come back as the inputs, and saving unchanged keeps them", () => {
  const { d } = profileDialog("project", { jira: null, project: { ...DEMO_PROJECT, prefixes: "kelpie--demo/acme=AC" } }, { filled: true });
  assert.equal(d.prefixes["kelpie--demo/acme"].state.value(), "AC");
  assert.equal(d.dirty(), false);
  assert.equal(d.draft().profile.project.prefixes, "kelpie--demo/acme=AC");
});

// The profile dialog fits the window it opens in (issue #44: on a 1440×900 laptop it didn't): it
// opens as the whole window and draws its card there, at most FIT's size and never past the window,
// with the page and the side tabs scrolling, and Save and Cancel outside both, always on screen.
// The path of elements from `x` down to the one with `id` (itself last), or null.
function pathTo(x, id, up = []) {
  if (Array.isArray(x)) { for (const v of x) { const f = pathTo(v, id, up); if (f) return f; } return null; }
  if (!isElement(x)) return null;
  const n = nodeOf(x), here = [...up, n];
  if (n.calls.some(([m, a]) => m === "id" && a[0] === id)) return here;
  for (const a of n.args) { const f = pathTo(a, id, here); if (f) return f; }
  for (const [, a] of n.calls) for (const v of a) { const f = pathTo(v, id, here); if (f) return f; }
  return null;
}
const calls = (n, name) => n.calls.filter(([m]) => m === name).map(([, a]) => a);
const scrolls = (n) => calls(n, "overflow_y_scrollbar").length > 0;

test("the profile dialog opens as a share of the window, never a fixed size that can be bigger", () => {
  setupDemoWorld({ stories });
  openProfile(DEMO, { focus: "agents" });
  const [spec] = mock.of("openOverlay").at(-1);
  assert.equal(spec.props.role, "setup");
  assert.equal(spec.frame, "none", "the dialog draws its own card");
  assert.ok(spec.width <= 1 && spec.height <= 1, `a share of the window, not px: ${spec.width}×${spec.height}`);
});

test("the profile dialog's card shrinks to the window, its page and tabs scroll, Save and Cancel stay outside", () => {
  for (const focus of ["general", "jira", "github", "web", "agents", "prompts", "messages", "commands"]) {
    const el = profilePage(focus);
    const card = byId(el, "work-setup");
    assert.ok(card, focus);
    const c = nodeOf(card);
    assert.deepEqual(calls(c, "max_w"), [[FIT.w]], "at most FIT.w wide");
    assert.deepEqual(calls(c, "max_h"), [[FIT.h]], "at most FIT.h tall");
    assert.equal(calls(c, "w").length + calls(c, "h").length + calls(c, "size").length, 0, "no fixed size of its own");
    assert.equal(calls(c, "w_full").length, 1);
    assert.equal(calls(c, "h_full").length, 1);
    assert.ok(calls(nodeOf(el), "p").some(([m]) => m === FIT.margin), "a margin to the window's edges");
    assert.ok(pathTo(el, `work-setup-body-${focus}`).at(-1).calls.some(([m]) => m === "overflow_y_scrollbar"), `${focus}: the page scrolls`);
    assert.ok(scrolls(pathTo(el, "setup-tabs").at(-1)), "the side tabs scroll");
    assert.ok(pathTo(el, `setup-tab-${focus}`).some(scrolls), "each tab is inside that scroll");
    for (const id of ["setup-save", "setup-cancel"]) {
      const path = pathTo(el, id);
      assert.ok(path, id);
      assert.equal(path.filter(scrolls).length, 0, `${id} is outside every scroll`);
    }
    // Let me configure it for you is a quiet button in the Save row, not a card in the side column.
    const row = pathTo(el, "setup-save").at(-2);
    const configure = pathTo(el, "setup-configure-all") ?? pathTo(el, "setup-configure-all-more");
    assert.ok(configure?.includes(row), `${focus}: Let me configure it for you is in the Save row`);
    // Delete profile is far from it: at the end of the General page, never in the Save row.
    const remove = pathTo(el, "setup-remove");
    if (focus === "general") assert.ok(remove && !remove.includes(row), "general: Delete profile is on the page");
    else assert.equal(remove, null, `${focus}: no Delete profile`);
  }
});

test("Delete profile, on the General page, deletes the profile only on its second press", () => {
  const { d, cx } = profileDialog("general");
  press(d.render(cx), "setup-remove", cx);
  assert.ok(mock.state.shared.get("kelpie.profiles")[DEMO], "the first press only asks");
  assert.ok(texts(d.render(cx)).some((x) => x.startsWith("Delete ")), "it now says what it deletes");
  press(d.render(cx), "setup-remove", cx);
  assert.equal(mock.state.shared.get("kelpie.profiles")[DEMO], undefined);
});
