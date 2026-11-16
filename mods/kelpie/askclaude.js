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
import { SMALL, ago, chrome, icon, own, sessionTitle, stop, textButton, tint } from "./ui.js";
import { ASK_PROMPTS, OTHERS, askText, fenced, promptValue } from "./config.js";

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
  // An existing Claude first (the person's rule: where to send, what's open comes first), the one on
  // the asked key before the rest; a new one last.
  // The person's order: exactly that ticket's Claude, then one on the story's own ticket or one of its
  // subtasks, then any other in the story's space; a new one last (rankOf()).
  const rank = (a) => rankOf(a, key, story, keyOf);
  const agents = [...open].sort((a, b) => rank(a) - rank(b));
  const fresh = { id: "new", label: "New Claude", hint: story ? `in ${story.key}'s space` : "on the Desk", tip: story ? `A new Claude in ${story.key}'s space, told about the ticket first` : "A new Claude on the Desk" };
  return [
    ...agents.map((a) => {
      const waiting = a.status === "blocked";
      const busy = a.status === "working";
      const where = names.get(a.space) ?? "";
      return {
        id: a.address, agent: a, label: sessionTitle(a.title) ?? a.tab_name ?? "Claude", waiting, busy, on: on(a), rank: rank(a),
        hint: waiting ? "waiting for you" : busy ? "working" : on(a) ? "on it" : "",
        tip: waiting ? "It's waiting for your answer: answer it first" : `${a.tab_name ?? "Claude"}${where ? ` in ${where}` : ""}${busy ? ": mid-task, your question waits until its turn ends" : ""}`,
      };
    }),
    fresh,
  ];
}

// Who's picked: the person's pick while it can take a message, else by what it's about. A question
// about the whole story goes to a new Claude (one busy on a subtask isn't the one to ask); anything
// else to the Claude on its key while that one isn't waiting for the person, else a new one.
export function chosenWho(who, picked, kind = "file") {
  // Picked by default: an existing Claude (the person's rule), the one on the asked key first, then
  // one at rest before one mid-task; a new one only when none can take it. `kind` is kept for callers.
  const ok = (r) => r && !r.waiting;
  if (ok(who.find((r) => r.id === picked))) return picked;
  // askWho() already orders them by rankOf(): the first that can take it.
  return who.find((r) => r.id !== "new" && ok(r))?.id ?? "new";
}
// Where a Claude stands for a question on `key` of `story`: 0 on exactly that ticket (its tab named
// after it), 1 on the story's own ticket or one of its subtasks, 2 any other of the story's.
export function rankOf(a, key, story, keyOf) {
  const k = keyOf(a.tab_name);
  if (k && k === key) return 0;
  const keys = story ? [story.key, ...(story.subs ?? []).map((s) => s.key)] : [];
  return k && keys.includes(k) ? 1 : 2;
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

// What's asked about, for lines of a file in Changes (KELPIE-227): the file as fileAbout() says it,
// then which lines (`what`: "line 12", "lines 9-14", "the change at lines 9-14"), then the lines
// themselves (`rows`, diffRows()'s: old/new numbers, +/− for added and removed, the text), fenced,
// a pull request's being anyone's code. Each line cleaned (promptValue()), LINES_MAX at most.
export const LINES_MAX = 80;
export function linesAbout(f, key, rows, what) {
  const file = fileAbout(f, key);
  const shown = rows.slice(0, LINES_MAX).map((r) => {
    const n = r.kind === "del" ? r.old : r.new ?? r.old;
    const sign = r.kind === "add" ? "+" : r.kind === "del" ? "-" : " ";
    return `${String(n ?? "").padStart(4)} ${sign} ${promptValue("description", r.text ?? "")}`;
  });
  if (rows.length > LINES_MAX) shown.push(`… and ${rows.length - LINES_MAX} lines more`);
  const range = promptValue("note", what);
  return { ...file, id: `lines:${f.id ?? f.path}:${range}`, kind: "lines", label: `${file.name} ${range}`,
    text: `${file.text}\n\nAbout ${range} of it (old and new line numbers as in the diff, + added, - removed):\n\n${fenced("the lines", shown.join("\n"))}` };
}

// What's asked about, for a passage the person copied (KELPIE-226): Herdr doesn't tell a mod what's
// selected, but a mod can read the clipboard, so copy, then ask. `found`: it's part of the story's
// description (said so). Anyone's words either way: each line cleaned, PASSAGE_MAX at most, fenced.
export const PASSAGE_MAX = 1500;
export function textAbout(text, it, { found = false } = {}) {
  const story = promptValue("key", it.key);
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n").map((l) => promptValue("description", l).replace(/\s+$/, ""));
  let body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (body.length > PASSAGE_MAX) body = `${body.slice(0, PASSAGE_MAX - 1).trimEnd()}…`;
  const head = body.replace(/\s+/g, " ");
  return { id: `text:${head.slice(0, 60)}`, key: story, name: "the passage", kind: "text", others: true,
    label: `“${head.length > 28 ? `${head.slice(0, 27)}…` : head}”`,
    text: `About this passage, ${found ? `from the description of the story ${story}` : `which I copied while looking at the story ${story}`}:\n\n${fenced("the passage", body)}` };
}

// What's asked about, for a ticket of the story shown: the story itself (`kind` "story"), one of its
// subtasks ("sub", `x` the subtask) or one of its pull requests ("pr", `x` the pull request, `name`
// its repo#n). A ticket goes with its status, a story with its subtasks (key, title, status, who has
// it; KELPIE-231), a subtask with its story, and either with its description once it's loaded
// (`description`, its blocks, as text), fenced. Titles, names and descriptions are anyone's on the
// board or GitHub, so they go in cleaned, and the question ends with OTHERS. `url`: the ticket's or
// pull request's page, when known.
export const ABOUT_DESC_MAX = 2000;
export function ticketAbout(it, kind, x = null, { url = null, name = null, description = null } = {}) {
  const story = promptValue("key", it.key);
  const title = promptValue("title", (kind === "story" ? it.title : x?.title) ?? "");
  const at = (words) => (url ? `, ${words}${promptValue("url", url)}` : "");
  const status = (s) => (s ? ` Its status: ${promptValue("status", s)}.` : "");
  const desc = (blocks) => {
    const text = blocksText(blocks, ABOUT_DESC_MAX);
    return text ? `\n\n${fenced("its description", text)}` : "";
  };
  if (kind === "pr") {
    const pr = promptValue("repo", name ?? "");
    return { id: `pr:${pr}`, key: story, name: pr, label: pr, kind, others: true, text: `About the pull request ${pr} (“${title}”) of ${story}${at("")}.` };
  }
  if (kind === "sub") {
    const key = promptValue("key", x.key);
    return { id: `sub:${key}`, key, name: key, label: `${key} · ${title}`, kind, others: true,
      text: `About the subtask ${key} (“${title}”) of the story ${story} (“${promptValue("title", it.title ?? "")}”)${at("its ticket: ")}.${status(x.status)}${desc(description)}` };
  }
  const subs = (it.subs ?? []).filter((s) => s.key !== it.key).map((s) => {
    const who = s.you ? "you" : s.assignee ? promptValue("name", s.assignee) : "nobody";
    return `- ${promptValue("key", s.key)} “${promptValue("title", s.title ?? "")}”: ${promptValue("status", s.status ?? "no status")}, ${who}`;
  });
  return { id: `story:${story}`, key: story, name: story, label: `${story} · the story`, kind: "story", others: true,
    text: `About the story ${story} (“${title}”)${at("its ticket: ")}.${status(it.status)}${subs.length ? `\n\nIts subtasks:\n${subs.join("\n")}` : ""}${desc(description)}` };
}

// A description's blocks (adf.js: paragraphs, headings, lists, code) as plain text, a line a block,
// cut at `max` characters; null for none.
export function blocksText(blocks, max = ABOUT_DESC_MAX) {
  if (!Array.isArray(blocks) || !blocks.length) return null;
  const runs = (r) => (r ?? []).map((x) => (x.br ? "\n" : x.text ?? "")).join("");
  const lines = [];
  const walk = (list, indent = "") => {
    for (const b of list ?? []) {
      if (b.kind === "code") lines.push(String(b.text ?? ""));
      else if (b.kind === "list") (b.items ?? []).forEach((item) => { const [first, ...rest] = item; lines.push(`${indent}- ${first ? runs(first.runs) : ""}`); walk(rest, `${indent}  `); });
      else if (b.runs) lines.push(`${indent}${runs(b.runs)}`);
      else if (b.blocks) walk(b.blocks, indent);
    }
  };
  walk(blocks);
  const text = lines.map((l) => promptValue("description", l).replace(/\s+$/, "")).filter((l) => l.trim()).join("\n");
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// The suggestions for a kind of thing asked about, each a profile message (the Messages page's Ask
// Claude group): a file's are about its code, a ticket's about where it stands.
const SUGGESTIONS = { file: ["explain", "check", "fixit", "test"], lines: ["explain", "check", "fixit"], text: ["explain", "left"], story: ["catchup", "left", "plan", "explain"], sub: ["left", "explain"], pr: ["explain", "check"] };
export const suggestionsFor = (kind) => (SUGGESTIONS[kind] ?? []).map((id) => ({ id, label: ASK_PROMPTS.find((a) => a.id === id).label }));

// The message: what it's about, then the suggestion (the profile's wording) or what was typed, then,
// with the ask's `id`, the line asking for a short answer back (handBack()), then OTHERS when what it's
// about is others' work. Null when there's nothing to ask.
export function askMessage(profile, about, { suggestion, note } = {}, id = null) {
  const what = suggestion ? askText(profile, suggestion) : promptValue("note", note ?? "").trim();
  if (!what) return null;
  return `${about.text}\n\n${what}${id ? `\n\n${handBack(id)}` : ""}${about.others ? `\n\n${OTHERS}` : ""}`;
}

// Asked from the Ask line, a Claude hands a short answer back to Kelpie, which puts it on the story's
// thread (and in Next): the line says so by the ask's id, never naming a tool, as every prompt says what
// to do and not how (the plugin's answer_ask is the how). Ids are Kelpie's own (askId()).
export const ASK_ID = /^[a-z0-9]{6,24}$/;
export const askId = (now = Date.now()) => `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 24);
export const handBack = (id) => `After answering, also hand Kelpie a short answer (a few plain lines) for the story's thread, with this ask's id: ${id}.`;

// An answer as the thread keeps it: anyone's words (a Claude can be misled by what it read), so no
// control characters but line breaks, no more than ANSWER_LINES lines and ANSWER_MAX characters.
export const ANSWER_MAX = 1200;
export const ANSWER_LINES = 12;
// A plan's answer (KELPIE-230) is its steps and checkpoints: longer.
export const PLAN_MAX = 4000;
export const PLAN_LINES = 40;
export function cleanAnswer(text, { lines: most = ANSWER_LINES, max = ANSWER_MAX } = {}) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim());
  const kept = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim().split("\n").slice(0, most).join("\n");
  return kept.length > max ? `${kept.slice(0, max - 1).trimEnd()}…` : kept;
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
  if (e.status === "started") return `new Claude · ${ago(e.at, now)}`;
  if (e.status === "answered") return `answered · ${ago(e.answeredAt ?? e.at, now)}`;
  return `no answer yet · ${ago(e.at, now)}`;
}

// The thread: the last few asks (`entries`), a line each, as the details' block is short while a
// story is at work: the question, what it was about and who, its state, and what can be done (a held
// one sent at once or dropped, `sendNow(id, cx)`, `drop(id, cx)`; a sent one's answer shown in its
// Claude's tab, `show(id, cx)`); the whole line is its tip. `more`: how many earlier ones are folded
// away (`unfold(cx)`).
export function askThread(t, { entries, more = 0, sendNow, drop, show, unfold, expanded = null, toggle, approve = null }) {
  if (!entries.length) return null;
  // An answered ask's line gives its answer's first line where the others say what they were about,
  // and a click opens the whole answer under it (and closes it): the details' block is short while a
  // story is at work, and answers shown open squeezed the Ask line out of it.
  const answeredLine = (e) => e.status === "answered" && Boolean(e.answer);
  const row = (e) => h_flex().id(`ask-entry-${e.id}`).flex_none().h(24).gap(10).items_center().min_w(0).text_size(SMALL)
    .tooltip(answeredLine(e) ? (expanded === e.id ? "Hide the answer" : `${e.answer}\n\nClick to read it here`) : `${e.q} · about ${e.about} · to ${e.to} · ${entryWords(e)}`)
    .when(answeredLine(e), (el) => el.cursor_pointer().on_click((_e, cx) => toggle(e.id, cx)))
    // The question keeps up to a third of the line; what follows it gives way first.
    .child(div().flex_none().max_w(240).truncate().text_color(t.foreground).child(e.q))
    .when(answeredLine(e), (el) => el.child(h_flex().flex_1().min_w(0).gap(6).items_center()
      .child(icon(own("sparkles"), 12).text_color(t.accent))
      .child(div().min_w(0).truncate().text_color(t.muted).child(String(e.answer).split("\n")[0]))))
    .when(!answeredLine(e), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`${e.about} · ${e.to}`)))
    .child(div().flex_none().text_color(e.status === "failed" ? t.blocked : t.dim).child(entryWords(e)))
    .when(e.status === "held", (el) => el
      .child(textButton(t, `ask-now-${e.id}`, "Send now", (_e, cx) => sendNow(e.id, cx), { dim: true, tip: "Typed in while it works, it may change what it's doing" }))
      .child(textButton(t, `ask-drop-${e.id}`, "Cancel", (_e, cx) => drop(e.id, cx), { dim: true })))
    // A plan answered: Go ahead tells its Claude to start, a step at a time (KELPIE-230).
    .when(e.pin === "plan" && e.status === "answered" && Boolean(approve) && !e.approved, (el) => el
      .child(textButton(t, `ask-approve-${e.id}`, "Go ahead", (_e, cx) => approve(e.id, cx), { tip: "Tell its Claude the plan is approved: build it a step at a time, stopping at each checkpoint" })));
  // An answer opened: its line, then the short answer under it, in the reading colour.
  const opened = (e) => v_flex().id(`ask-answered-${e.id}`).flex_none().gap(2)
    .child(row(e))
    .child(v_flex().id(`ask-answer-${e.id}`).flex_none().pl(2).pb(4).min_w(0).text_size(SMALL).text_color(t.foreground)
      .children(String(e.answer).split("\n").map((l, i) => div().id(`ask-answer-${e.id}-${i}`).min_w(0).child(l || " "))));
  return v_flex().id("ask-thread").flex_none().gap(2).pl(ASK_INDENT + 11).pr(11).rounded(8).bg(t.background)
    .when(more > 0, (el) => el.child(textButton(t, "ask-thread-more", `${more} earlier ${more === 1 ? "ask" : "asks"}`, (_e, cx) => unfold(cx), { dim: true })))
    .children(entries.map((e) => (answeredLine(e) && expanded === e.id ? opened(e) : row(e))));
}

// The Ask line: the sparkles, what it's about (✕ goes back to the story; a word when it's others'
// text), the question (Enter sends), who it goes to (`to`, the caller's menu) and Send; under it the
// suggestions for that kind of thing (a click sends that one) and a word on where it goes (`hint`).
// It's lit as Kelpie's magic is (CLAUDE.md, Visual kit): a faint accent tint behind it and a soft
// accent edge, so it reads apart from the story's details above it; still, as nothing is happening.
// The Ask line (KELPIE-305): one row that never changes height, so nothing moves under the pointer.
// At rest: the sparkles, what it's about as faint words, the question, ONE offer (`offer`: the ask that
// fits what's happening, in Claude's voice, a click asking it at once), a small menu of the other asks
// (`more`), and the Claude it goes to (`to`: its state mark and name). Writing (`writing`: the cursor in
// it, or something typed), the line makes room for the question: the offer and the menu fold away,
// what it's about shrinks to a few letters, who it goes to to its mark, and a clear button comes; each
// slides (widths animate). Clearing empties it and puts it back at rest. Enter sends; no Send button.
// Claude's presence is its motion (`magic`, the caller's: the sparkles breathing while touched, brewing
// after a send, a glint along the edge then and while the Claude picked works).
const slide = (el, w, ms = 220) => el.flex_none().w(w).overflow_hidden().transition("width", { duration: ms, easing: "ease-out" });
const fade = (el, on, ms = 180) => el.opacity(on ? 1 : 0).transition("opacity", { duration: ms, easing: "ease-out" });
export function askLine(t, { about, input, to, toWide = 140, clear, reset, isStory, awake = false, writing = false, typed = false, offer = null, take, more = null, magic = {}, hover, focus = null }) {
  const edge = tint(t.accent, awake || writing ? "99" : "40");
  const offerW = offer ? Math.min(280, Math.round(offer.text.length * 6.4 + 46)) : 0;
  const offerEl = offer && h_flex().id("ask-offer").flex_none().w(offerW).h(26).px(10).gap(6).items_center().rounded(13).cursor_pointer()
    .bg(tint(t.accent, "1c")).border_1().border_color(tint(t.accent, "55")).text_size(SMALL).text_color(t.foreground)
    .hover((el) => el.bg(tint(t.accent, "33"))).tooltip(`${offer.tip ?? offer.text}\nClick to ask it`)
    .on_mouse_down("left", stop).on_click((_e, cx) => take(cx))
    .child(icon(own("sparkles"), 11).text_color(t.accent))
    .child(div().min_w(0).truncate().child(offer.text));
  return div().id("ask-line-card").relative().flex_none().mt(4)
    .when(Boolean(focus), (el) => el.track_focus(focus))
    .on_hover((on, cx) => hover?.(on, cx))
    .child(v_flex().id("ask-line").relative().overflow_hidden().rounded(12).bg(t.background)
      .child(div().absolute().inset_0().rounded(12).bg(tint(t.accent, awake || writing ? "17" : "0b")))
      .child(div().absolute().top(0).left(0).right(0).bottom(0).rounded(12).border_1().border_color(edge))
      .children(magic.glint ?? [])
      .when(Boolean(magic.measure), (el) => el.on_size_change(magic.measure).child(magic.probe))
      .child(h_flex().relative().gap(8).items_center().min_w(0).h(44).px(12)
        .child(div().flex_none().w(18).child(magic.mark ?? icon(own("sparkles"), 14).text_color(t.accent)))
        // What it's about: its words at rest, a few letters while writing (the whole of it in the tip).
        .child(slide(h_flex().id("ask-about").gap(4).items_center().text_size(SMALL).text_color(t.dim), writing ? ABOUT_MIN : ABOUT_W)
          .tooltip(about.others ? `${about.label}\nWritten by others: Claude is told it's information, not instructions` : about.label)
          .child(div().min_w(0).truncate().child(about.label))
          .when(!isStory && !writing, (el) => el.child(div().id("ask-about-clear").flex_none().cursor_pointer().hover((x) => x.text_color(t.foreground))
            .tooltip("Ask about the story instead").on_mouse_down("left", stop).on_click((_e, cx) => clear(cx)).child("✕"))))
        .child(div().flex_none().text_size(SMALL).text_color(t.dim).child("·"))
        .child(div().flex_1().min_w(120).child(Input.new(input).h(30).px(2).bg(tint(t.background, "00")).text_size(TEXT_ASK).text_color(t.foreground)))
        // Something typed: how to send it (↵) and a clear button, together by the question; at rest
        // the offer and the menu. Each slides in and out.
        .child(fade(slide(h_flex().id("ask-reset-box").gap(4).items_center(), typed ? 50 : 0), typed)
          .child(div().id("ask-enter").flex_none().h(18).px(5).rounded(4).border_1().border_color(t.border).text_size(11).text_color(t.dim).tooltip("Enter asks it").child("↵"))
          .child(div().id("ask-reset").flex_none().w(22).h(22).flex().items_center().justify_center().rounded_full().cursor_pointer().text_color(t.dim)
            .hover((el) => el.bg(t.hover).text_color(t.foreground)).tooltip("Clear it").on_mouse_down("left", stop).on_click((_e, cx) => reset(cx))
            .child(icon(chrome("x"), 12))))
        .when(Boolean(offerEl), (el) => el.child(fade(slide(div().id("ask-offer-box"), writing ? 0 : offerW), !writing).child(offerEl)))
        .when(Boolean(more), (el) => el.child(fade(slide(div().id("ask-more-box"), writing ? 0 : 22), !writing).child(more)))
        // Who it goes to: its mark and name at rest, its mark alone while writing.
        .child(slide(div().id("ask-to-box").flex().justify_end(), writing ? 28 : toWide).child(to))));
}
const ABOUT_W = 170, ABOUT_MIN = 72;
const TEXT_ASK = 13;
// Where the Ask line's rows and the thread's lines start: past the sparkles (16) and the gap (8).
export const ASK_INDENT = 24;
