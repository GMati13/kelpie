// View snapshots (tests/README.md, Snapshots): a rendered element tree as readable text, compared
// with a file checked in under tests/snapshots/. A mismatch fails with a line diff; UPDATE_SNAPSHOTS=1
// writes the files instead (a changed snapshot is reviewed like code, never re-recorded to pass).
//
// What the text keeps, one element per line, children indented under it:
//   kind and its text arguments    div, h_flex, svg chrome:spinner, TextView.html "t" "<p>…"
//   #id                            the element's id
//   "text"                         a text child, on its own line, in order among the elements
//   fg= bg= border=                text, background and border colours, as the theme's token names
//                                  (accent, working/26 for a tint); a colour no token has, as is
//   hover(…)                       what hovering changes (its colours, opacity)
//   font= weight=                  a font family or weight set (what skins change)
//   opacity=                       a faded element
//   ~spin ~loop(opacity) ~frames(4)   motion
//   {click down:left …}            the handlers present (not what they do)
//   tip="…"                        the tooltip
//   @content                       an element given to a method other than child (a Popup's list)
//   … ×32 … [bg=…]                 4 or more sibling leaves alike but for their colours, as one line
// Left out, so a spacing or size tweak doesn't churn every snapshot: padding, margins, gaps, sizes,
// flex and alignment, radius, text size, truncation and cursor.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import assert from "node:assert/strict";
import { element, isElement, nodeOf } from "gpui-kit";
import { REPO } from "./helpers.mjs";

export const SNAPSHOTS = join(REPO, "tests", "snapshots");
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

const COLOR = { text_color: "fg", bg: "bg", border_color: "border" };
const MOTION = new Set(["spin", "loop", "frames", "transition", "animate", "pulse"]);
const FONT = { font_family: "font", font_weight: "weight" };
const HANDLER = /^on_(.*)$/;

// A theme's colours by value, for naming them: "#4080ff" -> "accent", "#4080ff26" -> "accent/26".
function namer(t) {
  const byValue = new Map();
  for (const [k, v] of Object.entries(t ?? {})) if (typeof v === "string" && !byValue.has(v.toLowerCase())) byValue.set(v.toLowerCase(), k);
  return (v) => {
    if (typeof v !== "string") return JSON.stringify(v);
    const s = v.toLowerCase();
    if (byValue.has(s)) return byValue.get(s);
    if (/^#[0-9a-f]{8}$/.test(s) && byValue.has(s.slice(0, 7))) return `${byValue.get(s.slice(0, 7))}/${s.slice(7)}`;
    return v;
  };
}

const shortPath = (p) => String(p).replace(/^mods\/workspace-chrome\/(.*)\.svg$/, "chrome:$1").replace(/^art\/kelpie\/icons\/(.*)\.svg$/, "own:$1");
const quote = (s) => JSON.stringify(String(s));
const argText = (kind, a) => (typeof a === "string" ? (kind === "svg" || kind === "image" ? shortPath(a) : quote(a)) : typeof a === "number" || typeof a === "boolean" ? String(a) : null);

// What a hover()/active() style function sets, as "fg=… bg=…".
function styleOf(fn, name) {
  if (typeof fn !== "function") return "";
  const probe = element("style");
  try { fn(probe); } catch { return "?"; }
  return nodeOf(probe).calls.map(([m, a]) => (COLOR[m] ? `${COLOR[m]}=${name(a[0])}` : m === "opacity" ? `opacity=${a[0]}` : null)).filter(Boolean).join(" ");
}

function lines(x, name, indent, out) {
  if (x === null || x === undefined || x === false || x === true) return;
  if (Array.isArray(x)) { for (const v of x) lines(v, name, indent, out); return; }
  if (!isElement(x)) { out.push(`${indent}${quote(x)}`); return; }
  const n = nodeOf(x);
  const head = [n.kind, ...n.args.map((a) => argText(n.kind, a)).filter((s) => s !== null)];
  const attrs = [], motion = [], events = [], kids = [];
  let tip = null;
  for (const a of n.args) if (isElement(a) || Array.isArray(a)) kids.push(["", a]);
  for (const [m, a] of n.calls) {
    if (m === "id") head.push(`#${a[0]}`);
    else if (m === "child" || m === "children") kids.push(["", a[0]]);
    else if (COLOR[m]) attrs.push(`${COLOR[m]}=${name(a[0])}`);
    else if (FONT[m]) attrs.push(`${FONT[m]}=${typeof a[0] === "string" ? quote(a[0]) : a[0]}`);
    else if (m === "opacity") attrs.push(`opacity=${a[0]}`);
    else if (m === "hover" || m === "active") { const s = styleOf(a[0], name); if (s) attrs.push(`${m}(${s})`); }
    else if (m === "tooltip") tip = typeof a[0] === "string" ? a[0] : "[fn]";
    else if (MOTION.has(m)) motion.push(m === "loop" ? `~loop(${a[0]})` : m === "frames" ? `~frames(${Array.isArray(a[0]) ? a[0].length : "?"})` : `~${m}`);
    else if (HANDLER.test(m)) events.push(`${m.replace(HANDLER, "$1").replace(/^mouse_/, "").replace(/^click$/, "click")}${typeof a[0] === "string" ? `:${a[0]}` : ""}`);
    else if (a.some((v) => isElement(v))) kids.push([`@${m}`, a.filter(isElement)]);
  }
  let line = head.join(" ");
  if (attrs.length) line += ` [${attrs.join(" ")}]`;
  if (motion.length) line += ` ${motion.join(" ")}`;
  if (events.length) line += ` {${[...new Set(events)].join(" ")}}`;
  if (tip !== null) line += ` tip=${quote(tip)}`;
  out.push(indent + line);
  for (const [label, k] of kids) {
    const at = out.length;
    if (label) { out.push(`${indent}  ${label}`); lines(k, name, `${indent}    `, out); }
    else lines(k, name, `${indent}  `, out);
    if (!label) out.splice(at, Infinity, ...runs(out.slice(at), `${indent}  `));
  }
}

// A run of 4 or more sibling leaves alike but for their colours (a skin's bands, a gradient drawn in
// strips) as one line: the first, "×N", and the last one's colours.
function runs(list, indent) {
  const leaf = (i) => list[i]?.startsWith(indent) && !list[i].startsWith(`${indent} `) && !(list[i + 1] ?? "").startsWith(`${indent} `) && !list[i].startsWith(`${indent}"`);
  const shape = (l) => l.replace(/=[^\s\]]+/g, "=");
  const out = [];
  for (let i = 0; i < list.length;) {
    let j = i;
    if (leaf(i)) while (j + 1 < list.length && leaf(j + 1) && shape(list[j + 1]) === shape(list[i])) j++;
    if (j - i + 1 >= 4) {
      const last = /\[(.*)\]/.exec(list[j])?.[1];
      out.push(`${list[i]} ×${j - i + 1}${last ? ` … [${last}]` : ""}`);
      i = j + 1;
    } else out.push(list[i++]);
  }
  return out;
}

// The text form of a rendered view (or a list of them); `t`: the theme its colours are named from.
export function render(x, t) {
  const out = [];
  lines(x, namer(t), "", out);
  return out.join("\n") + "\n";
}

// A line diff of two texts (LCS), with 3 lines of context around each change: "-" expected, "+" got.
export function diff(want, got) {
  const a = want.split("\n"), b = got.split("\n");
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { ops.push([" ", a[i], i + 1]); i++; j++; }
    else if (i < n && (j === m || L[i + 1][j] >= L[i][j + 1])) { ops.push(["-", a[i], i + 1]); i++; }
    else { ops.push(["+", b[j], i + 1]); j++; }
  }
  const show = new Set();
  ops.forEach((o, k) => { if (o[0] !== " ") for (let d = -3; d <= 3; d++) show.add(k + d); });
  const out = [];
  ops.forEach((o, k) => {
    if (!show.has(k)) return;
    // Each stretch shown starts with where it is in the snapshot.
    if (k === 0 || !show.has(k - 1)) out.push(`@@ line ${o[2]}`);
    out.push(`${o[0]} ${o[1]}`);
  });
  return out.join("\n");
}

// Compares `text` with tests/snapshots/<name>.txt. Missing or different: fails with the diff, unless
// UPDATE_SNAPSHOTS=1, which writes it.
export function matchSnapshot(name, text) {
  const file = join(SNAPSHOTS, `${name}.txt`);
  const where = relative(REPO, file);
  if (UPDATE) {
    mkdirSync(dirname(file), { recursive: true });
    if (!existsSync(file) || readFileSync(file, "utf8") !== text) writeFileSync(file, text);
    return;
  }
  if (!existsSync(file)) assert.fail(`No snapshot ${where} yet. Record it with UPDATE_SNAPSHOTS=1 ./test.sh js, then review it before committing.`);
  const want = readFileSync(file, "utf8");
  if (want === text) return;
  assert.fail(`${where} differs from what the view draws now ("-" the snapshot, "+" now). If the change is meant, re-record with UPDATE_SNAPSHOTS=1 and review the diff like code.\n${diff(want, text)}`);
}

// The first element in a tree with this id (`.id(...)`), depth first, or null: to snapshot one part.
export function byId(x, id) {
  if (Array.isArray(x)) { for (const v of x) { const f = byId(v, id); if (f) return f; } return null; }
  if (!isElement(x)) return null;
  const n = nodeOf(x);
  if (n.calls.some(([m, a]) => m === "id" && a[0] === id)) return x;
  for (const a of n.args) { const f = byId(a, id); if (f) return f; }
  for (const [, a] of n.calls) for (const v of a) { const f = byId(v, id); if (f) return f; }
  return null;
}
