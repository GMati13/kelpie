// The Kelpie layout's own overlays. Roles:
//   story-picker  a popup over the window: the shown profile's stories in the list's order, filtered
//                 by key or words as you type; ↑/↓ and Enter open one (its space, else its preview),
//                 Esc closes (modelled on Herdr's `picker`)
//   confirm       asks before closing (props: { title, detail, yes, command: { name, args }, alt }); Enter
//                 or its button runs the command, Esc or Cancel closes; `alt` ({ label, command }), when
//                 given, is a second way out beside it

import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { closeOverlay, openOverlay, props, run } from "herdr";
import { DIALOG, MOD, SMALL, TEXT, TITLE, chrome, empty, icon, primaryButton, textButton } from "./ui.js";
import { selectStory, storyItems, storyState } from "./stories.js";
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
      return h_flex().id(`sp-${x.it.key}`).flex_none().h(ROW_H).mx(4).px(10).gap(10).items_center().rounded(7).cursor_pointer()
        .when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
        .on_click(() => this.go(x))
        .child(statusMark(t, x.done ? "done" : storyState(x.it, x.n), { where: "picker", size: 8, color: t[color] ?? t.dim }) ?? div().flex_none().size(8).rounded_full().bg(t[color] ?? t.dim))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(h_flex().min_w(0).gap(8)
            .child(skinFont(div(), "numbers").flex_none().text_size(SMALL).text_color(t.accent).child(x.it.key))
            .child(skinFont(div(), "ui").flex_1().min_w(0).truncate().text_color(t.foreground).child(x.it.title)))
          .child(div().truncate().text_size(SMALL).text_color(color === "dim" ? t.muted : t[color] ?? t.muted).child(line)))
        .when(Boolean(x.it.space) || Boolean(x.done), (el) => el.child(div().flex_none().text_size(SMALL).text_color(t.dim).child(x.done ? "Done" : "Open")));
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

export class Confirm {
  init(cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  // `pendingProfile`: an agent's profile change waiting for the person (config.js). It's applied here,
  // by this button, never through a command an agent could run itself; `installPlugin` (a profile id)
  // the same way: the Kelpie plugin installed on that profile's Claude account.
  // Installing runs in a task of this dialog's, which closes the dialog once the Desk's terminal is
  // open: a closed dialog's tasks are cancelled, so closing first left Install it doing nothing.
  yes(command = props().command, cx = null) {
    const { overlay, installPlugin: install, installThen: then = null } = props();
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
    if (props().pendingProfile) applyPendingProfile(false);
    closeOverlay(props().overlay);
  }

  render() {
    const t = skinTheme();
    const p = props() ?? {};
    return decor("blockDecor", t, v_flex().id("kelpie-confirm").track_focus(this.handle).size_full().min_h(0).p(DIALOG.pad).gap(DIALOG.gap).bg(t.popover).text_size(TEXT)
      .on_key_down((e, cx) => {
        if (e.key === "enter") this.yes(undefined, cx);
        else if (e.key === "escape") this.no();
        else return;
        cx.stop_propagation();
      })
      .child(div().text_size(TITLE).font_semibold().text_color(t.foreground).child(p.title ?? "Are you sure?"))
      .child(v_flex().id("confirm-detail").flex_1().min_h(0).gap(DIALOG.gap).overflow_y_scrollbar()
        .child(div().text_color(t.muted).child(p.detail ?? ""))
        // `items`: a list under the sentence ({ key, text }: what a clean-up runs on, a key beside a
        // line when given).
        .when(Boolean(p.items?.length), (el) => el.child(v_flex().gap(4).pl(4).children(p.items.map((x) => h_flex().gap(8).items_start()
          .child(div().flex_none().text_color(t.dim).child("•"))
          .when(Boolean(x.key), (row) => row.child(div().flex_none().text_size(SMALL).mt(1).text_color(t.dim).child(x.key)))
          .child(div().flex_1().min_w(0).text_color(t.foreground).child(x.text)))))))
      .child(h_flex().justify_end().gap(DIALOG.gap)
        .child(textButton(t, "confirm-no", "Cancel", () => this.no()))
        .when(Boolean(p.alt), (el) => el.child(textButton(t, "confirm-alt", p.alt.label, (_e, cx) => this.yes(p.alt.command, cx))))
        .child(primaryButton(t, "confirm-yes", p.yes ?? "Confirm", (_e, cx) => this.yes(undefined, cx)))), { role: "confirm", now: new Date() });
  }
}
