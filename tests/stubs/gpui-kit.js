// Stub of Herdr's "gpui-kit" (and "gpui") host module, for the tests: elements are recorders.
// Every method of an element is recorded (name and arguments) and returns the same element, so any
// chain a view builds works and can be inspected or snapshotted afterwards (tree(), snapshot()).
// `.when(cond, fn)` and `.map(fn)` run their branch as gpui does; `.when_some` and `.when_else`, which
// Herdr's elements don't have (a view calling one couldn't be drawn), throw as Herdr does, so a snapshot holds what the condition put there. Handlers (on_click and the like) are kept as
// functions in the record: a test can call them (handlers()).

const NODE = Symbol("kelpie.test.node");

// An element of `kind` ("div", "h_flex", "svg", "Input.new", ...) made with `args`.
export function element(kind, args = []) {
  const node = { kind, args, calls: [] };
  const el = new Proxy(node, {
    get(target, prop) {
      if (prop === NODE) return node;
      if (typeof prop === "symbol" || prop === "then" || prop === "toJSON") return undefined;
      return (...a) => {
        if (prop === "when") return a[0] ? (a[1](el) ?? el) : el;
        if (prop === "when_some" || prop === "when_else") throw new Error(`unknown element method \`${prop}\`: Herdr's elements have when() and map(), not ${prop}()`);
        if (prop === "map" && typeof a[0] === "function") return a[0](el) ?? el;
        node.calls.push([prop, a]);
        return el;
      };
    },
  });
  return el;
}

export const isElement = (x) => Boolean(x && typeof x === "object" && x[NODE]);
export const nodeOf = (x) => (isElement(x) ? x[NODE] : null);

// A plain-data tree of an element: { kind, args, calls: [[name, args]] }, children (any element
// argument) expanded the same way, functions as "[fn]". Stable, so a test can deep-equal or snapshot it.
export function tree(x, seen = new Set()) {
  if (isElement(x)) {
    const n = nodeOf(x);
    if (seen.has(n)) return "[cycle]";
    seen.add(n);
    const out = { kind: n.kind, args: n.args.map((a) => tree(a, seen)), calls: n.calls.map(([m, a]) => [m, a.map((v) => tree(v, seen))]) };
    seen.delete(n);
    return out;
  }
  if (typeof x === "function") return "[fn]";
  if (x && typeof x === "object" && x.__state) return `[${x.__state.kind}]`; // a state handle (gpui-base.js)
  if (Array.isArray(x)) return x.map((v) => tree(v, seen));
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, tree(v, seen)]));
  return x;
}

// The tree as indented text, one call per line: easy to read in a failing diff.
export function snapshot(x, indent = "") {
  if (!isElement(x)) return `${indent}${JSON.stringify(tree(x))}`;
  const n = nodeOf(x);
  const lines = [`${indent}${n.kind}(${n.args.map(short).join(", ")})`];
  for (const [m, a] of n.calls) {
    const kids = a.filter(isElement);
    const rest = a.filter((v) => !isElement(v));
    if (m === "children" && Array.isArray(a[0])) {
      lines.push(`${indent}  .children`);
      for (const c of a[0]) lines.push(snapshot(c, `${indent}    `));
      continue;
    }
    lines.push(`${indent}  .${m}(${rest.map(short).join(", ")})`);
    for (const c of kids) lines.push(snapshot(c, `${indent}    `));
  }
  return lines.join("\n");
}
const short = (v) => (typeof v === "function" ? "[fn]" : isElement(v) ? "<el>" : JSON.stringify(tree(v)));

// Every element in a tree (the element itself first), depth first.
export function walk(x, out = []) {
  if (!isElement(x)) {
    if (Array.isArray(x)) x.forEach((v) => walk(v, out));
    return out;
  }
  out.push(nodeOf(x));
  for (const a of nodeOf(x).args) walk(a, out);
  for (const [, a] of nodeOf(x).calls) for (const v of a) walk(v, out);
  return out;
}
// The text children of a tree (strings passed to child/children), in order.
export function texts(x) {
  const out = [];
  for (const n of walk(x)) for (const [m, a] of n.calls) {
    if (m === "child" && typeof a[0] === "string") out.push(a[0]);
    if (m === "children" && Array.isArray(a[0])) out.push(...a[0].filter((v) => typeof v === "string"));
  }
  return out;
}
// The handlers recorded under a method name (on_click, on_key_down, ...) in a tree, with the id
// (`.id(...)`) of the element each is on.
export function handlers(x, method = "on_click") {
  return walk(x).flatMap((n) => n.calls.filter(([m]) => m === method).map(([, a]) => ({ id: n.calls.find(([m]) => m === "id")?.[1][0] ?? null, fn: a.find((v) => typeof v === "function") })));
}

export class View {
  constructor(props) { this.props = props; }
}

export const div = () => element("div");
export const svg = (path) => element("svg", [path]);
export const image = (path) => element("image", [path]);
export const list = (...args) => element("list", args);
export const uniform_list = (...args) => element("uniform_list", args);

// A static namespace whose every member makes an element named after it: PathBuilder.fill(...).
export const namespace = (name) => new Proxy({}, { get: (_t, prop) => (typeof prop === "symbol" ? undefined : (...a) => element(`${name}.${String(prop)}`, a)) });
export const PathBuilder = namespace("PathBuilder");
export const Background = namespace("Background");
