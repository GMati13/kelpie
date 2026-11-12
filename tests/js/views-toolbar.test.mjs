// What the tab bar draws (main.js toolbar, through its view's "toolbar" role), pinned as snapshots
// (tests/README.md, Snapshots): a story's agent tabs, the + menu, Overview/Changes/Screenshots with
// their counts, and what a preview, a review and a plain space show instead.
import { DEMO, fakeCx, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers } from "gpui-kit";
import { byId, matchSnapshot, render } from "../lib/snapshot.mjs";
import { StoryList } from "../../mods/kelpie/stories.js";
import Quiet from "../../mods/kelpie/main.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";

const snap = (name, el) => matchSnapshot(name, render(el, skinTheme()));
let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

// The tab bar, with the story's space shown (`space`) or a story previewed (`preview`). Its key loop
// (nextCommand) never resolves under the stub, so its tasks aren't waited for.
function toolbar({ space = null, preview = null, counts = {}, layout = "Kelpie" } = {}) {
  setupDemoWorld({ stories, shown: space, layout, props: { role: "toolbar" } });
  if (preview) mock.state.shared.set("kelpie.stories.preview", { [DEMO]: preview });
  mock.state.shared.set("kelpie.stories.counts", counts);
  const cx = { ...fakeCx(), spawn() {} };
  const view = new Quiet({});
  view.init({}, cx);
  return { el: view.render(cx), view, cx };
}
const ids = (el, prefix) => render(el, skinTheme()).match(new RegExp(`#${prefix}[^\\s]*`, "g")) ?? [];

for (const layout of ["Kelpie", "Kelpie-Plain"]) {
  test(`${layout}: a story's space: its agent tabs, +, Changes and Screenshots with counts`, () => {
    const { el } = toolbar({ space: "ACME-142", counts: { "ACME-142": { files: 3, shots: 2 } }, layout });
    assert.deepEqual(ids(el, "tab-"), ["#tab-list", "#tab-t0-0", "#tab-t0-1"]);
    assert.deepEqual(ids(el, "view-"), ["#view-changes", "#view-shots"]);
    snap(`${layout === "Kelpie" ? "toolbar" : "plain/toolbar"}/story`, el);
  });
}

test("the + menu open", () => {
  // The toolbar is a function role: main.js keeps its open menu, opened by the trigger's click.
  const { el, view, cx } = toolbar({ space: "ACME-142" });
  const click = handlers(el).find((h) => h.id === "open-new-more").fn;
  click({}, cx);
  const open = view.render(cx);
  assert.ok(byId(open, "open-new-menu-list"), "the menu's list");
  snap("toolbar/new-open", byId(open, "open-new-menu-list"));
  click({}, cx); // closed again for the next test
});

test("a story previewed: Overview, and Changes or Screenshots only when they hold something", () => {
  const bare = toolbar({ preview: "ACME-180" });
  assert.deepEqual(ids(bare.el, "view-"), ["#view-start"]);
  assert.deepEqual(ids(bare.el, "tab-t"), [], "no tabs of a space");
  snap("toolbar/preview-empty", bare.el);
  const some = toolbar({ preview: "ACME-138", counts: { "ACME-138": { shots: 4 } } });
  assert.deepEqual(ids(some.el, "view-"), ["#view-start", "#view-shots"]);
  snap("toolbar/preview-shots", some.el);
});

test("a review previewed: Changes alone, no +", () => {
  const { el } = toolbar({ preview: "review:web#421" });
  assert.deepEqual(ids(el, "view-"), ["#view-changes"]);
  assert.equal(byId(el, "open-new-more"), null);
  snap("toolbar/review", el);
});

test("the Desk: its tabs, + and Screenshots (no story)", () => {
  const { el } = toolbar({ space: "Desk" });
  assert.deepEqual(ids(el, "view-"), ["#view-shots"]);
  snap("toolbar/desk", el);
});

test("the shown profile's browser playing sound, hidden: the globe turns into moving bars", () => {
  const draw = (playing) => {
    setupDemoWorld({ stories, shown: "ACME-142", props: { role: "toolbar" } });
    mock.state.shared.set("kelpie.web.playing", playing);
    const cx = { ...fakeCx(), spawn() {} };
    const view = new Quiet({});
    view.init({}, cx);
    return byId(view.render(cx), "panel-web");
  };
  const on = draw(["demo"]);
  const text = render(on, skinTheme());
  assert.match(text, /tip="Web ⌘⇧S · Playing sound"/);
  assert.doesNotMatch(text, /own:globe/, "the bars take the globe's place");
  snap("toolbar/web-playing", on);
  assert.match(render(draw([]), skinTheme()), /own:globe/, "nothing playing: the globe");
  assert.match(render(draw(["another"]), skinTheme()), /own:globe/, "another profile's browser: not this globe");
});

test("the browser on screen while it plays: the plain globe, selected", () => {
  setupDemoWorld({ stories, shown: "ACME-142", props: { role: "toolbar" } });
  const find = (n, id) => n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean);
  const panel = find(mock.state.layout, "panel"), body = find(mock.state.layout, "panel-body");
  assert.ok(panel && body && (body.children ?? []).some((c) => c.id === "web"), "the demo layout has a Web slot");
  panel.hidden = false;
  body.active = "web";
  mock.state.shared.set("kelpie.web", { slots: { demo: "web" } }); // the slot the demo's browser was given
  mock.state.shared.set("kelpie.web.playing", ["demo"]);
  const cx = { ...fakeCx(), spawn() {} };
  const view = new Quiet({});
  view.init({}, cx);
  const text = render(byId(view.render(cx), "panel-web"), skinTheme());
  assert.match(text, /own:globe/);
  assert.match(text, /bg=selected/);
  assert.doesNotMatch(text, /Playing sound/);
});
