// Skins: one `kelpie` mod, several looks. Each Kelpie layout (same block tree and ids, its own theme)
// picks a skin by its name, shared("layout"); the views call the hooks below where a look can differ.
//
//   layout              skin file               art (sources)             art (drawn from)
//   Kelpie-Plain        skins/base.js           -                         -
//   Kelpie              skins/quiet-pages.js    skins/quiet-pages/art/    art/kelpie/skins/quiet-pages/
// Any other layout gets base, which changes nothing.
//
// A skin is an object: base's hooks ({ ...base }) with some replaced. Every hook is optional; a hook
// that throws is logged once and base's is used for that call, so one broken skin can't break the
// views (a syntax error still breaks the whole mod: run `herdr-app check` after every save).
//
// Hooks (`t` is the skinned theme, `now` a Date; "el" hooks get the element the view built and
// return it, changed or not; "null" hooks return an element, or null for the view's own):
//
//   palette(t, now) -> { [colour name]: "#rrggbb[aa]" } | null
//       Merged over theme() for every Kelpie view (skinTheme()). For a light that follows the clock.
//       Keep it stepped (a few values a day): the footer redraws every view when it changes.
//   fonts: { [kind]: family }    font families by kind of text, null = inherit
//       ui: story rows and subtask titles; title: the story's title, the picker's heading;
//       reading: the description (lead and body); label: group headings, chips, buttons;
//       numbers: keys, the footer's figures; mono: code and diffs. Finer kinds, each falling back to
//       the family named after it when the skin gives it none: meta (a story's need line, in its row
//       and title row; label), key (the title row's story key; numbers), count (group and view
//       counts; numbers), clock (the footer's clock; numbers), profile (the profile's name), fresh
//       (the list's "Updated ..." line), tab (tab-bar tab and view labels), heading (the
//       description's headings), lead (its opening paragraph), footer (the footer's account): null,
//       inherit.
//       Fonts: an installed family, or .ttf/.otf files in skins/<name>/fonts/ (copied at start to
//       ~/.config/herdr-app/fonts/, loaded by Herdr on its next start or look change).
//   type: { [kind]: { scale, weight, color, caps, text } }    how a kind of text is set (see fonts)
//       scale: its size times this, where the view gives a size (a pixel face like VT323 reads
//       ~1.4x smaller than a text face); weight: a font weight over the view's (400 keeps a pixel face
//       from being drawn bold); color: a theme colour name, "#rrggbb[aa]" or (t) => colour, over the
//       view's; caps: upper-case its words (gpui has no text-transform: the views pass the strings
//       through skinText()); text(s): any other change to the string (brackets round a count, "== =="
//       round a heading). Letter spacing: gpui has none. Kinds without an entry are left as they are.
//   glyph(t, { name, size }) -> element | null
//       The profile's square (its first letter), in the profile row; null for the view's own.
//   statusMark(t, state, { where, size, color, agent }) -> element | null
//       The mark for a state, where the view shows one. `state`: a story's "needs-you", "changes" (changes requested), "failing",
//       "done" (ready to merge), "review", "working", "paused", "waiting" (handed over), "idle"
//       (open, quiet), "not-open"; an agent's, below. `where`: "row"
//       (sidebar story row, 8px dot), "plain" (state "review" or "space": a review or other-space
//       row), "picker" (story picker), "sub" (subtask row's agent chip), "tab" (tab bar, agent
//       status), "pane" (a split pane's header), "side-tab" (the sidebar's agent rows). Those four are an
//       agent's (ui.js agentMark(), `size` its box): "needs-you", "working", "done", "idle", "paused",
//       "unknown" (a Claude that hasn't reported yet); restyle a state, never drop or merge one. `color`:
//       the theme colour the view would use. `agent`: Herdr's agent, where there is one.
//   blockDecor(t, el, { role, now, story, state, working }) -> el
//       Each Kelpie block's root: role "space-picker" (profile row), "work-side" (sidebar list),
//       "footer", "stories" (title row), "story-body", "toolbar", "story-view", "story-picker",
//       "confirm". `story`/`state`/`working` (an agent of it at work) for the story blocks
//       (stories, story-body, story-view), `profile` for space-picker and work-side, `story` for
//       the toolbar.
//       For backgrounds, a scene image (absolute children), a lamp pool, a band.
//   rowDecor(t, el, { selected, state, story, now }) -> el     a sidebar story row (plate, glow, firefly)
//   groupDecor(t, el, { label, count, trail, aside }) -> el    a list's group heading (ink rule; trail: after the count, aside: before it)
//   tabDecor(t, el, { tab, active, state, agentTab, now }) -> el
//       A tab-bar tab; `agentTab` when it holds an agent, `state` its agent's (underline, sprite).
//   controlDecor(t, el, { kind, id, label, on }) -> el
//       kind "primary", "text", "icon", "chip", "view" (Changes/Screenshots/Overview). Key hints,
//       Fastext squares, chunky keys.
//   sidebarFoot(t, { now }) -> element | null
//       Drawn in the footer block above its lines (a pond, hills, a glow). The block is the layout's
//       "side-foot" (70px): make it taller in the skin's own layout file.
//   footerExtras(t, { now }) -> element | null                 just before the footer's clock (sun arc, mug)
//   meter(t, { kind, label, value, scale, reset, done, total }) -> element | null
//       A figure drawn as a meter. kind "cpu", "mem" (value %, scale [high, full]), "five", "week"
//       (Claude limits: value %, reset true once passed), "subtasks" (done of total, in the title
//       row; base shows nothing there).
//   tick: { [role]: ms }
//       That role's copy redraws every `ms` (for image frame swaps: `frameAt()` in common.js picks
//       the frame). Each redraw redraws the window, so ask for the fewest roles at the slowest rate
//       that looks right (>= 250 ms), and prefer native motion (.loop, .frames, .spin, .transition),
//       which costs no redraws. Never stream images.
//
// Skin agents touch only skins/<name>.js, skins/<name>/ (art, fonts), layouts/Kelpie-<Name>.json and
// themes/Kelpie-<Name>.json. Shared files (this one, base.js, common.js, the views) change only to add a
// hook every skin can use, a no-op in base (the plain Kelpie layout must look exactly as it did).

import { setShared, shared, theme } from "herdr";
import base from "./base.js";
import quietPages from "./quiet-pages.js";

export const SKINS = { "Kelpie": quietPages };


// The shown layout's skin (base for any layout without one).
export const skin = () => SKINS[shared("layout")] ?? base;

const warned = new Set();
// A hook of the shown skin, else base's; one that throws is logged once and base's runs instead.
function hook(name, ...args) {
  const s = skin();
  const f = s[name];
  if (s !== base && typeof f === "function" && f !== base[name]) {
    try {
      return f(...args);
    } catch (e) {
      const id = `${s.name}.${name}`;
      if (!warned.has(id)) { warned.add(id); console.log(`kelpie skin ${id}: ${e?.stack ?? e}`); }
    }
  }
  return base[name](...args);
}

// theme() with the skin's palette over it; theme() itself when the skin has none.
export function skinTheme(now = new Date()) {
  const t = theme();
  const p = hook("palette", t, now);
  return p ? { ...t, ...p } : t;
}

// The skin's font for a kind of text on `el`, or `el` as it is (fonts, falling back as listed above),
// then its `type`: `size` (the view's text size for it, if it sets one) times its scale, its weight
// and colour. Call it after the view's own size, weight and colour, so the skin's win.
const FALLBACK = { meta: "label", key: "numbers", count: "numbers", clock: "numbers" };
export function skinFont(el, kind, size) {
  let f = null, ty = null;
  try {
    const s = skin();
    f = s.fonts?.[kind] ?? (FALLBACK[kind] ? s.fonts?.[FALLBACK[kind]] : null) ?? null;
    ty = s.type?.[kind] ?? null;
  } catch {}
  if (f) el = el.font_family(f);
  if (size != null) el = el.text_size(ty?.scale ? Math.round(size * ty.scale * 2) / 2 : size);
  if (!ty) return el;
  if (ty.weight) el = el.font_weight(ty.weight);
  if (ty.color) {
    try {
      const t = skinTheme();
      const c = typeof ty.color === "function" ? ty.color(t) : t[ty.color] ?? ty.color;
      if (c) el = el.text_color(c);
    } catch {}
  }
  return el;
}

// A string as the skin sets that kind of text (type[kind].caps, .text); anything else as it is.
export function skinText(s, kind) {
  if (typeof s !== "string") return s;
  try {
    const ty = skin().type?.[kind];
    if (!ty) return s;
    const x = ty.caps ? s.toUpperCase() : s;
    return typeof ty.text === "function" ? String(ty.text(x)) : x;
  } catch { return s; }
}

// The skin's profile square, or null (the view draws its own).
export const skinGlyph = (t, o) => hook("glyph", t, o) ?? null;

// The skin's mark for a state, or null (the view draws its own).
export const statusMark = (t, state, o) => hook("statusMark", t, state, o) ?? null;

// An "el" hook: the element, decorated by the skin (or as it was).
export const decor = (name, t, el, o) => hook(name, t, el, o) ?? el;

export const sidebarFoot = (t, o) => hook("sidebarFoot", t, o) ?? null;
export const footerExtras = (t, o) => hook("footerExtras", t, o) ?? null;
export const skinMeter = (t, o) => hook("meter", t, o) ?? null;

// How often a role's copy redraws for the skin's animations (0: never).
export function skinTick(role) {
  try { return Math.max(0, Number(skin().tick?.[role]) || 0); } catch { return 0; }
}

// An agent's Herdr status as a skin state.
export const agentState = (status) => ({ blocked: "needs-you", working: "working", done: "done", idle: "idle" })[status] ?? null;

// The palette changing (the hour, say) reaches every copy at once: the footer (always shown) checks
// it on each of its redraws (at least every 15 s) and, when it changed, bumps a shared value, which
// redraws every copy. Copies each compute the palette themselves; this only keeps them in step.
const BEAT = "kelpie.skin.beat";
let lastPalette;
export function syncSkin(now = new Date()) {
  if (skin() === base) return;
  const key = JSON.stringify(hook("palette", theme(), now) ?? null);
  if (lastPalette !== undefined && key !== lastPalette) setShared(BEAT, Date.now());
  lastPalette = key;
}
