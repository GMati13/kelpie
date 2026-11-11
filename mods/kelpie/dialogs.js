// The Kelpie layout's own overlays. Roles:
//   story-picker  a popup over the window: the shown profile's stories in the list's order, filtered
//                 by key or words as you type; ↑/↓ and Enter open one (its space, else its preview),
//                 Esc closes (modelled on Herdr's `picker`)
//   confirm       asks before closing (props: { title, detail, yes, command: { name, args }, alt }); Enter
//                 or its button runs the command, Esc or Cancel closes; `alt` ({ label, command }), when
//                 given, is a second way out beside it; `changes` (an agent's profile change, config.js
//                 needsYes()): each setting under its page and name, its old and new value as lines
//                 removed and added, on a card sized to them (CHANGE_FIT)

import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { closeOverlay, openOverlay, props, run } from "herdr";
import { DIALOG, MOD, SMALL, TEXT, TITLE, chrome, empty, icon, primaryButton, textButton, tint } from "./ui.js";
import { moveStoriesToDone, moveStoryToDone, runPicks, selectStory, storyItems, storyState } from "./stories.js";
import { decor, skinFont, skinTheme, statusMark } from "./skins/index.js";
import { applyPendingProfile, installPlugin } from "./config.js";

export const openStoryPicker = () => openOverlay({ mod: MOD, kind: "popup", at: "top", offset: 40, width: 640, height: 520, props: { role: "story-picker" } });

const ROWS = 8; // rows shown at once; the selection keeps itself among them
const ROW_H = 44;

export class StoryPicker {
  init(cx) {
    this.filter = "";
    this.at = 0;
    this.input = InputState.new({ placeholder: "Go to a story: its key or words of its title" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; cx.notify(); });
    this.input.on("submit", () => this.go(this.rows()[this.at]));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus()); // as Herdr's picker: the popup may take focus as it opens
    this.handle = cx.focus_handle();
  }

  // Every word typed must be in the story's key, title, or a subtask's key or title.
  rows() {
    const s = storyItems();
    if (!s) return [];
    const words = this.filter.toLowerCase().split(/\s+/).filter(Boolean);
    // The finished stories of the sidebar's Done group come last, so they can be found again too.
    return [...s.items, ...s.done.map((x) => ({ ...x, done: true }))].filter(({ it }) => {
      const text = [it.key, it.title, ...it.subs.flatMap((x) => [x.key, x.title])].join(" ").toLowerCase();
      return words.every((w) => text.includes(w));
    }).map((x) => ({ ...x, profile: s.st.profile }));
  }

  go(x) {
    if (!x) return;
    closeOverlay(props().overlay);
    selectStory(x.profile, x.it);
  }

  render() {
    const t = skinTheme();
    const rows = this.rows();
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    const from = Math.max(0, Math.min(this.at - Math.floor(ROWS / 2), rows.length - ROWS));
    const row = (x, i) => {
      const on = i === this.at;
      const [, line, color] = x.n;
      // Its title and state line are cut to the row: the tooltip has them whole.
      return h_flex().id(`sp-${x.it.key}`).flex_none().h(ROW_H).mx(4).px(10).gap(10).items_center().rounded(7).cursor_pointer()
        .tooltip([`${x.it.key} ${x.it.title ?? ""}`.trim(), line].filter(Boolean).join("\n"))
        .when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
        .on_click(() => this.go(x))
        .child(statusMark(t, x.done ? "done" : storyState(x.it, x.n), { where: "picker", size: 8, color: t[color] ?? t.dim }) ?? div().flex_none().size(8).rounded_full().bg(t[color] ?? t.dim))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(h_flex().min_w(0).gap(8)
            .child(skinFont(div(), "numbers").flex_none().text_size(SMALL).text_color(t.accent).child(x.it.key))
            .child(skinFont(div(), "ui").flex_1().min_w(0).truncate().text_color(t.foreground).child(x.it.title)))
          .child(div().truncate().text_size(SMALL).text_color(color === "dim" ? t.muted : t[color] ?? t.muted).child(line)))
        .when(Boolean(x.it.space) || Boolean(x.done), (el) => el.child(div().flex_none().text_size(SMALL).text_color(t.dim).child(x.done ? "Done" : "Open here")));
    };
    const loaded = Boolean(storyItems());
    return decor("blockDecor", t, v_flex().id("story-picker").track_focus(this.handle).w_full().min_h(0).p(DIALOG.pad).gap(DIALOG.gap).bg(t.popover).text_size(TEXT)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "down" && rows.length) this.at = (this.at + 1) % rows.length;
        else if (e.key === "up" && rows.length) this.at = (this.at + rows.length - 1) % rows.length;
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .on_scroll_wheel((e, cx) => {
        if (!rows.length) return;
        this.at = Math.max(0, Math.min(rows.length - 1, this.at + (e.delta.y < 0 ? 1 : e.delta.y > 0 ? -1 : 0)));
        cx.notify();
      })
      .child(h_flex().items_center()
        .child(skinFont(div(), "title").flex_1().text_size(TITLE).font_semibold().text_color(t.foreground).child("Go to a story"))
        .child(div().text_size(SMALL).text_color(t.dim).child("Esc")))
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(icon(chrome("search"), 15).text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(TEXT).text_color(t.foreground)))
      .child(v_flex().id("sp-list").flex_none().gap(0)
        .children(rows.length ? rows.slice(from, from + ROWS).map((x, i) => row(x, from + i))
          : [empty(t, !loaded ? "This profile shows no stories (it needs a board: Jira or a GitHub Project), or they haven't loaded yet." : "No story matches.")]))
      .when(rows.length > ROWS, (el) => el.child(div().px(8).text_size(SMALL).text_color(t.dim).child(`${this.at + 1} of ${rows.length}`)))
      .child(div().px(8).text_size(SMALL).text_color(t.dim).child("↑↓ choose · Enter open · ⌘⇧J next that needs you · ⌘⇧R start or resume · ⌥⌘P pause")), { role: "story-picker", now: new Date() });
  }
}

// An agent's profile change: the dialog fills the window with no frame (config.js
// requestProfileChange()) and draws its card in the middle, at most `w` wide and as tall as what it
// says, up to the window less `margin` on each side; only the changes scroll, past that.
export const CHANGE_FIT = { w: 760, margin: 48 };
// Past this many line pairs, a changed value shows as all its old lines then all its new ones: the
// diff is worked out once per dialog, but a huge value mustn't keep the mod engine busy.
const LCS_MAX = 250000;

// A value's lines before and after, as the Changes view shows a patch: [{ kind: "same" | "del" |
// "add", text }], by the longest run of lines kept. Exported for the tests.
export function lineDiff(was, now) {
  const a = was == null ? [] : String(was).split("\n"), b = now == null ? [] : String(now).split("\n");
  const del = (text) => ({ kind: "del", text }), add = (text) => ({ kind: "add", text });
  if (a.length * b.length > LCS_MAX) return [...a.map(del), ...b.map(add)];
  // keep[i][j]: how many lines a[i..] and b[j..] keep in common at most.
  const keep = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    keep[i][j] = a[i] === b[j] ? keep[i + 1][j + 1] + 1 : Math.max(keep[i + 1][j], keep[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { out.push({ kind: "same", text: a[i] }); i++; j++; }
    else if (j < b.length && (i >= a.length || keep[i][j + 1] >= keep[i + 1][j])) out.push(add(b[j++]));
    else out.push(del(a[i++]));
  }
  // Within a run of changes, the removed lines first, as a patch has them.
  for (let s = 0; s < out.length; s++) {
    if (out[s].kind === "same") continue;
    let e = s;
    while (e < out.length && out[e].kind !== "same") e++;
    const run = out.slice(s, e);
    out.splice(s, e - s, ...run.filter((x) => x.kind === "del"), ...run.filter((x) => x.kind === "add"));
    s = e;
  }
  return out;
}

export class Confirm {
  init(cx) {
    // `changes`: their lines worked out once, not on every draw.
    this.diffs = (props()?.changes ?? []).map((c) => lineDiff(c.was, c.now));
    // `check`: a choice under the list ({ label, on, about }), its state kept here (Move to Done's
    // Clean up afterwards).
    this.checked = Boolean(props()?.check?.on);
    // Items with `choose` (Run all's picks) each have a switch, all on at first: the ones turned off.
    this.off = new Set();
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  // `pendingProfile`: an agent's profile change waiting for the person (config.js). It's applied here,
  // by this button, never through a command an agent could run itself; `installPlugin` (a profile id)
  // the same way: the Kelpie plugin installed on that profile's Claude account.
  // Installing runs in a task of this dialog's, which closes the dialog once the Desk's terminal is
  // open: a closed dialog's tasks are cancelled, so closing first left Install it doing nothing.
  // `doneStory` ({ profile, key }): Move to Done's tickets moved on the board by this button (stories.js
  // moveStoryToDone()), the dialog staying open, its button saying Moving…, until they're done;
  // `doneStories` ({ profile, keys }) the same for Next's Ready for Done, story after story
  // (moveStoriesToDone()).
  // `runPicks` ({ profile }): Run all's picks started by this button (stories.js runPicks()), the ones
  // still ticked, the dialog staying open as Starting… until the last has opened: no command does it,
  // as any agent can run one and this starts agents.
  yes(command = props().command, cx = null) {
    const { overlay, installPlugin: install, installThen: then = null, doneStory, doneStories, runPicks: picks } = props();
    if (picks) {
      if (this.busy) return;
      const keys = (props().items ?? []).filter((x) => x.choose && !this.off.has(x.choose)).map((x) => x.choose);
      if (!keys.length) return;
      this.busy = true;
      const ask = { ...picks, keys };
      if (!cx) return runPicks(ask).catch(() => null).finally(() => closeOverlay(overlay));
      cx.notify?.();
      cx.spawn(async () => { await runPicks(ask).catch(() => null); closeOverlay(overlay); });
      return;
    }
    if (doneStory || doneStories) {
      if (this.busy) return;
      this.busy = true;
      const ask = { ...(doneStory ?? doneStories), clean: props().check ? this.checked : null };
      const move = doneStory ? moveStoryToDone : moveStoriesToDone;
      if (!cx) return move(ask).catch(() => null).finally(() => closeOverlay(overlay));
      cx.notify?.();
      cx.spawn(async () => { await move(ask).catch(() => null); closeOverlay(overlay); });
      return;
    }
    if (install) {
      if (!cx) return installPlugin(install, then).finally(() => closeOverlay(overlay));
      cx.spawn(async () => { await installPlugin(install, then).catch(() => null); closeOverlay(overlay); });
      return;
    }
    closeOverlay(overlay);
    if (props().pendingProfile) return applyPendingProfile(true);
    if (!command) return;
    run(command.name, command.args ?? {});
  }
  no() {
    if (this.busy) return; // half the tickets moved: let it finish
    if (props().pendingProfile) applyPendingProfile(false);
    closeOverlay(props().overlay);
  }

  // One setting of an agent's profile change: its page and name as the profile dialog has them, over
  // its value as lines, kept as written (line breaks, leading spaces); a command in monospace, a
  // prompt in the reading font. A changed value shows its removed and added lines, as the Changes
  // view does; a new one, or one removed, says so beside its name.
  change(t, c, i) {
    const ADD = /^#[0-9a-f]{6}$/i.test(t.ansi2 ?? "") ? t.ansi2 : "#8cc26e", DEL = /^#[0-9a-f]{6}$/i.test(t.ansi1 ?? "") ? t.ansi1 : "#e5786d";
    const tag = c.was == null ? "new" : c.now == null ? "removed" : null;
    // A prompt from or back to its default: still a change of lines, said beside its name.
    const note = c.to === "default" ? "back to the default" : c.from === "default" ? "replacing the default" : null;
    const font = c.kind === "command" ? "mono" : c.kind === "prompt" ? "reading" : "ui";
    const lines = this.diffs?.[i] ?? lineDiff(c.was, c.now);
    const shown = (text) => text.replace(/^ +/, (sp) => "\u00a0".repeat(sp.length)) || "\u00a0";
    const line = (x, n) => {
      const color = tag ? null : x.kind === "add" ? ADD : x.kind === "del" ? DEL : null;
      return h_flex().id(`confirm-change-${i}-${n}`).w_full().items_start().when(Boolean(color), (el) => el.bg(tint(color, "24")))
        .when(!tag, (el) => el.child(div().w(18).flex_none().text_center().text_color(color ?? t.dim).child(x.kind === "add" ? "+" : x.kind === "del" ? "−" : "")))
        // Monospace as the Changes view's, a skin's own mono font over it.
        .child(skinFont(c.kind === "command" ? div().font_family("JetBrains Mono") : div(), font).flex_1().min_w(0).px(tag ? 10 : 4).text_color(x.kind === "same" ? t.muted : t.foreground).child(shown(x.text)));
    };
    return v_flex().id(`confirm-change-${i}`).flex_none().gap(6)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).text_size(SMALL).font_medium().text_color(t.muted).child(`${c.page} · ${c.label}`))
        .when(Boolean(tag), (el) => el.child(div().flex_none().text_size(SMALL).text_color(tag === "new" ? ADD : DEL).child(tag)))
        .when(Boolean(note), (el) => el.child(div().flex_none().text_size(SMALL).text_color(t.dim).child(note))))
      .child(v_flex().w_full().py(6).rounded(8).overflow_hidden().border_1().border_color(t.border).bg(t.background)
        .when(tag === "removed", (el) => el.opacity(0.7))
        .children(lines.map(line)));
  }

  // A switch, as the profile dialog's (no square boxes in Kelpie); `small` for a list's rows.
  toggle(t, on, small = false) {
    const w = small ? 28 : 34, h = small ? 16 : 20;
    return h_flex().flex_none().mt(small ? 2 : 1).w(w).h(h).p(2).rounded_full().bg(on ? t.accent : t.border).when(on, (c) => c.justify_end())
      .child(div().size(h - 4).rounded_full().bg(on ? t.accent_foreground : t.muted));
  }

  // The changes' height: as drawn once measured (divided by the zoom, as sizes set are zoomed again),
  // else a guess from their lines, so the first frame is near the right size.
  changesHeight(changes) {
    if (this.drawnH) return this.drawnH / (this.zoom || 1);
    const lines = (this.diffs ?? []).reduce((n, d) => n + d.reduce((m, x) => m + Math.max(1, Math.ceil(x.text.length / 80)), 0), 0);
    return changes.length * (20 + 6 + 12 + DIALOG.section) + lines * 22;
  }

  render() {
    const t = skinTheme();
    const p = props() ?? {};
    const fit = Boolean(p.changes?.length);
    const body = v_flex().id("kelpie-confirm").track_focus(this.handle).min_h(0).p(DIALOG.pad).gap(DIALOG.gap).bg(t.popover).text_size(TEXT)
      // The card of an agent's profile change: as tall as what it says, at most the window's room,
      // only its changes scrolling; any other confirm fills the dialog Herdr gives it.
      .when(fit, (el) => el.w_full().max_w(CHANGE_FIT.w).max_h_full().rounded(12).border_1().border_color(t.border).shadow_lg())
      .when(!fit, (el) => el.size_full())
      .on_key_down((e, cx) => {
        if (e.key === "enter") this.yes(undefined, cx);
        else if (e.key === "escape") this.no();
        else return;
        cx.stop_propagation();
      })
      .child(div().flex_none().text_size(TITLE).font_semibold().text_color(t.foreground).child(p.title ?? "Are you sure?"))
      .when(fit, (el) => el.child(div().flex_none().text_color(t.muted).child(p.detail ?? "")))
      .child(v_flex().id("confirm-detail").min_h(0).gap(DIALOG.gap).overflow_y_scrollbar()
        // A scroll area takes no height from what it holds, so the changes measure themselves and
        // that is its height, shrinking (and scrolling) only when the window has less room.
        .when(fit, (el) => el.relative().flex_shrink(1).h(this.changesHeight(p.changes))
          .child(div().id("confirm-zoom-probe").absolute().top(0).left(0).w(100).h(0).on_size_change((size, cx) => {
            const z = size.width / 100;
            if (z && Math.abs((this.zoom ?? 0) - z) > 0.001) { this.zoom = z; cx.notify(); }
          }))
          .child(v_flex().id("confirm-changes").flex_none().w_full().gap(DIALOG.section).on_size_change((size, cx) => {
            if (Math.abs((this.drawnH ?? 0) - size.height) < 0.5) return;
            this.drawnH = size.height;
            cx.notify();
          }).children(p.changes.map((c, i) => this.change(t, c, i)))))
        .when(!fit, (el) => el.flex_1())
        .when(!fit, (el) => el.child(div().text_color(t.muted).child(p.detail ?? "")))
        // `items`: a list under the sentence ({ key, text }: what a clean-up runs on, a key beside a
        // line when given). One with `choose` has a switch at its end, the whole row its click.
        .when(Boolean(p.items?.length), (el) => el.child(v_flex().gap(4).pl(4).children(p.items.map((x, i) => {
          const on = Boolean(x.choose) && !this.off.has(x.choose);
          return (x.choose ? h_flex().id(`confirm-pick-${i}`) : h_flex()).gap(8).items_start()
            .when(Boolean(x.choose), (row) => row.cursor_pointer().on_click((_e, cx) => {
              if (this.busy) return;
              if (this.off.has(x.choose)) this.off.delete(x.choose); else this.off.add(x.choose);
              cx.notify();
            }))
            .child(div().flex_none().text_color(t.dim).child("•"))
            .when(Boolean(x.key), (row) => row.child(div().flex_none().text_size(SMALL).mt(1).text_color(t.dim).child(x.key)))
            .child(div().flex_1().min_w(0).text_color(x.choose && !on ? t.muted : t.foreground).child(x.text))
            .when(Boolean(x.choose), (row) => row.child(this.toggle(t, on, true)));
        }))))
        // `check`: a switch, as the profile dialog's (no square boxes in Kelpie), the whole row its click.
        .when(Boolean(p.check), (el) => el.child(h_flex().id("confirm-check").gap(16).items_start().cursor_pointer()
          .on_click((_e, cx) => { if (this.busy) return; this.checked = !this.checked; cx.notify(); })
          .child(v_flex().flex_1().min_w(0).gap(2)
            .child(div().text_color(t.foreground).child(p.check.label))
            .when(Boolean(p.check.about), (c) => c.child(div().text_size(SMALL).text_color(t.dim).child(p.check.about))))
          .child(this.toggle(t, this.checked)))))
      .child(h_flex().flex_none().justify_end().gap(DIALOG.gap)
        .child(textButton(t, "confirm-no", "Cancel", () => this.no()))
        .when(Boolean(p.alt), (el) => el.child(textButton(t, "confirm-alt", p.alt.label, (_e, cx) => this.yes(p.alt.command, cx))))
        .child(primaryButton(t, "confirm-yes", this.busy ? (p.working ?? (this.checked && p.check ? "Moving and cleaning up…" : "Moving…")) : p.yes ?? "Confirm", (_e, cx) => this.yes(undefined, cx))));
    // The skin decorates the card, not the window around it.
    const card = decor("blockDecor", t, body, { role: "confirm", now: new Date() });
    return fit ? div().id("confirm-fit").size_full().flex().items_center().justify_center().p(CHANGE_FIT.margin).child(card) : card;
  }
}
