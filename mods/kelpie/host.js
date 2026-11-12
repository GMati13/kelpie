// Herdr's reads, kept for one render (#37). Every host read converts its whole value into the mod
// engine (spaces(), agents(), panes(), layout() list every space, pane and agent of every Herdr window;
// a profile's stories copy in shared state is ~80 KB), and the helpers a render goes through each ask
// again: one tab bar render read the spaces 19 times and the stories copy twice. Inside a render
// (`rendering()`, which main.js wraps around every Kelpie view's), each read is made once and handed
// to every caller; outside one (a click, a timer, a task after its first await) every read is fresh.
// Nothing changes Herdr's state in the middle of a render but the render itself, so what it writes
// drops what it read: setShared() the key written (and what was worked out from the reads), run() and
// hc() everything, as a layout or space command may change the lists.
// Values are shared by every caller in the render: never change one in place (tests/stubs/herdr.js
// hands them out frozen, so a mod that does fails its tests).
import { agents as hostAgents, focused as hostFocused, hc as hostHc, layout as hostLayout, panes as hostPanes, run as hostRun, setShared as hostSetShared, shared as hostShared, spaces as hostSpaces, terminals as hostTerminals } from "herdr";

let frame = null; // while a render runs: read name -> value
let derived = null; // while a render runs: what was worked out from the reads (memo()), by name

// Runs `fn` (a render) with its reads kept until it returns. A render inside a render keeps the outer's.
export function rendering(fn) {
  if (frame) return fn();
  frame = new Map();
  derived = new Map();
  try {
    return fn();
  } finally {
    frame = null;
    derived = null;
  }
}

const kept = (name, read) => {
  if (!frame) return read();
  if (!frame.has(name)) frame.set(name, read());
  return frame.get(name);
};
// What a render works out from its reads once (the story list's build, say) and hands to every caller:
// worked out again after anything is written. Outside a render, `fn()` every time.
export function memo(name, fn) {
  if (!derived) return fn();
  if (!derived.has(name)) derived.set(name, fn());
  return derived.get(name);
}
const forget = () => { frame?.clear(); derived?.clear(); };

export const spaces = () => kept("spaces", hostSpaces);
export const agents = () => kept("agents", hostAgents);
export const panes = () => kept("panes", hostPanes);
export const terminals = () => kept("terminals", hostTerminals);
export const focused = () => kept("focused", hostFocused);
export const layout = () => kept("layout", hostLayout);
export const shared = (key) => kept(`shared:${key}`, () => hostShared(key));
export function setShared(key, value) {
  frame?.delete(`shared:${key}`);
  derived?.clear();
  return hostSetShared(key, value);
}
export function run(name, args) {
  forget();
  return arguments.length > 1 ? hostRun(name, args) : hostRun(name);
}
export const hc = (args, ...rest) => {
  forget();
  return hostHc(args, ...rest);
};
