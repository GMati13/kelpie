// What every Hub source shares: it shows the shown space's data, by that space's setup, loading on
// start, on a timer, on Refresh and when the space or its setup changes; its frame; starting agents.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, setShared, shared, spaces } from "./host.js";
import { SMALL, TEXT, ago, chrome, empty as emptyText, icon, placed, primaryButton } from "./ui.js";
import { claudeArgv, newTab, openProfile, openSetup, setupOf, shownSpace } from "./config.js";
import { asked, began, ended, skipped, waits } from "./debug.js";

export const REFRESH = "kelpie.refresh";
const STUCK = 2 * 60 * 1000;
export const count = (id, space) => `kelpie.count.${id}.${space}`;

export class Source {
  // needs: what of the setup it can't work without ("jira", "github"), or null.
  constructor(id, every, needs = null) {
    this.id = id;
    this.every = every;
    this.needs = needs;
    this.cache = {}; // context key -> { data, error, at }
    this.busy = new Set();
    this.started = {}; // context key -> when its load started
    this.again = new Set(); // context keys asked to load again while their load was running
  }

  init(cx) {
    this.seen = shared(REFRESH);
    if (this.wanted()) this.load(cx, { why: "start" }); else this.skipped = true;
    cx.timer.every(this.every, (cx) => { if (this.wanted()) this.load(cx, { why: "timer" }); else this.skipped = true; });
  }

  // Whether its loads are worth making now. A source its view doesn't draw (the sidebar's sessions
  // while the profile shown has a board, whose list loads its own) skips the timer's: each would run
  // its script and redraw the view for nothing. Drawn again, it loads at once (state()).
  wanted() {
    return true;
  }

  // Its name in the load record (debug.js): the source and whose data it is.
  job(ctx) {
    return `${this.id}:${ctx.profile?.id ?? ctx.space?.id ?? "none"}`;
  }

  // The shown space, its setup, and a key that changes when either (or a source's own option) does.
  context() {
    const space = shownSpace();
    const setup = setupOf(space);
    return { space, setup, key: JSON.stringify([space?.id, this.keyOf(setup)]) };
  }

  keyOf(setup) {
    return this.needs ? setup[this.needs] : setup.folder;
  }

  ready(ctx) {
    return Boolean(ctx.space) && (!this.needs || Boolean(ctx.setup[this.needs]));
  }

  // `again`: asked for because something may have changed (Refresh, Kelpie's own action, an agent's
  // turn ending). A load already running began before that change, so its answer may not have it:
  // the request isn't dropped but waits, and the next draw once that load ends loads again. A timer's
  // or a stale copy's request isn't kept, as the load running answers it.
  //   `why`: what asked for it, for the load record (debug.js).
  load(cx, { again = false, why = again ? "asked again" : "asked" } = {}) {
    const ctx = this.context();
    if (!this.ready(ctx)) return;
    const job = this.job(ctx);
    asked(job, why);
    // A load still marked busy after STUCK was dropped (a reload or restart mid-load ends its task
    // without its finally): it no longer blocks the next one, or "Updating…" would stay for good.
    if (this.busy.has(ctx.key) && Date.now() - (this.started[ctx.key] ?? 0) < STUCK) {
      if (again) { this.again.add(ctx.key); waits(job, why, cx); }
      else skipped(job, `${why}: the load running answers it`, cx);
      return;
    }
    this.again.delete(ctx.key);
    this.busy.add(ctx.key);
    this.started[ctx.key] = Date.now();
    began(job, why, cx);
    cx.spawn(async (cx) => {
      const before = this.cache[ctx.key];
      let error = null;
      try {
        const data = await this.fetch(ctx);
        this.cache[ctx.key] = { data, error: null, at: Date.now() };
        const n = this.count?.(data);
        const name = count(this.id, ctx.profile?.id ?? ctx.space?.id ?? "none");
        if (typeof n === "number" && shared(name) !== n) setShared(name, n);
        this.loaded?.(ctx); // a source shown by several copies wakes the others
      } catch (e) {
        error = String(e?.message ?? e);
        this.cache[ctx.key] = { data: before?.data ?? null, error, at: Date.now() };
        this.loaded?.(ctx); // the others show the error too
      } finally {
        this.busy.delete(ctx.key);
        ended(job, error, cx);
        cx.notify();
      }
    });
  }

  // First in render: what to show now. A Refresh press, a space or setup not loaded yet, or a load
  // asked for while the last one ran (`again`), loads.
  state(cx) {
    const ctx = this.context();
    const r = shared(REFRESH);
    if (r !== this.seen) { this.seen = r; this.skipped = false; this.load(cx, { again: true, why: "refresh" }); }
    else if (!this.cache[ctx.key] || this.skipped || (this.again.has(ctx.key) && !this.busy.has(ctx.key))) {
      const why = !this.cache[ctx.key] ? "nothing loaded yet" : this.skipped ? "drawn again: the timer's loads were skipped" : "asked again while one ran";
      this.skipped = false;
      this.load(cx, { why });
    }
    return { ...ctx, ...(this.cache[ctx.key] ?? { data: null, error: null, at: 0 }), loading: this.busy.has(ctx.key) };
  }
}

// The frame every source draws in: a row of filters and the state on the right, then the body.
export function frame(t, st, filters, body) {
  const when = st.at ? ago(st.at) : null;
  const label = st.loading && !st.data ? "Loading…" : st.loading ? "Updating…" : when === "now" ? "Updated just now" : when ? `Updated ${when} ago` : "";
  return v_flex().size_full().min_h(0).px(12).pb(12).gap(10).text_size(TEXT).text_color(t.foreground)
    .child(h_flex().h(32).flex_none().gap(4).items_center()
      .children(filters ?? [])
      .child(div().flex_1())
      .child(div().text_size(SMALL).text_color(t.dim).child(label)))
    .when(Boolean(st.error), (el) => el.child(notice(t, st.error, t.blocked)))
    .child(body);
}

export function notice(t, text, color) {
  return div().flex_none().px(12).py(10).rounded(10).border_1().border_color(t.border).text_size(SMALL).text_color(color ?? t.muted).child(text);
}

// A source's "nothing here": ui.js's empty text, centred in the view.
export const empty = (t, text) => emptyText(t, text, { fill: true });

// A source this space hasn't been set up for: what it would show, and the button to set it up (`focus`,
// the profile dialog's tab it opens, when `what` isn't its name). The profile shown (one picked in the
// menu, say) is the one set up, not the shown space's.
export function needsSetup(t, st, what, glyph, line, focus = what.toLowerCase()) {
  const profile = st.profile ?? st.setup?.profile ?? null;
  if (!st.space && !profile) return empty(t, "No space is shown.");
  return v_flex().size_full().items_center().justify_center().gap(6).text_size(TEXT)
    .child(div().flex().size(40).mb(6).items_center().justify_center().rounded(12).bg(t.raised).border_1().border_color(t.border)
      .child(icon(chrome(glyph), 18).text_color(t.muted)))
    .child(div().font_medium().text_color(t.foreground).child(`Connect ${what} to ${profile?.name ?? st.space.name}`))
    .child(div().max_w(380).text_size(SMALL).text_color(t.dim).text_center().child(line))
    .child(primaryButton(t, `setup-${focus.replace(/\W+/g, "-")}`, `Set up ${what}`, () => (profile ? openProfile(profile.id, { space: st.space, focus }) : openSetup(st.space, focus))).mt(8));
}

// Starts (or, if a tab with this name is open, shows) a Claude agent in the space, in its folder.
// With no space shown (or the one shown then closed since), it gets a new space of its own. Its
// terminal is told the profile, and no story (placed(), ui.js): these spaces are a profile's own
// ("Working on"), as a story's agents start through stories.js.
export function startAgent(st, { name, task, folder, argv: given }) {
  const tab = name && spaces().flatMap((s) => s.tabs).find((c) => c.name === name);
  if (tab) return run("tab.select", { id: tab.id });
  const where = folder ?? st.setup.folder;
  const profile = st.setup?.profile ?? st.profile;
  const argv = placed(given ?? claudeArgv(profile), profile);
  if (!st.space || !spaces().some((s) => s.id === st.space.id)) {
    return run("space.new", { ...(where ? { folder: where } : {}), ...(name ? { tab: name } : {}), argv, ...(task ? { task } : {}) });
  }
  return newTab({
    space: st.space.id,
    ...(where ? { folder: where } : {}),
    ...(name ? { name } : {}),
    argv,
    ...(task ? { task } : {}),
  });
}
