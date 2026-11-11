// Quiet Pages: ink, lamp and safelight (layout "Kelpie"). See skins/index.js for every hook and what it gets.
// A calm warm-graphite page where colour lives only in small things: a 2px ink rule under each group,
// Fastext keys (teletext's coloured keys, drawn as round dots: squares this small read as a missing
// glyph) on tabs, buttons, chips and views. Two lights with two
// jobs: the amber lamp pools over the story you're
// reading and warms its row (barely there by day, pooling after dark); the red safelight means needs
// you and nothing else (a lit bulb on that row, on its agent's tab, and a count in the footer).
// Status: needs you = the safelight bulb; every other state uses Kelpie's own marks (ui.js mark(): a
// spinner, an X, a check circle…), which say what they mean. sign() below still serves the picker.
// DM Sans for lists and UI, Fraunces for reading (title, description), DM Mono for keys and figures
// (skins/quiet-pages/fonts/, loaded on Herdr's next start). Art from skins/quiet-pages/build.py.

import { div, image, svg } from "gpui-kit";
import { agents, run } from "herdr";
import base from "./base.js";
import { alpha, artImage, bands, byHour } from "./common.js";

const NAME = "quiet-pages";
// The art's version (build.py VERSION): Herdr caches images by path.
const V = 2;
const art = (file) => artImage(NAME, `${file}-${V}.${file === "check" ? "svg" : "png"}`);

// Inks: the only colours on the page, in squares and rules. Gold stays for working things.
const INK = { gold: "#d9b45f", teal: "#7fb3ae", rose: "#c195ab", sage: "#9dbb84", coral: "#ef7f62" };
const SAFELIGHT = "#e8603f";
const LINE = "#e6dcc81f";
const LINE2 = "#e6dcc833";

// The hour, in steps: the lamp's colour, strength and warmth on the selected row.
// The row tint is the lamp's own colour, light enough to keep the row's dim key at 4.5:1.
const STEPS = [
  [0, { step: "late", lamp: "lamp-late", breath: true, row: "#c08a5a1a", rule: "#c99a6a" }],
  [5, { step: "dawn", lamp: "lamp-dawn", breath: false, row: "#e8a07018", rule: "#d9a27a" }],
  [8, { step: "day", lamp: "lamp-day", breath: false, row: "#f2c88c16", rule: "#d8c39a" }],
  [15, { step: "afternoon", lamp: "lamp-afternoon", breath: false, row: "#f0bc7c16", rule: "#dcb57e" }],
  [18, { step: "dusk", lamp: "lamp-dusk", breath: true, row: "#e08a5a1a", rule: "#e0a070" }],
  [20, { step: "night", lamp: "lamp-night", breath: true, row: "#f2b46c18", rule: "#e7b57a" }],
];
const hourStep = (now = new Date()) => byHour(STEPS, now);
// The skinned theme's hour values, or the hour's own when the palette didn't run.
const qp = (t) => (t.qpStep ? t : { ...t, ...palette(t, new Date()) });

function palette(_t, now) {
  const s = hourStep(now);
  return {
    // Kelpie names its "needs you" text `working` (its own agents at work are `accent`): the safelight's
    // readable coral there; Herdr's own `working` stays gold in the theme file.
    working: "#f08a6c",
    selected: s.row,
    qpStep: s.step, qpLamp: s.lamp, qpBreath: s.breath, qpRow: s.row, qpRule: s.rule,
  };
}

// ---- marks

// Keys and signs are round: a small square reads as a broken glyph.
const square = (c, size = 7) => div().flex_none().size(size).rounded_full().bg(c);
const hollow = (c, size = 7) => div().flex_none().size(size).rounded_full().border_1().border_color(c);
// A dotted ring: dots around a circle (Herdr draws no dashed border this small).
function dashed(c, size = 7) {
  const d = 1.5, r = (size - d) / 2;
  const at = Array.from({ length: 8 }, (_, i) => [r + r * Math.cos((i * Math.PI) / 4), r + r * Math.sin((i * Math.PI) / 4)]);
  return div().flex_none().relative().size(size).opacity(0.8).children(at.map(([x, y]) => div().absolute().left(x).top(y).size(d).rounded_full().bg(c)));
}
const easing = (size = 7) => square(INK.gold, size).loop("opacity", { from: 0.45, to: 1, period: 3000 });
const check = (c, size = 11) => svg(art("check")).flex_none().size(size).text_color(c);
const bars = (c) => div().flex().flex_row().flex_none().gap(2).child(div().w(2).h(7).bg(c)).child(div().w(2).h(7).bg(c));
// The safelight: a red bulb in a glow that swells and settles, natively. `box` square, bulb in its middle.
function bulb(box = 12, size = 8) {
  const mid = (box - size) / 2;
  return div().flex_none().relative().size(box)
    .child(div().absolute().left(0).top(0).size(box).rounded_full().bg(alpha(SAFELIGHT, 0.32)).loop("opacity", { from: 0.25, to: 1, period: 2400 }))
    .child(div().absolute().left(mid).top(mid).size(size).rounded_full().bg(SAFELIGHT))
    .child(div().absolute().left(mid + size * 0.22).top(mid + size * 0.18).size(Math.max(2, size * 0.32)).rounded_full().bg("#ffb39a").opacity(0.75));
}

// The sign for a state, about `size` big.
function sign(t, state, size = 8) {
  const s = Math.max(5, size - 1);
  switch (state) {
    case "needs-you": return bulb(size + 4, size);
    case "working": return easing(s);
    case "done": return check(INK.sage, size + 3);
    case "failing": return square(INK.coral, s);
    case "review": return square(INK.teal, s);
    case "paused": return bars(t.dim);
    case "waiting": return dashed(t.dim, s);
    case "not-open": return hollow(t.dim, s);
    case "idle": return square(t.dim, s - 1);
    case "space": return square(t.muted, s - 1);
    case "shell": return hollow(t.dim, s - 1);
    default: return null;
  }
}
// Where an agent's own state shows (ui.js agentMark()).
const AGENT_PLACES = new Set(["tab", "pane", "side-tab", "sub"]);
// Every mark in a box of one size, so titles line up whatever the state: rows match their title's line.
const boxed = (el, w, h = w) => div().flex().flex_none().w(w).h(h).items_center().justify_center().child(el);

// A Fastext square (or a mark) at an element's left, centred on its height: the element makes room.
function lead(el, mark, { left = 10, room = 26, half = 4 } = {}) {
  return el.relative().pl(room)
    .child(div().absolute().left(left).top("50%").w(0).h(0).child(div().absolute().left(0).top(-half).child(mark)));
}

// An ink rule that fades out to the right (hard-stop steps: mods paint no gradients), never quite
// to nothing, so it still reaches the count.
const FADE = Array.from({ length: 32 }, (_, i) => 0.1 + 0.85 * (1 - i / 31) ** 2);
const inkRule = (c) => bands(FADE.map((f) => alpha(c, f))).size_full();
const GROUP_INK = { "In progress": INK.gold, "To do": INK.teal, "Waiting on others": INK.rose, "Built": INK.rose, "Reviews for you": INK.sage };

// ---- hooks

export default {
  ...base,
  name: NAME,
  palette,
  fonts: { ui: "DM Sans", title: "Fraunces", reading: "Fraunces", label: "DM Sans", numbers: "DM Mono", mono: "DM Mono" },

  statusMark(t, state, { where, size = 8 } = {}) {
    // An agent's mark is the same in every place (ui.js agentMark(): the tab bar, a pane's header, the
    // sidebar's rows, a subtask's slot), and so is a list's: only the safelight is the skin's own,
    // every other state is Kelpie's mark, so one state never looks two ways.
    if (AGENT_PLACES.has(where)) return state === "needs-you" ? boxed(bulb(12, 8), size) : null;
    if (where !== "picker" && state !== "needs-you") return null;
    const el = sign(t, state, size);
    if (!el) return null;
    if (where === "row" || where === "plain") return boxed(el, 12, 16);
    return boxed(el, size + 4);
  },

  blockDecor(t, el, { role, story } = {}) {
    if ((role !== "stories" && role !== "story-body") || !story) return el;
    const q = qp(t);
    if (!q.qpLamp) return el;
    // The lamp: one pool across the title row and the body, centred over the opening of the reading
    // column (the body starts 51px lower, under its divider), so its upper edge warms the title row.
    // Behind the text, clipped.
    // Clipped E px inside its own edges (transparent there anyway): stretched 2.4x, the image's last row
    // blends in a sliver of whatever Herdr keeps beside it, which drew a 1px line across the reading.
    const W = 1500, H = 640, Y = 80, E = 6;
    const pool = div().absolute().left("50%").top(role === "stories" ? Y + 51 : Y).w(0).h(0)
      .child(div().absolute().left(-W / 2 + E).top(-H / 2 + E).w(W - 2 * E).h(H - 2 * E).overflow_hidden()
        .child(image(art(q.qpLamp)).absolute().left(-E).top(-E).w(W).h(H)
          .when(q.qpBreath, (x) => x.loop("opacity", { from: 0.82, to: 1, period: 9000 }))));
    return div().relative().flex().flex_col().size_full().min_w(0).min_h(0).overflow_hidden().child(pool).child(el);
  },

  rowDecor(t, el, { selected } = {}) {
    el = el.rounded(2);
    if (!selected) return el;
    const q = qp(t);
    // The lamp warms the row you're reading: a tint and a 2px rule, laid over the row's left edge so
    // selecting changes no layout (a border swapped for padding rounded differently at Herdr's zoom,
    // and the row's text jumped a pixel).
    return el.relative().bg(q.qpRow).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(q.qpRule));
  },

  // A group heading set as a small capital label over an ink rule that fades out (the view's own is a
  // plain label; this rebuilds it with the same text and count, no controls there to keep).
  groupDecor(t, el, { label, count, trail } = {}) {
    const text = String(label ?? "");
    const ink = GROUP_INK[text] ?? t.dim;
    return div().relative().flex().flex_row().flex_none().items_center().px(8).pt(18).pb(8).mb(4).text_size(10.5)
      .child(div().flex_1().min_w(0).truncate().font_family("DM Sans").font_bold().text_color(t.muted).child(text.toUpperCase()))
      .when(count != null, (x) => x.child(div().flex_none().font_family("DM Mono").text_size(11).text_color(t.dim).child(String(count))))
      .when(Boolean(trail), (x) => x.child(div().flex_none().ml(6).child(trail)))
      .child(div().absolute().left(8).right(8).bottom(0).h(2).child(inkRule(ink)));
  },

  tabDecor(t, el, { active } = {}) {
    const q = qp(t);
    el = el.rounded(2);
    // The open tab: an underline in lamp light instead of a fill. Every tab has the 2px border (clear
    // when not open) and the same weight, so switching tabs doesn't shift the bar.
    el = el.border_b_2().border_color(active ? q.qpRule : "#00000000");
    // Its agent sign is statusMark's ("tab"), in the tab's own slot.
    return active ? el.bg("#00000000") : el;
  },

  controlDecor(t, el, { kind, id, label, on, color } = {}) {
    const q = qp(t);
    if (kind === "icon") return el.rounded(3);
    if (kind === "primary") {
      // The main action: a raised key with a teal square, not a gold fill (gold means working).
      return lead(el.rounded(3).bg("#2a2724").text_color(t.foreground).border_1().border_color(LINE2), square(INK.teal, 8), { room: 25 });
    }
    if (kind === "text") {
      el = el.rounded(3);
      // The story header's other actions (Pause, asks) get a rose key.
      return id?.startsWith("story-") ? lead(el.border_1().border_color(LINE), square(INK.rose, 8), { room: 25 }) : el;
    }
    if (kind === "view") {
      const ink = { "view-changes": INK.teal, "view-shots": INK.rose, "view-start": INK.sage }[id] ?? INK.teal;
      el = el.rounded(2);
      if (on) el = el.bg("#00000000").border_b_2().border_color(q.qpRule).font_semibold();
      return lead(el, square(ink, 8));
    }
    if (kind === "chip") {
      // A chip is plain text after a square of its colour, in a hairline box; only what needs you stays coral.
      const text = String(label ?? "");
      // Kelpie colours "Checks running" with `working` too: that one is work in progress, gold and calm.
      const running = /working|running/i.test(text);
      const urgent = !running && (color === t.working || color === t.blocked);
      const ink = running ? INK.gold
        : urgent ? INK.coral
        : color === t.done ? INK.sage
        : color === t.accent ? INK.teal
        : null;
      return lead(el.rounded(2).bg("#00000000").border_1().border_color(LINE).text_color(urgent ? t.working : t.muted),
        ink ? square(ink, 7) : hollow(t.dim, 7), { left: 6, room: 18, half: 3.5 });
    }
    return el;
  },

  // The safelight in the footer: how many agents need you, lit only then. A click goes to the next.
  footerExtras(t) {
    const n = agents().filter((a) => a.status === "blocked").length;
    if (!n) return null;
    return div().id("qp-safelight").flex().flex_row().flex_none().gap(5).items_center().cursor_pointer()
      .tooltip(`${n === 1 ? "An agent needs" : `${n} agents need`} you: show the next ⌘⇧J`)
      .on_click(() => run("kelpie.next-need"))
      .child(bulb(11, 7)).child(div().font_family("DM Mono").text_color("#f08a6c").child(String(n)));
  },
};
