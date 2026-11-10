// Kelpie's own pieces: a macOS-style sidebar and a plain toolbar. Roles, from the layout:
//   top      window-button space and the sidebar toggle
//   sidebar  spaces and agents, and a footer: the time, CPU, memory and the focused agent's Claude limits
//   toolbar  tabs, and the side panels as icons (Files, Changes, Artifacts, Web); in the Kelpie layout, where the space
//            shows stories, the selected story's tabs, its Claude and Terminal, Changes and Screenshots;
//            elsewhere, Claude and Terminal open a tab in the shown space
//   footer   the sidebar's footer on its own (the Kelpie layout's sidebar is workside.js), with the Claude account and
//            limits of the focused agent, else of the shown profile's account (workClaude)
//   hub, sprint, pulls, sessions, setup   the Kelpie layout's Hub: its strip, sources and setup dialog (work.js)

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, appHome, exec, focused, hc, layout, nextCommand, notify, openOverlay, panes, props, run, setShared, shared, spaces, terminals, theme, window } from "herdr";
import { CONTROL, MOD, ROW, modFile, SMALL, TEXT, ago, agentName, capitalize, chrome, claudeInfo, clock12, find, icon, iconButton, LOAD, loadColor, menuButton, meter, programIcon, own, resetLabel, shownAgent, statColor, status, stop, sideHidden, buttonsRoom, toggleSide, sessionTitle } from "./ui.js";
import { WORK_ROLES, hubHidden, syncHub } from "./work.js";
import { whatNext, cleanAll, cleanStoryByKey, nextNeed, pauseStoryByKey, showNotified, showStoryByKey, storyKeyOf, storyNow, syncTracking } from "./stories.js";
import { openStoryPicker } from "./dialogs.js";
import { REFRESH } from "./source.js";
import { applyProfileRequest, requestProfileChange, chooseProfile, claudeArgv, claudeConfigOf, claudeKey, liveFolder, newSpace, openProfile, openSetup, profileElsewhere, profiles, shownProfile, saveProfile, shellArgv, switchProfile, isDesk, newTab } from "./config.js";
import { goDesk } from "./desk.js";
import { demoAccounts, isDemo, removeDemo, setupDemo } from "./demo.js";
import { agentState, decor, footerExtras, sidebarFoot, skinFont, skinMeter, skinText, skinTheme, skinTick, statusMark, syncSkin } from "./skins/index.js";

function top() {
  const t = theme();
  const mac = window()?.platform === "macos" && !window()?.fullscreen;
  return h_flex().size_full().pl(mac ? 84 : 12).pr(8).items_center().justify_end().text_size(TEXT)
    .child(iconButton(t, "search", chrome("search"), () => run("mod.open", { name: "picker" }), "Search"));
}

function section(t, label, trailing) {
  return h_flex().h(ROW).flex_none().pl(10).pr(2).mt(10).items_center().justify_between().text_size(SMALL).text_color(t.dim)
    .child(label).when(Boolean(trailing), (el) => el.child(trailing));
}

const POLL = 5000;

// CPU as a share of all cores, memory in use as a share of all of it: on macOS active, wired and
// compressed pages; on Linux what /proc/meminfo doesn't count as available.
const STATS = `if [ "$(uname)" = Darwin ]; then
ps -A -o %cpu= | awk -v n="$(sysctl -n hw.ncpu)" '{s+=$1} END {printf "%d ", s/n}'
vm_stat | awk -v total="$(sysctl -n hw.memsize)" '/page size of/ {ps=$8} /Pages active/ {a=$3} /Pages wired/ {w=$4} /occupied by compressor/ {c=$5} END {printf "%d", (a+w+c)*ps*100/total}'
else
ps -A -o %cpu= | awk -v n="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)" '{s+=$1} END {printf "%d ", s/n}'
awk '/^MemTotal:/ {t=$2} /^MemAvailable:/ {a=$2} END {if (t) printf "%d", (t-a)*100/t}' /proc/meminfo
fi`;
const limitMeter = (t, label, limit) => meter(t, label, limit?.used_percentage, resetLabel(limit?.resets_at));

function footer(t, state) {
  const c = state.claude;
  const details = c ? [c.model, c.effort ? capitalize(c.effort) : null].filter(Boolean).join(" \u00b7 ") : "";
  const limits = c ? [limitMeter(t, "5h", c.five_hour), limitMeter(t, "Week", c.seven_day)].filter(Boolean) : [];
  // Plain text, only coloured once genuinely high (statColor).
  // A skin may draw them as meters (skins/index.js meter).
  const stat = (kind, label, value, scale) => skinMeter(t, { kind, label, value, scale }) ?? h_flex().gap(4).child(div().child(label))
    .child(skinFont(div(), "numbers").text_color(statColor(t, value, scale)).child(value == null ? "\u2013" : `${value}%`));
  const extra = footerExtras(t, { now: new Date() });
  return v_flex().flex_none().mx(2).mt(6).pt(8).px(8).gap(2).border_t_1().border_color(t.border).text_size(SMALL).text_color(t.dim)
    .when(Boolean(c), (el) => el
      .child(h_flex().h(20).gap(8).items_center().justify_between()
        .child(div().text_color(t.muted).child(c.account))
        .child(div().min_w(0).truncate().child(details)))
      .children(limits))
    .children(state.lines ?? [])
    .child(h_flex().h(ROW).gap(12).items_center()
      .child(stat("cpu", "CPU", state.cpu, LOAD.cpu))
      .child(stat("mem", "Mem", state.mem, LOAD.mem))
      .child(div().flex_1())
      .when(Boolean(extra), (el) => el.child(extra))
      .child(skinFont(div().text_color(t.muted), "clock", SMALL).child(skinText(clock12(new Date()), "clock")))
      .child(iconButton(t, "settings", chrome("settings"), () => run("app.settings"), "Settings").mr(-6)));
}

// The Kelpie footer's Claude line, compact (its block is short): the active profile's account (the one
// its agents start on), never what has focus, with its 5h and week limits from the newest status line
// any session of that account saved; the model and how old the figures are in its tip. Nothing known:
// no line.
const ACCOUNTS = 'set -- "$HOME"/.cache/kelpie/limits/*.json; [ -e "$1" ] || exit 0; jq -c -s \'map(select(type == "object" and has("config") and (.five_hour != null or .seven_day != null))) | group_by(.config // "") | map(max_by(.at))\' "$@" 2>/dev/null; true';
async function claudeAccounts() {
  const out = (await exec("sh", ["-c", ACCOUNTS])).stdout.trim();
  // One per folder however it was written (unset and ~/.claude are the same one).
  const newest = {};
  for (const a of out ? JSON.parse(out) : []) if (!(newest[claudeKey(a.config)]?.at >= a.at)) newest[claudeKey(a.config)] = a;
  return Object.values(newest);
}
// When a window resets: in full for its tip ("Resets in 1h 20m, at 3:40 PM"; past a day "Resets Sat
// 5:00 PM"), and short for beside a share that's near the limit ("20m", "1h20", "16h", "Sat").
function resetTip(limit, now = Date.now()) {
  if (!limit?.resets_at) return null;
  if (limit.resets_at * 1000 <= now) return "Reset: the next session that runs shows the new share";
  const when = resetLabel(limit.resets_at, now);
  return /^[A-Z]/.test(when) ? `Resets ${when}` : `Resets in ${when}, at ${clock12(new Date(limit.resets_at * 1000))}`;
}
function resetShort(limit, now = Date.now()) {
  const minutes = Math.round((limit.resets_at * 1000 - now) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  if (minutes < 10 * 60) return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  return resetLabel(limit.resets_at, now).split(" ")[0];
}
// A window's used share, coloured as the meters are; "reset" once its reset time has passed. Near the
// limit (LOAD.limit's full, red) the time it resets follows the share.
const nearLimit = (limit, now = Date.now()) => typeof limit?.used_percentage === "number" && limit.resets_at && limit.resets_at * 1000 > now && limit.used_percentage >= LOAD.limit[1];
function limitText(t, kind, label, limit, now = Date.now()) {
  const used = limit?.used_percentage;
  if (typeof used !== "number") return null;
  const reset = limit.resets_at && limit.resets_at * 1000 <= now;
  const skinned = skinMeter(t, { kind, label, value: used, scale: LOAD.limit, reset: Boolean(reset) });
  if (skinned) return skinned;
  const near = nearLimit(limit, now);
  return h_flex().flex_none().gap(4).child(div().child(label))
    .child(skinFont(div(), "numbers").text_color(reset ? t.dim : loadColor(t, used, LOAD.limit)).child(reset ? "reset" : `${Math.round(used)}%`))
    .when(Boolean(near), (el) => el.child(skinFont(div(), "numbers").text_color(t.muted).child(resetShort(limit, now))));
}
function workClaude(t, accounts, profile) {
  const shown = accounts.find((a) => claudeKey(a.config) === claudeKey(claudeConfigOf(profile))) ?? null;
  if (!shown) return [];
  const since = (at) => { const a = ago(at * 1000); return a === "now" ? "just now" : `${a} ago`; };
  // A small table row: the account on the left (truncating), then a 5h and a Week column of fixed
  // width, so whatever a skin draws in them lines up. The model and how old the figures are go in the
  // name's tip.
  const COL = 92;
  // Each column's tip says when its window resets. One near its limit, with the reset time beside the
  // share, may grow past COL (the account name truncates first).
  const cell = (id, el, limit) => h_flex().id(id).map((x) => (nearLimit(limit) ? x.min_w(COL) : x.w(COL).overflow_hidden())).flex_none().justify_end()
    .when(Boolean(el && resetTip(limit)), (x) => x.tooltip(resetTip(limit))).child(el ?? div());
  return [h_flex().h(20).flex_none().gap(6).items_center().min_w(0)
    .child(skinFont(div().id("acct").flex_1().min_w(0).truncate().text_color(t.muted), "footer", SMALL)
      .tooltip([shown.account, shown.model, since(shown.at)].filter(Boolean).join(" \u00b7 ")).child(skinText(shown.account, "footer")))
    .child(cell("acct-five", limitText(t, "five", "5h", shown.five_hour), shown.five_hour))
    .child(cell("acct-week", limitText(t, "week", "Week", shown.seven_day), shown.seven_day))];
}

function sidebar(state) {
  const t = theme();
  const row = (id, on) => h_flex().id(id).h(ROW).flex_none().px(10).gap(8).items_center().rounded(8).cursor_pointer()
    .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)));
  const list = agents();
  const tabs = spaces().flatMap((s) => s.tabs);
  return v_flex().size_full().min_h(0).px(8).pb(8).text_size(TEXT).text_color(t.foreground)
    .child(v_flex().id("kelpie-list").flex_1().min_h(0).overflow_y_scrollbar()
      .child(section(t, "Spaces", iconButton(t, "space-new", chrome("plus"), () => run("space.new"), "New space")))
      // Each space with its agents nested under it, so what belongs where needs no label.
      .children(spaces().flatMap((s) => {
        const members = list.filter((a) => a.space === s.id);
        return [
          row(`space-${s.id}`, s.active && !members.some((a) => a.focused))
            .on_click(() => run("space.select", { id: s.id }))
            .on_mouse_down("right", () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: s.id } } }))
            .child(icon(chrome(s.machine ? "server" : "folder")).text_color(s.active ? t.accent : t.dim))
            .child(div().flex_1().min_w(0).truncate().child(s.name)),
          ...members.map((a) => {
            const name = agentName(a, tabs.find((c) => c.id === a.tab));
            const pic = programIcon(a.program, t.muted);
            return row(`agent-${a.address}`, a.focused).pl(26).tooltip(name)
              .on_click(() => run("pane.focus", { pane: a.pane }))
              .when(Boolean(pic), (el) => el.child(pic))
              .child(div().flex_1().min_w(0).truncate().text_color(a.status === "idle" && !a.focused ? t.muted : t.foreground).child(name))
              .when(Boolean(status(t, a.status)), (el) => el.child(status(t, a.status)));
          }),
        ];
      })))
    .child(footer(t, state));
}

// The toolbar's Claude and Terminal (and their keys): in a story, the story's own; elsewhere a tab in
// the shown space's folder.
function newClaude(work = storyNow(), space = spaces().find((s) => s.active)) {
  if (work?.story) return work.claude();
  if (space && !profileElsewhere()) newTab({ space: space.id, folder: liveFolder(space), argv: claudeArgv(shownProfile()) });
}
function newTerminal(work = storyNow(), space = spaces().find((s) => s.active)) {
  if (work?.story) return work.terminal();
  if (space && !profileElsewhere()) newTab({ space: space.id, folder: liveFolder(space), argv: shellArgv(shownProfile()) });
}

// Closing a tab (its ✕, cmd-w): the last tab of a space closes the space, so that asks first, in words
// that say what happens; any other tab closes at once. A story's space is paused by default (its
// agents' sessions kept as paused, as the header's Pause does), or just closed.
function closeTab(id) {
  const space = spaces().find((s) => s.tabs.some((c) => c.id === id));
  if (!space || space.tabs.length > 1) return run("tab.close", { id });
  const key = storyKeyOf(space);
  const close = { name: "tab.close", args: { id, confirmed: true } };
  openOverlay({ mod: MOD, kind: "dialog", width: 440, height: 170, props: key
    ? { role: "confirm", title: `Leave ${key}?`, yes: "Pause", command: { name: `${MOD}.pause-story-${key}` }, alt: { label: "Close", command: close },
      detail: "Pause keeps its agents' sessions, to Resume from the story list. Close just closes its space." }
    : { role: "confirm", title: `Close ${space.name}?`, yes: "Close", command: close,
      detail: isDesk(space) ? "It's the Desk's last tab, so the Desk closes with it. It opens again from the sidebar or ⌥⌘D." : "It's the space's last tab, so the space closes with it." } });
}

// The toolbar's open menu (ui.js menuButton keeps it here: the toolbar is a function, not a view).
const toolbarMenu = {};

// Dragging a tab to another place in the bar: press on a tab, move a few pixels, let go on another
// tab, and it goes before or after it (whichever half the pointer is over), by tab.move. Kept here as
// the toolbar has no view of its own; one drag at a time, so the copies sharing it don't matter.
// `hover` is the tab under the pointer, which shows its ✕.
const tabDrag = { id: null, space: null, x: 0, moved: false, over: null, side: null, hover: null };
function tabDragEnd() { Object.assign(tabDrag, { id: null, space: null, moved: false, over: null, side: null }); }
function tabDragOver(c, e, cx) {
  if (!tabDrag.id) return;
  const moved = tabDrag.moved || Math.abs(e.position.x - tabDrag.x) > 4;
  const side = e.local_position.x < e.bounds.width / 2 ? "before" : "after";
  if (moved === tabDrag.moved && tabDrag.over === c.id && tabDrag.side === side) return;
  Object.assign(tabDrag, { moved, over: c.id, side });
  cx.notify();
}
function tabDrop(space, cx) {
  const { id, moved, over, side, space: home } = tabDrag;
  tabDragEnd();
  cx.notify();
  if (!id || !moved || !over || over === id || space.id !== home) return;
  const from = space.tabs.find((c) => c.id === id)?.index;
  const to = space.tabs.find((c) => c.id === over)?.index;
  if (!from || !to) return;
  // tab.move takes the position the tab ends up at (1 = first), counted after it has left its own.
  const index = from < to ? (side === "before" ? to - 1 : to) : (side === "before" ? to : to + 1);
  if (index !== from) run("tab.move", { id, index });
}

// Following the shown space (a story space closing, the profile, the panel, the skin's hour) runs in
// one shown copy only: the footer, or while the sidebar (and so the footer) is hidden (cmd-b), the tab
// bar that's shown ("toolbar" in "lower", or "toolbar-start", props slot "start"). Hidden copies don't
// redraw, so they'd miss a close. A copy that takes over first notes what's shown, so what it
// remembered from before can't be taken for a change. Which copy leads is shared ("kelpie.tracker"):
// copies may share one JavaScript context (then a module flag is written by every copy, the ones not
// leading too) or not (then a hidden copy's flag goes stale), and neither may restart the leader.
const TRACKER = "kelpie.tracker";
let started = false; // this context has noted what's shown
function track(role) {
  const root = layout();
  const slot = props()?.slot === "start" ? "start" : "";
  const lead = !sideHidden(root) ? role === "footer"
    : role === "toolbar" && (slot ? !find(root, "toolbar-start")?.hidden : !find(root, "lower")?.hidden);
  if (!lead) return;
  const me = `${role}${slot}`;
  if (!started || shared(TRACKER) !== me) {
    started = true;
    if (shared(TRACKER) !== me) setShared(TRACKER, me);
    syncTracking(true);
    syncPanel(true);
    return;
  }
  syncTracking();
  syncPanel();
  syncSkin();
}


function toolbar() {
  syncHub();
  track("toolbar");
  const t = skinTheme();
  const space = spaces().find((s) => s.active);
  const all = panes();
  const root = layout();
  const panel = find(root, "panel");
  const body = find(root, "panel-body");
  // On a story's space the key goes without saying: "ABC-1 terminal" shows as "Terminal", a tab named
  // just the key as "Agent". Only what's drawn changes, never the tab's name.
  const work = storyNow();
  const label = (name) => {
    const key = work?.story?.key;
    if (!key || (name !== key && !name.startsWith(`${key} `))) return name;
    const rest = name.slice(key.length).replace(/^[\s:·-]+/, "");
    return name === key ? "Agent" : rest ? capitalize(rest) : name;
  };
  const tab = (c) => {
    const agentPane = all.find((p) => p.tab === c.id && p.program?.agent);
    const program = agentPane?.program ?? all.find((p) => p.tab === c.id)?.program;
    // A Claude agent's tab shows its session's name (the title Claude gives its terminal), once it has
    // one; until then, and for other tabs, the tab's own name (kept in the tip).
    const session = sessionTitle(agentPane?.title);
    const name = session ?? (c.named ? label(c.name) : program?.name ?? `Tab ${c.index}`);
    const agentTab = all.some((p) => p.tab === c.id && p.program?.agent);
    const mark = c.status ? statusMark(t, agentState(c.status), { where: "tab", size: 12, color: t[c.status] }) : null;
    // Every tab is the same boxes, shown or hovered or not, so the bar never shifts: 10px padding, a
    // 16px slot, a 6px gap, the name (180px at most), 10px padding. The slot holds the agent's mark,
    // else the program's icon, and turns into the ✕ while the pointer is on the tab (⌘W closes the
    // shown one).
    const closable = tabDrag.hover === c.id && !tabDrag.moved;
    const sign = closable
      ? div().id(`close-${c.id}`).flex().size_full().items_center().justify_center().rounded(4).cursor_pointer().text_color(t.muted)
        .hover((x) => x.bg(t.border).text_color(t.foreground)).on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); closeTab(c.id); }).child(icon(chrome("x"), 12))
      : mark ?? status(t, c.status) ?? programIcon(program, c.active ? t.foreground : t.dim);
    const dragged = tabDrag.moved && tabDrag.id === c.id;
    const target = tabDrag.moved && tabDrag.over === c.id && tabDrag.id !== c.id ? tabDrag.side : null;
    return decor("tabDecor", t, h_flex().id(`tab-${c.id}`).relative().h(CONTROL).flex_none().px(10).gap(6).items_center().rounded(8).cursor_pointer()
      .when(c.active, (el) => el.bg(t.selected).text_color(t.foreground))
      .when(!c.active, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .when(dragged, (el) => el.opacity(0.5))
      .on_hover((on, cx) => { const was = tabDrag.hover; tabDrag.hover = on ? c.id : was === c.id ? null : was; if (tabDrag.hover !== was) cx.notify(); })
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        if (e.click_count === 2) return run("tab.rename", { id: c.id });
        Object.assign(tabDrag, { id: c.id, space: space.id, x: e.position.x, moved: false, over: null, side: null });
      })
      .on_mouse_move((e, cx) => tabDragOver(c, e, cx))
      .on_mouse_up("left", (_e, cx) => tabDrop(space, cx))
      .on_click(() => run("tab.select", { id: c.id }))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
      .when(name !== c.name && (c.named || Boolean(session)), (el) => el.tooltip(c.named ? c.name : `${program?.name ?? "Tab"}: ${name}`))
      .child(div().flex().flex_none().size(16).items_center().justify_center().when(Boolean(sign), (el) => el.child(sign)))
      .child(skinFont(div().max_w(180).truncate(), "tab").child(skinText(name, "tab")))
      // Where a dragged tab would land: a line in the gap at this tab's left or right edge; before the
      // first tab, just inside it, as the list clips anything left of its start.
      .when(Boolean(target), (el) => el.child(div().absolute().top(4).bottom(4).w(2).rounded(1).bg(t.accent)
        .when(target === "before", (x) => x.left(shownTabs[0]?.id === c.id ? 0 : -3)).when(target === "after", (x) => x.right(-3)))),
      { tab: c, name, active: Boolean(c.active), state: agentState(c.status), agentTab, now: new Date() });
  };
  // The side panels, as icons (the open one selected), each only when the layout's panel has it.
  const panelButton = (id, path, tip) => {
    const child = id === "web" ? webChild(root) : id;
    if (id === "web" ? !webSlots(body).length : !find(body, id)) return null;
    const on = Boolean(panel && !panel.hidden && child && body?.active === child);
    return iconButton(t, `panel-${id}`, path, () => togglePanel(id).catch(() => {}), tip, { on });
  };
  // In a story's space: its tabs, then the story's other views. A story previewed from the list (not
  // open) has no tabs yet: its Overview, and Changes and Screenshots only when they hold something.
  const view = (id, label, n) => {
    const on = work?.view === id;
    return decor("controlDecor", t, h_flex().id(`view-${id}`).h(CONTROL).flex_none().px(10).gap(6).items_center().rounded(8).cursor_pointer()
      .when(on, (el) => el.bg(t.selected).text_color(t.foreground)).when(!on, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .on_mouse_down("left", stop).on_click(() => work.show(id))
      .child(skinFont(div(), "tab").child(skinText(label, "tab"))).when(typeof n === "number" && n > 0, (el) => el.child(skinFont(div().text_color(t.dim), "count", SMALL).child(skinText(String(n), "count")))),
    { kind: "view", id: `view-${id}`, label, on });
  };
  // One + icon, a menu that opens a tab (an icon, so it doesn't read as a tab): Claude or Terminal,
  // the Kelpie layout's keys beside them.
  const keyed = Boolean(find(root, "story-head"));
  const create = (claudeTip, terminalTip) => menuButton(toolbarMenu, t, "open-new", "+ New ▾", [
    { label: "Claude", hint: keyed ? "⌥⌘C" : "", tip: claudeTip, action: () => newClaude(work, space) },
    { label: "Terminal", hint: keyed ? "⌥⌘T" : "", tip: terminalTip, action: () => newTerminal(work, space) },
  ], { tip: "New Claude or terminal", anchor: "top_left", width: 220, iconPath: chrome("plus") });
  const has = (n) => typeof n === "number" && n > 0;
  const changes = !work?.preview || has(work?.prs) || has(work?.files);
  const shots = !work?.preview || has(work?.shots);
  const shownTabs = work?.preview || profileElsewhere() ? [] : (space?.tabs ?? []).map((c) => ({ ...c, active: c.active && (!work || work.view === "agent") }));
  // The sidebar hidden (cmd-b): a button to bring it back, after room for the window buttons when the
  // tab bar is the top block (no story header above it).
  const sideOff = sideHidden(root);
  const topmost = !find(root, "story-head") || Boolean(find(root, "story-head")?.hidden);
  return decor("blockDecor", t, h_flex().size_full().min_w(0).gap(4).items_center().text_size(TEXT)
    .when(sideOff && topmost, (el) => el.pl(buttonsRoom()))
    .when(sideOff, (el) => el.child(iconButton(t, "side-show", chrome("sidebar"), toggleSide, "Show the sidebar ⌘B")))
    .child(h_flex().id("tab-list").flex_1().min_w(0).h_full().gap(2).items_center().overflow_x_scrollbar()
      // A drag that leaves the bar, or is let go between tabs, ends without moving anything.
      .on_hover((on, cx) => { if (!on && tabDrag.id) { tabDragEnd(); cx.notify(); } })
      .on_mouse_up("left", (_e, cx) => { if (tabDrag.id) { tabDragEnd(); cx.notify(); } })
      .children(shownTabs.map((c) => (work ? tab(c).on_click(() => { run("tab.select", { id: c.id }); work.show("agent"); }) : tab(c))))
      // Outside a story: a Claude agent with no task, or a shell, as a new tab in the shown space's folder.
      .when(!work?.story && Boolean(space) && !profileElsewhere(), (el) => el
        .child(create("A Claude agent with no task, in this space's folder", "A shell in this space's folder")))
      .when(Boolean(work?.story), (el) => el
        // A pull request shown on its own (a review, one of yours with no ticket) has no Overview.
        .when(work.preview && !work.review, (x) => x.child(view("start", "Overview")))
        // A review has no space of its own: its agent goes to the Reviews space (Start review).
        .when(!work.review, (x) => x
          .child(create("A Claude agent for this story with no task, in the profile's folder", "A plain shell for this story")))
        // The line between the tabs (and +) and the views; a pull request on its own has nothing before them.
        .when((changes || shots) && !work.review, (x) => x.child(div().w(1).h(16).mx(4).flex_none().bg(t.border)))
        .when(changes, (x) => x.child(view("changes", "Changes", work.files)))
        .when(shots && !work.review, (x) => x.child(view("shots", "Screenshots", work.shots)))))
    // In the Kelpie layout, a space whose Hub shows nothing keeps a way back to its setup.
    .when(hubHidden(), (el) => el.child(h_flex().id("hub-setup").h(CONTROL).flex_none().px(10).gap(6).items_center().rounded(8).cursor_pointer()
      .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(`Choose what ${space?.name ?? "this space"}'s Hub shows`)
      .on_mouse_down("left", stop).on_click(() => openSetup(space)).child("Hub")))
    .child(h_flex().flex_none().gap(2).items_center()
      .children([panelButton("files", chrome("folder"), "Files"), panelButton("changes", chrome("git-compare"), "Changes"),
        panelButton("artifacts", chrome("layers"), "Artifacts"), panelButton("web", own("globe"), "Web ⌘⇧S")].filter(Boolean))
      // While the profile's browser shows: restart it when stuck, or sign it out of every site.
      .when(Boolean(panel && !panel.hidden) && body?.active === webChild(root), (el) => el.child(menuButton(toolbarMenu, t, "web", "", [
        { label: "Restart browser", tip: "For a stuck page: stops this profile's browser and opens it again on a blank page. Sign-ins stay.", action: () => resetBrowser(false).catch(() => {}) },
        { label: "Sign out of all sites", careful: true, tip: "Clears this profile's cookies and site data, then opens its browser again. Other profiles keep theirs.", action: () => resetBrowser(true).catch(() => {}) },
      ], { tip: "Browser", anchor: "top_right", width: 240, iconPath: own("ellipsis") })))), { role: "toolbar", now: new Date(), story: work?.story ?? null });
}

// The Web panel (Kelpie layout): a browser per profile, each in a slot of the panel, a block showing
// the core terminal named after the slot ("web", "web-1", …). A slot goes to a profile the first time
// it opens the panel and stays its own (shared WEB `slots`), so its tabs and sign-ins stay while it
// runs. A browser starts with the tab and address bars, on the profile's start page (`web.home`).
// kittyfix.py rewrites its kitty graphics so Herdr draws them without stale tiles or blinks
// (needs `terminal-browser config set render.presenter patched`). Herdr keeps a slot whose terminal
// hasn't started, or has ended, in the layout.
const WEB = "kelpie.web"; // { slots: { [profile id]: slot id }, panels: { [profile id]: { open, child } } }
const SLOTS = ["web", "web-1", "web-2", "web-3"];
const webSlots = (body) => SLOTS.filter((id) => find(body, id));
const isSlot = (id) => SLOTS.includes(id);
const profileKey = () => shownProfile()?.id ?? "none";
const quote = (text) => `'${text.replace(/'/g, `'\\''`)}'`;
// terminal-browser runs every window in one background process (its socket under XDG_RUNTIME_DIR),
// with one cookie folder (TERMINAL_BROWSER_APPDATA) and one store of history and the last page it
// reopens (XDG_DATA_HOME): each profile's browser gets its own of all three, so signing in or out
// in one leaves the others, and none shares terminal-browser's own defaults. Without python3 it runs
// without kittyfix.py (Herdr's image glitches return; the browser still works).
export const profileDir = () => (shownProfile()?.id ?? "none").replace(/[^A-Za-z0-9_-]/g, "-");
const browserCommand = (url, python) => {
  const dir = `$HOME/.local/share/kelpie/web/${profileDir()}`;
  const env = `env XDG_RUNTIME_DIR="${dir}/run" TERMINAL_BROWSER_APPDATA="${dir}/data" XDG_DATA_HOME="${dir}/share" `;
  const fix = python ? `python3 ${quote(modFile("kittyfix.py"))} -- ` : "";
  return `mkdir -p "${dir}/run" "${dir}/data" "${dir}/share" && ${fix}${env}terminal-browser${url ? ` ${quote(url)}` : ""}`;
};

// The shown profile's slot (made its own when `assign`, from the free ones or ones of deleted
// profiles), or null.
function webChild(root = layout(), assign = false) {
  const slots = webSlots(find(root, "panel-body"));
  if (slots.length < 2) return slots[0] ?? null;
  const web = shared(WEB) ?? {};
  const known = new Set([...profiles().map((p) => p.id), "none"]);
  const map = Object.fromEntries(Object.entries(web.slots ?? {}).filter(([p, s]) => known.has(p) && slots.includes(s)));
  const me = profileKey();
  if (map[me] || !assign) return map[me] ?? null;
  const taken = new Set(Object.values(map));
  const free = slots.find((s) => !taken.has(s));
  if (!free) return null;
  setShared(WEB, { ...web, slots: { ...map, [me]: free } });
  return free;
}

// The slot's terminal runs the browser in a loop of its own,
// nothing typed: each round first clears what a browser that was killed leaves behind (its keyboard
// mode, its images on screen), then starts it, and starts it again 2 s after it ends. So restarting
// a stuck browser is just ending its processes. Typing into the user's own shell broke (a shell like
// zsh-vi-mode garbles what arrives in the browser's leftover keyboard mode). A slot still holding an
// old shell is replaced once, while the panel shows something else: Herdr rewrites the layout file
// (stripped, the panel column folded) when a shown terminal is killed or removed.
// (kittyfix.py sends the same reset itself, so a restart needn't wait for a new loop).
const browserLoop = (command) =>
  `while :; do printf '\\033\\\\\\033_Gq=2,m=0;\\033\\\\\\033[=0;1u\\033_Ga=d,d=A,q=2\\033\\\\'; clear; ${command}; sleep 2; done`;
async function ensureBrowser(name, command) {
  const term = terminals().find((x) => x.name === name && x.state === "live");
  let address = term?.address;
  // A slot terminal not running the loop (an older one, a shell or a browser typed into it) is
  // replaced once; its browser's sign-ins are in the profile's folder, so they stay.
  const looping = term ? await hc(["get", name]).then((r) => (JSON.parse(r.stdout || "{}").argv ?? []).join(" ").includes("while :")).catch(() => false) : false;
  if (!looping) {
    if (term) {
      const other = (find(layout(), "panel-body")?.children ?? []).find((c) => !isSlot(c.id));
      if (other) run("layout.select", { stack: "panel-body", child: other.id });
      await exec("sleep", ["0.3"]);
      await hc(["kill", name]).catch(() => {});
      await exec("sleep", ["0.5"]);
    }
    const started = await hc(["run", "--bg", "--json", "--name", name, "--no-parent", "--outlive-parent", "--", "/bin/sh", "-c", browserLoop(command)]);
    address = JSON.parse(started.stdout || "{}").address;
  }
  // Right-clicks go to the browser's own menu (shift+right-click is still Herdr's).
  if (address) run("terminal.right_click", { to: "program", terminal: address });
}

// Restarts the shown profile's browser: ends its processes (kittyfix and Electron, found by its own
// folder, so no other profile's; never the loop's shell, whose command names that folder too: its
// terminal would end while shown), forgets the page it would reopen (a stuck one would freeze it again),
// and with `signOut` deletes its cookies and site data; then the panel starts it again.
export async function resetBrowser(signOut) {
  const root = layout();
  const slot = webChild(root);
  const id = profileDir();
  if (!slot) return;
  await exec("sh", ["-c", `d="$HOME/.local/share/kelpie/web/$1"
    p="[Pp]ython[^ ]* [^ ]*kittyfix[.]py -- .*kelpie/web/$1/|user-data-dir=$d/"
    pkill -f "$p"; sleep 1; pkill -9 -f "$p"
    [ "$2" = 1 ] && rm -rf "$d/data"
    for db in "$d"/share/*/terminal-browser.db; do [ -f "$db" ] && sqlite3 "$db" "delete from app_state where key='last-url'" 2>/dev/null; done; true`, "sh", id, signOut ? "1" : "0"]);
  // Its terminal's loop starts it again (see ensureBrowser).
  await showPanel(slot, webSlots(find(root, "panel-body")).length);
  notify({ title: signOut ? "Signed out of every site" : "Browser restarted", body: shownProfile()?.name ? `In ${shownProfile().name}'s browser.` : "", level: "info", timeout: 4000 });
}

// Shows a panel child; a browser is started first if needed, and its page zoom reset once shown:
// unshown, herdr-core puts the terminal at its headless 200x120, and terminal-browser takes each such
// resize for a font change and rescales the page (ctrl+0; cmd+0 is Herdr's).
async function showPanel(child, slots) {
  if (isSlot(child)) {
    // Nothing runs there yet: say what's missing instead of leaving "command not found" in the panel.
    const running = terminals().some((x) => x.name === child && x.state === "live" && !x.program?.shell);
    const has = running ? "bp" : (await exec("sh", ["-c", "command -v terminal-browser >/dev/null && echo b; command -v python3 >/dev/null && echo p; true"]).catch(() => ({ stdout: "" }))).stdout;
    if (!has.includes("b")) return notify({ title: "Web needs terminal-browser", body: "Install it, then run once: terminal-browser config set render.presenter patched", level: "warning", timeout: 10000 });
    await ensureBrowser(child, browserCommand(shownProfile()?.web?.home ?? "", has.includes("p")));
  }
  run("layout.select", { stack: "panel-body", child });
  run("layout.show", { id: "panel" });
  if (isSlot(child)) { await exec("sleep", ["0.6"]); await hc(["keys", child, "ctrl+0"]); }
}

async function togglePanel(id) {
  const root = layout();
  const panel = find(root, "panel");
  const slots = webSlots(find(root, "panel-body")).length;
  const child = id === "web" ? webChild(root, true) : id;
  if (!child) return notify({ title: "Every browser slot is taken", body: `The layout has ${slots}, each kept by a profile.`, level: "warning", timeout: 5000 });
  if (panel && !panel.hidden && find(root, "panel-body")?.active === child) return run("layout.hide", { id: "panel" });
  await showPanel(child, slots);
}

// terminal-browser takes a size change of its terminal (another display, a resized window or panel)
// for a font change and rescales the page, so it ends up smaller or larger. Herdr doesn't tell mods
// a terminal's size: the footer asks herdr-core every few seconds while a browser shows, and resets
// the page zoom (ctrl+0) once a new size has settled. 200x120 is herdr-core's size for an unshown one.
const browserSize = {}; // slot -> "colsxrows" last seen
async function watchBrowserSize() {
  const root = layout();
  const body = find(root, "panel-body");
  const panel = find(root, "panel");
  if (!panel || panel.hidden || !isSlot(body?.active)) return;
  const slot = body.active;
  const d = JSON.parse((await hc(["get", slot])).stdout || "{}");
  if (!d.cols || d.state !== "live" || (d.cols === 200 && d.rows === 120)) return;
  const now = `${d.cols}x${d.rows}`;
  const was = browserSize[slot];
  browserSize[slot] = now;
  if (was && was !== now) { await exec("sleep", ["0.6"]); await hc(["keys", slot, "ctrl+0"]); }
}

// Each profile keeps whether the panel is open and what it shows: switching profile saves the one
// left and brings back the one shown. Runs in the always-shown footer (its own copy's memory).
let panelProfile;
function syncPanel(baseline = false) {
  if (baseline) { panelProfile = profileKey(); return; }
  const root = layout();
  const body = find(root, "panel-body");
  const panel = find(root, "panel");
  if (!panel || webSlots(body).length < 2) return;
  const me = profileKey();
  // Never another profile's browser: one shown (after a restored layout, say) gives way to this
  // profile's own, or the panel closes.
  if (!panel.hidden && isSlot(body.active) && body.active !== webChild(root) && (panelProfile === undefined || panelProfile === me)) {
    const own = webChild(root);
    if (own) showPanel(own, webSlots(body).length).catch(() => {}); else run("layout.hide", { id: "panel" });
  }
  if (panelProfile === undefined || panelProfile === me) { panelProfile = me; return; }
  const web = shared(WEB) ?? {};
  const panels = { ...(web.panels ?? {}), [panelProfile]: { open: !panel.hidden, child: body.active } };
  panelProfile = me;
  setShared(WEB, { ...web, panels });
  const want = panels[me];
  // A child the layout no longer has (a slot renamed, say) shows nothing.
  const child = want?.open ? (isSlot(want.child) ? webChild(root) : find(body, want.child) ? want.child : null) : null;
  if (child) showPanel(child, webSlots(body).length).catch(() => {});
  else if (!panel.hidden) run("layout.hide", { id: "panel" });
}

let lastCommand = {}; // { c, at }: the last key command this copy ran

async function command(c) {
  if (["files", "changes", "artifacts", "web"].includes(c)) return togglePanel(c);
  if (c === "refresh") return setShared(REFRESH, Date.now());
  if (c === "close") { const tab = focused()?.tab; return tab && closeTab(tab); }
  if (c === "claude") return newClaude();
  if (c === "terminal") return newTerminal();
  if (c === "new-space") return newSpace();
  if (c === "desk") return goDesk();
  if (c === "next-need") return nextNeed();
  if (c === "stories") return openStoryPicker();
  if (c === "show-notified" || c.startsWith("show-notified-")) return showNotified(c.slice("show-notified-".length));
  // From outside (herdr-app do kelpie.profile-<id> / kelpie.preview-<KEY>): pick a profile as its menu
  // does; show a story of the shown profile, its space or a preview.
  // claude-<profile id>--<folder in home> asks to set that profile's Claude account (".claude": Claude's
  // own, nothing set), for scripts such as a one-off folder move; the person confirms it in a dialog.
  if (c.startsWith("claude-") && c.includes("--")) {
    const [id, dir] = [c.slice("claude-".length, c.indexOf("--")), c.slice(c.indexOf("--") + 2)];
    const p = profiles().find((x) => x.id === id);
    if (!p || !/^\.claude[\w.-]*$/.test(dir)) return;
    const home = (await exec("sh", ["-c", 'printf %s "$HOME"'])).stdout;
    // The Claude account is one of the settings that wait for the person's yes (CONFIRM_KEYS): this
    // command can be run by any agent, so it asks the same way an agent's profile change does.
    return requestProfileChange(id, { claude: dir === ".claude" ? null : { config: `${home}/${dir}` } });
    return;
  }
  // apply-profile: an agent's change to a profile, from a file (guides/profile-setup.md, "Saving").
  if (c === "apply-profile") return applyProfileRequest();
  // edit-profile opens the shown profile's dialog, edit-profile-<tab> on that tab (setup.js TABS).
  if (c === "edit-profile" || c.startsWith("edit-profile-")) { const p = shownProfile(); return p ? openProfile(p.id, { focus: c.slice("edit-profile-".length) || undefined }) : undefined; }
  if (c.startsWith("profile-")) { const p = profiles().find((x) => x.id === c.slice("profile-".length)); return p ? switchProfile(p) : undefined; }
  if (c.startsWith("preview-")) return showStoryByKey(c.slice("preview-".length));
  if (c.startsWith("pause-story-")) return pauseStoryByKey(c.slice("pause-story-".length));
  if (c.startsWith("clean-story-")) return cleanStoryByKey(c.slice("clean-story-".length));
  if (c === "clean-all") return cleanAll();
  // what-next: Claude, in the background, fills Next's queue with suggestions (the magic button).
  if (c === "what-next") return whatNext();
  // demo: the demo profile and its spaces, from mods/kelpie/demo/demo.json (demo.js); demo-remove undoes it.
  if (c === "demo-remove") return removeDemo().catch((e) => notify({ title: "The demo wasn't removed", body: String(e?.message ?? e).slice(0, 300), level: "error", timeout: 8000 }));
  if (c === "demo") return setupDemo().catch((e) => notify({ title: "The demo didn't open", body: String(e?.message ?? e).slice(0, 300), level: "error", timeout: 8000 }));
  const work = storyNow();
  if (!work?.story) return;
  if (c === "start") return work.start();
  if (c === "pause") return work.pause();
  if (c === "fold") return work.fold();
  // "view-agent", "view-changes", "view-shots", "view-start": the tab bar's view buttons.
  if (c.startsWith("view-")) return work.show(c.slice("view-".length));
}

// The Kelpie layout's Hub roles (work.js) are views of their own.
const ROLES = { top, sidebar, toolbar };
const STATS_ROLES = ["sidebar", "footer"];

export default class Quiet extends View {
  init(_props, cx) {
    // A skin's animations (skins/index.js tick): this copy redraws as often as its skin asks for its role.
    const tick = skinTick(props()?.role ?? "sidebar");
    if (tick) cx.timer.every(Math.max(100, tick), (cx) => cx.notify());
    const Work = WORK_ROLES[props()?.role];
    if (Work) {
      this.work = new Work();
      this.work.init(cx);
      return;
    }
    // Keys: "kelpie.files", "kelpie.changes", "kelpie.artifacts", "kelpie.web" toggle that panel;
    // "kelpie.refresh" loads the Kelpie layout's stories again (its Hub strip, which had it, is gone);
    // "kelpie.close" closes the focused tab as its ✕ does. The Kelpie layout's story keys: "next-need",
    // "start", "pause", "claude", "terminal", "fold", "stories" (the picker), "show-notified"
    // (a pull request notification's click), "pause-story-<key>" (the close dialog's Pause) and
    // "clean-story-<key>" (the clean-up dialog's Clean up), "clean-all" (the list's Clean up all).
    if (props()?.role === "toolbar") cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        // Herdr sends a key to shown copies only, and the layout shows one toolbar at a time, so
        // this copy alone hears it. A key repeated within a moment (a double delivery) is left, so a
        // toggle doesn't undo itself; kept here, not in shared state, which would redraw every copy.
        if (lastCommand.c === c && Date.now() - lastCommand.at < 150) continue;
        lastCommand = { c, at: Date.now() };
        try {
          await command(c);
        } catch (e) {
          console.log(`kelpie ${c}: ${e}`);
        }
      }
    });
    if (!STATS_ROLES.includes(props()?.role ?? "sidebar")) return;
    this.stats = { cpu: null, mem: null };
    // The mod's own icons draw only from a real folder (Herdr draws no SVG reached through a symlinked
    // mod folder, as stow makes it): copy any that are missing or changed to art/<mod>/icons, where
    // own() points. Once per start, here in the sidebar or footer, which every layout of this mod has.
    cx.spawn(async () => {
      await exec("sh", ["-c", 'mkdir -p "$2" && for f in "$1"/*.svg; do cmp -s "$f" "$2/${f##*/}" || cp "$f" "$2/"; done', "sh", modFile("icons"), `${appHome()}/art/${MOD}/icons`]).catch(() => {});
      // The skins' art the same way (skins/<name>/art -> art/<mod>/skins/<name>), and their fonts to
      // Herdr's fonts/: skins/copy-art.sh, which install.sh runs too.
      await exec("sh", [modFile("skins/copy-art.sh"), modFile("skins"), `${appHome()}/art/${MOD}/skins`, `${appHome()}/fonts`]).catch(() => {});
    });
    this.claude = {}; // agent address -> what claude-statusline.sh saved for it, so switching back shows at once
    this.poll(cx);
    cx.timer.every(POLL, (cx) => this.poll(cx));
    if (props()?.role === "footer") cx.timer.every(3000, () => { watchBrowserSize().catch(() => {}); });
    // The clock moves even when nothing else does.
    cx.timer.every(15000, (cx) => cx.notify());
  }

  poll(cx) {
    if (props()?.role !== "footer") this.fetchClaude(cx, this.agent);
    else { if (this.agent) this.fetchClaude(cx, this.agent); this.fetchAccounts(cx); }
    if (this.polling) return;
    this.polling = true;
    cx.spawn(async (cx) => {
      try {
        const [cpu, mem] = (await exec("sh", ["-c", STATS])).stdout.trim().split(" ").map(Number);
        const next = { cpu: Number.isFinite(cpu) ? cpu : null, mem: Number.isFinite(mem) ? mem : null };
        if (next.cpu !== this.stats.cpu || next.mem !== this.stats.mem) { this.stats = next; cx.notify(); }
      } catch (e) {
        console.log(`kelpie stats: ${e}`);
      } finally {
        this.polling = false;
      }
    });
  }

  // The Kelpie footer's accounts (claudeAccounts), every few polls: each account's latest known limits.
  fetchAccounts(cx) {
    if (this.loadingAccounts || Date.now() - (this.accountsAt ?? 0) < 15000) return;
    this.loadingAccounts = true;
    cx.spawn(async (cx) => {
      try {
        const list = await claudeAccounts();
        this.accountsAt = Date.now();
        if (JSON.stringify(list) !== JSON.stringify(this.accounts ?? [])) { this.accounts = list; cx.notify(); }
      } catch (e) {
        console.log(`kelpie accounts: ${e}`);
      } finally {
        this.loadingAccounts = false;
      }
    });
  }

  fetchClaude(cx, address) {
    if (!address || this.fetching?.has(address)) return;
    (this.fetching ??= new Set()).add(address);
    cx.spawn(async (cx) => {
      try {
        const info = await claudeInfo(address);
        if (JSON.stringify(info) !== JSON.stringify(this.claude[address] ?? null)) {
          this.claude[address] = info;
          cx.notify();
        }
      } catch (e) {
        console.log(`kelpie claude: ${e}`);
      } finally {
        this.fetching.delete(address);
      }
    });
  }

  render(cx) {
    if (this.work) return this.work.render(cx);
    const role = props()?.role ?? "sidebar";
    if (!STATS_ROLES.includes(role)) return (ROLES[role] ?? sidebar)();
    // The footer is always shown, so it keeps the Kelpie layout in step with the shown space too (the
    // tab bar does as well, but it can be hidden: then nothing else would bring it back).
    // It also follows the shown space for the rest (syncTracking): a hidden copy would miss a close.
    if (role === "footer") { track("footer"); syncHub(); }
    if (role === "footer") {
      // The active profile's account and limits (workClaude), whatever has focus.
      const t = skinTheme();
      const lines = workClaude(t, isDemo(shownProfile()) ? demoAccounts() : this.accounts ?? [], shownProfile());
      const scene = sidebarFoot(t, { now: new Date() });
      return decor("blockDecor", t, v_flex().size_full().justify_end().px(8).pb(8).text_size(TEXT)
        .when(Boolean(scene), (el) => el.child(scene)).child(footer(t, { ...this.stats, claude: null, lines })), { role: "footer", now: new Date() });
    }
    // Focus changes re-render the sidebar: show what's known for the new agent now, and refresh it.
    const address = shownAgent(this.agent);
    if (address !== this.agent) {
      this.agent = address;
      this.fetchClaude(cx, address);
    }
    const state = { ...this.stats, claude: address ? this.claude?.[address] ?? null : null };
    return sidebar(state);
  }
}
