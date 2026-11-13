// Stub of Herdr's "herdr" host module, for the tests. Nothing here reaches Herdr, a terminal or the
// real Herdr homes: shared state lives in memory, the lists (spaces, agents, panes, ...) are what a test
// puts in `mock.state`, and every action (exec, hc, run, openOverlay, notify, ...) is recorded in
// `mock.calls` and answered by `mock.on.<name>` when a test sets it. See tests/README.md.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const OK = Object.freeze({ code: 0, stdout: "", stderr: "" });

const THEME = {
  background: "#101010", surface: "#181818", canvas: "#141414", chrome: "#121212", popover: "#1c1c1c", raised: "#202020",
  hover: "#262626", selected: "#2c2c2c", border: "#333333", input: "#1e1e1e", foreground: "#e0e0e0", muted: "#a0a0a0",
  dim: "#707070", accent: "#4080ff", accent_foreground: "#ffffff", solid: "#e0e0e0", solid_foreground: "#101010",
  selection: "#304060", working: "#d0a020", blocked: "#e05050", done: "#40c060", idle: "#808080", unknown: "#606060",
  ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`ansi${i}`, "#8080" + (i * 16).toString(16).padStart(2, "0")])),
};

const fresh = () => ({
  shared: new Map(),
  spaces: [], agents: [], panes: [], terminals: [], machines: [], layouts: [], themes: [], fonts: [], keys: [], commands: [],
  layout: null, focused: null, props: {}, settings: {}, placement: null,
  theme: { ...THEME },
  window: { platform: "macos", titlebar: "none", buttons: false, maximized: false, fullscreen: false, active: true },
  home: "/nonexistent/kelpie-test-home",
  appHome: "/nonexistent/kelpie-test-home/.config/herdr-app",
});

const json = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
// What a read hands out: a copy, as Herdr's, but frozen. Kelpie keeps each read for the whole render
// and hands the one value to every caller (mods/kelpie/host.js), so one changed in place would change
// it for the rest: here that throws instead.
const frozen = (v) => {
  if (v && typeof v === "object" && !Object.isFrozen(v)) { for (const x of Object.values(v)) frozen(x); Object.freeze(v); }
  return v;
};
const copy = (v) => frozen(json(v));

export const mock = {
  state: fresh(),
  calls: [], // { fn, args } in the order they were made
  reads: {}, // host reads of live data and shared state, by name ("spaces", "shared:<key>"): how many
  on: {},    // fn name -> (...args) => result (a value or a promise; undefined: the default)
  overlays: 0,

  // Back to a clean state: call it in beforeEach.
  reset() {
    this.state = fresh();
    this.calls = [];
    this.reads = {};
    this.on = {};
    this.overlays = 0;
  },
  // The arguments of each recorded call of `fn`.
  of(fn) { return this.calls.filter((c) => c.fn === fn).map((c) => c.args); },
  // Shared state without the stub's copying (for asserting).
  sharedValue(key) { return json(this.state.shared.get(key)) ?? null; },
  // A path under appHome()/mods/ as the repo's own file (the mods as if installed), else unchanged.
  repoPath(path) {
    const mods = `${this.state.appHome}/mods/`;
    return path.startsWith(mods) ? `${REPO}mods/${path.slice(mods.length)}` : path;
  },
  // Runs a command for real (spawnSync), answering as exec() does: { code, stdout, stderr }; paths of
  // the installed mods in its arguments are the repo's. For a test that wants a script to actually run
  // (`mock.on.exec = (c, a, o) => mock.realExec(c, a, o)`). `options.env` replaces the environment.
  realExec(command, args = [], options = {}) {
    const r = spawnSync(command, args.map((a) => this.repoPath(String(a))), { cwd: options.cwd, encoding: "utf8", timeout: options.timeout ?? 30000, env: options.env ?? process.env });
    if (r.error) throw r.error;
    return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  },
};

function record(fn, args) { mock.calls.push({ fn, args }); }
async function answer(fn, args, fallback) {
  record(fn, args);
  const h = mock.on[fn];
  const r = h ? await h(...args) : undefined;
  return r === undefined ? fallback : r;
}
function answerNow(fn, args, fallback) {
  record(fn, args);
  const h = mock.on[fn];
  const r = h ? h(...args) : undefined;
  return r === undefined ? fallback : r;
}

// --- Processes and files -----------------------------------------------------------------------
export const exec = (command, args = [], options = {}) => answer("exec", [command, args, options], { ...OK });
export const hc = (args) => answer("hc", [args], { ...OK });
export const home = () => mock.state.home;
export const appHome = () => mock.state.appHome;
// The mods are taken to be installed in appHome()/mods: a file there (modFile() in ui.js) is read
// from the repo's mods folder, as is any file of the repo; anything else is null unless a test
// answers it.
export function readTextFile(path, options = {}) {
  return answer("readTextFile", [path, options], (() => {
    const file = mock.repoPath(String(path));
    if (!file.startsWith(REPO)) return null;
    try { return readFileSync(file, "utf8"); } catch { return null; }
  })());
}
export const writeTextFile = (path, text, expected) => answer("writeTextFile", [path, text, expected], null);
export const knownAgents = (options = {}) => answer("knownAgents", [options], []);
export const pickFolder = (options = {}) => answer("pickFolder", [options], null);
export const watchFolder = (path) => { record("watchFolder", [path]); return new Promise(() => {}); };
export const nextCommand = () => { record("nextCommand", []); return new Promise(() => {}); };

// --- Actions -----------------------------------------------------------------------------------
export const run = (name, args = {}) => { answerNow("run", [name, args], null); return null; };
export const playSound = (sound) => { answerNow("playSound", [sound], null); return null; };
export const setAgentOrder = (addresses) => { answerNow("setAgentOrder", [addresses], null); return null; };
export const openOverlay = (spec) => answerNow("openOverlay", [spec], `overlay-${++mock.overlays}`);
export const closeOverlay = (id) => { answerNow("closeOverlay", [id], null); return null; };
export const notify = (n) => { answerNow("notify", [n], null); return null; };
export const presentUpdateNotes = (versions) => { answerNow("presentUpdateNotes", [versions], null); return null; };

// --- Shared state: kept in memory, copied in and out as Herdr's JSON store does ---------------
const read = (name) => { mock.reads[name] = (mock.reads[name] ?? 0) + 1; };
export const shared = (key) => (read(`shared:${key}`), copy(mock.state.shared.get(key)) ?? null);
export function setShared(key, value) {
  record("setShared", [key, json(value)]);
  if (value === null || value === undefined) mock.state.shared.delete(key);
  else mock.state.shared.set(key, json(value));
  return null;
}

// --- What Herdr shows: whatever the test put in mock.state ----------------------------------
export const spaces = () => (read("spaces"), copy(mock.state.spaces));
export const agents = () => (read("agents"), copy(mock.state.agents));
export const panes = () => (read("panes"), copy(mock.state.panes));
export const terminals = () => (read("terminals"), copy(mock.state.terminals));
export const machines = () => json(mock.state.machines);
export const focused = () => (read("focused"), copy(mock.state.focused));
export const layout = () => (read("layout"), copy(mock.state.layout));
export const layouts = () => json(mock.state.layouts);
export const props = () => mock.state.props;
export const settings = () => json(mock.state.settings);
export const theme = () => ({ ...mock.state.theme });
export const themes = () => json(mock.state.themes);
export const fonts = () => json(mock.state.fonts);
export const keys = () => json(mock.state.keys);
export const commands = () => json(mock.state.commands);
export const window = () => ({ ...mock.state.window });
export const placement = () => json(mock.state.placement);
export const updates = () => ({ current: "0.0.0", available: null });
export const telemetry = () => ({ enabled: false });

// --- Feedback (unused by Kelpie) ------------------------------------------------------------
export const feedbackPreview = () => ({ body: null, available: false });
export const feedbackPasteImage = () => null;
export const feedbackPickImages = async () => [];
export const feedbackAttachImages = () => [];
export const feedbackClearImages = () => null;
export const sendFeedback = async () => null;
