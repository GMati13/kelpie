// What the Quiet pieces share: sizes, icons, status marks, buttons, names and load colours.

import { div, image, svg } from "gpui-kit";
import { Popup, h_flex, v_flex } from "gpui-base";
import { agents, appHome, exec, focused, hc, run, window } from "herdr";
import { decor, skinFont, skinText } from "./skins/index.js";

export { CLAUDE_TMP, STAT_MTIME, fullName, openExternal, platform, reveal, revealLabel } from "./platform.js";

// This mod's own name, its folder under mods/: Herdr doesn't tell a mod its name, so overlays it opens
// of itself, the "<mod>.<command>" names it builds and the paths to its scripts all start here.
// Renaming the folder means changing this (and keys.json and the layouts, which name it too).
export const MOD = "kelpie";
export const modFile = (name) => `${appHome()}/mods/${MOD}/${name}`;

// Three type sizes (a diff's mono text is 12) and one content inset, so the sidebar, the story
// header and the tab bar start their text on the same line.
export const TEXT = 13;
export const SMALL = 11.5;
export const TITLE = 15;
export const INSET = 16;
export const ICON = 14;
export const ROW = 30;
export const CONTROL = 28;

export const chrome = (name) => `mods/workspace-chrome/${name}.svg`;
// Lucide icons Herdr's chrome lacks (globe, external-link, refresh-cw, ellipsis, copy, send,
// folder-open), kept in this mod's icons/ folder. Herdr draws no SVG reached through stow's symlinked
// mod folder, so icons/install.sh copies them to art/kelpie/icons, read from here (from Herdr's home, as chrome()).
export const own = (name) => `art/${MOD}/icons/${name}.svg`;
export const icon = (path, size = ICON) => svg(path).flex_none().size(size);
export const stop = (_e, cx) => cx.stop_propagation();
export const find = (node, id) => (node?.id === id ? node : (node?.children ?? []).map((c) => find(c, id)).find(Boolean) ?? null);
// The Kelpie layout's sidebar ("side"), hidden with cmd-b: the block that's then leftmost leaves room for
// macOS's window buttons (the layout draws no title bar), as the sidebar's profile row does.
// The session name in a Claude terminal's title: spinner or status glyphs before it dropped; none
// while it's just the program's own name.
export function sessionTitle(title) {
  const t = String(title ?? "").replace(/^[^\p{L}\p{N}[(]+/u, "").trim();
  return t && !/^claude( code)?$/i.test(t) ? t : null;
}

export const sideHidden = (root) => Boolean(find(root, "side")?.hidden);
export const buttonsRoom = () => (window()?.platform === "macos" && !window()?.fullscreen ? 84 : 0);
export const toggleSide = () => run("layout.toggle", { id: "side" });

export function programIcon(p, color) {
  if (!p?.icon) return null;
  return p.tint ? icon(p.icon).text_color(color) : image(p.icon).flex_none().size(ICON);
}

// Status says itself quietly: motion only while working or waiting for you.
export function status(t, state) {
  if (state === "working") return icon(chrome("spinner"), 12).text_color(t.working).spin(900);
  if (state === "blocked") return div().flex_none().size(7).rounded_full().bg(t.blocked).loop("opacity", { from: 0.35, to: 1, period: 1200 });
  if (state === "done") return div().flex_none().size(7).rounded_full().bg(t.done);
  return null;
}

// One mark per state, in a box of `size` so rows line up whatever they show. Motion says something is
// live: a spinner while working, a slow pulse while waiting for you. Everything else is still.
// States: an agent's or a story's (skins/index.js statusMark lists them), a pull request's ("pr-…",
// see prState) and "paused". A tooltip on the element that holds it says the words.
export function mark(t, state, size = 14) {
  const box = (el) => div().flex().flex_none().size(size).items_center().justify_center().child(el);
  const glyph = (path, color, s = size - 2) => box(icon(path, s).text_color(color));
  const dot = (d) => Math.max(5, Math.round(d));
  switch (state) {
    case "needs-you":
    case "blocked": return box(div().flex().flex_none().size(dot(size * 0.75)).items_center().justify_center().rounded_full().bg(tint(t.working, "40"))
      .loop("opacity", { from: 0.45, to: 1, period: 1200 })
      .child(div().flex_none().size(dot(size * 0.4)).rounded_full().bg(t.working)));
    case "working": return box(icon(chrome("spinner"), size - 2).text_color(t.accent).spin(900));
    case "failing":
    case "pr-failing": return glyph(own("circle-x"), t.blocked);
    case "changes":
    case "pr-changes": return glyph(own("message-square"), t.working, size - 3);
    // Approved (and so ready to merge) is the green circle; the merge icon is only for merged ones.
    case "ready":
    case "pr-approved": return glyph(chrome("circle-check"), t.done);
    // Merged: the merge icon with an outlined check in a circle at its top right (icons/git-merged.svg),
    // in the theme's calm blue, a colour no other state uses.
    case "pr-merged": return glyph(own("git-merged"), t.ansi4 ?? t.accent);
    case "pr-running": return glyph(chrome("clock"), t.working);
    case "pr-draft": return glyph(own("git-pull-request-draft"), t.dim);
    case "pr-review": return glyph(own("git-pull-request"), t.accent);
    case "review": return glyph(own("eye"), t.accent);
    case "done": return glyph(chrome("check"), t.done);
    case "paused": return glyph(own("pause"), t.dim, size - 4);
    case "idle": return box(div().flex_none().size(dot(size * 0.5)).rounded_full().border_1().border_color(t.muted));
    case "waiting": return box(div().flex_none().size(dot(size * 0.5)).rounded_full().border_1().border_color(t.dim));
    case "not-open": return box(div().flex_none().size(dot(size * 0.35)).rounded_full().bg(t.dim));
    default: return box(div().flex_none().size(dot(size * 0.35)).rounded_full().bg(t.dim));
  }
}

// A pull request's one state: [mark state, words, colour]. Changes requested come first (failing
// checks then only in its words); then failing checks, approved or not (the approval in its words);
// then an approval, the green circle even while checks run; then the rest.
export function prState(t, p, checks) {
  if (p.merged) return ["pr-merged", "Merged", t.ansi4 ?? t.accent];
  const failed = ["FAILURE", "ERROR"].includes(checks), running = ["PENDING", "EXPECTED"].includes(checks);
  if (p.reviewDecision === "CHANGES_REQUESTED") return ["pr-changes", failed ? "Changes requested, and checks failing" : "Changes requested", t.working];
  if (failed) return ["pr-failing", p.reviewDecision === "APPROVED" ? "Checks failing (approved)" : "Checks failing", t.blocked];
  if (p.reviewDecision === "APPROVED") return ["pr-approved", running ? "Approved, checks running"
    : checks ? "Approved, checks pass: ready to merge" : "Approved, no checks: ready to merge", t.done];
  if (p.isDraft) return ["pr-draft", "Draft", t.dim];
  if (running) return ["pr-running", "Checks running", t.working];
  return ["pr-review", checks === "SUCCESS" ? "In review, checks pass" : "In review", t.accent];
}

// A small count with its mark ("3" beside a spinner): the sidebar's summary, a row's agents. `tip` says it.
export function countBadge(t, id, state, n, tip, color = t.muted) {
  return h_flex().id(id).flex_none().gap(3).items_center().text_size(SMALL).font_medium().text_color(color).tooltip(tip)
    .child(mark(t, state, 12)).when(n > 1 || n === 0, (el) => el.child(String(n)));
}

// Progress as a thin bar in parts (done, in review, in progress, to do) and "done/total" beside it.
export function progressBar(t, id, parts, tip, width = 32) {
  const total = parts.reduce((s, p) => s + p.n, 0);
  if (!total) return null;
  const done = parts[0]?.n ?? 0;
  return h_flex().id(id).flex_none().gap(5).items_center().tooltip(tip)
    .child(h_flex().flex_none().w(width).h(4).gap(1).rounded_full().overflow_hidden().bg(t.raised)
      .children(parts.filter((p) => p.n).map((p) => div().flex_none().h_full().w(Math.max(2, Math.round((width - parts.length) * p.n / total))).bg(p.color))))
    .child(div().flex_none().text_size(SMALL).text_color(t.dim).child(`${done}/${total}`));
}

// The one icon button, for routine actions (panels, create, refresh, open elsewhere, copy): dim until
// hovered, `on` for the open one of a group, a tooltip always (its name, and its key when it has one).
export function iconButton(t, id, path, action, tip, { on = false } = {}) {
  return decor("controlDecor", t, iconButtonEl(t, id, path, action, tip, on), { kind: "icon", id, label: tip, on });
}
function iconButtonEl(t, id, path, action, tip, on) {
  return div().id(id).flex().flex_none().size(CONTROL).items_center().justify_center().rounded(7).cursor_pointer()
    .when(on, (el) => el.bg(t.selected)).text_color(on ? t.foreground : t.dim)
    .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
    .on_mouse_down("left", stop).on_click(action).child(icon(path));
}

// Buttons come in two kinds, drawn alike everywhere (headers, rows, dialogs, menus): the same
// height, radius, padding and text size, only their fill differs.
const button = (t, id, label, action, tip) => skinFont(h_flex().id(id).h(CONTROL).flex_none().px(10).items_center().rounded(7).cursor_pointer()
  .font_medium(), "label", SMALL).when(Boolean(tip), (el) => el.tooltip(tip))
  .on_mouse_down("left", stop).on_click(action).child(skinText(label, "label"));

// A quiet button, no fill until hovered; `on` marks the selected one of a group, `dim` one that sits
// back further (menuButton passes `dim` and a text `size` through).
export function textButton(t, id, label, action, { on = false, tip, dim = false } = {}) {
  return decor("controlDecor", t, button(t, id, label, action, tip)
    .when(on, (el) => el.bg(t.selected)).text_color(on ? t.foreground : dim ? t.dim : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)), { kind: "text", id, label, on });
}

// The one main action of a view, filled in the accent colour; takes the same options as textButton.
export function primaryButton(t, id, label, action, { tip } = {}) {
  return decor("controlDecor", t, button(t, id, label, action, tip).bg(t.accent).text_color(t.accent_foreground).hover((s) => s.opacity(0.88)), { kind: "primary", id, label, on: false });
}

// A small menu: a quiet button with a list under it. Rows are { label, hint, tip, action, careful },
// or { header } over the rows after it. A careful row's first click arms it ("Confirm …", the menu
// stays open) and a second within a few seconds does it. An outside click closes it. `host` keeps
// the open menu and the armed row (menu, menuShut, armed, armedAt): a view, or a plain object for a
// function role. The list is a Popup, painted over the window, so a short block doesn't clip it.
// With `iconPath` the trigger is an icon button (label unused), shown selected while open.
// `trigger(toggle, open)` draws a trigger of the caller's own instead (give it the id `<id>-more`).
export function menuButton(host, t, id, label, rows, { tip, anchor = "top_right", dim = false, width = 380, size, iconPath, trigger: own } = {}) {
  const open = host.menu === id;
  const toggle = (_e, cx) => {
    // The click that closed it from outside lands on this button too: it stays closed.
    host.menu = open || (host.menuShut?.id === id && Date.now() - host.menuShut.at < 400) ? null : id;
    cx.notify();
  };
  const trigger = own ? own(toggle, open) : iconPath ? iconButton(t, `${id}-more`, iconPath, toggle, tip, { on: open })
    : textButton(t, `${id}-more`, label, toggle, { tip, dim }).when(label === "▾", (el) => el.px(6)).when(Boolean(size), (el) => el.text_size(size));
  const row = (x, i) => {
    if (x.header) return div().flex_none().px(8).pt(8).pb(2).text_size(SMALL).text_color(t.dim).child(x.header);
    const rid = `${id}-row-${i}`;
    const armed = host.armed === rid && Date.now() - host.armedAt < 6000;
    return h_flex().id(rid).flex_none().h(CONTROL).px(8).gap(10).items_center().rounded(6).cursor_pointer()
      .when(armed, (el) => el.bg(t.selected)).hover((el) => el.bg(t.hover)).when(Boolean(x.tip), (el) => el.tooltip(x.tip))
      .on_click((_e, cx) => {
        if (x.careful && !armed) { host.armed = rid; host.armedAt = Date.now(); cx.notify(); return; }
        host.armed = null;
        host.menu = null;
        cx.notify();
        x.action(cx);
      })
      .child(div().flex_1().min_w(0).truncate().child(armed ? `Confirm ${x.label.toLowerCase()}` : x.label))
      .when(Boolean(x.hint), (el) => el.child(div().flex_none().text_size(SMALL).text_color(t.dim).child(x.hint)));
  };
  return Popup.new(`${id}-menu`, trigger).anchor(anchor).when(open, (el) => el.content(
    v_flex().id(`${id}-menu-list`).w(width).max_h(360).p(4).gap(1).overflow_y_scrollbar().rounded(8).bg(t.popover).border_1().border_color(t.border)
      .text_size(SMALL).text_color(t.foreground)
      .on_mouse_down_out((_e, cx) => { if (host.menu === id) { host.menu = null; host.menuShut = { id, at: Date.now() }; cx.notify(); } })
      .children(rows.map(row))));
}

// "Nothing here" text, the same in every list, view and dialog: dim, small, padded. `fill` centres
// it in the space left (a view with nothing else to show); otherwise it sits in a list.
export function empty(t, text, { fill = false } = {}) {
  return div().when(fill, (el) => el.flex_1().flex().items_center().justify_center()).px(8).py(12)
    .text_size(SMALL).text_color(t.dim).child(text);
}

// Dialogs (Confirm, the story picker, the profile dialog) share one inner padding and gap scale:
// padded INSET, 8 between the pieces of a part (a label and its field), 16 between parts.
export const DIALOG = { pad: INSET, gap: 8, section: 16 };

// A list's group heading, inside a list padded 8 (rows pad 8 more): its label, and its count at the right.
export function groupHeader(t, label, n) {
  return decor("groupDecor", t, h_flex().flex_none().px(8).pt(18).pb(6).items_center().text_size(SMALL)
    .child(skinFont(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.muted), "label").child(skinText(label, "label")))
    .when(n != null, (el) => el.child(skinFont(div().flex_none().text_color(t.dim), "count").child(skinText(String(n), "count")))), { label, count: n });
}

// What an agent is doing, not where it lives: a tab you named, else its own session title, else
// the program. Titles that are only a path or a user@host say nothing, so they're skipped.
export function agentName(agent, tab) {
  const program = agent.program?.name;
  // Herdr names a tab after the program it starts in, which isn't a name anyone chose.
  if (tab?.named && tab.name !== program) return tab.name;
  const raw = (agent.title ?? "").trim();
  const title = raw.replace(/^[^\p{L}\p{N}~/]+/u, "").trim();
  const telling = title && title !== program && title.toLowerCase() !== agent.program?.key && !/^[~/]|^[A-Za-z]:\\/.test(title) && !title.includes("@");
  return telling ? title : program || agent.address;
}

// Each agent's name in a list (its session's name, else agentName()), numbered where two would read
// the same ("Claude Code", "Claude Code 2": fresh agents have no session name yet). By address.
export function agentLabels(list, tabs) {
  const seen = new Map();
  return new Map(list.map((a) => {
    const name = sessionTitle(a.title) ?? agentName(a, tabs.find((c) => c.id === a.tab));
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return [a.address, n > 1 ? `${name} ${n}` : name];
  }));
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const clock12 = (d) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;

// Under a day away reads as time left; further away, as a day and a time. `at` is epoch seconds.
export function resetLabel(at, now = Date.now()) {
  if (!at) return "";
  const when = new Date(at * 1000);
  const minutes = Math.round((when.getTime() - now) / 60000);
  if (Number.isNaN(minutes)) return "";
  if (minutes <= 0) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${DAYS[when.getDay()]} ${clock12(when)}`;
}

// How long ago, short: "now", "5m", "3h", "2d". `at` is epoch ms.
export function ago(at, now = Date.now()) {
  const minutes = Math.floor((now - at) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (24 * 60))}d`;
}

export const capitalize = (w) => (w ? w[0].toUpperCase() + w.slice(1) : "");

// A theme colour at an alpha (hex "26" is about 15%), for tinted chips; names pass through.
export const tint = (hex, alpha) => (/^#[0-9a-f]{6}$/i.test(hex ?? "") ? hex + alpha : hex);

// A person as a small round avatar: their initials on a colour that is always the same for them.
export function avatar(t, name, size = 18) {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const initials = words.length ? (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase() : "?";
  let h = 0;
  for (const c of name ?? "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = [t.ansi4, t.ansi5, t.ansi6, t.ansi2, t.ansi3, t.ansi1][h % 6];
  return div().flex().flex_none().size(size).items_center().justify_center().rounded_full()
    .bg(name ? tint(hue, "33") : t.raised).text_size(size * 0.45).font_medium().text_color(name ? hue : t.dim)
    .tooltip(name || "Unassigned").child(name ? initials : "–");
}

// A small coloured chip: a label on a tint of its colour (or on `bg`). Jira's status lozenges are chips too.
export function chip(t, label, color, bg = tint(color, "26")) {
  return decor("controlDecor", t, skinFont(div().flex_none().px(6).py(2).rounded(4).bg(bg).font_medium().text_color(color), "label", SMALL).child(skinText(label, "label")), { kind: "chip", id: null, label, on: false, color });
}

// One load palette for limits, CPU and memory: calm, getting high, nearly out. Memory runs fuller
// on a Mac by design, so it warns later.
export const LOAD = { limit: [60, 85], cpu: [60, 85], mem: [80, 92] };
// Calm reads neutral: colour only says something once it's high.
export function loadColor(t, value, [high, full]) {
  if (typeof value !== "number") return t.dim;
  return value >= full ? t.blocked : value >= high ? t.working : t.muted;
}

// The footer's CPU and memory as plain text, coloured only once nearly out (the load's `full`).
export const statColor = (t, value, [, full]) => (typeof value === "number" && value >= full ? t.blocked : t.muted);

// A labelled bar: used share, its percent and a trailing note (when the limit resets).
export function meter(t, label, used, note = "") {
  if (typeof used !== "number") return null;
  const color = loadColor(t, used, LOAD.limit);
  return h_flex().h(20).flex_none().gap(8).items_center()
    .child(div().w(34).flex_none().child(label))
    .child(div().flex_1().h(4).rounded_full().bg(t.raised).child(div().h_full().rounded_full().bg(color).w(`${Math.max(2, Math.min(100, used))}%`)))
    .child(div().w(30).flex_none().text_right().text_color(color).child(`${Math.round(used)}%`))
    .child(div().w(88).flex_none().text_right().truncate().child(note));
}

// What claude-statusline.sh saved for the claude with this pid: its session from the newest
// <config folder>/sessions/<pid>.json (another config folder can keep a stale one for a reused pid).
const LIMITS = 'f=$(ls -t "$HOME"/.claude*/sessions/"$1".json 2>/dev/null | head -1); [ -n "$f" ] || exit 0; id=$(jq -r ".sessionId // empty" "$f" 2>/dev/null); [ -n "$id" ] && cat "$HOME/.cache/kelpie/limits/$id.json" 2>/dev/null; true';

// The status line's saved data for the agent at this address, or null.
export async function claudeInfo(address) {
  const pid = Number(JSON.parse((await hc(["get", address])).stdout).foreground?.pid);
  // An agent on another machine keeps its sessions there.
  const on = address.includes("/") ? address.split("/")[0] : null;
  const out = pid ? (await exec("sh", ["-c", LIMITS, "sh", String(pid)], on ? { on } : {})).stdout.trim() : "";
  return out ? JSON.parse(out) : null;
}

// The Claude session the agent at this address runs: its terminal's foreground process is claude,
// which records itself in <config folder>/sessions/<pid>.json on the agent's own machine. Only one
// such file is read, the newest (another config folder can keep a stale one for a reused pid), and
// `config` is its config folder when that isn't the default ~/.claude (another account), else null,
// so a resume can start claude on the same account. Null when no session is found.
const SESSION = 'f=$(ls -t "$HOME"/.claude*/sessions/"$1".json 2>/dev/null | head -1); [ -n "$f" ] || exit 0; d="${f%/sessions/*}"; [ "$d" = "$HOME/.claude" ] && d=""; printf "%s\\n" "$d"; cat "$f"';
export async function claudeSession(address) {
  const pid = JSON.parse((await hc(["get", address])).stdout).foreground?.pid;
  if (!pid) return null;
  const on = address.includes("/") ? address.split("/")[0] : null;
  const out = (await exec("sh", ["-c", SESSION, "sh", String(pid)], on ? { on } : {})).stdout;
  const at = out.indexOf("\n");
  if (at < 0) return null;
  const rec = JSON.parse(out.slice(at + 1).trim() || "null");
  return rec?.sessionId ? { ...rec, config: out.slice(0, at) || null } : null;
}

// The argv that resumes a Claude session, on the account (config folder) it ran on. No config (the
// session is in Claude's own ~/.claude): plain claude, which uses ~/.claude as herdr-core's environment
// sets no CLAUDE_CONFIG_DIR.
export const resumeArgv = (id, config) => [...(config ? ["env", `CLAUDE_CONFIG_DIR=${config}`] : []), "claude", "--resume", id];

// The agent whose limits to show: the focused one, else the shown tab's, else the last one shown.
export function shownAgent(last) {
  const list = agents();
  const f = focused();
  const here = (address) => list.find((a) => a.address === address);
  return here(f?.terminal)?.address ?? here(f?.agent)?.address ?? list.find((a) => a.tab === f?.tab)?.address ?? (here(last) ? last : null);
}
