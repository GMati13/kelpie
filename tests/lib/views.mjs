// A Herdr world for the view tests (tests/README.md, Snapshots): the demo fixture
// (mods/kelpie/demo/demo.json) as the shown profile, its spaces and agents as Herdr would report them,
// at a fixed time, and a fake `cx` for rendering. Import this before any mod file: it pins the clock
// and the time zone, which the views read (ago(), the footer's clock, the skin's hour).
import { readFileSync } from "node:fs";
import { mock } from "herdr";
import { REPO, repoFile } from "./helpers.mjs";

// --- A fixed clock: every Date.now() and new Date() is NOW (a Tuesday, 10:00 UTC) ---------------
process.env.TZ = "UTC";
export const NOW = Date.parse("2026-11-10T10:00:00Z");
const RealDate = globalThis.Date;
class FixedDate extends RealDate {
  constructor(...a) { super(...(a.length ? a : [NOW])); }
  static now() { return NOW; }
}
globalThis.Date = FixedDate;

export const FIXTURE = JSON.parse(readFileSync(repoFile("mods/kelpie/demo/demo.json"), "utf8"));
const UNITS = { m: 60e3, h: 3600e3, d: 864e5 };
export const when = (v) => { const m = /^([+-]\d+(?:\.\d+)?)([mhd])$/.exec(String(v)); return m ? NOW + Number(m[1]) * UNITS[m[2]] : NOW; };

export const DEMO = "demo";
export const FOLDER = "/home/test/.local/share/kelpie/demo/acme";
const LAYOUTS = { "Kelpie": "layouts/Kelpie.json", "Kelpie-Plain": "layouts/Kelpie-Plain.json" };

// The demo profile, as kelpie.demo saves it (demo.js setupDemo), in a home of the test's.
export function demoProfile() {
  const p = FIXTURE.profile;
  return {
    id: DEMO, name: p.name, folder: FOLDER, demo: true, claude: null,
    jira: { url: `${p.site}/jira/software/projects/${p.project}/boards/${p.board}`, site: p.site, board: p.board, demo: true },
    github: { owner: p.owner, demo: true },
  };
}

// Herdr's spaces, tabs, panes and agents for the fixture's spaces: space `s<i>`, tab `t<i>-<j>`,
// pane `p<i>-<j>`, agent address `a<i>-<j>`. `shown`: the name of the space shown (null: none).
// `agentOf(spaceName, tabName, agent)` may change or drop (null) an agent before it's listed.
export function demoWorld({ shown = null, agentOf = (_s, _t, a) => a, spaces = FIXTURE.spaces } = {}) {
  const out = { spaces: [], agents: [], panes: [] };
  spaces.forEach((s, i) => {
    const id = `s${i}`;
    const tabs = [];
    s.tabs.forEach((tab, j) => {
      const tid = `t${i}-${j}`, pid = `p${i}-${j}`;
      const agent = tab.agent ? agentOf(s.name, tab.name, { address: `a${i}-${j}`, space: id, tab: tid, pane: pid, tab_name: tab.name, status: tab.agent, title: tab.title ?? "", focused: false, program: { name: "Claude Code", agent: true } }) : null;
      tabs.push({ id: tid, name: tab.name, named: true, index: j + 1, active: j === 0, status: agent?.status ?? null });
      out.panes.push({ id: pid, tab: tid, cwd: FOLDER, focused: j === 0, title: agent ? `✳ ${tab.title ?? ""}` : "zsh", program: agent ? { name: "Claude Code", agent: true } : { name: "zsh" } });
      if (agent) out.agents.push(agent);
    });
    out.spaces.push({ id, name: s.name, folder: FOLDER, active: s.name === shown, tabs });
  });
  return out;
}

// Resets the stub and puts the demo profile in it (`profile`: settings over the demo's): its spaces
// (`shown`, `agentOf`, `spaces` as demoWorld() takes them), owned by the profile, its Desk, paused
// agents, the layout (and so the skin) named `layout`, the block's `props`. `stories`: the loaded
// stories (loadStories()), shared again as the list shares them.
export function setupDemoWorld({ layout = "Kelpie", shown = null, agentOf, spaces, paused = FIXTURE.paused, props = {}, stories = null, profile = {} } = {}) {
  mock.reset();
  mock.state.home = "/home/test";
  mock.state.appHome = "/home/test/.config/herdr-app";
  mock.state.layout = JSON.parse(readFileSync(`${REPO}/${LAYOUTS[layout] ?? LAYOUTS.Kelpie}`, "utf8"));
  mock.state.props = props;
  const w = demoWorld({ shown, agentOf, spaces });
  Object.assign(mock.state, w);
  const shared = mock.state.shared;
  shared.set("layout", layout);
  shared.set("kelpie.profiles", { [DEMO]: { ...demoProfile(), ...profile } });
  if (stories) shared.set("kelpie.stories.data", { [DEMO]: stories });
  shared.set("kelpie.space.profile", Object.fromEntries(w.spaces.map((s) => [s.id, DEMO])));
  const desk = w.spaces.find((s) => s.name === "Desk");
  if (desk) shared.set("kelpie.desk", { [DEMO]: desk.id });
  const p = {};
  for (const [key, list] of Object.entries(paused ?? {})) p[key] = list.map((x, n) => ({ sessionId: x.id ?? `demo-paused-${key}-${n}`, cwd: FOLDER, name: x.name ?? key, at: when(x.at ?? "-3h") }));
  shared.set("kelpie.paused", { [DEMO]: p });
  // Shown with no space of its own: as picked in the profile menu.
  if (!w.spaces.some((s) => s.active)) shared.set("kelpie.profile.chosen", { id: DEMO, space: null });
  // demo.js asks the shell for $HOME; the rest of exec (sleep, python3, ...) answers nothing.
  mock.on.exec = (cmd, args) => (cmd === "sh" && String(args?.[1] ?? "").includes('"$HOME"') && String(args[1]).startsWith("printf") ? { code: 0, stdout: "/home/test", stderr: "" } : undefined);
  return w;
}

// A cx for render(): spawn() runs the task and keeps its promise (settle() waits for them all),
// timers and notify() only count.
export function fakeCx() {
  const cx = {
    tasks: [], notified: 0,
    spawn(fn) { const p = Promise.resolve().then(() => fn(cx)).catch((e) => { cx.errors.push(e); }); cx.tasks.push(p); return p; },
    errors: [],
    notify() { cx.notified++; },
    timer: { every() {}, after() {} },
    stop_propagation() {},
    focus_handle() { return { focus() {}, is_focused: () => false }; },
    async settle(rounds = 5) {
      for (let i = 0; i < rounds; i++) {
        const now = cx.tasks.splice(0);
        if (!now.length) break;
        await Promise.all(now);
      }
    },
  };
  return cx;
}

// The stories' data as the list loads it (Stories.fetch, answered by the demo fixture) and shares it
// in kelpie.stories.data, so every view reads it as Herdr's would. Loaded once per test file.
export async function loadStories(StoryList, cx = fakeCx()) {
  const list = new StoryList();
  list.init(cx);
  await cx.settle(10);
  if (cx.errors.length) throw cx.errors[0];
  const data = mock.sharedValue("kelpie.stories.data");
  if (!data?.[DEMO]?.data) throw new Error(`the stories didn't load: ${JSON.stringify(data?.[DEMO]?.error ?? null)}`);
  return data[DEMO];
}

// Draws a view the way Herdr does: init, a first render (which may start loads), the loads settled,
// then the render that's returned. `view` is an instance; `init(view, cx)` overrides how it starts.
export async function draw(view, { cx = fakeCx(), init = (v, c) => v.init?.(c) } = {}) {
  init(view, cx);
  view.render(cx);
  await cx.settle();
  if (cx.errors.length) throw cx.errors[0];
  return { el: view.render(cx), view, cx };
}
