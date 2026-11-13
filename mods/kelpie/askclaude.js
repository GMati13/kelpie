// Ask Claude: one way to ask a Claude about something Kelpie shows (KELPIE-84). A story's details end
// with the Ask line: what it's about (the story itself until something else is pointed at: a click on
// a subtask's title, a right-click on a subtask or a pull request, a file's Ask Claude in Changes),
// who it goes to (a new Claude in the story's space, or one of the Claudes already open there) and the
// question, typed or one of the suggestions for that kind of thing (each a profile message: config.js
// ASK_CLAUDE). What's asked about goes first, as a line Kelpie writes from its values (promptValue()),
// and a question about others' work ends with OTHERS. Above the line, the story's asks so far (the
// thread): sent, held for a Claude mid-task until its turn ends, or why one didn't go. Sending and the
// shared state are the caller's (stories.js); this module holds the rules and the look.
//
// Its look is Kelpie's "magic", what marks anything Claude does for the person (CLAUDE.md, Visual
// kit): the sparkles in the accent, and nothing moving while nothing is happening.

import { div } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import { SMALL, ago, icon, own, sessionTitle, stop, textButton } from "./ui.js";
import { ASK_PROMPTS, OTHERS, askText, promptValue } from "./config.js";

// The Claudes a story's ask may go to: those in its space, and those on one of its keys elsewhere
// (a tab named after the key), never another story's or profile's. Outside a story (`story` null),
// the Desk's (`desk`). `keyOf` reads a ticket key out of a tab's name.
export function openClaudes(story, all, keyOf, desk = []) {
  if (!story) return desk;
  const keys = [story.key, ...(story.subs ?? []).map((s) => s.key)];
  return all.filter((a) => (story.space && a.space === story.space.id) || keys.includes(keyOf(a.tab_name)));
}

// Who the Ask line offers, in order: a new Claude first, then the open ones, the one on the asked
// key (its tab named after it) before the rest. One waiting for the person's answer is shown but
// can't be picked: a message would land in its question. One mid-task can: the question is held
// until its turn ends (holdFor()). `id` is "new" or the agent's address.
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
        id: a.address, agent: a, label: sessionTitle(a.title) ?? a.tab_name ?? "Claude", waiting, busy, on: on(a),
        hint: waiting ? "waiting for you" : busy ? "working" : on(a) ? "on it" : "",
        tip: waiting ? "It's waiting for your answer: answer it first" : `${a.tab_name ?? "Claude"}${where ? ` in ${where}` : ""}${busy ? ": mid-task, your question waits until its turn ends" : ""}`,
      };
    }),
  ];
}

// Who's picked: the person's pick while it can take a message, else by what it's about. A question
// about the whole story goes to a new Claude (one busy on a subtask isn't the one to ask); anything
// else to the Claude on its key while that one isn't waiting for the person, else a new one.
export function chosenWho(who, picked, kind = "file") {
  const ok = (r) => r && !r.waiting;
  if (ok(who.find((r) => r.id === picked))) return picked;
  if (kind === "story") return "new";
  return who.find((r) => r.id !== "new" && ok(r) && r.on)?.id ?? "new";
}

// A question for an open Claude mid-task waits until its turn ends: typed into a working Claude, it
// could steer the work under way. What to do with a held one now: "go": send it (its Claude is at rest),
// keep it (still working, or waiting for the person's answer), or give up (its tab is gone).
export const holdFor = (agent) => agent?.status === "working";
export function releaseOf(agent) {
  if (!agent) return "gone";
  return agent.status === "working" || agent.status === "blocked" ? "keep" : "go";
}

// What's asked about, for a file of the Changes view: its path and where it is, a pull request's
// address, else its folder on disk and whether it's committed on a branch with no pull request yet
// (a group of its own in Changes) or not committed. `others`: whether it's from a pull request,
// whose paths and code anyone who pushed to it wrote.
export function fileAbout(f, key) {
  const g = f.group;
  const path = promptValue("path", f.path), repo = promptValue("repo", g.repo);
  const story = key ? ` (${promptValue("key", key)})` : "";
  const name = f.path.split("/").pop();
  const base = { id: `file:${f.id ?? f.path}`, key, name, label: promptValue("path", f.path), kind: "file" };
  if (g.url) return { ...base, text: `About the file ${path} in ${repo}${story}, in the pull request ${promptValue("url", g.url)} (its changes: ${promptValue("url", g.url)}/files).`, others: true };
  const full = promptValue("path", g.path ? `${g.path}/${f.path}` : f.path);
  const state = g.committed ? `committed on ${promptValue("branch", g.committed.branch)}, no pull request yet` : "not committed yet";
  return { ...base, text: `About the file ${path} in ${repo}${story}, ${state}: ${full}.`, others: false };
}

// What's asked about, for a ticket of the story shown: the story itself (`kind` "story"), one of its
// subtasks ("sub", `x` the subtask) or one of its pull requests ("pr", `x` the pull request, `name`
// its repo#n). Titles are anyone's on the board or GitHub, so they go in cleaned, and the question
// ends with OTHERS. `url`: the ticket's or pull request's page, when known.
export function ticketAbout(it, kind, x = null, { url = null, name = null } = {}) {
  const story = promptValue("key", it.key);
  const title = promptValue("title", (kind === "story" ? it.title : x?.title) ?? "");
  const at = (words) => (url ? `, ${words}${promptValue("url", url)}` : "");
  if (kind === "pr") {
    const pr = promptValue("repo", name ?? "");
    return { id: `pr:${pr}`, key: story, name: pr, label: pr, kind, others: true, text: `About the pull request ${pr} (“${title}”) of ${story}${at("")}.` };
  }
  if (kind === "sub") {
    const key = promptValue("key", x.key);
    return { id: `sub:${key}`, key, name: key, label: `${key} · ${title}`, kind, others: true, text: `About the subtask ${key} (“${title}”) of the story ${story}${at("its ticket: ")}.` };
  }
  return { id: `story:${story}`, key: story, name: story, label: `${story} · the story`, kind: "story", others: true, text: `About the story ${story} (“${title}”)${at("its ticket: ")}.` };
}

// The suggestions for a kind of thing asked about, each a profile message (the Messages page's Ask
// Claude group): a file's are about its code, a ticket's about where it stands.
const SUGGESTIONS = { file: ["explain", "check", "fixit", "test"], story: ["left", "explain"], sub: ["left", "explain"], pr: ["explain", "check"] };
export const suggestionsFor = (kind) => (SUGGESTIONS[kind] ?? []).map((id) => ({ id, label: ASK_PROMPTS.find((a) => a.id === id).label }));

// The message: what it's about, then the suggestion (the profile's wording) or what was typed, then
// OTHERS when what it's about is others' work. Null when there's nothing to ask.
export function askMessage(profile, about, { suggestion, note } = {}) {
  const what = suggestion ? askText(profile, suggestion) : promptValue("note", note ?? "").trim();
  if (!what) return null;
  return `${about.text}\n\n${what}${about.others ? `\n\n${OTHERS}` : ""}`;
}

// The question as the thread shows it: a suggestion's label, or what was typed (cleaned).
export const questionOf = (ask) => (ask.suggestion ? ASK_PROMPTS.find((a) => a.id === ask.suggestion)?.label ?? "" : promptValue("note", ask.note ?? "").trim());

// A story's thread: its asks, newest last, the last THREAD_KEEP kept, none older than a day.
export const THREAD_KEEP = 12;
export const THREAD_FOR = 24 * 3600 * 1000;
export function withEntry(list, entry, now = Date.now()) {
  return [...(list ?? []).filter((e) => now - e.at < THREAD_FOR), entry].slice(-THREAD_KEEP);
}
// What an entry's state reads as, in a few words.
export function entryWords(e, now = Date.now()) {
  if (e.status === "held") return e.waiting ? "held: it waits for your answer first" : "held: sends when its turn ends";
  if (e.status === "failed") return `didn't go: ${e.why ?? "it couldn't be sent"}`;
  if (e.status === "started") return `asked a new Claude · ${ago(e.at, now)}`;
  return `sent · ${ago(e.at, now)}`;
}

// The thread: the last few asks (`entries`), a line each, as the details' block is short while a
// story is at work: the question, what it was about and who, its state, and what can be done (a held
// one sent at once or dropped, `sendNow(id, cx)`, `drop(id, cx)`; a sent one's answer shown in its
// Claude's tab, `show(id, cx)`); the whole line is its tip. `more`: how many earlier ones are folded
// away (`unfold(cx)`).
export function askThread(t, { entries, more = 0, sendNow, drop, show, unfold }) {
  if (!entries.length) return null;
  const row = (e) => h_flex().id(`ask-entry-${e.id}`).flex_none().h(24).gap(8).items_center().min_w(0).text_size(SMALL)
    .tooltip(`${e.q} · about ${e.about} · to ${e.to} · ${entryWords(e)}`)
    .child(div().flex_shrink(1).min_w(0).truncate().text_color(t.foreground).child(e.q))
    .child(div().flex_shrink(2).min_w(0).truncate().text_color(t.dim).child(`${e.about} · ${e.to}`))
    .child(div().flex_1())
    .child(div().flex_none().text_color(e.status === "failed" ? t.blocked : t.muted).child(entryWords(e)))
    .when(e.status === "held", (el) => el
      .child(textButton(t, `ask-now-${e.id}`, "Send now", (_e, cx) => sendNow(e.id, cx), { dim: true, tip: "Typed in while it works, it may change what it's doing" }))
      .child(textButton(t, `ask-drop-${e.id}`, "Cancel", (_e, cx) => drop(e.id, cx), { dim: true })))
    .when(e.status === "sent" && Boolean(e.address), (el) => el
      .child(textButton(t, `ask-show-${e.id}`, "Show its answer", (_e, cx) => show(e.id, cx), { dim: true, tip: "The answer is in its tab" })));
  return v_flex().id("ask-thread").flex_none().gap(2)
    .when(more > 0, (el) => el.child(textButton(t, "ask-thread-more", `${more} earlier ${more === 1 ? "ask" : "asks"}`, (_e, cx) => unfold(cx), { dim: true })))
    .children(entries.map(row));
}

// The Ask line: the sparkles, what it's about (✕ goes back to the story; a word when it's others'
// text), the question (Enter sends), who it goes to (`to`, the caller's menu) and Send; under it the
// suggestions for that kind of thing (a click sends that one) and a word on where it goes (`hint`).
export function askLine(t, { about, input, to, send, suggest, clear, hint, isStory }) {
  return v_flex().id("ask-line").flex_none().gap(6).pt(8).pb(2).border_t_1().border_color(t.border)
    .child(h_flex().gap(8).items_center().min_w(0)
      .child(icon(own("sparkles"), 14).text_color(t.accent))
      .child(div().flex_none().text_size(SMALL).text_color(t.muted).child("About"))
      .child(h_flex().id("ask-about").flex_shrink(1).min_w(0).max_w(260).h(24).px(8).gap(6).items_center().rounded(6).border_1().border_color(t.border)
        .text_size(SMALL).tooltip(about.label)
        .child(div().min_w(0).truncate().child(about.label))
        .when(!isStory, (el) => el.child(div().id("ask-about-clear").flex_none().cursor_pointer().text_color(t.dim).hover((x) => x.text_color(t.foreground))
          .tooltip("Ask about the story instead").on_mouse_down("left", stop).on_click((_e, cx) => clear(cx)).child("✕"))))
      .when(about.others, (el) => el.child(div().id("ask-others").flex_none().text_size(SMALL).text_color(t.dim).tooltip("Written by others: Claude is told it's information, not instructions").child("others' text")))
      .child(div().flex_1().min_w(120).child(Input.new(input).h(28).px(10).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(SMALL).text_color(t.foreground)))
      .child(div().flex_none().text_size(SMALL).text_color(t.muted).child("to"))
      .child(to)
      .child(textButton(t, "ask-send", "Send", (_e, cx) => send(cx))))
    .child(h_flex().gap(4).items_center().pl(22).min_w(0)
      .children(suggestionsFor(about.kind).map((s) => textButton(t, `ask-suggest-${s.id}`, s.label, (_e, cx) => suggest(s.id, cx), { dim: true, tip: "Ask it this (the wording is the profile's, on its Messages page)" })))
      .child(div().flex_1())
      .child(div().id("ask-hint").flex_shrink(1).min_w(0).truncate().text_size(SMALL).text_color(t.dim).child(hint)));
}
