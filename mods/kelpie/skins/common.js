// Building blocks several skins share: the hour, colour mixing, breathing and pulsing marks,
// stepped bands, frame picking and art paths. Pure helpers: nothing here draws unless a skin calls it.

import { div } from "gpui-kit";
import { MOD } from "../ui.js";

// The part of the day and how far into it (0..1): night 0-5, dawn 5-7, morning 7-12, afternoon
// 12-17, dusk 17-20, evening 20-24. `hour` is fractional (16.5 is 4:30 PM).
export const PHASES = [["night", 0, 5], ["dawn", 5, 7], ["morning", 7, 12], ["afternoon", 12, 17], ["dusk", 17, 20], ["evening", 20, 24]];
export function hourPhase(now = new Date()) {
  const hour = now.getHours() + now.getMinutes() / 60;
  const [phase, from, to] = PHASES.find(([, a, b]) => hour >= a && hour < b) ?? PHASES[0];
  return { phase, progress: (hour - from) / (to - from), hour };
}

// Picks the entry for the hour from a list of [fromHour, value], sorted by hour (the last one before
// or at the hour; before the first, the last one, as the day wraps): presets by the clock.
export function byHour(list, now = new Date()) {
  const hour = now.getHours() + now.getMinutes() / 60;
  let pick = list[list.length - 1][1];
  for (const [h, v] of list) if (hour >= h) pick = v;
  return pick;
}

// Colours as "#rrggbb" or "#rrggbbaa".
export function parseHex(hex) {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex ?? "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255];
}
const hex2 = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
export const toHex = ([r, g, b, a = 255]) => `#${hex2(r)}${hex2(g)}${hex2(b)}${a >= 255 ? "" : hex2(a)}`;

// `a` mixed toward `b` by f (0: a, 1: b), alpha too. Anything unparsable gives `a`.
export function mix(a, b, f) {
  const x = parseHex(a), y = parseHex(b);
  if (!x || !y) return a;
  return toHex(x.map((v, i) => v + (y[i] - v) * f));
}
// A colour at an opacity 0..1 (replacing its own alpha).
export function alpha(hex, a) {
  const x = parseHex(hex);
  return x ? toHex([x[0], x[1], x[2], a * 255]) : hex;
}
export const lighten = (hex, f) => mix(hex, "#ffffff", f);
export const darken = (hex, f) => mix(hex, "#000000", f);

// An opacity that breathes between lo and hi over `period` ms, for a value computed at render (a
// skin with a tick). For marks that just breathe, prefer breathingDot: it costs no redraws.
export function breathing(now = new Date(), period = 2000, lo = 0.4, hi = 1) {
  const phase = (now.getTime() % period) / period;
  return lo + (hi - lo) * (0.5 - 0.5 * Math.cos(phase * 2 * Math.PI));
}

// Which of `count` frames shows now, each `ms` long (with a tick of `ms` on that role).
export const frameAt = (ms, count, now = new Date()) => Math.floor(now.getTime() / ms) % count;

// A round dot that breathes natively (no redraws).
export function breathingDot(color, size = 8, period = 2000, lo = 0.35) {
  return div().flex_none().size(size).rounded_full().bg(color).loop("opacity", { from: lo, to: 1, period });
}

// A dot sending out a ring that grows and fades, natively: a `box` x `box` box (default 2.4x the dot)
// with the dot in its middle. The ring's size and position swing with it, so it stays centred.
export function pulseRing(color, size = 8, period = 1200, box = Math.round(size * 2.4)) {
  const mid = (box - size) / 2;
  const opts = (from, to) => ({ from, to, period, easing: "ease-out" });
  return div().flex_none().relative().size(box)
    .child(div().absolute().rounded_full().border_1().border_color(color)
      .loop("width", opts(size, box)).loop("height", opts(size, box)).loop("left", opts(mid, 0)).loop("top", opts(mid, 0)).loop("opacity", opts(0.9, 0)))
    .child(div().absolute().left(mid).top(mid).size(size).rounded_full().bg(color));
}

// A hollow ring, solid or dashed (dashed drawn as four short arcs' worth of dots: Herdr has no dashed border).
export function ring(color, size = 8, { dashed = false } = {}) {
  if (!dashed) return div().flex_none().size(size).rounded_full().border_1().border_color(color);
  const d = Math.max(1, Math.round(size / 5));
  const at = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5], [0.15, 0.15], [0.85, 0.15], [0.85, 0.85], [0.15, 0.85]];
  return div().flex_none().relative().size(size)
    .children(at.map(([x, y]) => div().absolute().left(x * (size - d)).top(y * (size - d)).size(d).rounded_full().bg(color)));
}

// A hard-stop band of colours (layout gradients aren't available to mods): equal steps side by side
// (`vertical`: stacked). Give it a size; each step fills its share.
export function bands(colors, { vertical = false } = {}) {
  const box = vertical ? div().flex().flex_col() : div().flex().flex_row();
  return box.overflow_hidden().children(colors.map((c) => div().flex_1().bg(c)));
}

// A row of `total` small boxes, `filled` of them lit: a segmented meter.
export function segments(filled, total, on, off, { w = 4, h = 8, gap = 2 } = {}) {
  return div().flex().flex_row().flex_none().items_center().gap(gap)
    .children(Array.from({ length: total }, (_, i) => div().flex_none().w(w).h(h).bg(i < filled ? on : off)));
}

// Where a skin's art is drawn from: art/kelpie/skins/<skin>/<file> under Herdr's home, a real folder
// (Herdr draws no image reached through stow's symlinks). Sources live in mods/kelpie/skins/<skin>/art/
// and the footer copies them there at start (png, svg, subfolders kept). Herdr caches images by path:
// give a changed image a new file name.
export const artImage = (skinName, file) => `art/${MOD}/skins/${skinName}/${file}`;
