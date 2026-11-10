// The Kelpie layout's sidebar. Roles:
//   space-picker  the profile shown (window buttons left of it); a click opens a dropdown of the
//                 profiles, to switch, add or edit one, and the spaces in no profile. Its search
//                 opens the story picker where the profile has stories, else Herdr's picker
//   work-side     the profile's work: its stories (stories.js) where it has Jira, else the shown
//                 profile's Desk (desk.js) and other open spaces with their agents, then its
//                 earlier sessions (folded)
// The footer (limits, CPU, memory) is main.js's "footer" role.

import { div } from "gpui-kit";
import { Popup, h_flex, v_flex } from "gpui-base";
import { agents, run, setShared, shared, spaces, window, layout, openOverlay } from "herdr";
import { SMALL, TEXT, ago, chrome, countBadge, groupHeader, icon, iconButton, mark, resumeArgv, stop, find, toggleSide, empty, agentLabels } from "./ui.js";
import { chooseProfile, deskOf, newSpace, openProfile, profileOf, profiles, shownProfile, shownSpace, spacesOf, switchProfile } from "./config.js";
import { startAgent } from "./source.js";
import { StoryList } from "./stories.js";
import { openStoryPicker } from "./dialogs.js";
import { agentState, decor, skinFont, skinGlyph, skinText, skinTheme, statusMark } from "./skins/index.js";
import { Sessions } from "./sessions.js";
import { deskRows } from "./desk.js";

const MENU = "kelpie.spacemenu";
const PALETTE = [["#5a3b26", "#f3c08a"], ["#3d3550", "#d8c2f0"], ["#2c4436", "#b4dcbf"], ["#2f3f52", "#b9d2ec"], ["#523036", "#f0b8c0"], ["#4a4426", "#e8d79a"]];

// A profile's (or space's) small square: its first letter on a colour that's always the same for it
// (or the skin's, skins/index.js glyph).
function glyph(t, space, size = 20) {
  const skinned = skinGlyph(t, { name: space?.name ?? "", size });
  if (skinned) return skinned;
  let h = 0;
  for (const c of space?.name ?? "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = PALETTE[h % PALETTE.length];
  return div().flex().flex_none().size(size).items_center().justify_center().rounded(6).bg(bg).text_color(fg)
    .text_size(size * 0.55).font_semibold().child((space?.name ?? "?").trim().charAt(0).toUpperCase());
}

// The profile dropdown's geometry, counted from the sidebar's own boxes: the list and the sidebar
// rows both sit 8 in from the sidebar's edges, so the menu spans the same width and its rows' left and
// right edges line up with the rows under it. Inside: 4 of padding, rows 32 high with radius 6 (the
// menu's own radius is 6 + 4, so the corners run parallel), every leading glyph or icon in one 20px
// slot so the labels share a left edge, and every trailing part in fixed slots so the counts and the
// check line up row to row.
// `nudge`: Herdr puts the popup 6.5px in from the bar's left (measured at zoom 1.2); 1.5 more brings
// it to the rows' 8, and with the width above its right edge meets theirs too.
const DROP = { gutter: 8, pad: 4, row: 32, radius: 6, lead: 20, check: 14, gap: 4, min: 240, fallback: 300, nudge: 1.5 };

export class SpacePicker {
  init(cx) {
    this.handle = cx.focus_handle();
    this.at = -1; // the row the keyboard is on, -1: none
  }

  render(cx) {
    const t = skinTheme();
    const space = shownProfile() ?? shownSpace();
    const open = Boolean(shared(MENU));
    if (!open) this.at = -1;
    const mac = window()?.platform === "macos" && !window()?.fullscreen;
    const close = () => { this.at = -1; setShared(MENU, false); };
    // The click that closed the list from outside lands on the trigger too: it stays closed.
    const toggle = () => {
      const show = !open && !(this.shutAt && Date.now() - this.shutAt < 400);
      setShared(MENU, show);
      if (show) { this.at = -1; this.handle.focus(); }
    };
    const trigger = h_flex().id("space-picker").h(30).px(8).gap(8).items_center().rounded(8).cursor_pointer().min_w(0)
      .when(open, (el) => el.bg(t.raised)).when(!open, (el) => el.hover((s) => s.bg(t.raised)))
      .when(!open, (el) => el.tooltip("Switch profile")).on_mouse_down("left", stop).on_click(toggle)
      .child(glyph(t, space))
      .child(skinFont(div().min_w(0).truncate().font_semibold(), "profile").child(skinText(space?.name ?? "No space", "profile")))
      .child(icon(chrome("chevron-down"), 12).text_color(open ? t.foreground : t.dim));
    const bar = h_flex().size_full().pl(mac ? 80 : 8).pr(8).gap(6).items_center().text_size(TEXT).text_color(t.foreground)
      .child(trigger)
      .child(div().flex_1())
      .when(Boolean(find(layout(), "story-head")), (el) => el.child(iconButton(t, "side-hide", chrome("sidebar"), toggleSide, "Hide the sidebar ⌘B")))
      .child(space?.jira ? iconButton(t, "search", chrome("search"), () => openStoryPicker(), "Go to a story ⌘⇧K")
        : iconButton(t, "search", chrome("search"), () => run("mod.open", { name: "picker" }), "Search"));
    // The whole bar is the anchor, so the menu starts at the block's bottom left (just under the
    // window buttons on a windowed Mac too) and lines up with the sidebar, not with the name.
    const width = Math.max(DROP.min, (find(layout(), "side")?.size?.px ?? DROP.fallback) - 2 * DROP.gutter);
    return decor("blockDecor", t, Popup.new("space-picker-menu", bar).size_full().anchor("top_left")
      .when(open, (el) => el.content(this.menu(t, cx, width, close))), { role: "space-picker", now: new Date(), profile: space });
  }

  // Pick a profile to show its work (its latest space comes up), add or edit one; then the spaces in
  // no profile, and a new space. ↑/↓ move, Enter picks, Esc closes.
  menu(t, cx, width, close) {
    const shown = shownProfile();
    const list = agents();
    const loose = spaces().filter((s) => !profileOf(s));
    const items = [];
    const header = (text) => items.push({ header: text });
    const rule = () => items.push({ rule: true });
    const pick = (fn) => () => { close(); fn(); };
    header("Profiles");
    for (const p of profiles()) {
      const mine = spacesOf(p).map((s) => s.id);
      const here = list.filter((a) => mine.includes(a.space));
      const n = mine.length;
      items.push({
        id: `menu-profile-${p.id}`, lead: glyph(t, p), label: p.name, on: p.id === shown?.id,
        ask: here.filter((a) => a.status === "blocked").length, busy: here.filter((a) => a.status === "working").length,
        hint: n ? `${n} space${n === 1 ? "" : "s"}` : p.jira ? "Jira" : "",
        tip: [p.folder, p.jira ? "Jira" : "", p.github?.owner ? "GitHub" : ""].filter(Boolean).join(" · "),
        action: pick(() => switchProfile(p)),
      });
    }
    if (loose.length) {
      rule();
      header("Spaces in no profile");
      for (const s of loose) items.push({ id: `menu-space-${s.id}`, lead: glyph(t, s), label: s.name, on: !shown && s.active,
        action: pick(() => { chooseProfile(null); run("space.select", { id: s.id }); }) });
    }
    rule();
    const quiet = (name) => icon(chrome(name), 14).text_color(t.dim);
    items.push({ id: "menu-space-new", lead: quiet("plus"), label: "New space", muted: true, hint: "⌘N", action: pick(() => newSpace()) });
    items.push({ id: "menu-profile-new", lead: quiet("folder-plus"), label: "New profile…", muted: true, action: pick(() => openProfile(null, { space: shownSpace() })) });
    if (shown) items.push({ id: "menu-profile-edit", lead: quiet("settings"), label: `Edit ${shown.name}…`, muted: true, action: pick(() => openProfile(shown.id)) });

    const rows = items.filter((x) => x.action);
    const at = Math.min(this.at, rows.length - 1);
    const move = (d) => { this.at = at < 0 ? (d > 0 ? 0 : rows.length - 1) : (at + d + rows.length) % rows.length; cx.notify(); };
    const slot = (w, child) => div().flex().flex_none().w(w).items_center().justify_end().child(child ?? "");
    const draw = (x, i) => {
      if (x.header) return div().flex_none().px(8).pt(i === 0 ? 4 : 2).pb(4).text_size(SMALL).font_semibold().text_color(t.dim).child(x.header);
      if (x.rule) return div().flex_none().h(1).mx(8).my(DROP.gap).bg(t.border);
      const lit = rows[at] === x;
      const badges = [x.ask && countBadge(t, `${x.id}-ask`, "needs-you", x.ask, `${x.ask} waiting for you`, t.working),
        x.busy && countBadge(t, `${x.id}-busy`, "working", x.busy, `${x.busy} working`, t.accent)].filter(Boolean);
      return h_flex().id(x.id).flex_none().h(DROP.row).px(8).gap(10).items_center().rounded(DROP.radius).cursor_pointer()
        .when(x.on, (el) => el.bg(t.selected)).when(lit && !x.on, (el) => el.bg(t.hover)).when(!x.on && !lit, (el) => el.hover((s) => s.bg(t.hover)))
        .when(Boolean(x.tip), (el) => el.tooltip(x.tip))
        .on_mouse_move(() => { if (this.at !== rows.indexOf(x)) { this.at = rows.indexOf(x); cx.notify(); } })
        .on_click(x.action)
        .child(div().flex().flex_none().size(DROP.lead).items_center().justify_center().child(x.lead))
        .child(div().flex_1().min_w(0).truncate().when(x.on, (el) => el.font_medium()).text_color(x.muted ? t.muted : t.foreground).child(x.label))
        .when(badges.length > 0, (el) => el.child(h_flex().flex_none().gap(8).items_center().children(badges)))
        .when(Boolean(x.hint), (el) => el.child(div().flex_none().text_size(SMALL).text_color(t.dim).child(x.hint)))
        // The check's slot is on every row, so counts and key hints end at the same x.
        .child(slot(DROP.check, x.on ? icon(chrome("check"), DROP.check).text_color(t.accent) : null));
    };
    // The frame (border, corners, shadow) is an outer box and the scrolling list sits inside it: a
    // scroll box with its own border loses the right one under its scrollbar's edge.
    return v_flex().id("space-menu").track_focus(this.handle).w(width).ml(DROP.nudge).overflow_hidden()
      .rounded(DROP.radius + DROP.pad).bg(t.popover).border_1().border_color(t.border).shadow_lg()
      .text_size(TEXT).text_color(t.foreground)
      .on_mouse_down_out(() => { if (shared(MENU)) { this.shutAt = Date.now(); close(); } })
      .on_key_down((e, cx) => {
        if (e.key === "escape") close();
        else if (e.key === "down") move(1);
        else if (e.key === "up") move(-1);
        else if (e.key === "enter" && rows[at]) rows[at].action();
        else return;
        cx.stop_propagation();
      })
      .child(v_flex().id("space-menu-list").max_h(520).p(DROP.pad).gap(1).overflow_y_scrollbar().children(items.map(draw)));
  }
}

export class WorkSide {
  constructor() {
    this.stories = new StoryList();
    this.sessions = new Sessions();
    // The Desk's menus keep what's open here (menuButton() writes `host.menu`).
    this.deskMenus = {};
  }

  init(cx) {
    this.stories.init(cx);
    this.sessions.init(cx);
  }

  render(cx) {
    const t = skinTheme();
    const profile = shownProfile();
    const body = profile?.jira ? this.stories.render(cx) : this.plain(t, cx);
    return decor("blockDecor", t, body, { role: "work-side", now: new Date(), profile });
  }

  // A profile without stories: its Desk first (desk.js), then its other spaces, then its earlier
  // sessions folded away.
  // "Working on": each of the profile's open spaces (a click shows it) with its Claude agents under it,
  // each by its session's name and state (a click focuses it). The shown space's tabs are the tab
  // bar's, so plain terminals aren't repeated here. "Earlier sessions": the folder's past Claude
  // sessions to continue, folded until opened (they're history, not current work).
  plain(t, cx) {
    const profile = shownProfile();
    const shown = shownSpace();
    const desk = deskOf(profile);
    const open = (profile ? spacesOf(profile) : spaces().filter((s) => s.id === shown?.id)).filter((s) => s.id !== desk?.id);
    const st = this.sessions.state(cx);
    const list = agents();
    const tabs = spaces().flatMap((s) => s.tabs);
    // `trail`: something small at the row's right (a space's agents, as marks).
    const row = (id, on, dot, title, line, onClick, indent = 0, trail = null) => h_flex().id(id).flex_none().pl(8 + indent).pr(8).py(6).gap(10).items_start().rounded(8).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover))).on_click(onClick)
      .child(div().flex().flex_none().h(18).w(14).items_center().justify_center().child(dot))
      .child(v_flex().flex_1().min_w(0).gap(1).child(div().truncate().font_medium().child(title)).when(Boolean(line), (el) => el.child(div().truncate().text_size(SMALL).text_color(t.muted).child(line))))
      .when(Boolean(trail), (el) => el.child(h_flex().flex_none().h(18).gap(6).items_center().child(trail)));
    const recent = (st.data ?? []).filter((s) => !s.running).slice(0, 12);
    const folded = !this.earlierOpen;
    return v_flex().id("work-side-plain").size_full().min_h(0).px(8).pb(10).text_size(TEXT).text_color(t.foreground).overflow_y_scrollbar()
      .when(Boolean(profile), (el) => el.children(deskRows(t, this.deskMenus, profile, { on: Boolean(desk?.active) })))
      .child(h_flex().flex_none().items_end().gap(4)
        .child(div().flex_1().min_w(0).child(groupHeader(t, "Working on", open.length)))
        .child(div().flex_none().mb(1).child(iconButton(t, "plain-space-new", chrome("plus"), () => newSpace(), "New space (⌘N)"))))
      .when(open.length === 0, (el) => el.child(empty(t, profile ? "Nothing else open in this profile." : "Nothing open in this profile.")))
      .children(open.flatMap((sp) => {
        const here = list.filter((a) => a.space === sp.id);
        const names = agentLabels(here, tabs);
        const counts = here.length ? `${here.length} agent${here.length === 1 ? "" : "s"}` : `${sp.tabs.length} tab${sp.tabs.length === 1 ? "" : "s"}, no agent`;
        // Its agents in one glance at the right, the ones waiting for you or working counted.
        const ask = here.filter((a) => a.status === "blocked").length, busy = here.filter((a) => a.status === "working").length;
        const trail = [ask && countBadge(t, `plain-ask-${sp.id}`, "needs-you", ask, `${ask} waiting for you`, t.working),
          busy && countBadge(t, `plain-busy-${sp.id}`, "working", busy, `${busy} working`, t.accent)].filter(Boolean);
        return [
          row(`plain-space-${sp.id}`, sp.id === shown?.id && !here.some((a) => a.focused), icon(chrome("folder"), 12).text_color(sp.id === shown?.id ? t.accent : t.dim), sp.name, null,
            () => run("space.select", { id: sp.id }), 0, trail.length ? h_flex().gap(8).items_center().children(trail) : div().text_size(SMALL).text_color(t.dim).child(String(here.length || "")))
            // Double-click renames it; right-click opens Herdr's own space menu (rename, close…).
            .tooltip(`${sp.name} · ${counts}: double-click to rename, right-click for more`)
            .on_mouse_down("left", (e, cx) => { if (e.click_count === 2) { cx.stop_propagation(); run("space.rename", { id: sp.id }); } })
            .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: sp.id } } }); }),
          ...here.map((a) => row(`plain-agent-${a.address}`, a.focused,
            statusMark(t, agentState(a.status) ?? "idle", { where: "side-tab", size: 7, color: t[a.status] ?? t.dim, agent: a }) ?? mark(t, agentState(a.status) ?? "idle", 14),
            names.get(a.address), null,
            () => { run("space.select", { id: a.space }); if (a.pane) run("pane.focus", { pane: a.pane }); }, 16)
            .tooltip(`${a.program?.name ?? "Agent"} · ${{ blocked: "waiting for you", working: "working", done: "done", idle: "idle" }[a.status] ?? a.status}`)
            .on_mouse_down("left", (e, cx) => { if (e.click_count === 2) { cx.stop_propagation(); run("tab.rename", { id: a.tab }); } })),
        ];
      }))
      .when(recent.length > 0, (el) => el
        .child(h_flex().id("plain-earlier").flex_none().cursor_pointer().items_end().gap(4).on_click((_e, cx) => { this.earlierOpen = folded; cx.notify(); })
          .child(div().flex_1().min_w(0).child(groupHeader(t, "Earlier sessions", recent.length)))
          .child(icon(chrome(folded ? "chevron-right" : "chevron-down"), 12).text_color(t.dim).mr(8).mb(7)))
        .when(!folded, (x) => x.children(recent.map((s) => row(`plain-session-${s.id}`, false, div().size(7).rounded_full().border_1().border_color(t.dim), s.title,
          `Continue · ${ago(s.updated)} ago`, () => startAgent(st, { folder: s.cwd, argv: resumeArgv(s.id, s.config, (st.setup ?? st.profile)?.github?.account) }))))));
  }

}
