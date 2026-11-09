// The Hub: the Kelpie layout's card above the terminals, showing the shown space's sprint board, pull
// requests and previous sessions (its three sources), each by that space's own setup (config.js).
// Each source is a block in the "hub-sources" stack; the "hub" role is the Hub strip that picks one.
//   hub       the Hub strip: one button per source, with counts; the space's Setup and Refresh
//   stories   the selected story: subtasks, pull requests, changes, screenshots, agents (stories.js)
//   story-list  your stories, what needs you first, in their own column ("story-col")
//   sprint    its Jira board (sprint.js)
//   pulls     its GitHub owner's pull requests (pulls.js)
//   sessions  previous Claude sessions started in its folder (sessions.js)
//   setup     the setup dialog (setup.js), opened by Setup or a source's "Set up"
//   story-picker, confirm   the story picker and the close dialog (dialogs.js)

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, nextCommand, run, setShared, shared, theme } from "herdr";
import { SMALL, TEXT, chrome, find, fullName, icon, iconButton, stop, textButton } from "./ui.js";
import { REFRESH, count } from "./source.js";
import { openSetup, profileElsewhere, savedSetup, setupOf, shownSpace } from "./config.js";
import { Stories, StoryBody, StoryList, StoryView, headFolded, stackChild, storyNow } from "./stories.js";
import { SpacePicker, WorkSide } from "./workside.js";
import { Sprint } from "./sprint.js";
import { Pulls } from "./pulls.js";
import { Sessions } from "./sessions.js";
import { Setup } from "./setup.js";
import { Confirm, StoryPicker } from "./dialogs.js";
import { PaneHead } from "./panes.js";

const HUB = "hub";
const STACK = "hub-sources";
const FOLDED = 48; // the Hub strip (46) and the card's border
export const SOURCES = [
  { id: "stories", label: "Stories", icon: "circle-check" },
  { id: "sprint", label: "Sprint", icon: "layers" },
  { id: "pulls", label: "Pull requests", icon: "git-compare" },
  { id: "sessions", label: "Sessions", icon: "clock" },
];

// Folded, the Hub is only its strip: the sources' stack is hidden and the card shrinks to the strip.
// Herdr keeps both across restarts; the unfolded height is kept in shared state.
const folded = () => Boolean(find(layout(), STACK)?.hidden);

function fold(shut) {
  if (shut === folded()) return;
  if (shut) {
    const weight = find(layout(), HUB)?.size?.weight;
    if (weight) setShared("kelpie.hub.weight", weight);
    run("layout.hide", { id: STACK });
    run("layout.resize", { id: HUB, px: FOLDED });
  } else {
    run("layout.show", { id: STACK });
    run("layout.resize", { id: HUB, weight: shared("kelpie.hub.weight") ?? 3 });
  }
}

// A source's button: shows it (unfolding the Hub), or folds the Hub when it's already the one shown.
function pick(id) {
  if (!setupOf(shownSpace()).sources.includes(id)) return;
  if (!folded() && find(layout(), STACK)?.active === id) return fold(true);
  run("layout.select", { stack: STACK, child: id });
  fold(false);
}

// Keeps the layout in step with the shown space's setup: the Hub is hidden when the space shows no
// sources, and the shown source is always one it shows. Called on render by the Hub strip and the
// toolbar (the strip doesn't draw while the Hub is hidden); it only acts when something differs.
export function syncHub() {
  const root = layout();
  syncStories(root);
  const hub = find(root, HUB);
  if (!hub) return; // not the Kelpie layout
  const sources = setupOf(shownSpace()).sources;
  if (Boolean(hub.hidden) !== !sources.length) run(sources.length ? "layout.show" : "layout.hide", { id: HUB });
  const active = find(root, STACK)?.active;
  if (sources.length && !sources.includes(active)) run("layout.select", { stack: STACK, child: sources[0] });
  // The story list's column shows where the space shows its stories.
  const col = find(root, "story-col");
  if (col && Boolean(col.hidden) !== !sources.includes("stories")) run(sources.includes("stories") ? "layout.show" : "layout.hide", { id: "story-col" });
}

// The story layout: the story's title row and its details show while a story is shown (its space, or
// a preview from the list), the details unless folded. The main area follows its view (its
// terminals, or its changes or screenshots); a story not started has no main area, its details take
// the column (folded or not: there's nothing else to show).
function syncStories(root) {
  const head = find(root, "story-head");
  if (!head) return;
  const now = storyNow(); // keeps a closed space's profile and story shown first
  const unstarted = Boolean(now) && now.view === "start";
  const shown = (id, on) => { const node = find(root, id); if (node && Boolean(node.hidden) === on) run(on ? "layout.show" : "layout.hide", { id }); };
  shown("story-head", Boolean(now));
  shown("story-body", Boolean(now) && (unstarted || !headFolded()));
  // The tab bar and the terminals share the "lower" column, under a draggable boundary with the
  // details. A story not started has no terminals: "lower" hides and a copy of the tab bar at the
  // bottom of the column ("toolbar-start", where nothing resizes) shows instead, so the details
  // fill the column. Only one tab bar is ever shown, so its keys reach one copy.
  shown("main-stack", !unstarted);
  shown("lower", !unstarted);
  shown("toolbar-start", unstarted);
  // An earlier version shrank "lower" to the tab bar's 42px, and Herdr kept that size: give the
  // terminals their share back.
  const lower = find(root, "lower");
  if (lower?.size?.px === 42) run("layout.resize", { id: "lower", weight: 3 });
  // The Screenshots view has a block of its own (the Artifacts panel, scoped to the story).
  // Another profile's space shown under a preview: never its terminals, but Screenshots still can.
  const want = profileElsewhere() || (now && (now.preview || now.view !== "agent")) ? (now?.view === "shots" ? stackChild("shots") : "story-view") : "main";
  // Also when this copy last asked for something else: the layout it reads can lag behind a select.
  if (!unstarted && find(root, "main-stack") && (find(root, "main-stack").active !== want || lastWant !== want)) {
    lastWant = want;
    run("layout.select", { stack: "main-stack", child: want });
  }
}
let lastWant = null; // the main stack's child this copy last selected

// Whether the Kelpie layout's Hub is hidden for the shown space (the toolbar then offers its setup).
export const hubHidden = () => Boolean(find(layout(), HUB)?.hidden);

// The Hub strip, over the sources.
// A hello by the time of day, with your first name (the account's full name) once known.
function greeting(name, now = new Date()) {
  const h = now.getHours();
  const hello = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : h < 22 ? "Good evening" : "Up late";
  return name ? `${hello}, ${name}` : hello;
}

class Strip {
  init(cx) {
    cx.spawn(async (cx) => {
      const full = await fullName();
      this.name = full.split(/\s+/)[0] || null;
      cx.notify();
    });
    cx.timer.every(5 * 60 * 1000, (cx) => cx.notify()); // the greeting follows the clock
    // Keys: "kelpie.sprint", "kelpie.pulls", "kelpie.sessions" show that source (again: fold the Hub);
    // "kelpie.hub" folds or unfolds it; "kelpie.refresh" loads the sources again; "kelpie.setup" opens
    // the shown space's setup.
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (SOURCES.some((s) => s.id === c)) pick(c);
        if (c === "hub") fold(!folded());
        if (c === "refresh") setShared(REFRESH, Date.now());
        if (c === "setup") openSetup(shownSpace());
      }
    });
  }

  render() {
    syncHub();
    const t = theme();
    const shut = folded();
    const active = find(layout(), STACK)?.active;
    const space = shownSpace();
    const shown = setupOf(space).sources;
    // A segmented control: one track, the shown source raised in it (none while folded).
    const segment = (s) => {
      const on = !shut && active === s.id;
      const n = space ? shared(count(s.id, space.id)) : null;
      return h_flex().id(`source-${s.id}`).h(26).flex_none().px(10).gap(6).items_center().rounded(7).cursor_pointer()
        .when(on, (el) => el.bg(t.selected).text_color(t.foreground))
        .when(!on, (el) => el.text_color(t.muted).hover((x) => x.text_color(t.foreground)))
        .tooltip(on ? `Fold the Hub` : `Show ${s.label}`)
        .on_mouse_down("left", stop).on_click(() => pick(s.id))
        .child(icon(chrome(s.icon), 13).text_color(on ? t.accent : t.dim))
        .child(s.label)
        .when(typeof n === "number" && n > 0, (el) => el.child(div().px(5).rounded(5).bg(t.raised).text_size(SMALL).text_color(on ? t.foreground : t.dim).child(String(n))));
    };
    return h_flex().size_full().pl(6).pr(12).gap(6).items_center().text_size(TEXT)
      .child(iconButton(t, "hub-fold", chrome(shut ? "chevron-right" : "chevron-down"), () => fold(!shut), shut ? "Unfold the Hub" : "Fold the Hub").size(26))
      // One source needs no control to choose it: it's the Hub's title.
      .child(shown.length > 1
        ? h_flex().p(2).gap(2).rounded(9).bg("#00000033").border_1().border_color(t.border).children(SOURCES.filter((s) => shown.includes(s.id)).map(segment))
        : h_flex().children(SOURCES.filter((s) => shown.includes(s.id)).map((s) => segment(s).bg("#00000000").px(4).text_color(t.foreground).font_medium())))
      .child(div().flex_1().min_w(0).px(10).truncate().text_size(SMALL).text_color(t.dim).text_center().child(greeting(this.name)))
      .when(Boolean(space), (el) => el
        .child(h_flex().id("hub-space").h(26).px(8).gap(6).items_center().rounded(7).cursor_pointer().max_w(260)
          .text_size(SMALL).text_color(t.muted).hover((x) => x.bg(t.hover).text_color(t.foreground))
          .tooltip(`${space.name}'s Kelpie setup`)
          .on_mouse_down("left", stop).on_click(() => openSetup(space))
          .child(icon(chrome(space.machine ? "server" : "folder"), 13).text_color(t.dim))
          .child(div().min_w(0).truncate().child(space.name))
          .when(!savedSetup(space), (x) => x.child(div().px(6).rounded(5).bg(t.raised).text_size(SMALL).text_color(t.working).child("Set up")))
          .child(icon(chrome("settings"), 13).text_color(t.dim))))
      .child(textButton(t, "hub-refresh", "Refresh", () => setShared(REFRESH, Date.now()), { tip: "Load every source again" }));
  }
}

export const WORK_ROLES = { hub: Strip, stories: Stories, "story-body": StoryBody, "story-list": StoryList, "story-view": StoryView, "space-picker": SpacePicker, "work-side": WorkSide, sprint: Sprint, pulls: Pulls, sessions: Sessions, setup: Setup, "story-picker": StoryPicker, confirm: Confirm, "pane-head": PaneHead };
