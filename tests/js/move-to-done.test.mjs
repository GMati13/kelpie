// Move to Done (stories.js donePlan, moveStoryToDone; board.js doneOption): a story and the person's
// own subtasks moved to the board's done column in one go, from the header's More, after a dialog
// listing each ticket. Others' subtasks stay, the story moves last and only once every subtask is
// done, and a move that fails doesn't stop the rest.
import { DEMO, FIXTURE, demoProfile, draw, fakeCx, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, texts, walk } from "gpui-kit";
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
  assert.match(bodyOf(readRepo("mods/kelpie/dialogs.js"), "  yes(command = props().command, cx = null) {"), /await moveStoryToDone\(ask\)/);
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

  test("the header has its own icon, and its dialog lists each ticket and what stays", async () => {
    setupDemoWorld({ stories });
    mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-180" });
    const { el, view, cx } = await draw(new Stories());
    const icon = byId(el, "story-finish");
    assert.ok(icon, "a Move to Done icon");
    assert.ok(walk(icon).some((n) => n.kind === "svg" && n.args[0].endsWith("check-check.svg")), "drawn as a double check");
    handlers(el).find((h) => h.id === "story-finish").fn({}, cx);
    const spec = mock.of("openOverlay").at(-1)[0];
    assert.equal(spec.props.title, "Move ACME-180 to Done?");
    assert.deepEqual(spec.props.doneStory, { profile: DEMO, key: "ACME-180" });
    assert.equal(spec.props.command, undefined, "no command: only the dialog's own button moves them");
    assert.deepEqual(spec.props.items.map((x) => `${x.key} ${x.text}`), [
      "ACME-181 To Do → Done",
      "ACME-182 To Do, Tomás Ruiz's: left alone",
      "ACME-180 Stays To Do, as ACME-182 is still open",
    ]);
    view.menu = "story-more";
    assert.ok(!texts(view.render(cx)).includes("Move to Done…"), "not in More as well");
  });

  test("not offered for a story with nothing of yours left to move", async () => {
    setupDemoWorld({ stories });
    mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-118" });
    const { el } = await draw(new Stories());
    assert.equal(byId(el, "story-finish"), null);
  });

  test("the sidebar's rows have it only under Built / Waiting on others", async () => {
    setupDemoWorld({ stories });
    const { el, cx } = await draw(new StoryList());
    assert.ok(byId(el, "finish-ACME-129"), "a built story (its subtask of yours past the handover column)");
    for (const key of ["ACME-180", "ACME-142", "ACME-175"]) assert.equal(byId(el, `finish-${key}`), null, `${key} isn't built yet`);
    assert.ok(handlers(el, "on_mouse_down").some((h) => h.id === "finish-ACME-129"), "its click stays off the row");
    handlers(el).find((h) => h.id === "finish-ACME-129-button").fn({}, cx);
    assert.equal(mock.of("openOverlay").at(-1)[0].props.title, "Move ACME-129 to Done?");
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

  // Turned off on the profile (the board's moveToDone false): no icon anywhere, and nothing moves.
  const off = () => { setupDemoWorld({ profile: { jira: { ...demoProfile().jira, moveToDone: false } } }); mock.state.shared.set("kelpie.stories.data", { [DEMO]: { ...stories, key: new Stories().context().key } }); };
  test("turned off: no icon in the header or on the list's rows", async () => {
    off();
    mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-138" });
    assert.equal(byId((await draw(new Stories())).el, "story-finish"), null);
    assert.equal(byId((await draw(new StoryList())).el, "finish-ACME-129"), null);
  });
  test("turned off: a dialog opened before moves nothing", async () => {
    off();
    assert.equal(await moveStoryToDone({ profile: DEMO, key: "ACME-151" }), null);
    assert.equal(note(), "Nothing was moved: Move to Done is turned off for this profile.");
    assert.equal(await statusOf("ACME-153"), "To Do");
  });

  // Clean up afterwards (#72): the dialog's switch, then the clean-up's own checks after the moves.
  test("the dialog offers Clean up afterwards only when the story will be done, off at first", async () => {
    setupDemoWorld({ stories });
    for (const [key, offered] of [["ACME-138", true], ["ACME-180", false]]) {
      mock.state.shared.set("kelpie.stories.preview", { [DEMO]: key });
      const { el, cx } = await draw(new Stories());
      handlers(el).find((h) => h.id === "story-finish").fn({}, cx);
      const check = mock.of("openOverlay").at(-1)[0].props.check;
      assert.equal(Boolean(check), offered, key);
      if (check) assert.deepEqual([check.label, check.on], ["Clean up afterwards", false]);
    }
  });

  test("ticked, the button moves everything, then cleans up once its checks pass, and remembers the choice", async () => {
    // A profile with a leftovers check and a clean-up command: the story wasn't finished before, so
    // nothing was found for it yet; the clean-up looks first, then runs the command on what it left.
    setupDemoWorld({ profile: { commands: { leftovers: "check-leftovers {key}", cleanUp: "clean-up {key}" } } });
    mock.state.shared.set("kelpie.stories.data", { [DEMO]: { ...stories, key: new Stories().context().key } });
    const ran = [];
    const home = mock.on.exec;
    mock.on.exec = (cmd, args, opts) => {
      const line = cmd === "sh" && args[0] === "-c" ? String(args[3] ?? "") : "";
      if (line.startsWith("check-leftovers ")) return { code: 0, stdout: line.endsWith("ACME-139") ? "branch 139-token-bucket (merged)" : "", stderr: "" };
      if (line.startsWith("clean-up ")) { ran.push(line); return { code: 0, stdout: "removed branch 139-token-bucket", stderr: "" }; }
      return home(cmd, args, opts);
    };
    mock.state.props = { role: "confirm", doneStory: { profile: DEMO, key: "ACME-138" }, yes: "Move to Done", overlay: "o2", check: { label: "Clean up afterwards", on: false } };
    const dialog = new Confirm();
    const cx = fakeCx();
    dialog.init(cx);
    handlers(dialog.render(cx)).find((h) => h.id === "confirm-check").fn({}, cx);
    handlers(dialog.render(cx)).find((h) => h.id === "confirm-yes").fn({}, cx);
    assert.deepEqual(texts(byId(dialog.render(cx), "confirm-yes")), ["Moving and cleaning up…"]);
    await cx.settle(10);
    assert.deepEqual(await Promise.all(["ACME-139", "ACME-138"].map(statusOf)), ["Done", "Done"]);
    assert.equal(mock.sharedValue("kelpie.paused")[DEMO]["ACME-138"], undefined, "its paused session forgotten");
    assert.deepEqual(ran, ["clean-up ACME-139"], "the clean-up command ran on what the story left");
    assert.equal(note(), "Moved ACME-139 and ACME-138 to Done. Cleaned up ACME-138: removed branch 139-token-bucket");
    assert.deepEqual(mock.sharedValue("kelpie.done.clean"), { [DEMO]: true });
    assert.deepEqual(mock.of("closeOverlay"), [["o2"]]);
  });

  test("a check that fails cleans nothing up and says why, after the moves", async () => {
    setupDemoWorld({ stories });
    const r = await moveStoryToDone({ profile: DEMO, key: "ACME-160", clean: true });
    assert.deepEqual(r, { moved: ["ACME-161", "ACME-160"], failed: [], cleaned: false, why: ["a pull request of it is still open", "an agent is working on it"] });
    assert.equal(note(), "Moved ACME-161 and ACME-160 to Done. ACME-160 wasn't cleaned up: a pull request of it is still open, an agent is working on it.");
    assert.ok(mock.of("notify").some(([n]) => n.level === "warning" && n.title === "ACME-160 wasn't cleaned up"));
    assert.ok(!mock.of("run").some(([c]) => c === "space.close"), "its space stays");
  });

  test("a story that stays isn't cleaned up", async () => {
    setupDemoWorld({ stories });
    const r = await moveStoryToDone({ profile: DEMO, key: "ACME-180", clean: true });
    assert.deepEqual(r.why, ["it isn't done on the board"]);
    assert.match(note(), /ACME-180 stays, as ACME-182 is still open\. ACME-180 wasn't cleaned up: it isn't done on the board\.$/);
  });
});

// Its stories load when its test runs: loaded in the describe's body, beside the Jira suite's own load
// above, the two loads shared one mocked world and took turns in it.
describe("Move to Done on the demo's GitHub Project", () => {
  const profile = { jira: null, project: { url: "https://github.com/users/kelpie--demo/projects/1", owner: "kelpie--demo", ownerType: "user", number: 1, demo: true } };
  test("moves to the Project's last Status option", async () => {
    setupDemoWorld({ profile });
    const stories = await loadStories(StoryList);
    setupDemoWorld({ stories, profile });
    assert.equal(boardOf(storyItems().st.setup).kind, "project");
    const r = await moveStoryToDone({ profile: DEMO, key: "ACME-171" });
    assert.deepEqual(r, { moved: ["ACME-172", "ACME-173", "ACME-171"], failed: [] });
    assert.equal(await statusOf("ACME-171"), FIXTURE.board.columns.at(-1).statuses[0].name);
  });
});
