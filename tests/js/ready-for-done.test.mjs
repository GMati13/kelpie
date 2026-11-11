// Next's Ready for Done (KELPIE-88, stories.js readyForDone(), askFinishAll(), moveStoriesToDone()):
// the stories whose work is finished but aren't Done yet, one item in Next just before the clean-up,
// one press opening one dialog for all of them, its own button moving them story by story. In a file
// of its own, as the demo's board keeps its moves in memory for the file.
import { DEMO, draw, fakeCx, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, texts } from "gpui-kit";
import { byId } from "../lib/snapshot.mjs";
import { StoryList, busyOf, moveStoriesToDone } from "../../mods/kelpie/stories.js";
import { Confirm } from "../../mods/kelpie/dialogs.js";
import { demoJira } from "../../mods/kelpie/demo.js";

const statusOf = async (key) => (await demoJira(["get", `/rest/api/3/issue/${key}`])).body.fields.status.name;
const note = () => mock.sharedValue("kelpie.stories.note")?.[DEMO]?.text ?? "";
describe("Ready for Done in Next", async () => {
  setupDemoWorld();
  const stories = await loadStories(StoryList);
  // ACME-175 made ready too: in the handover column (ACME-130's status), its pull requests merged.
  const qa = stories.data.children.find((c) => c.key === "ACME-130").fields.status;
  const two = { ...stories, data: { ...stories.data,
    parents: stories.data.parents.map((p) => (p.key === "ACME-175" ? { ...p, fields: { ...p.fields, status: qa } } : p)),
    prs: stories.data.prs.map((p) => (p.title.includes("ACME-175") ? { ...p, merged: true } : p)) } };
  // The open queue (folded, Next shows only its first item), and a press on one of its rows; drawn
  // from the shared stories, with no load of its own (which would put the demo's back).
  const queue = async () => {
    const { view, cx } = await draw(new StoryList(), { init: () => {} });
    view.queueOpen = true;
    return { el: view.render(cx), cx };
  };
  const press = async (key) => {
    const { el, cx } = await queue();
    const h = handlers(el).find((x) => x.id === key);
    assert.ok(h, `${key} is in the open queue`);
    h.fn({}, cx);
  };

  test("the demo's built story is the item; a press asks as its own Move to Done does", async () => {
    setupDemoWorld({ stories });
    const { el } = await queue();
    const all = texts(el);
    assert.ok(all.includes("ACME-129: ready for Done, move it"));
    assert.ok(all.indexOf("Ready for Done") > all.indexOf("To review"), "its own group, after what needs you");
    await press("queue-finish");
    const spec = mock.of("openOverlay").at(-1)[0];
    assert.equal(spec.props.title, "Move ACME-129 to Done?");
    assert.deepEqual(spec.props.doneStory, { profile: DEMO, key: "ACME-129" });
  });

  test("several ready: one item, and one press opens one dialog listing every story's tickets", async () => {
    setupDemoWorld({ stories: two, spaces: [] });
    assert.ok(texts((await queue()).el).includes("2 stories ready for Done: move them"));
    const before = mock.of("openOverlay").length;
    await press("queue-finish");
    assert.equal(mock.of("openOverlay").length, before + 1, "asked once");
    const spec = mock.of("openOverlay").at(-1)[0];
    assert.equal(spec.props.title, "Move 2 stories to Done?");
    assert.equal(spec.props.doneStories.profile, DEMO);
    assert.deepEqual([...spec.props.doneStories.keys].sort(), ["ACME-129", "ACME-175"]);
    assert.equal(spec.props.command, undefined, "no command: only the dialog's own button moves them");
    const lines = spec.props.items.map((x) => `${x.key} ${x.text}`);
    assert.ok(lines.includes("ACME-130 In QA → Done"), "a story's subtask of yours, from its status");
    assert.ok(lines.some((l) => /^ACME-131 In Progress, .+: left alone$/.test(l)), "others' left alone");
    assert.ok(lines.includes("ACME-129 Stays In QA, as ACME-131 is still open"), "and why the story stays");
    assert.ok(lines.includes("ACME-175 In QA → Done"), "a ticket without subtasks moves itself");
    assert.ok(spec.props.check, "Clean up afterwards, as one of them will be done");
  });

  test("a second run while one runs is refused", async () => {
    setupDemoWorld({ stories: two, spaces: [] });
    mock.state.shared.set("kelpie.busy", { [`done-all:${DEMO}`]: { kind: "done", keys: [], step: "x", at: Date.now(), until: Date.now() + 60e3 } });
    assert.equal(await moveStoriesToDone({ profile: DEMO, keys: ["ACME-175"] }), null);
    assert.equal(note(), "Those stories are already moving to Done.");
    assert.equal(await statusOf("ACME-175"), "In Progress", "as the demo's board has it");
  });
  test("its button moves each story, sums it up and closes once done", async () => {
    setupDemoWorld({ stories: two, spaces: [] });
    const keys = ["ACME-175", "ACME-129"];
    mock.state.props = { role: "confirm", doneStories: { profile: DEMO, keys }, yes: "Move to Done", overlay: "o9" };
    const dialog = new Confirm();
    const cx = fakeCx();
    dialog.init(cx);
    handlers(dialog.render(cx)).find((h) => h.id === "confirm-yes").fn({}, cx);
    assert.deepEqual(texts(byId(dialog.render(cx), "confirm-yes")), ["Moving…"]);
    await cx.settle(10);
    assert.deepEqual(await Promise.all(["ACME-175", "ACME-130", "ACME-131", "ACME-129"].map(statusOf)), ["Done", "Done", "In Progress", "In QA"], "ACME-129 stays, as ACME-131 is someone else's");
    assert.equal(note(), "Moved ACME-175 and ACME-130 to Done. ACME-129 stays, as not all its subtasks are done.");
    assert.equal(busyOf(`done-all:${DEMO}`), null);
    assert.deepEqual(mock.of("closeOverlay"), [["o9"]]);
  });

});
