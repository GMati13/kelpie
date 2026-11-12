// The Desk's rows at the top of a profile's sidebar (stories.js StoryList for a profile with Jira,
// workside.js for one without): the Desk itself (a click shows it, opening it when it isn't open),
// then its Claude agents by session name. After its heading's rule, a menu of earlier sessions that
// name no ticket (to continue on the Desk; Jira profiles only, where the sidebar has no other place
// for them) and + for a new Claude or terminal on it. The space itself lives in config.js (deskOf,
// openDesk).

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { openOverlay } from "herdr";
import { agents, layout, run, setShared, shared, spaces } from "./host.js";
import { agentMark, agentWords, ago, agentLabels, chrome, claudeSession, groupHeader, icon, menuButton, own, resumeArgv, sideHidden, stop, toggleSide } from "./ui.js";
import { claudeArgv, deskOf, openDesk, shellArgv, shownProfile } from "./config.js";
import { countShots } from "./shots.js";

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
// agents counted, then its plain terminals; a click on it shows the Desk) with its icons after the
// rule, then one-line rows: its agents. The heading names the Desk, so it has a row of its own only
// while it has no agent: "Open the Desk" while closed, else its tabs, to show it. `host` keeps the sessions menu open (a view); `on`: the Desk is what's shown
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
  // Its plain terminals stay off the list (the sidebar is about agents), but the heading says they're
  // there, while it has agents (without, its own row counts its tabs): a mark and a count after the
  // agents', a click showing the Desk on the terminal, or on the one picked when there are several.
  const plain = desk && here.length ? desk.tabs.filter((c) => !here.some((a) => a.tab === c.id)) : [];
  const showTab = (c) => { openDesk(profile); run("tab.select", { id: c.id }); };
  const termTip = `${plain.length} terminal${plain.length === 1 ? "" : "s"} on the Desk (${plain.map((c) => c.name).join(", ")})`;
  const termMark = (id, onClick, open = false) => h_flex().id(id).flex_none().h(18).px(4).gap(4).items_center().rounded(6).cursor_pointer()
    .text_color(open ? t.foreground : t.dim).when(open, (el) => el.bg(t.selected)).hover((el) => el.bg(t.hover))
    .tooltip(plain.length === 1 ? `${termTip}: click to show it` : `${termTip}: click to pick one`).on_click(onClick)
    .child(icon(chrome("terminal"), 12)).child(String(plain.length));
  const terms = !plain.length ? null : div().id("desk-terminals-wrap").flex_none().on_mouse_down("left", stop).on_click(stop)
    .child(plain.length === 1 ? termMark("desk-terminals", () => showTab(plain[0]))
      : menuButton(host, t, "desk-terminals", "", [{ header: "Terminals on the Desk" }, ...plain.map((c) => ({ label: c.name, action: () => showTab(c) }))],
        { anchor: "top_left", width: 220, trigger: (toggle, open) => termMark("desk-terminals", toggle, open) }));
  // The heading's name (and its empty part) goes to the Desk itself, as ⌥⌘D does: as it was last
  // seen, its last focused tab, without picking one of its agents (#133).
  const head = h_flex().flex_none().items_end().gap(4)
    .child(div().id("desk-head").flex_1().min_w(0).cursor_pointer()
      .tooltip(desk ? "Show the Desk ⌥⌘D" : "Open the Desk ⌥⌘D")
      .on_click(() => { goDesk(profile); })
      .child(groupHeader(t, "Desk", here.length || null, terms)))
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
    agentMark(t, a.status, { where: "side-tab", agent: a }),
    names.get(a.address))
    .tooltip(`${a.program?.name ?? "Agent"} · ${agentWords(a.status)}`)
    .on_click(() => { openDesk(profile); showDeskView(profile, "agent"); if (a.pane) run("pane.focus", { pane: a.pane }); })
    .on_mouse_down("left", (e, cx) => { if (e.click_count === 2) { cx.stop_propagation(); run("tab.rename", { id: a.tab }); } });
  return [head, ...(deskRow ? [deskRow] : []), ...here.map(agentRow)];
}

// Shows the Desk's agent waiting for you (the first), for the next-need key. False when none waits.
export function goDeskAsking(profile) {
  const a = deskAgents(profile).find((x) => x.status === "blocked");
  if (!a) return false;
  openDesk(profile);
  showDeskView(profile, "agent");
  if (a.pane) run("pane.focus", { pane: a.pane });
  return true;
}

// The Desk's Screenshots view: the Artifacts panel's story copy (the "story-shots" block), scoped to
// the Desk's agents' Claude sessions through shared "kelpie.artifacts.sessions", as a story's is
// (stories.js shareShots). What the main area shows is kept by the Desk's space id in "kelpie.view",
// as a story space's is: "agent" (its terminals) or "shots".
const VIEW = "kelpie.view";
const ARTIFACTS = "kelpie.artifacts.sessions";
// The sessions of the Desk's agents seen so far, newest first, so an agent's screenshots stay once its
// tab closes: { profile id: [{ id, at }] }, the last SEEN_MAX within SEEN_FOR. A deleted profile's
// entry goes with it (config.js saveProfile).
export const DESK_SESSIONS = "kelpie.desk.sessions";
const SEEN_MAX = 30;
const SEEN_FOR = 14 * 24 * 3600 * 1000;
const GATHERED = {}; // profile id -> { list, at, live, loading, shots }: the Desk's sessions, by profile

// Whether the profile's Desk is the space shown.
export const deskShown = (profile = shownProfile()) => Boolean(deskOf(profile)?.active);
export function deskView(profile) {
  const desk = deskOf(profile);
  return desk && (shared(VIEW) ?? {})[desk.id] === "shots" ? "shots" : "agent";
}
export function showDeskView(profile, mode) {
  const desk = deskOf(profile);
  if (!desk || !["agent", "shots"].includes(mode) || deskView(profile) === mode) return;
  setShared(VIEW, { ...(shared(VIEW) ?? {}), [desk.id]: mode });
}

const seenOf = (profile) => ((shared(DESK_SESSIONS) ?? {})[profile.id] ?? []).filter((s) => Date.now() - s.at < SEEN_FOR);
// Notes sessions seen on the Desk, written only when one is new.
function remember(profile, ids) {
  const seen = seenOf(profile);
  const fresh = ids.filter((id) => !seen.some((s) => s.id === id));
  if (!fresh.length) return;
  const list = [...fresh.map((id) => ({ id, at: Date.now() })), ...seen].slice(0, SEEN_MAX);
  setShared(DESK_SESSIONS, { ...(shared(DESK_SESSIONS) ?? {}), [profile.id]: list });
}

// The Desk's Claude sessions ([{ id, terminal }]): its open agents' (with their terminal, so an image
// can go to its chat), then the ones seen on it before. Exported for the tests.
export async function deskSessions(profile) {
  const open = [];
  for (const a of deskAgents(profile)) {
    const rec = await claudeSession(a.address).catch(() => null);
    if (rec?.sessionId && !open.some((s) => s.id === rec.sessionId)) open.push({ id: rec.sessionId, terminal: a.address });
  }
  remember(profile, open.map((s) => s.id));
  return [...open, ...seenOf(profile).filter((s) => !open.some((o) => o.id === s.id)).map((s) => ({ id: s.id, terminal: null }))];
}

// For the tab bar (main.js) while the Desk is shown: its view, how many screenshots its sessions hold
// (undefined until counted), and a way to switch views. Its sessions are gathered again when its
// agents change, every 5 s while an open agent has no session yet (a new agent's is on disk only after
// its first message), and once a minute; while Screenshots shows they go to the Artifacts panel.
export function deskNow(cx, profile = shownProfile()) {
  if (!deskShown(profile)) return null;
  const desk = deskOf(profile);
  const view = deskView(profile);
  const here = deskAgents(profile);
  const e = GATHERED[profile.id];
  const live = here.map((a) => a.address).sort().join(" ");
  const unseen = Boolean(e?.list) && here.some((a) => !e.list.some((s) => s.terminal === a.address));
  const age = Date.now() - (e?.at ?? 0);
  if (!e || (!e.loading && (e.live !== live || (unseen && age > 5000) || age > 60000))) {
    GATHERED[profile.id] = { ...(e ?? {}), loading: true, at: e?.at ?? 0, live };
    cx.spawn(async (cx) => {
      const list = await deskSessions(profile).catch(() => e?.list ?? []);
      const shots = await countShots(list.map((s) => s.id), desk.machine ?? null).catch(() => e?.shots);
      GATHERED[profile.id] = { list, at: Date.now(), live, shots };
      cx.notify();
    });
  }
  const list = GATHERED[profile.id]?.list;
  if (view === "shots") {
    const key = `desk:${profile.id}`;
    const next = list ? {
      key, desk: true, ids: list.map((s) => s.id), keys: {},
      terminals: Object.fromEntries(list.filter((s) => s.terminal).map((s) => [s.id, s.terminal])), on: desk.machine ?? null, started: true,
      agents: here.map((a) => a.address),
    } : { key, desk: true };
    if (JSON.stringify(shared(ARTIFACTS)) !== JSON.stringify(next)) setShared(ARTIFACTS, next);
  }
  return { view, shots: GATHERED[profile.id]?.shots, show: (mode) => showDeskView(profile, mode) };
}
