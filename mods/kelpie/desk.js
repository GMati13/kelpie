// The Desk's rows at the top of a profile's sidebar (stories.js StoryList for a profile with Jira,
// workside.js for one without): the Desk itself (a click shows it, opening it when it isn't open),
// then its Claude agents by session name. After its heading's rule, a menu of earlier sessions that
// name no ticket (to continue on the Desk; Jira profiles only, where the sidebar has no other place
// for them) and + for a new Claude or terminal on it. The space itself lives in config.js (deskOf,
// openDesk).

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, layout, openOverlay, run, setShared, shared, spaces } from "herdr";
import { ago, agentLabels, chrome, groupHeader, icon, mark, menuButton, own, resumeArgv, sideHidden, toggleSide } from "./ui.js";
import { claudeArgv, deskOf, openDesk, shellArgv, shownProfile } from "./config.js";
import { agentState, statusMark } from "./skins/index.js";

const SAYS = { blocked: "waiting for you", working: "working", done: "done", idle: "idle" };
const ASK = "kelpie.desk.ask"; // { profile, at }: ⌥⌘D on a closed Desk, for the sidebar to open its menu

// What a new tab on the Desk runs, as the tab bar's + offers: Claude or a shell, on the profile's
// Claude account, opening the Desk with it when it's closed.
const newRows = (profile) => [
  { label: "Claude", tip: "A Claude agent with no task, in the profile's folder", action: () => { openDesk(profile, { argv: claudeArgv(profile) }); } },
  { label: "Terminal", tip: "A shell in the profile's folder", action: () => { openDesk(profile, { argv: shellArgv(profile) }); } },
];

// ⌥⌘D: shows the Desk; a closed one asks what to open first, in the sidebar's Desk menu (the sidebar
// shown, the profile menu closed).
export function goDesk(profile = shownProfile()) {
  if (!profile) return;
  if (deskOf(profile)) return openDesk(profile);
  if (sideHidden(layout())) toggleSide();
  if (shared("kelpie.spacemenu")) setShared("kelpie.spacemenu", false);
  setShared(ASK, { profile: profile.id, at: Date.now() });
}

// The Desk's agents (none while it's closed).
export const deskAgents = (profile) => {
  const desk = deskOf(profile);
  return desk ? agents().filter((a) => a.space === desk.id) : [];
};

// Drawn as the sidebar's other sections are ("Working on" in workside.js): a group heading (its
// agents counted) with its icons after the rule, then one-line rows: its agents. The heading names
// the Desk, so it has a row of its own only while it has no agent: "Open the Desk" while closed,
// else its tabs, to show it. `host` keeps the sessions menu open (a view); `on`: the Desk is what's shown
// (not a story previewed over it); `sessions`: earlier sessions to offer, newest first (null: no menu).
export function deskRows(t, host, profile, { on = false, sessions = null } = {}) {
  const desk = deskOf(profile);
  const here = deskAgents(profile);
  const tabs = spaces().flatMap((s) => s.tabs);
  const names = agentLabels(here, tabs);
  // ⌥⌘D asked for a closed Desk: its menu opens, once per press.
  const ask = shared(ASK);
  if (!desk && ask?.profile === profile.id && Date.now() - ask.at < 5000 && host.deskAsked !== ask.at) {
    host.deskAsked = ask.at;
    host.menu = "desk-open";
  }
  const earlier = (sessions ?? []).slice(0, 15);
  const menu = earlier.length ? menuButton(host, t, "desk-sessions", "", [
    { header: "Continue on the Desk" },
    ...earlier.map((s) => ({ label: s.title || "Untitled session", hint: `${ago(s.updated)} ago`, tip: s.cwd,
      action: () => { openDesk(profile, { folder: s.cwd, argv: resumeArgv(s.id, s.config, profile?.github?.account) }); } })),
  ], { tip: "Earlier sessions with no ticket", iconPath: chrome("clock"), width: 320 }) : null;
  const head = h_flex().flex_none().items_end().gap(4)
    .child(div().flex_1().min_w(0).child(groupHeader(t, "Desk", here.length || null)))
    .child(h_flex().flex_none().mb(1).gap(2).items_center()
      .when(Boolean(menu), (el) => el.child(menu))
      .child(menuButton(host, t, "desk-new", "", newRows(profile), { tip: "New Claude or terminal on the Desk", iconPath: chrome("plus"), width: 220 })));
  // The same row as "Working on"'s: a mark in a 14px column, then the title.
  const row = (id, on, dot, title) => h_flex().id(id).flex_none().px(8).py(6).gap(10).items_start().rounded(8).cursor_pointer()
    .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
    .child(div().flex().flex_none().h(18).w(14).items_center().justify_center().child(dot))
    .child(div().flex_1().min_w(0).truncate().font_medium().child(title));
  const mark0 = icon(own("house"), 14).text_color(on ? t.accent : t.dim);
  // Closed: the row asks what to open (the same menu as +); open with no agent, it shows the Desk.
  const deskRow = here.length ? null : desk
    ? row("desk", on, mark0, `${desk.tabs.length} tab${desk.tabs.length === 1 ? "" : "s"}, no agent`).text_color(t.muted)
      .tooltip("Show the Desk ⌥⌘D: right-click for more")
      .on_click(() => { openDesk(profile); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: desk.id } } }); })
    : menuButton(host, t, "desk-open", "", newRows(profile), { anchor: "top_left", width: 220,
      trigger: (toggle, open) => row("desk-open-more", open, mark0, "Open the Desk").text_color(t.muted)
        .tooltip("For work without a ticket: a space in the profile's folder, with Claude or a terminal ⌥⌘D").on_click(toggle) });
  const agentRow = (a) => row(`desk-agent-${a.address}`, a.focused,
    statusMark(t, agentState(a.status) ?? "idle", { where: "side-tab", size: 7, color: t[a.status] ?? t.dim, agent: a }) ?? mark(t, agentState(a.status) ?? "idle", 14),
    names.get(a.address))
    .tooltip(`${a.program?.name ?? "Agent"} · ${SAYS[a.status] ?? a.status}`)
    .on_click(() => { openDesk(profile); if (a.pane) run("pane.focus", { pane: a.pane }); })
    .on_mouse_down("left", (e, cx) => { if (e.click_count === 2) { cx.stop_propagation(); run("tab.rename", { id: a.tab }); } });
  return [head, ...(deskRow ? [deskRow] : []), ...here.map(agentRow)];
}

// Shows the Desk's agent waiting for you (the first), for the next-need key. False when none waits.
export function goDeskAsking(profile) {
  const a = deskAgents(profile).find((x) => x.status === "blocked");
  if (!a) return false;
  openDesk(profile);
  if (a.pane) run("pane.focus", { pane: a.pane });
  return true;
}
