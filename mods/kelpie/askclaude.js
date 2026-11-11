// Ask Claude: one way to ask a Claude about something Kelpie shows (KELPIE-84). Its picker asks who
// (a new Claude in the story's space, or on the Desk outside a story, or one of the Claudes already
// open there) and what (a typed message, or one of the suggestions, each a profile message:
// config.js ASK_CLAUDE). What's asked about goes first, as a line Kelpie writes from its values
// (promptValue()), and a task about others' work ends with OTHERS. Sending is the caller's (stories.js,
// through sendToClaude()); this module holds the rules and the picker's look.
//
// Its look is Kelpie's "magic", what marks anything Claude does for the person (CLAUDE.md, Visual
// kit): the sparkles in the accent, an accent edge, and nothing moving while nothing is happening.

import { div } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import { SMALL, agentMark, icon, own, sessionTitle, stop, textButton, tint } from "./ui.js";
import { ASK_CLAUDE, ASK_PROMPTS, OTHERS, askText, promptValue } from "./config.js";

// The Claudes a story's ask may go to: those in its space, and those on one of its keys elsewhere
// (a tab named after the key), never another story's or profile's. Outside a story (`story` null),
// the Desk's (`desk`). `keyOf` reads a ticket key out of a tab's name.
export function openClaudes(story, all, keyOf, desk = []) {
  if (!story) return desk;
  const keys = [story.key, ...(story.subs ?? []).map((s) => s.key)];
  return all.filter((a) => (story.space && a.space === story.space.id) || keys.includes(keyOf(a.tab_name)));
}

// Who the picker offers, in order: a new Claude first, then the open ones, the one on the asked
// key (its tab named after it) before the rest. One waiting for the person's answer is shown but
// can't be picked: a message would land in its question. `id` is "new" or the agent's address.
export function askWho({ story, key, open, keyOf, names = new Map() }) {
  const on = (a) => keyOf(a.tab_name) === key;
  const agents = [...open.filter(on), ...open.filter((a) => !on(a))];
  return [
    { id: "new", label: "New Claude", hint: story ? `in ${story.key}'s space` : "on the Desk", tip: story ? `A new Claude in ${story.key}'s space, told about the ticket first` : "A new Claude on the Desk" },
    ...agents.map((a) => {
      const waiting = a.status === "blocked";
      const busy = a.status === "working";
      const where = names.get(a.space) ?? "";
      return {
        id: a.address, agent: a, label: sessionTitle(a.title) ?? a.tab_name ?? "Claude", waiting, busy,
        hint: waiting ? "waiting for you" : busy ? "working" : on(a) ? "on it" : "",
        tip: waiting ? "It's waiting for your answer: answer it first" : `${a.tab_name ?? "Claude"}${where ? ` in ${where}` : ""}${busy ? ": working, it reads this when its turn ends" : ""}`,
      };
    }),
  ];
}

// Who's picked when the picker opens: the Claude on the asked key when it can take a message, else a
// new one. A pick that's gone (its tab closed) or now waits for the person falls back the same way.
export function chosenWho(who, picked) {
  const ok = (r) => r && !r.waiting;
  return (ok(who.find((r) => r.id === picked)) && picked) || who.find((r) => r.id !== "new" && ok(r) && r.hint === "on it")?.id || "new";
}

// What's asked about, for a file of the Changes view: its path and where it is, a pull request's
// address or an uncommitted repo's folder. `others`: whether it's from a pull request, whose paths
// and code anyone who pushed to it wrote.
export function fileAbout(f, key) {
  const g = f.group;
  const path = promptValue("path", f.path), repo = promptValue("repo", g.repo);
  const story = key ? ` (${promptValue("key", key)})` : "";
  if (g.url) return { name: f.path.split("/").pop(), text: `About the file ${path} in ${repo}${story}, in the pull request ${promptValue("url", g.url)} (its changes: ${promptValue("url", g.url)}/files).`, others: true, kind: "file" };
  const full = g.path ? `${g.path}/${f.path}` : f.path;
  return { name: f.path.split("/").pop(), text: `About the file ${path} in ${repo}${story}, not committed yet: ${promptValue("path", full)}.`, others: false, kind: "file" };
}

// The suggestions for a kind of thing asked about: a file has them all.
const SUGGESTIONS = { file: ASK_CLAUDE };
export const suggestionsFor = (kind) => (SUGGESTIONS[kind] ?? []).map((id) => ({ id, label: ASK_PROMPTS.find((a) => a.id === id).label }));

// The message: what it's about, then the suggestion (the profile's wording) or what was typed, then
// OTHERS when what it's about is others' work. Null when there's nothing to ask.
export function askMessage(profile, about, { suggestion, note } = {}) {
  const what = suggestion ? askText(profile, suggestion) : promptValue("note", note ?? "").trim();
  if (!what) return null;
  return `${about.text}\n\n${what}${about.others ? `\n\n${OTHERS}` : ""}`;
}

// The picker: a header with the sparkles naming what's asked about (and Close), who to ask as a row
// of choices, then what: the typed message (Enter sends) and the suggestions (a click sends).
// `input` is the view's InputState; `pick(id, cx)`, `suggest(id, cx)` and `close(cx)` its handlers.
export function askPicker(t, { id = "ask-claude", about, who, chosen, input, pick, suggest, close, note }) {
  const whoRow = (r, i) => {
    const on = r.id === chosen;
    return h_flex().id(`${id}-who-${i}`).flex_none().h(26).px(9).gap(6).items_center().rounded(6).border_1()
      .border_color(on ? tint(t.accent, "99") : t.border).bg(on ? tint(t.accent, "1f") : t.background)
      .text_size(SMALL).text_color(r.waiting ? t.dim : on ? t.foreground : t.muted).tooltip(r.tip)
      .when(!r.waiting, (el) => el.cursor_pointer().hover((s) => s.bg(on ? tint(t.accent, "1f") : t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => pick(r.id, cx)))
      .child(r.agent ? agentMark(t, r.agent.status, { size: 12 }) : icon(own("sparkles"), 12).text_color(t.accent))
      .child(div().flex_none().max_w(200).truncate().child(r.label))
      .when(Boolean(r.hint), (el) => el.child(div().flex_none().text_color(t.dim).child(r.hint)));
  };
  const label = (s) => div().flex_none().w(40).text_size(SMALL).text_color(t.dim).child(s);
  return v_flex().id(id).w_full().gap(8)
    .child(h_flex().gap(6).items_center().text_size(SMALL).text_color(t.muted)
      .child(icon(own("sparkles"), 13).text_color(t.accent)).child("Ask Claude about")
      .child(div().min_w(0).truncate().font_medium().text_color(t.foreground).child(about.name))
      .child(div().flex_1())
      .child(textButton(t, `${id}-close`, "Close", (_e, cx) => close(cx), { dim: true })))
    .child(h_flex().gap(8).items_center().child(label("Who"))
      .child(h_flex().flex_1().min_w(0).flex_wrap().gap(6).children(who.map(whoRow))))
    .child(h_flex().gap(8).items_center().child(label("What"))
      .child(div().flex_1().min_w(0).child(Input.new(input).h(28).px(10).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(SMALL).text_color(t.foreground))))
    .child(h_flex().gap(8).items_center().child(label(""))
      .child(h_flex().flex_1().min_w(0).flex_wrap().gap(4).children(suggestionsFor(about.kind).map((s) =>
        textButton(t, `${id}-suggest-${s.id}`, s.label, (_e, cx) => suggest(s.id, cx), { tip: "Ask it this (the wording is the profile's, on its Messages page)" })))))
    .when(Boolean(note), (el) => el.child(div().id(`${id}-note`).truncate().text_size(SMALL).text_color(t.muted).tooltip(note.full ?? note.text).child(note.text)));
}
