// The Desk's rows at the top of a profile's sidebar (stories.js StoryList for a profile with Jira,
// workside.js for one without): the Desk itself (a click shows it, opening it when it isn't open),
// then its Claude agents by session name. After its heading's rule, a menu of earlier sessions that
// name no ticket (to continue on the Desk; Jira profiles only, where the sidebar has no other place
// for them) and + for a new Claude or terminal on it. The space itself lives in config.js (deskOf,
// openDesk). Pausing it (pauseDesk) keeps its agents' sessions and closes it, as a story's Pause does;
// they're offered again, first, in the menu that opens it.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, focused, layout, notify, openOverlay, panes, run, setShared, shared, spaces } from "herdr";
import { MOD, agentMark, agentWords, ago, agentLabels, capitalize, chrome, claudeSession, groupHeader, icon, iconButton, menuButton, own, resumeArgv, sideHidden, toggleSide } from "./ui.js";
import { DESK_PAUSED, claudeArgv, deskOf, openDesk, shellArgv, shownProfile } from "./config.js";

const ASK = "kelpie.desk.ask"; // { profile, at }: ⌥⌘D on a closed Desk, for the sidebar to open its menu

// The Desk's paused agents, oldest first: each { sessionId, cwd, name (its tab's), at, config }.
export const deskPaused = (profile) => (shared(DESK_PAUSED) ?? {})[profile?.id] ?? [];
function savePaused(profile, list) {
  const all = { ...(shared(DESK_PAUSED) ?? {}) };
  if (list.length) all[profile.id] = list; else delete all[profile.id];
  setShared(DESK_PAUSED, all);
}

// Brings back paused agents of the Desk, one after another, each in a tab of its old name on its
// session: the first opens the Desk when it's closed, the rest open in it. They leave the paused list
// before they launch, so a second click can't open one twice; one whose Desk didn't show up goes back.
export async function resumeDesk(profile, picked = deskPaused(profile)) {
  // Only those still paused: a menu drawn before keeps its rows, and a second click there comes too.
  const still = new Set(deskPaused(profile).map((p) => p.sessionId));
  const list = picked.filter((p) => still.has(p.sessionId));
  const ids = new Set(list.map((p) => p.sessionId));
  savePaused(profile, deskPaused(profile).filter((p) => !ids.has(p.sessionId)));
  for (const [i, p] of list.entries()) {
    const id = await openDesk(profile, { name: p.name, folder: p.cwd, argv: resumeArgv(p.sessionId, p.config, profile?.github?.account) }).catch(() => null);
    if (!id) {
      savePaused(profile, [...deskPaused(profile), ...list.slice(i)]);
      notify({ title: "The Desk didn't open in time", body: "Its paused agents stay paused: try again from the Desk's menu.", level: "warning", timeout: 6000 });
      return;
    }
  }
}

// What a new tab on the Desk runs, as the tab bar's + offers: Claude or a shell, on the profile's
// Claude account, opening the Desk with it when it's closed. Paused agents come first, to resume.
const newRows = (profile) => {
  const paused = deskPaused(profile);
  const resumeRows = paused.length ? [
    { header: "Paused" },
    ...(paused.length > 1 ? [{ label: `Resume all ${paused.length}`, tip: "Each paused agent back in its own tab, on its session", action: () => { resumeDesk(profile); } }] : []),
    ...paused.map((p) => ({ label: p.name || "Claude", hint: ago(p.at) === "now" ? "just now" : `${ago(p.at)} ago`, tip: `Resume it on its session, in ${p.cwd}`, action: () => { resumeDesk(profile, [p]); } })),
    { header: "New" },
  ] : [];
  return [
    ...resumeRows,
    { label: "Claude", tip: "A Claude agent with no task, in the profile's folder", action: () => { openDesk(profile, { argv: claudeArgv(profile) }); } },
    { label: "Terminal", tip: "A shell in the profile's folder", action: () => { openDesk(profile, { argv: shellArgv(profile) }); } },
  ];
};

// Keeps each agent's Claude session in the Desk's paused list (one already there isn't added twice).
// Returns the agents kept and those with no Claude session found.
async function keepSessions(profile, list) {
  const kept = [], failed = [];
  for (const a of list) {
    const rec = await claudeSession(a.address).catch(() => null);
    if (!rec) { failed.push(a); continue; }
    const others = deskPaused(profile).filter((p) => p.sessionId !== rec.sessionId);
    savePaused(profile, [...others, { sessionId: rec.sessionId, cwd: rec.cwd, name: a.tab_name, at: Date.now(), ...(rec.config ? { config: rec.config } : {}) }]);
    kept.push(a);
  }
  return { kept, failed };
}

// Closes each agent's pane, so others split into its tab keep running; its tab when it was alone.
function closeAgents(list) {
  for (const a of list) {
    const alone = panes().filter((p) => p.tab === a.tab).length <= 1;
    if (alone) run("tab.close", { id: a.tab, confirmed: true }); else run("pane.close", { pane: a.pane });
  }
}

const noSession = (list) => notify({ title: `No Claude session found for ${list.map((a) => a.tab_name).join(", ")}`,
  body: "So the Desk stays open, with it. The other agents are paused.", level: "warning", timeout: 8000 });

// Pauses the Desk: every agent's session kept, then the Desk closed (a terminal in it closes too).
// When an agent's session can't be found, the Desk stays, with that agent; the others' panes close.
export async function pauseDesk(profile = shownProfile()) {
  const desk = deskOf(profile);
  if (!desk) return;
  const { kept, failed } = await keepSessions(profile, deskAgents(profile));
  if (failed.length) { closeAgents(kept); noSession(failed); return; }
  if (spaces().some((s) => s.id === desk.id)) run("space.close", { id: desk.id, confirmed: true });
}

// Pauses one agent of the Desk (⌥⌘P on it): its session kept, its pane closed; the Desk stays.
export async function pauseDeskAgent(profile, a) {
  const { kept, failed } = await keepSessions(profile, [a]);
  if (failed.length) return notify({ title: `No Claude session found in ${a.tab_name}`, body: "So it stays open.", level: "warning", timeout: 6000 });
  closeAgents(kept);
}

// Why pausing the Desk asks first: an agent at work, or tabs with no agent, which close with it. "" when nothing.
export function deskPauseWhy(profile) {
  const desk = deskOf(profile);
  const here = deskAgents(profile);
  const agentTabs = new Set(agents().map((a) => a.tab));
  const plain = (desk?.tabs ?? []).filter((c) => !agentTabs.has(c.id)).length;
  const working = here.filter((a) => a.status === "working").length;
  return [working && `${working === 1 ? "an agent is" : `${working} agents are`} working`, plain && `${plain === 1 ? "a tab" : `${plain} tabs`} with no agent close${plain === 1 ? "s" : ""} too`].filter(Boolean).join(", ");
}

// The Desk heading's Pause: at once when nothing would be lost, else a dialog saying why first, whose
// Pause runs `kelpie.pause-desk`.
export function askPauseDesk(profile) {
  const why = deskPauseWhy(profile);
  if (!why) return pauseDesk(profile);
  openOverlay({ mod: MOD, kind: "dialog", width: 440, height: 170, props: { role: "confirm", title: "Pause the Desk?", yes: "Pause", command: { name: `${MOD}.pause-desk` },
    detail: `${capitalize(why)}. Pause keeps its agents' sessions, to resume when the Desk opens again.` } });
}

// ⌥⌘P on the Desk: its focused agent, else the whole Desk; either asks first when it would stop work
// or close a terminal, here by pressing the key again within a few seconds (`armed`: { what, at }, the
// caller's).
export function pauseDeskByKey(profile, armed) {
  const f = focused();
  const here = deskAgents(profile);
  const a = here.find((x) => x.address === f?.terminal) ?? here.find((x) => x.pane === f?.pane);
  const what = a ? a.address : `desk:${profile.id}`;
  const why = a ? (a.status === "working" ? `${a.tab_name} is working` : "") : deskPauseWhy(profile);
  if (!a && !here.length) return notify({ title: "No agent on the Desk to pause", level: "info", timeout: 4000 });
  const again = armed.what === what && Date.now() - armed.at < 6000;
  if (why && !again) {
    Object.assign(armed, { what, at: Date.now() });
    return notify({ title: capitalize(why), body: `Press the key again to pause ${a ? "it" : "the Desk"} anyway.`, level: "warning", timeout: 6000 });
  }
  Object.assign(armed, { what: null, at: 0 });
  return a ? pauseDeskAgent(profile, a) : pauseDesk(profile);
}

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
  const paused = deskPaused(profile);
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
      .when(Boolean(desk) && here.length > 0, (el) => el.child(iconButton(t, "desk-pause", own("pause"), () => { askPauseDesk(profile); },
        "Pause the Desk ⌥⌘P: keeps its agents' sessions, to resume when it opens again")))
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
      trigger: (toggle, open) => row("desk-open-more", open, mark0, paused.length ? `Open the Desk · ${paused.length} paused` : "Open the Desk").text_color(t.muted)
        .tooltip(paused.length ? `Resume its paused agent${paused.length === 1 ? "" : "s"}, or start something new on it ⌥⌘D`
          : "For work without a ticket: a space in the profile's folder, with Claude or a terminal ⌥⌘D").on_click(toggle) });
  const agentRow = (a) => row(`desk-agent-${a.address}`, a.focused,
    agentMark(t, a.status, { where: "side-tab", agent: a }),
    names.get(a.address))
    .tooltip(`${a.program?.name ?? "Agent"} · ${agentWords(a.status)}`)
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
