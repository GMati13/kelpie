// Move to Done (stories.js donePlan, moveStoryToDone; board.js doneOption): a story and the person's
// own subtasks moved to the board's done column in one go, from the header's More, after a dialog
// listing each ticket. Others' subtasks stay, the story moves last and only once every subtask is
// done, and a move that fails doesn't stop the rest.
import { DEMO, FIXTURE, draw, fakeCx, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, texts } from "gpui-kit";
import { byId } from "../lib/snapshot.mjs";
import { Stories, StoryList, build, donePlan, moveStoryToDone, storyItems } from "../../mods/kelpie/stories.js";
import { Confirm } from "../../mods/kelpie/dialogs.js";
import { doneOption } from "../../mods/kelpie/board.js";
import { boardOf } from "../../mods/kelpie/config.js";
import { demoJira } from "../../mods/kelpie/demo.js";
import { COLUMNS, data, issue } from "../lib/stories.mjs";
import { bodyOf, readRepo } from "../lib/helpers.mjs";

const statusOf = async (key) => (await demoJira(["get", `/rest/api/3/issue/${key}`])).body.fields.status.name;
const note = () => mock.sharedValue("kelpie.stories.note")?.text ?? "";
const refreshes = () => mock.of("setShared").filter(([k]) => k === "kelpie.refresh").length;
const story = (key) => storyItems().items.map((x) => x.it).find((x) => x.key === key);

// It writes to the board for each ticket, so it's the person's click: any agent can run a kelpie.*
// command (herdr-app do), so none moves a story; only the confirm dialog's own button does.
test("only the confirm dialog's button moves a story to done; no kelpie.* command does", () => {
  assert.doesNotMatch(bodyOf(readRepo("mods/kelpie/main.js"), "async function command(c) {"), /moveStoryToDone|done-story/);
  for (const f of ["main.js", "work.js", "workside.js", "setup.js", "desk.js", "demo.js", "source.js", "ui.js", "sprint.js", "pulls.js", "panes.js", "config.js"]) {
    assert.doesNotMatch(readRepo("mods/kelpie", f), /moveStoryToDone/, f);
  }
  assert.match(bodyOf(readRepo("mods/kelpie/dialogs.js"), "  yes(command = props().command, cx = null) {"), /await moveStoryToDone\(doneStory\)/);
  const stories = readRepo("mods/kelpie/stories.js");
  assert.equal(stories.match(/moveStoryToDone\(/g).length, 1, "stories.js only defines it");
});

describe("donePlan: what Move to Done would move", () => {
  const plan = (d) => donePlan(build(d, new Map())[0]);
  test("your open subtasks, then the story, once no one else's is open", () => {
    const p = plan(data({ parents: [issue("A-1", "doing")], children: [issue("A-2", "doing", "A-1"), issue("A-3", "done", "A-1"), issue("A-4", "done", "A-1")], mine: ["A-2", "A-3"] }));
    assert.deepEqual(p.mine.map((x) => x.key), ["A-2"], "a done subtask of yours is left alone");
    assert.deepEqual(p.others, []);
    assert.equal(p.story, true);
  });
  test("someone else's open subtask stays, and so does the story", () => {
    const p = plan(data({ parents: [issue("A-1", "doing")], children: [issue("A-2", "doing", "A-1"), issue("A-3", "todo", "A-1")], mine: ["A-2"] }));
    assert.deepEqual(p.mine.map((x) => x.key), ["A-2"]);
    assert.deepEqual(p.others.map((x) => x.key), ["A-3"]);
    assert.equal(p.story, false);
  });
  test("a ticket without subtasks is moved itself; a done one has nothing to move", () => {
    assert.deepEqual(plan(data({ parents: [issue("A-1", "doing")], mine: ["A-1"] })), { mine: [], others: [], story: true });
    // A done one is in the list's Done group (build's `done`).
    assert.deepEqual(donePlan(build(data({ parents: [issue("A-1", "done")], mine: ["A-1"] }), new Map(), {}, new Map(), null, { done: true })[0]), { mine: [], others: [], story: false });
  });
  test("nothing for what isn't a board's ticket", () => {
    assert.equal(donePlan({ key: "pull:api#1", pull: true, subs: [] }), null);
    assert.equal(donePlan({ key: "A-9", pr: true, subs: [] }), null);
    assert.equal(donePlan(null), null);
  });
});

describe("doneOption: the move into the board's done column", () => {
  const jira = { kind: "jira", cfg: { site: "https://acme.atlassian.net", board: 1, keychain: "k" } };
  const answer = (transitions) => { mock.on.exec = () => ({ code: 0, stdout: JSON.stringify({ code: 200, authed: true, body: { transitions } }), stderr: "" }); };
  test("Jira: the transition landing in the last column's status, by the status's id, not the transition's", async () => {
    mock.reset();
    // Transition "4" (an id the Done status has too) goes to In QA; "31" goes to Done.
    answer([{ id: "4", name: "Send to QA", to: { id: "3", name: "In QA", statusCategory: { key: "indeterminate" } } },
      { id: "31", name: "Finish", to: { id: "4", name: "Done", statusCategory: { key: "done" } } }]);
    assert.equal((await doneOption(jira, "A-1", { columns: COLUMNS })).id, "31");
  });
  test("Jira: else one landing in a done status; none, and it says why", async () => {
    mock.reset();
    answer([{ id: "7", name: "Close", to: { id: "9", name: "Closed", statusCategory: { key: "done" } } }]);
    assert.equal((await doneOption(jira, "A-1", { columns: COLUMNS })).id, "7");
    answer([{ id: "5", name: "Start", to: { id: "2", name: "In Progress", statusCategory: { key: "indeterminate" } } }]);
    await assert.rejects(doneOption(jira, "A-1", { columns: COLUMNS }), /no move straight to done/);
  });
  test("a Project: its last Status option; an issue off the Project has none", async () => {
    const board = { kind: "project", cfg: {}, account: null };
    const cols = [{ name: "Todo", statuses: ["o1"] }, { name: "Doing", statuses: ["o2"] }, { name: "Done", statuses: ["o3"] }];
    const d = { columns: cols, repos: { WEB: "acme/web" }, parents: [], children: [
      { key: "WEB-1", url: "https://github.com/acme/web/issues/1", item: "it1", fields: { status: { id: "o2", name: "Doing" } } },
      { key: "WEB-2", url: "https://github.com/acme/web/issues/2", item: null, fields: { status: { id: null, name: "Open" } } }] };
    assert.equal((await doneOption(board, "WEB-1", d)).id, "o3");
    await assert.rejects(doneOption(board, "WEB-2", d), /isn't on the board's Project/);
  });
});

describe("Move to Done on the demo's board", async () => {
  setupDemoWorld();
  const stories = await loadStories(StoryList);

  test("the header's More offers it, and its dialog lists each ticket and what stays", async () => {
    setupDemoWorld({ stories });
    mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-180" });
    const { view, cx } = await draw(new Stories());
    view.menu = "story-more";
    const el = view.render(cx);
    const row = handlers(el).find((h) => /^story-more-row-/.test(h.id ?? "") && texts(byId(el, h.id)).includes("Move to Done…"));
    assert.ok(row, "a Move to Done… row");
    row.fn({}, cx);
    const spec = mock.of("openOverlay").at(-1)[0];
    assert.equal(spec.props.title, "Move ACME-180 to Done?");
    assert.deepEqual(spec.props.doneStory, { profile: DEMO, key: "ACME-180" });
    assert.equal(spec.props.command, undefined, "no command: only the dialog's own button moves them");
    assert.deepEqual(spec.props.items.map((x) => `${x.key} ${x.text}`), [
      "ACME-181 To Do → Done",
      "ACME-182 To Do, Tomás Ruiz's: left alone",
      "ACME-180 Stays To Do, as ACME-182 is still open",
    ]);
  });

  test("not offered for a story with nothing of yours left to move", async () => {
    setupDemoWorld({ stories });
    mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-118" });
    const { view, cx } = await draw(new Stories());
    view.menu = "story-more";
    assert.ok(!texts(view.render(cx)).includes("Move to Done…"));
  });

  test("the dialog's button moves your subtasks, then the story, and loads the stories once", async () => {
    setupDemoWorld({ stories });
    mock.state.props = { role: "confirm", doneStory: { profile: DEMO, key: "ACME-142" }, yes: "Move to Done", overlay: "o1" };
    const dialog = new Confirm();
    const cx = fakeCx();
    dialog.init(cx);
    handlers(dialog.render(cx)).find((h) => h.id === "confirm-yes").fn({}, cx);
    assert.deepEqual(texts(byId(dialog.render(cx), "confirm-yes")), ["Moving…"]);
    await cx.settle(10);
    assert.deepEqual(await Promise.all(["ACME-143", "ACME-144", "ACME-142"].map(statusOf)), ["Done", "Done", "Done"]);
    assert.equal(await statusOf("ACME-145"), "Done", "already done, left alone");
    assert.equal(refreshes(), 1);
    assert.equal(note(), "Moved ACME-143, ACME-144 and ACME-142 to Done.");
    assert.deepEqual(mock.of("closeOverlay"), [["o1"]], "closed once done");
  });

  test("others' subtasks are left alone and the story stays, saying why", async () => {
    setupDemoWorld({ stories });
    const r = await moveStoryToDone({ profile: DEMO, key: "ACME-129" });
    assert.deepEqual(r, { moved: ["ACME-130"], failed: [] });
    assert.equal(await statusOf("ACME-131"), "In Progress");
    assert.equal(await statusOf("ACME-129"), "In QA");
    assert.equal(note(), "Moved ACME-130 to Done. ACME-129 stays, as ACME-131 is still open.");
  });

  test("a move that fails doesn't stop the rest, the story stays, and it says which and why", async () => {
    // The same stories on a real Jira board (its answers faked below), shared as its list would.
    setupDemoWorld({ profile: { jira: { site: "https://acme.atlassian.net", board: 7, keychain: "k" } } });
    mock.state.shared.set("kelpie.stories.data", { [DEMO]: { ...stories, key: new Stories().context().key } });
    const it = story("ACME-151");
    assert.deepEqual(donePlan(it).mine.map((x) => x.key), ["ACME-152", "ACME-153"]);
    const moves = [];
    mock.on.exec = (_cmd, args) => {
      const [what, key, id] = args.slice(3);
      if (what === "get") return { code: 0, stdout: JSON.stringify({ code: 200, authed: true, body: { transitions: [{ id: "41", name: "Done", to: { id: "10001", name: "Done", statusCategory: { key: "done" } } }] } }), stderr: "" };
      moves.push(key);
      return { code: 0, stdout: JSON.stringify(key === "ACME-152" ? { code: 400, body: { errorMessages: ["Resolution is required."] } } : { code: 204, authed: true, body: null }), stderr: "" };
    };
    const r = await moveStoryToDone({ profile: DEMO, key: "ACME-151" });
    assert.deepEqual(moves, ["ACME-152", "ACME-153"], "the story itself isn't tried");
    assert.deepEqual(r, { moved: ["ACME-153"], failed: [{ key: "ACME-152", why: "Resolution is required" }] });
    assert.equal(note(), "Moved ACME-153 to Done. Couldn't move ACME-152 (Resolution is required): move it by hand. ACME-151 stays, as not all its subtasks moved.");
    assert.ok(mock.of("notify").some(([n]) => n.level === "warning"));
    assert.equal(refreshes(), 1);
  });

  test("the new statuses show at once, before the stories load again", async () => {
    setupDemoWorld({ stories });
    mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-175" });
    await moveStoryToDone({ profile: DEMO, key: "ACME-175" });
    const { el } = await draw(new Stories());
    assert.ok(texts(byId(el, "story-status-menu-more")).includes("Done"));
    assert.equal(donePlan(story("ACME-175")).story, false, "nothing left to move");
  });

  test("a story of another profile than the shown one isn't moved", async () => {
    setupDemoWorld({ stories });
    assert.equal(await moveStoryToDone({ profile: "other", key: "ACME-160" }), null);
    assert.match(note(), /^Nothing was moved: ACME-160 isn't among the shown profile's stories/);
    assert.equal(await statusOf("ACME-161"), "In Review");
  });
});

describe("Move to Done on the demo's GitHub Project", async () => {
  const profile = { jira: null, project: { url: "https://github.com/users/kelpie--demo/projects/1", owner: "kelpie--demo", ownerType: "user", number: 1, demo: true } };
  setupDemoWorld({ profile });
  const stories = await loadStories(StoryList);
  test("moves to the Project's last Status option", async () => {
    setupDemoWorld({ stories, profile });
    assert.equal(boardOf(storyItems().st.setup).kind, "project");
    const r = await moveStoryToDone({ profile: DEMO, key: "ACME-171" });
    assert.deepEqual(r, { moved: ["ACME-172", "ACME-173", "ACME-171"], failed: [] });
    assert.equal(await statusOf("ACME-171"), FIXTURE.board.columns.at(-1).statuses[0].name);
  });
});
