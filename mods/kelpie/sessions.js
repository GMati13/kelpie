// Previous Claude sessions started in the space's folder or under it, newest first, on its profile's
// Claude account only (another account's sessions are another profile's). Clicking one resumes it in a new tab in its own folder; one that is still running is shown instead. A space on
// another machine reads that machine's sessions.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, readTextFile } from "herdr";
import { agents, run } from "./host.js";
import { skinTheme } from "./skins/index.js";
import { SMALL, ago, chrome, claudeSession, icon, modFile, resumeArgv } from "./ui.js";
import { Source, empty, frame, startAgent } from "./source.js";
import { claudeConfigOf } from "./config.js";

// The running agent whose claude is this session, found by its process.
async function focusRunning(id) {
  for (const a of agents()) {
    const rec = await claudeSession(a.address).catch(() => null);
    if (rec?.sessionId === id) return run("pane.focus", { pane: a.pane });
  }
  return null;
}

// The Claude config folder a profile's sessions live in: its account, else Claude's own ~/.claude.
const account = (profile) => claudeConfigOf(profile) ?? "~/.claude";

const base = (path) => path.replace(/\/+$/, "").split("/").pop() || path;

// Which day group a time falls in. `at` is epoch ms.
function day(at, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (at >= start) return "Today";
  if (at >= start - 864e5) return "Yesterday";
  if (at >= start - 6 * 864e5) return "Earlier this week";
  return "Older";
}

export class Sessions extends Source {
  constructor() {
    super("sessions", 60 * 1000);
  }

  keyOf(setup) {
    return JSON.stringify([setup.folder, account(setup.profile)]);
  }

  ready(ctx) {
    return Boolean(ctx.space && ctx.setup.folder);
  }

  async fetch({ space, setup }) {
    // The script runs where the space is: this machine, or the space's own through herdr-core.
    const code = await readTextFile(modFile("sessions.py"));
    const r = await exec("python3", ["-I", "-c", code, setup.folder, "40", account(setup.profile)], space.machine ? { on: space.machine } : {});
    if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || "Couldn't read the sessions.");
    return JSON.parse(r.stdout);
  }

  row(t, st, s) {
    const root = st.setup.folder.replace(/\/+$/, "");
    const where = s.cwd === root ? base(root) : `${base(root)}/${s.cwd.slice(root.length + 1)}`;
    const meta = [where, s.branch && s.branch !== "HEAD" ? s.branch : null, ago(s.updated)].filter(Boolean).join(" · ");
    return h_flex().id(`session-${s.id}`).flex_none().px(10).py(7).gap(10).items_center().rounded(10).cursor_pointer()
      .hover((x) => x.bg(t.hover))
      .tooltip(s.running ? "Show the running agent" : s.prompt ? `Continue where you left off. Last prompt: ${s.prompt.slice(0, 200)}` : "Continue where you left off")
      .on_click(() => (s.running ? focusRunning(s.id) : startAgent(st, { folder: s.cwd, argv: resumeArgv(s.id, s.config, (st.setup ?? st.profile)?.github?.account) })))
      // A running session glows green where the others show a clock.
      .child(s.running
        ? div().flex().flex_none().size(14).items_center().justify_center().child(div().size(7).rounded_full().bg(t.done).loop("opacity", { from: 0.45, to: 1, period: 1600 }))
        : icon(chrome("clock")).text_color(t.dim))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().child(s.title))
        .child(div().truncate().text_size(SMALL).text_color(t.dim).child(meta)))
      .child(div().flex_none().text_size(SMALL).text_color(s.running ? t.done : t.dim).child(s.running ? "Running" : "Continue"));
  }

  render(cx) {
    const st = this.state(cx);
    const t = skinTheme();
    if (!this.ready(st)) return frame(t, st, [], empty(t, "Open a terminal in this space and its sessions will gather here."));
    const filters = [div().text_size(SMALL).text_color(t.dim).truncate().child(st.setup.folder)];
    if (!st.data) return frame(t, st, filters, st.error ? div().flex_1() : empty(t, "Gathering your sessions…"));
    if (!st.data.length) return frame(t, st, filters, empty(t, "No Claude sessions here yet. Start one and it will wait for you here."));
    // By day, as Finder groups files: Today, Yesterday, the last week, older.
    const groups = [];
    for (const s of st.data) {
      const label = day(s.updated);
      if (groups[groups.length - 1]?.label !== label) groups.push({ label, list: [] });
      groups[groups.length - 1].list.push(s);
    }
    return frame(t, st, filters, v_flex().id("sessions-list").flex_1().min_h(0).gap(10).overflow_y_scrollbar().children(groups.map((g) => v_flex().flex_none().gap(1)
      .child(div().px(10).pb(2).text_size(SMALL).font_medium().text_color(t.muted).child(g.label))
      .children(g.list.map((s) => this.row(t, st, s))))));
  }
}
