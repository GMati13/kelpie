// Close in the Done group (#167; stories.js closePlan, askClose, closeStories; issues.js closeIssue):
// on a GitHub Project a story moved to done is still open on GitHub, so the Done group closes it, one
// row's Close or the heading's Close all, after a dialog. Only that dialog's button closes anything.
import { DEMO, draw, fakeCx, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, texts } from "gpui-kit";
import { byId } from "../lib/snapshot.mjs";
import { StoryList, build, closePlan, closeStories, storyItems } from "../../mods/kelpie/stories.js";
import { Confirm } from "../../mods/kelpie/dialogs.js";
import { CLOSE, closeIssue } from "../../mods/kelpie/issues.js";
import { DEMO_PROJECT_PROFILE, data, issue } from "../lib/stories.mjs";
import { bodyOf, readRepo } from "../lib/helpers.mjs";

const PROFILE = { jira: null, project: DEMO_PROJECT_PROFILE.project };
const note = () => mock.sharedValue("kelpie.stories.note")?.[DEMO]?.text ?? "";
const refreshes = () => mock.of("setShared").filter(([k]) => k === "kelpie.refresh").length;
const unfold = () => mock.state.shared.set("kelpie.done.open", { [DEMO]: true });
const hover = (el, id, cx) => handlers(el, "on_hover").find((h) => h.id === id).fn(true, cx);

// It writes to GitHub, so it's the person's click: any agent can run a kelpie.* command, so none closes.
test("only the confirm dialog's button closes issues; no kelpie.* command does", () => {
  assert.doesNotMatch(bodyOf(readRepo("mods/kelpie/main.js"), "async function command(c) {"), /closeStories|close-done/);
  for (const f of ["main.js", "work.js", "workside.js", "setup.js", "desk.js", "source.js", "ui.js", "config.js"]) {
    assert.doesNotMatch(readRepo("mods/kelpie", f), /closeStories|closeTicket|closeIssue/, f);
  }
  assert.match(bodyOf(readRepo("mods/kelpie/dialogs.js"), "  yes(command = props().command, cx = null) {"), /await closeStories\(closing\)/);
  assert.equal(readRepo("mods/kelpie/stories.js").match(/closeStories\(/g).length, 1, "stories.js only defines it");
});

describe("closePlan: what Close would close", () => {
  const open = (i, closed = false) => ({ ...i, closed });
  const done = (d) => closePlan(build(d, new Map(), {}, new Map(), null, { all: true })[0]);
  test("the story and its sub-issues still open, others' too; one not done on the board is left open", () => {
    const p = done(data({ parents: [open(issue("A-1", "done"))], mine: ["A-2"], children: [
      open(issue("A-2", "done", "A-1")), { ...open(issue("A-3", "done", "A-1")), fields: { ...issue("A-3", "done", "A-1").fields, assignee: { displayName: "Sam" } } },
      open(issue("A-4", "done", "A-1"), true), open(issue("A-5", "doing", "A-1"))] }));
    assert.deepEqual(p.close.map((x) => x.key), ["A-1", "A-2", "A-3"], "the closed one isn't closed again");
    assert.deepEqual(p.left.map((x) => x.key), ["A-5"]);
  });
  test("a ticket without sub-issues closes itself; a closed one has nothing", () => {
    assert.deepEqual(done(data({ parents: [open(issue("A-1", "done"))], mine: ["A-1"] })).close.map((x) => x.key), ["A-1"]);
    assert.deepEqual(done(data({ parents: [open(issue("A-1", "done"), true)], mine: ["A-1"] })).close, []);
  });
  test("a Jira ticket (no open state) has nothing to close", () => {
    assert.deepEqual(done(data({ parents: [issue("A-1", "done")], mine: ["A-1"] })), { close: [], left: [] });
  });
});

describe("closeIssue: the one write, a constant mutation", () => {
  const board = { kind: "project", cfg: {}, account: "someone" };
  const d = (id) => ({ parents: [{ key: "WEB-1", url: "https://github.com/acme/web/issues/1", id, fields: {} }], children: [] });
  test("closes as completed by the loaded node id, a variable, never in the query's text", async () => {
    mock.reset();
    const runs = [];
    mock.on.exec = (cmd, args) => { runs.push(args); return { code: 0, stdout: JSON.stringify({ data: { closeIssue: { issue: { id: "I_abc", state: "CLOSED" } } } }), stderr: "" }; };
    await closeIssue(board, d("I_abc"), "WEB-1");
    assert.equal(runs.length, 1);
    const args = runs[0];
    assert.ok(args.includes("issue=I_abc"));
    assert.ok(args.includes(`query=${CLOSE}`));
    assert.match(CLOSE, /^mutation KelpieClose\(\$issue: ID!\) \{ closeIssue\(input: \{issueId: \$issue, stateReason: COMPLETED\}\)/);
  });
  test("a node id that isn't one, or none, runs nothing", async () => {
    for (const id of [null, "I_abc; rm -rf ~", "x".repeat(101), "a b"]) {
      mock.reset();
      let ran = false;
      mock.on.exec = () => { ran = true; return { code: 0, stdout: "{}", stderr: "" }; };
      await assert.rejects(closeIssue(board, d(id), "WEB-1"), /doesn't know which issue/);
      assert.equal(ran, false, String(id));
    }
  });
  test("GitHub's refusal, in its own words", async () => {
    mock.reset();
    mock.on.exec = () => ({ code: 1, stdout: JSON.stringify({ errors: [{ message: "Resource not accessible by integration" }] }), stderr: "" });
    await assert.rejects(closeIssue(board, d("I_abc"), "WEB-1"), /Resource not accessible by integration/);
  });
});

describe("Close in the demo's GitHub Project", () => {
  let stories;
  before(async () => { setupDemoWorld({ profile: PROFILE }); stories = await loadStories(StoryList); });
  const world = (opts = {}) => { const w = setupDemoWorld({ stories, profile: PROFILE, ...opts }); unfold(); return w; };

  test("the load keeps each issue's node id and whether it's closed", () => {
    const all = [...stories.data.parents, ...stories.data.children];
    assert.deepEqual(all.filter((i) => i.closed === false && i.fields.status.statusCategory.key === "done").map((i) => i.key).sort(), ["ACME-118", "ACME-119"]);
    assert.equal(all.find((i) => i.key === "ACME-122").closed, true);
    assert.ok(all.every((i) => /^I_ACME-\d+$/.test(i.id)));
  });

  test("Close all shows in the Done group's heading, counting the stories with something open", async () => {
    world();
    const { el } = await draw(new StoryList());
    assert.deepEqual(texts(byId(el, "stories-close-all-button")), ["Close all · 1"]);
    assert.ok(handlers(el, "on_mouse_down").some((h) => h.id === "stories-close-all"), "its clicks stay off the heading's fold");
  });

  test("a row's Close shows on the row hovered, and only on a row with something open", async () => {
    world();
    const { el, view, cx } = await draw(new StoryList());
    assert.equal(byId(el, "close-ACME-118-button"), null, "nothing at rest");
    hover(el, "done-ACME-118", cx);
    assert.deepEqual(texts(byId(view.render(cx), "close-ACME-118-button")), ["Close"]);
  });

  test("its dialog lists what closes; no command, only its own button", async () => {
    world();
    const { el, view, cx } = await draw(new StoryList());
    hover(el, "done-ACME-118", cx);
    handlers(view.render(cx)).find((h) => h.id === "close-ACME-118-button").fn({}, cx);
    const spec = mock.of("openOverlay").at(-1)[0];
    assert.equal(spec.props.title, "Close ACME-118 on GitHub?");
    assert.deepEqual(spec.props.closeStories, { profile: DEMO, keys: ["ACME-118"] });
    assert.equal(spec.props.command, undefined);
    assert.deepEqual(spec.props.items.map((x) => x.key), ["ACME-118", "ACME-119"]);
    assert.match(spec.props.detail, /^This closes these 2 issues on GitHub as completed:/);
  });

  test("a second press while it runs is refused, saying so", async () => {
    world();
    mock.state.shared.set("kelpie.busy", { "ACME-118": { kind: "close", keys: ["ACME-118"], step: "Closing on GitHub… 1 of 2", at: Date.now(), until: Date.now() + 60e3 } });
    const { el } = await draw(new StoryList());
    assert.ok(byId(el, "close-ACME-118-busy"), "the working mark in its place");
    const r = await closeStories({ profile: DEMO, keys: ["ACME-118"] });
    assert.deepEqual(r, { closed: [], failed: [] });
    assert.match(note(), /ACME-118 was busy/);
  });

  // From here on the demo has closed issues, which every load after sees (kept until the mod reloads).
  test("a failed close doesn't stop the rest, is named, and the stories load once", async () => {
    world();
    // ACME-118's node id is one the demo doesn't know: GitHub's words for it come back.
    const shared = mock.sharedValue("kelpie.stories.data");
    const d = shared[DEMO].data;
    mock.state.shared.set("kelpie.stories.data", { [DEMO]: { ...shared[DEMO], data: { ...d, parents: d.parents.map((i) => (i.key === "ACME-118" ? { ...i, id: "I_gone" } : i)) } } });
    const r = await closeStories({ profile: DEMO, keys: ["ACME-118"] });
    assert.deepEqual(r, { closed: ["ACME-119"], failed: [{ key: "ACME-118", why: "Could not resolve to a node with the global id" }] });
    assert.equal(note(), "Closed ACME-119 on GitHub. Couldn't close ACME-118 (Could not resolve to a node with the global id): close it by hand on GitHub.");
    assert.ok(mock.of("notify").some(([n]) => n.level === "warning"));
    assert.equal(refreshes(), 1);
    assert.equal(mock.sharedValue("kelpie.busy")?.["ACME-118"], undefined, "its busy mark is gone");
  });

  test("the dialog's button closes them; the row then has no Close, and Close all hides", async () => {
    world();
    mock.state.props = { role: "confirm", closeStories: { profile: DEMO, keys: ["ACME-118"] }, yes: "Close 2 issues", working: "Closing…", overlay: "o1" };
    const dialog = new Confirm();
    const cx = fakeCx();
    dialog.init(cx);
    handlers(dialog.render(cx)).find((h) => h.id === "confirm-yes").fn({}, cx);
    assert.deepEqual(texts(byId(dialog.render(cx), "confirm-yes")), ["Closing…"]);
    await cx.settle(10);
    assert.equal(note(), "Closed ACME-118 and ACME-119 on GitHub.");
    assert.deepEqual(mock.of("closeOverlay"), [["o1"]]);
    const it = storyItems().done.map((x) => x.it).find((x) => x.key === "ACME-118");
    assert.ok(it, "still in Done");
    assert.deepEqual(closePlan(it).close, [], "shown closed at once");
    const { el, view, cx: list } = await draw(new StoryList());
    assert.equal(byId(el, "stories-close-all-button"), null);
    hover(el, "done-ACME-118", list);
    assert.equal(byId(view.render(list), "close-ACME-118-button"), null, "its row has no Close");
  });

});

test("a Jira profile shows neither Close all nor a row's Close, and closes nothing", async () => {
  setupDemoWorld();
  const stories = await loadStories(StoryList);
  setupDemoWorld({ stories });
  unfold();
  const { el, cx } = await draw(new StoryList());
  assert.equal(byId(el, "stories-close-all-button"), null);
  hover(el, "done-ACME-118", cx);
  assert.equal(byId(el, "close-ACME-118-button"), null);
  assert.equal(await closeStories({ profile: DEMO, keys: ["ACME-118"] }), null);
  assert.match(note(), /closes a ticket by moving it to done/);
});
