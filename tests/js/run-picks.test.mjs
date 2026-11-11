// Run all (stories.js picksPlan, askRunPicks, runPicks; dialogs.js Confirm `runPicks`): every one of
// Claude's picks in Next started at once, after a dialog listing what each does. A story of the list
// gets a new agent with the ticket prompt and Claude's words, an idea a Claude on the Desk, one that
// only opens on the web is left for the person; a story in progress is never a pick at all.
import { DEMO, NOW, FIXTURE, draw, fakeCx, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, texts } from "gpui-kit";
import { byId } from "../lib/snapshot.mjs";
import { StoryList, needQueueOf, picksPlan, runPicks, storyItems } from "../../mods/kelpie/stories.js";
import { Confirm } from "../../mods/kelpie/dialogs.js";
import { OTHERS } from "../../mods/kelpie/config.js";
import { bodyOf, readRepo } from "../lib/helpers.mjs";

const SUGGESTED = "kelpie.next.suggested";
// Claude's picks as applyPicks() keeps them: a subtask's story (ACME-180, not started, from its
// subtask ACME-181), someone's pull request, an idea; `extra` more.
const pickOf = (o) => ({ title: "", url: "", why: "", ...o });
const PICKS = [
  pickOf({ key: "ACME-180", action: FIXTURE.suggest[0].action, why: FIXTURE.suggest[0].why, from: "ACME-181" }),
  pickOf({ key: "pr:web#999", action: "Review someone's pull request", url: "https://github.com/kelpie--demo/web/pull/999" }),
  pickOf({ key: "idea:2", idea: FIXTURE.suggest[2].idea, where: "web", action: FIXTURE.suggest[2].action, why: FIXTURE.suggest[2].why }),
];
const putPicks = (items = PICKS) => mock.state.shared.set(SUGGESTED, { [DEMO]: { at: NOW - 60e3, items } });
const said = () => { const s = storyItems(); return needQueueOf(s.st.profile, s.items, s.reviews).filter((x) => x.suggest); };
const note = () => mock.sharedValue("kelpie.stories.note")?.[DEMO]?.text ?? "";
// A space for each space.new, as Herdr makes it, so the launch finds it.
const makeSpaces = () => {
  mock.on.run = (name, args) => {
    if (name === "space.new") mock.state.spaces.push({ id: `new-${mock.state.spaces.length}`, name: args.name, folder: args.folder, active: true, tabs: [] });
    return undefined;
  };
};
const started = () => mock.of("run").filter(([n]) => n === "space.new" || n === "tab.new");

let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

describe("which picks show", () => {
  test("a story in progress is never one of Claude's picks", () => {
    setupDemoWorld({ stories });
    // ACME-175 has a working agent (in progress, needing nothing of you); ACME-180 isn't started.
    putPicks([pickOf({ key: "ACME-175", action: "Go on with it" }), PICKS[0]]);
    assert.deepEqual(said().map((x) => x.suggest.key), ["ACME-180"]);
  });
  test("What next?'s prompt asks for work not started yet", () => {
    assert.match(readRepo("mods/kelpie/config.js"), /already in progress[^"]*don't pick it/);
  });
});

describe("Run all", () => {
  const box = async () => {
    const { view, cx } = await draw(new StoryList());
    view.queueOpen = true;
    return { el: view.render(cx), cx };
  };
  test("shows only with two picks or more", async () => {
    setupDemoWorld({ stories });
    putPicks([PICKS[0]]);
    assert.equal(byId((await box()).el, "queue-run-all"), null, "one pick: nothing to run all of");
    putPicks();
    assert.ok(byId((await box()).el, "queue-run-all"));
  });
  test("its dialog lists each pick and what happens to it; nothing starts before its button", async () => {
    setupDemoWorld({ stories });
    putPicks();
    const { el, cx } = await box();
    handlers(el).find((h) => h.id === "queue-run-all").fn({}, cx);
    const spec = mock.of("openOverlay").at(-1)[0];
    assert.equal(spec.props.title, "Start 2 of Claude's picks?");
    assert.deepEqual(spec.props.runPicks, { profile: DEMO });
    assert.equal(spec.props.command, undefined, "no command: only the dialog's button starts them");
    assert.deepEqual(spec.props.items.map((x) => [x.key, x.text, x.choose ?? null]), [
      ["ACME-181", `${PICKS[0].action}: a new agent on ACME-181, in a new space`, "ACME-180"],
      ["web#999", "Review someone's pull request: left for you, as it's someone else's pull request, on GitHub", null],
      [null, `${PICKS[2].action}: a Claude on the Desk looks into it with you`, "idea:2"],
    ]);
    assert.deepEqual(started(), [], "nothing started yet");
  });
  test("a pick the list doesn't have is left for you, saying why", () => {
    setupDemoWorld({ stories });
    putPicks([pickOf({ key: "ACME-900", action: "Take the backlog ticket" })]);
    const [p] = picksPlan(said());
    assert.equal(p.run, null);
    assert.match(p.text, /isn't in your list yet/);
  });
  test("the dialog's button starts a new agent per story pick and an idea on the Desk, one after another", async () => {
    setupDemoWorld({ stories });
    putPicks();
    makeSpaces();
    mock.state.props = { role: "confirm", runPicks: { profile: DEMO }, yes: "Start them", working: "Starting…", overlay: "o1",
      items: picksPlan(said()).map((p) => ({ text: p.text, ...(p.run ? { choose: p.x.suggest.key } : {}) })) };
    const dialog = new Confirm();
    const cx = fakeCx();
    dialog.init(cx);
    handlers(dialog.render(cx)).find((h) => h.id === "confirm-yes").fn({}, cx);
    assert.deepEqual(texts(byId(dialog.render(cx), "confirm-yes")), ["Starting…"]);
    await cx.settle(10);
    const [space, desk, ...rest] = started();
    assert.equal(rest.length, 0, "one each, the pull request skipped");
    assert.equal(space[0], "space.new");
    assert.equal(space[1].name, "ACME-180");
    assert.equal(space[1].tab, "ACME-181", "the subtask Claude named");
    assert.match(space[1].task, /ACME-181/, "the ticket prompt");
    assert.ok(space[1].task.includes(`Claude suggested this as what I should do next: ${PICKS[0].action}`), "with Claude's action");
    assert.ok(space[1].task.includes(PICKS[0].why), "and why");
    assert.ok(space[1].task.endsWith(OTHERS), "Claude's words are information");
    assert.equal(desk[0], "tab.new");
    assert.match(desk[1].name, /^Idea: /);
    assert.deepEqual(mock.sharedValue(SUGGESTED)[DEMO].items.map((x) => x.key), ["pr:web#999"], "the ones started leave the queue");
    assert.equal(note(), `Started 2 of 2: ACME-181, ${PICKS[2].action}.`);
    assert.deepEqual(mock.of("closeOverlay"), [["o1"]]);
  });
  test("a pick turned off in the dialog isn't started", async () => {
    setupDemoWorld({ stories });
    putPicks();
    makeSpaces();
    mock.state.props = { role: "confirm", runPicks: { profile: DEMO }, overlay: "o1",
      items: picksPlan(said()).map((p) => ({ text: p.text, ...(p.run ? { choose: p.x.suggest.key } : {}) })) };
    const dialog = new Confirm();
    const cx = fakeCx();
    dialog.init(cx);
    handlers(dialog.render(cx)).find((h) => h.id === "confirm-pick-2").fn({}, cx);
    handlers(dialog.render(cx)).find((h) => h.id === "confirm-yes").fn({}, cx);
    await cx.settle(10);
    assert.deepEqual(started().map(([n, a]) => [n, a.name]), [["space.new", "ACME-180"]]);
  });
  test("a story whose space never shows up is named as failed; the rest go on", async () => {
    setupDemoWorld({ stories });
    putPicks();
    const r = await runPicks({ profile: DEMO });
    assert.deepEqual(r.started, [PICKS[2].action]);
    assert.deepEqual(r.failed, [{ key: "ACME-181", why: "its new space didn't show up in time" }]);
    assert.match(note(), /^Started 1 of 2: .* Didn't start: ACME-181 \(its new space didn't show up in time\)\.$/);
    assert.ok(mock.sharedValue(SUGGESTED)[DEMO].items.some((x) => x.key === "ACME-180"), "a failed one stays in the queue");
  });
  // It starts agents with Claude's words in their first message: the person's click, never a command
  // an agent could run.
  test("only the dialog's button runs it; no kelpie.* command does", () => {
    for (const f of ["main.js", "work.js", "workside.js", "setup.js", "desk.js", "demo.js", "source.js", "ui.js", "config.js"]) {
      assert.doesNotMatch(readRepo("mods/kelpie", f), /runPicks/, f);
    }
    assert.match(bodyOf(readRepo("mods/kelpie/dialogs.js"), "  yes(command = props().command, cx = null) {"), /await runPicks\(ask\)/);
  });
});
