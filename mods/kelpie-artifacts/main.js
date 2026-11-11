// The shown tab's Claude session's artifacts, in the side panel beside Files and Changes.
// Images for now; other kinds can join them later. It only ever shows that session's own.
// With props { scope: "story" } (the Kelpie layout's Screenshots view), it shows the sessions the Kelpie
// layout lists in shared state instead: every Claude session of the story shown.
//
// Viewer: wheel zooms toward the pointer, drag pans, double-click toggles fit and 100%.
// Keys: + - zoom, 0 fit, 1 100%, arrows pan when zoomed and step when fitted, [ ] always step,
// Esc fits, then goes back.

import * as fs from "fs/promises";
import { PathBuilder, View, div, image, svg } from "gpui-kit";
import { Input, InputState, Popup, h_flex, v_flex } from "gpui-base";
import { agents, appHome, exec, layout, nextCommand, panes, props, run, settings, shared, spaces, theme } from "herdr";
import { FLATTEN_SCRIPT, INK, INKS, SAVE_SCRIPT, TEXT_FONT, addMark, arrowHead, drawArgs, editBase, isTiny, redo, strokeFor, textSizeFor, undo } from "./markup.js";
import { justify, moveSelection, pngAspect, sections, stripWindow } from "./gallery.js";
import { openExternal, reveal, revealLabel } from "./platform.js";
import { fetchFull, findSession, isFull, isReady, listImages, locate, pixelSize, prepare, sessionDirs, sweep } from "./session.js";

const POLL = 3000;
// Written by the Kelpie layout (mods/kelpie/stories.js) for its Screenshots view: { key, ids, keys:
// { [session id]: subtask key }, terminals: { [session id]: agent terminal }, agents: [the story space's agent terminals], on, started }. Only
// `key` until the story's sessions are known.
const STORY = "kelpie.artifacts.sessions";
const TEXT = 13;
const SMALL = 11.5;
const TITLE = 15;
const CONTROL = 28;
const ROW = 48;
const icon = (name, size = 14) => svg(`mods/workspace-chrome/${name}.svg`).flex_none().size(size);
const GAP = 4; // between images, tight like a photo library
const MARGIN = 12;
const SCROLLBAR = 6;
const SIZES = [84, 118, 168, 240, 340]; // row heights, from the size control
const STAGE = "#0b0b0d";
const MAX_ZOOM = 8;
const clock = (mtime) => {
  const d = new Date(mtime * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const clamp = (v, low, high) => Math.min(high, Math.max(low, v));
// Sizes and pointer positions arrive in real pixels, but layout sizes are multiplied by zoom.
const toLayout = (v) => v / (settings().zoom || 1);
const pointIn = (p) => (p ? { x: toLayout(p.x), y: toLayout(p.y) } : undefined);

// The terminal of the shown tab whose session we show: its agent, else the focused one.
function shownTerminal() {
  const tab = spaces().find((s) => s.active)?.tabs.find((t) => t.active)?.id;
  const inTab = panes().filter((p) => p.tab === tab && p.terminal);
  return (inTab.find((p) => p.program?.agent) ?? inTab.find((p) => p.focused) ?? inTab[0])?.terminal ?? null;
}

const find = (node, id) => (node?.id === id ? node : (node?.children ?? []).map((c) => find(c, id)).find(Boolean) ?? null);
// A hidden copy keeps running, so it stops looking until it's shown. The story's copy shows in the
// Kelpie layout's main area, the other in the side panel.
const showing = (story) => {
  const root = layout();
  if (story) {
    const stack = find(root, "main-stack");
    return Boolean(stack) && !stack.hidden && !find(root, "lower")?.hidden && stack.active === "story-shots";
  }
  const panel = find(root, "panel");
  return Boolean(panel) && !panel.hidden && find(root, "panel-body")?.active === "artifacts";
};

export default class Artifacts extends View {
  init(_props, cx) {
    // The block's props come from props(): init's first argument isn't them.
    this.story = props()?.scope === "story";
    this.items = [];
    this.pasted = false;
    this.open = null; // the path of the image shown large
    this.state = "looking";
    this.width = 600;
    this.sizes = {}; // path -> its pixel size, or "loading"
    this.aspects = {}; // thumbnail -> width / height
    this.selected = null; // the src selected in the grid
    this.size_step = Number(localStorage.getItem("size-step") ?? 1);
    this.controls = true;
    this.textInput = InputState.new({ value: "", placeholder: "Type, then Return" });
    this.textInput.on("submit", (_e, cx) => { this.commitText(); cx.notify(); });
    this.shown = true;
    this.viewport = { width: 0, height: 0 };
    this.resetView();
    this.handle = cx.focus_handle();
    this.refresh(cx);
    cx.timer.every(POLL, (cx) => this.refresh(cx));
    // Images age out of "Latest" even when nothing new arrives.
    cx.timer.every(60000, (cx) => { if (showing(this.story) && !this.open) cx.notify(); });
    cx.spawn(async () => { await sweep().catch(() => {}); });
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "focus") this.handle.focus();
        cx.notify();
      }
    });
  }

  // The sessions whose images show ([{ id, dir, key }]): the story's, else the shown tab's one.
  // Null when the tab has no Claude session; undefined while the story's are still being gathered.
  async sessions(scope) {
    if (this.story) {
      const story = shared(STORY);
      if (!scope || story?.key !== scope || !story.ids) return undefined;
      this.session = { on: story.on ?? null };
      return (await sessionDirs(story.ids, story.on ?? null)).map((s) => ({ ...s, key: story.keys?.[s.id] ?? null }));
    }
    const session = scope ? await findSession(scope).catch(() => null) : null;
    // Between Claude sessions, or while a tool holds the terminal: keep what's showing.
    if (session) this.session = session;
    return this.session ? [this.session] : null;
  }

  refresh(cx) {
    // Before the first render there's no tab yet, and looking would only delay the real look.
    if (this.busy || !showing(this.story) || this.scope === undefined) return;
    this.busy = true;
    const scope = this.scope;
    cx.spawn(async (cx) => {
      try {
        const sessions = await this.sessions(scope);
        if (scope !== this.scope || sessions === undefined) return; // the tab changed while we looked
        if (!sessions) {
          this.state = "no-session";
          cx.notify();
          return;
        }
        const found = await listImages(sessions.map((s) => s.dir), this.pasted, this.session.on);
        found.forEach((item) => {
          const s = sessions.find((x) => x.dir === item.dir);
          item.session = s.id;
          item.key = s.key ?? null;
          locate(s.id, item);
        });
        const key = (list) => list.map((i) => i.src).join("\n");
        const changed = key(found) !== key(this.items) || this.state !== "ready";
        this.items = found;
        this.state = "ready";
        if (changed) cx.notify();
        // Tiles fill in as their thumbnails are ready, newest first.
        while (await prepare(found, this.session.on)) {
          await this.readAspects(found);
          cx.notify();
        }
        if (await this.readAspects(found)) cx.notify();
        // Only once its local copy exists: Herdr won't redraw an image that was missing when first shown.
        if (this.pendingOpen && found.some((i) => i.path === this.pendingOpen)) {
          this.show(this.pendingOpen);
          this.pendingOpen = null;
          cx.notify();
        }
      } catch (e) {
        console.log(`kelpie-artifacts: ${e}`);
      } finally {
        this.busy = false;
      }
    });
  }

  // Each thumbnail's shape, once it's on disk, so rows can keep it.
  async readAspects(items) {
    let changed = false;
    for (const item of items) {
      if (item.thumb in this.aspects || !isReady(item)) continue;
      this.aspects[item.thumb] = pngAspect(await fs.readFile(`${appHome()}/${item.thumb}`).catch(() => null));
      changed = true;
    }
    return changed;
  }

  // View state: scale is image pixels to real screen pixels; null means fit the pane.
  resetView() {
    this.scale = null;
    this.pan = { x: 0, y: 0 };
    this.drag = null;
  }

  show(path) {
    this.open = path;
    this.resetView();
    const item = this.items.find((i) => i.path === path);
    if (item) this.selected = item.src;
    this.fadeIn = true;
  }

  // The terminal whose message box an image goes to: the shown tab's, or for the story, the open agent
  // of the image's session, else the story's agent that has the keyboard, else any agent of the story
  // (its sessions' open ones, then those in its space). None when the story has no agent open.
  chatTerminal(item) {
    return this.chatTargets(item)[0] ?? null;
  }

  // Every agent the image can go to, best first (see chatTerminal); several give the button a menu.
  chatTargets(item) {
    if (!this.story) return this.terminal ? [this.terminal] : [];
    const story = shared(STORY) ?? {};
    const own = (story.terminals ?? {})[item.session];
    const focused = panes().find((p) => p.focused)?.terminal;
    const open = [...new Set([own, ...Object.values(story.terminals ?? {}), ...(story.agents ?? [])])].filter((x) => x && panes().some((p) => p.terminal === x));
    return open.sort((a, b) => (b === own) - (a === own) || (b === focused) - (a === focused));
  }

  // "Add to chat": a button when one agent can take it, else a menu of the story's agents (by their
  // tab's name; the one whose session took the image says so).
  chatButton(t, id, item, label, on, tip, send) {
    const targets = this.chatTargets(item);
    if (targets.length < 2) return this.button(t, id, label, (cx) => send(targets[0], cx), on, tip);
    const own = (shared(STORY)?.terminals ?? {})[item.session];
    const name = (x) => agents().find((a) => a.address === x)?.tab_name ?? panes().find((p) => p.terminal === x)?.title ?? x;
    const open = this.chatMenu === id;
    const trigger = this.button(t, id, `${label} ▾`, () => { this.chatMenu = open ? null : id; }, on || open, tip);
    return Popup.new(`${id}-menu`, trigger).anchor("top_right").when(open, (el) => el.content(
      v_flex().id(`${id}-list`).w(260).p(4).gap(1).rounded(10).bg(t.popover).border(1).border_color(t.border).shadow_lg().text_size(SMALL).text_color(t.foreground)
        .on_mouse_down_out((_e, cx) => { if (this.chatMenu === id) { this.chatMenu = null; cx.notify(); } })
        .children(targets.map((x, i) => h_flex().id(`${id}-to-${i}`).h(CONTROL).px(8).gap(8).items_center().rounded(6).cursor_pointer().hover((el) => el.bg(t.hover))
          .on_click((_e, cx) => { cx.stop_propagation(); this.chatMenu = null; send(x, cx); cx.notify(); })
          .child(div().flex_1().min_w(0).truncate().child(name(x)))
          .when(x === own, (el) => el.child(div().flex_none().text_color(t.dim).child("took it")))))));
  }

  // Puts a file in a Claude message box, unsent: its path goes through the clipboard,
  // because Herdr's paste presses no Enter. Whatever text you had copied comes back afterwards.
  pasteToChat(path, terminal, cx) {
    const pane = terminal ? panes().find((p) => p.terminal === terminal)?.pane : null;
    if (!pane) return false;
    const before = cx.read_from_clipboard();
    cx.write_to_clipboard(`${path} `);
    run("pane.focus", { pane });
    run("terminal.paste");
    cx.timer.after(1500, (cx) => {
      if (before !== undefined) cx.write_to_clipboard(before);
      this.added = null;
      cx.notify();
    });
    return true;
  }

  addToChat(item, cx, terminal = this.chatTerminal(item)) {
    // A double-click shouldn't attach it twice to the same agent. Another agent, or later on, is fine.
    if (this.added === `${terminal}|${item.path}`) return;
    if (this.pasteToChat(item.path, terminal, cx)) this.added = `${terminal}|${item.path}`;
  }

  // The image with its marks, straight to the message box. You stay in mark-up with the marks intact,
  // so you can change them and add another version, and nothing joins the gallery.
  addMarksToChat(item, size, cx, terminal = this.chatTerminal(item)) {
    this.commitText();
    const m = this.markup;
    if (!m?.marks.length || m.adding) return;
    // This version once per agent: another agent can have it too.
    const version = `${terminal}|${JSON.stringify(m.marks)}`;
    if (m.addedVersion === version || m.adding) return;
    m.adding = true;
    m.error = null;
    const on = this.session?.on;
    cx.spawn(async (cx) => {
      const out = await exec("sh", ["-c", FLATTEN_SCRIPT, "sh", item.path, ...drawArgs(m.marks, size.width, size.height)], on ? { on } : {}).catch((e) => ({ code: 1, stderr: String(e), stdout: "" }));
      m.adding = false;
      if (out.code === 0 && out.stdout.trim() && this.pasteToChat(out.stdout.trim(), terminal, cx)) m.addedVersion = version;
      else m.error = out.stderr?.includes("not found") ? "ImageMagick isn't installed" : "Couldn't add it to the chat";
      cx.notify();
    });
  }

  // The text being typed becomes a mark on Return, on the next click, or on saving.
  commitText() {
    const m = this.markup;
    if (!m?.editing) return;
    const text = this.textInput.value().trim();
    if (text) addMark(m, { tool: "text", color: m.color, text, points: [m.editing] });
    m.editing = null;
    this.textInput.set_value("");
  }

  // Marks are drawn live over the image, then burned into a new copy. The original never changes.
  saveMarks(t, item, size, cx) {
    this.commitText();
    const m = this.markup;
    if (!m?.marks.length || m.saving) return;
    m.saving = true;
    m.error = null;
    const on = this.session?.on;
    const args = [item.path, `${item.dir}/scratchpad`, editBase(item.name), ...drawArgs(m.marks, size.width, size.height)];
    cx.spawn(async (cx) => {
      const out = await exec("sh", ["-c", SAVE_SCRIPT, "sh", ...args], on ? { on } : {}).catch((e) => ({ code: 1, stderr: String(e), stdout: "" }));
      if (out.code === 0 && out.stdout.trim()) {
        this.markup = null;
        this.pendingOpen = out.stdout.trim();
        this.refresh(cx);
      } else {
        m.saving = false;
        m.error = out.stderr?.includes("not found") ? "ImageMagick isn't installed" : "Couldn't save the copy";
      }
      cx.notify();
    });
  }

  // A pointer position as a share of the image, kept on the image.
  markPoint(e, place) {
    const p = pointIn(e.local_position) ?? { x: 0, y: 0 };
    return [clamp((p.x - place.left) / place.width, 0, 1), clamp((p.y - place.top) / place.height, 0, 1)];
  }

  endMark(size) {
    const m = this.markup;
    if (m?.current && !isTiny(m.current, size.width, size.height)) addMark(m, m.current);
    if (m) m.current = null;
  }

  // The marks, with percentages so they sit exactly where the saved copy will have them.
  marksLayer(size, place) {
    const m = this.markup;
    const pct = ([x, y]) => [`${x * 100}%`, `${y * 100}%`];
    const scale = place.width / size.width;
    const stroke = strokeFor(size.width);
    const textPx = textSizeFor(size.width) * scale;
    const textAt = (el, at) => el.absolute().left(`${at[0] * 100}%`).top(`${at[1] * 100}%`).font_family(TEXT_FONT).text_size(textPx);
    const shapes = [...m.marks, ...(m.current ? [m.current] : [])].flatMap((mark) => {
      if (mark.tool === "text") return [textAt(div(), mark.points[0]).whitespace_nowrap().line_height(1.15).text_color(mark.color ?? INK).child(mark.text)];
      const layer = (path) => window.paint_path(path, mark.color ?? INK).absolute().top(0).left(0).size_full();
      const line = () => PathBuilder.stroke(Math.max(1, stroke * scale));
      const [a, b] = [mark.points[0], mark.points.at(-1)];
      if (mark.tool === "box") {
        return [layer(line().add_polygon([[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]].map(pct), true).build())];
      }
      if (mark.tool === "pen") return [layer(line().add_polygon(mark.points.map(pct), false).build())];
      const head = arrowHead(a[0] * size.width, a[1] * size.height, b[0] * size.width, b[1] * size.height, stroke)
        .map(([x, y]) => [x / size.width, y / size.height]);
      return [layer(line().add_polygon([a, b].map(pct), false).build()), layer(PathBuilder.fill().add_polygon(head.map(pct), true).build())];
    });
    return div().absolute().left(place.left).top(place.top).w(place.width).h(place.height).children(shapes)
      .when(Boolean(m.editing), (el) => el.child(textAt(div(), m.editing ?? [0, 0]).id("markup-text").w(Math.max(220, textPx * 12)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Input.new(this.textInput).w_full().h(textPx * 1.5).font_family(TEXT_FONT).text_size(textPx).text_color(m.color).bg("#00000066").border(1).border_color(m.color))));
  }

  markupBar(t, item, size) {
    const m = this.markup;
    const tool = (id, label) => this.button(t, `markup-${id}`, label, () => { this.commitText(); m.tool = id; }, m.tool === id);
    // Greyed out when there's nothing to do, and still safe to click.
    const history = (id, label, enabled, action, tip) => this.button(t, `markup-${id}`, label, action, false, tip).when(!enabled, (el) => el.opacity(0.4));
    const swatch = (color) => {
      const on = m.color === color;
      return div().id(`ink-${color}`).flex().flex_none().size(24).items_center().justify_center().rounded_full().cursor_pointer()
        .when(on, (el) => el.border(2).border_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => {
          cx.stop_propagation();
          m.color = color;
          localStorage.setItem("ink", color);
          cx.notify();
        })
        .child(div().flex_none().size(on ? 14 : 16).rounded_full().bg(color).border(1).border_color(t.input));
    };
    return v_flex().absolute().left(0).right(0).bottom(MARGIN).gap(6).items_center().cursor_default()
      .child(this.capsule(t).px(8).gap(2).children(INKS.map(swatch)))
      .child(this.capsule(t)
        .child(tool("box", "Box")).child(tool("arrow", "Arrow")).child(tool("pen", "Pen")).child(tool("text", "Text"))
        .child(div().flex_none().w(1).h(14).mx(4).bg(t.border))
        .child(history("undo", "Undo", m.marks.length > 0, () => undo(m), "Undo (⌘Z)"))
        .child(history("redo", "Redo", m.undone.length > 0, () => redo(m), "Redo (⇧⌘Z)"))
        .child(this.button(t, "markup-cancel", "Cancel", () => { this.markup = null; }))
        .when(m.marks.length > 0 || Boolean(m.editing), (el) => el
          .child(this.button(t, "markup-save", m.saving ? "Saving…" : "Save copy", (cx) => this.saveMarks(t, item, size, cx), false, "Keep this version in the gallery"))
          .when(Boolean(this.chatTerminal(item)), (x) => x.child(this.chatButton(t, "markup-add", item, m.addedVersion === `${this.chatTerminal(item)}|${JSON.stringify(m.marks)}` ? "Added" : m.adding ? "Adding…" : "Add to chat", true, "Put this version in the message box, without sending", (to, cx) => this.addMarksToChat(item, size, cx, to))))));
  }

  resize(by) {
    this.size_step = clamp(this.size_step + by, 0, SIZES.length - 1);
    localStorage.setItem("size-step", String(this.size_step));
  }

  step(by) {
    const at = this.items.findIndex((i) => i.path === this.open);
    if (at >= 0) this.show(this.items[clamp(at + by, 0, this.items.length - 1)].path);
  }

  size(item) {
    const known = this.sizes[item.path];
    return known && known !== "loading" ? known : null;
  }

  fitScale(size) {
    const zoom = settings().zoom || 1;
    return Math.min(1, (this.viewport.width * zoom) / size.width, (this.viewport.height * zoom) / size.height);
  }

  scaleOf(size) {
    return this.scale ?? this.fitScale(size);
  }

  // Where the image goes: centred if it fits on that axis, otherwise kept covering the pane.
  placement(size) {
    const zoom = settings().zoom || 1;
    const scale = this.scaleOf(size);
    const width = (size.width * scale) / zoom;
    const height = (size.height * scale) / zoom;
    const axis = (span, room, offset) => (span <= room ? (room - span) / 2 : clamp(offset, room - span, 0));
    return { width, height, left: axis(width, this.viewport.width, this.pan.x), top: axis(height, this.viewport.height, this.pan.y) };
  }

  // Zooms keeping the image point under `at` (pane coordinates, default its centre) in place.
  zoomTo(size, next, at) {
    const point = at ?? { x: this.viewport.width / 2, y: this.viewport.height / 2 };
    const before = this.placement(size);
    const scale = clamp(next, Math.min(0.05, this.fitScale(size)), MAX_ZOOM);
    const ratio = scale / this.scaleOf(size);
    this.scale = scale;
    this.pan = { x: point.x - (point.x - before.left) * ratio, y: point.y - (point.y - before.top) * ratio };
    // Remember the kept position, so panning starts from what's on screen.
    const after = this.placement(size);
    this.pan = { x: after.left, y: after.top };
  }

  zoomBy(size, factor, at) {
    this.zoomTo(size, this.scaleOf(size) * factor, at);
  }

  fit() {
    this.scale = null;
    this.pan = { x: 0, y: 0 };
  }

  // Controls float over the image, so a press on one mustn't also start a drag.
  button(t, id, label, action, on = false, tip = null) {
    return h_flex().id(id).h(CONTROL).min_w(CONTROL).px(8).flex_none().items_center().justify_center().rounded_full().cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).text_color(on ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); cx.notify(); })
      .child(label);
  }

  capsule(t) {
    return h_flex().flex_none().h(CONTROL + 8).px(4).gap(2).items_center().rounded_full().bg(t.popover).border(1).border_color(t.border).shadow_lg();
  }

  header(t) {
    const segment = (id, label, on, action) => h_flex().id(id).h(CONTROL - 4).px(12).flex_none().items_center().rounded_full().text_size(SMALL).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { if (!on) { action(cx); cx.notify(); } }).child(label);
    const count = this.items.length;
    const keys = this.story ? this.keys() : [];
    return h_flex().h(ROW + 8).flex_none().px(MARGIN).gap(8).items_center()
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().font_semibold().text_size(TITLE).child(this.story ? "Screenshots" : "Artifacts"))
        .child(div().truncate().text_size(SMALL).text_color(t.dim).child(`${count} item${count === 1 ? "" : "s"}${keys.length > 1 ? ` · ${keys.join(", ")}` : ""}`)))
      .child(h_flex().flex_none().items_center()
        .child(this.button(t, "artifact-smaller", icon("minus"), () => this.resize(-1), false, "Smaller"))
        .child(this.button(t, "artifact-larger", icon("plus"), () => this.resize(1), false, "Larger")))
      .child(h_flex().flex_none().p(2).rounded_full().bg(t.raised)
        .child(segment("artifact-saved", "Saved", !this.pasted, (cx) => { this.pasted = false; this.refresh(cx); }))
        .child(segment("artifact-all", "All", this.pasted, (cx) => { this.pasted = true; this.refresh(cx); })));
  }

  // The story's keys the images belong to, when it's the story's copy.
  keys() {
    return [...new Set(this.items.map((i) => i.key).filter(Boolean))];
  }

  // Click selects, double-click opens, as in Photos. A story's images with more than one key are
  // badged with theirs.
  grid(t) {
    const badged = this.story && this.keys().length > 1;
    const room = Math.max(120, this.width - MARGIN * 2 - SCROLLBAR);
    const target = Math.min(SIZES[this.size_step], room);
    const aspectOf = (item) => this.aspects[item.thumb];
    this.drawnRows = [];
    const tile = ({ item, width }, height) => {
      const on = this.selected === item.src;
      return div().id(`artifact-${item.src}`).relative().flex_none().w(width).h(height).rounded(6).bg(t.canvas).cursor_pointer()
        .tooltip(`${item.key && this.story ? `${item.key} · ` : ""}${item.name} · ${clock(item.mtime)}`)
        .on_mouse_down("left", () => this.handle.focus())
        .on_click((e, cx) => {
          this.selected = item.src;
          if (e.click_count >= 2) this.show(item.path);
          cx.notify();
        })
        .when(isReady(item), (el) => el.child(image(item.thumb).w(width).h(height).rounded(6)))
        .when(badged && Boolean(item.key), (el) => el.child(div().absolute().left(6).bottom(6).px(6).py(1).rounded(4).bg("#000000a6").text_size(10.5).text_color("#ffffffd9").child(item.key)))
        .when(on, (el) => el.child(div().absolute().left(-2).top(-2).right(-2).bottom(-2).rounded(8).border(2).border_color(t.accent)));
    };
    // Each story's (or terminal's) images have a grid of their own, so one's scroll isn't another's.
    return v_flex().id(`artifact-grid-${this.scope ?? "none"}`).flex_1().min_h(0).px(MARGIN).pb(MARGIN).overflow_y_scrollbar()
      .children(sections(this.items).flatMap((day) => {
        const rows = justify(day.items, room, target, GAP, aspectOf);
        rows.forEach((row) => this.drawnRows.push(row.tiles.map((entry) => entry.item.src)));
        return [
          div().flex_none().pt(14).pb(8).text_size(TITLE).font_semibold().child(day.label),
          ...rows.map((row, r) => h_flex().id(`artifact-${day.label}-${r}`).flex_none().mb(GAP).gap(GAP)
            .children(row.tiles.map((entry) => tile(entry, row.height)))),
        ];
      }));
  }

  // The filmstrip: where you are in the set, and a quick way to jump.
  strip(t, at) {
    const { start, end } = stripWindow(this.items.length, at, Math.floor((this.width - 48) / 66));
    return h_flex().flex_none().h(52).px(6).gap(3).items_center().rounded(12).bg(t.popover).border(1).border_color(t.border).shadow_lg().cursor_default()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .children(this.items.slice(start, end).map((item) => {
        const on = item.path === this.open;
        // Every slot has one height; the width follows the image's shape, within reason.
        const height = on ? 38 : 32;
        const width = clamp(height * (this.aspects[item.thumb] ?? 1.6), height * 0.6, height * 2);
        return div().id(`strip-${item.src}`).relative().overflow_hidden().flex_none().w(width).h(height).rounded(4).bg(t.canvas).cursor_pointer()
          .transition("width", { duration: 140 }).transition("height", { duration: 140 })
          .when(!on, (el) => el.opacity(0.65).hover((s) => s.opacity(1)))
          .on_click((_e, cx) => { cx.stop_propagation(); this.show(item.path); cx.notify(); })
          .when(isReady(item), (el) => el.child(image(item.thumb).w(width).h(height).rounded(4)));
      }));
  }

  // The image gets the whole panel. Controls float on it and fade when the pointer leaves.
  large(t, item) {
    const at = this.items.indexOf(item);
    const size = this.size(item);
    const roomy = this.width >= 620;
    const percent = size ? `${Math.round(this.scaleOf(size) * 100)}%` : "";
    const zoomed = Boolean(size) && this.scale !== null && this.scale > this.fitScale(size);
    const fading = (el) => el.opacity(this.controls ? 1 : 0).transition("opacity", { duration: 180 }).cursor_default();
    if (this.markup && size) {
      return div().id("artifact-stage-wrap").relative().flex().flex_1().min_h(0).p(4).rounded(11).bg(STAGE)
        .child(this.viewer(t, item, size, false))
        .child(h_flex().absolute().left(0).right(0).top(MARGIN).justify_center().cursor_default()
          .child(this.capsule(t).px(14).text_size(SMALL).text_color(this.markup.error ? t.blocked : t.muted)
            .child(this.markup.error ?? `Marking up ${item.name}`)))
        .child(this.markupBar(t, item, size));
    }
    const edge = (id, side, name, by, tip) => fading(div().id(`${id}-edge`).absolute().top("50%").mt(-18)).when(side === "left", (el) => el.left(MARGIN)).when(side === "right", (el) => el.right(MARGIN))
      .child(this.capsule(t).child(this.button(t, id, icon(name), () => this.step(by), false, tip)));
    // Herdr clips to rectangles, so a zoomed image stays inside a mat, clear of the rounded corners.
    return div().id("artifact-stage-wrap").relative().flex().flex_1().min_h(0).p(4).rounded(11).bg(STAGE)
      .on_hover((over, cx) => { this.controls = over; cx.notify(); })
      .child(this.viewer(t, item, size, zoomed))
      .child(fading(h_flex().id("artifact-top").absolute().left(MARGIN).right(MARGIN).top(MARGIN).gap(8).items_center())
        .child(this.capsule(t).child(this.button(t, "artifact-back", icon("chevron-left"), () => { this.open = null; this.resetView(); }, false, "All artifacts")))
        .child(div().flex_1().min_w(0).flex().justify_center()
          .child(v_flex().min_w(0).max_w("100%").px(14).py(4).rounded(12).items_center().bg(t.popover).border(1).border_color(t.border).shadow_lg()
            .child(div().max_w("100%").truncate().text_size(TEXT).font_medium().child(item.name))
            .child(div().truncate().text_size(SMALL).text_color(t.dim).child(`${this.story && item.key ? `${item.key} · ` : ""}${at + 1} of ${this.items.length} · ${clock(item.mtime)}`))))
        .when(Boolean(size), (el) => el.child(this.capsule(t).child(this.button(t, "artifact-markup", "Mark up", () => {
          this.fit();
          this.markup = { tool: "box", color: localStorage.getItem("ink") ?? INK, marks: [], undone: [], current: null, saving: false, error: null };
        }, false, "Draw on a new copy of this image"))))
        .when(Boolean(this.chatTerminal(item)), (el) => el.child(this.capsule(t).child(this.chatButton(t, "artifact-add", item,
          this.added === `${this.chatTerminal(item)}|${item.path}` ? "Added" : "Add to chat", this.added === `${this.chatTerminal(item)}|${item.path}`, "Put this image in the message box, without sending", (to, cx) => this.addToChat(item, cx, to)))))
        .when(Boolean(size), (el) => el.child(this.capsule(t)
          .child(this.button(t, "artifact-out", icon("minus"), () => this.zoomBy(size, 1 / 1.25), false, "Zoom out"))
          .child(div().flex_none().w(40).flex().justify_center().text_size(SMALL).text_color(t.muted).child(percent))
          .child(this.button(t, "artifact-in", icon("plus"), () => this.zoomBy(size, 1.25), false, "Zoom in"))
          .when(roomy, (c) => c.child(this.button(t, "artifact-fit", "Fit", () => this.fit(), this.scale === null))
            .child(this.button(t, "artifact-actual", "100%", () => this.zoomTo(size, 1), this.scale === 1)))
          .when(roomy && !this.session?.on, (c) => c.child(this.button(t, "artifact-preview", "Preview", () => { openExternal(item.path); })))))
        // The path is the original's (on the agent's machine), for pasting into an agent or a shell.
        .when(roomy, (el) => el.child(this.capsule(t)
          .child(this.button(t, "artifact-copy", this.copied === item.path ? "Copied" : "Copy path", (cx) => this.copyPath(item, cx), false, "Copy the image's path (⌘C)"))
          .when(!this.session?.on, (c) => c.child(this.button(t, "artifact-reveal", revealLabel(), () => { reveal(item.path); }))))))
      .when(at > 0, (el) => el.child(edge("artifact-prev", "left", "chevron-left", -1, "Previous")))
      .when(at < this.items.length - 1, (el) => el.child(edge("artifact-next", "right", "chevron-right", 1, "Next")))
      .child(fading(h_flex().id("artifact-bottom").absolute().left(0).right(0).bottom(MARGIN).justify_center()).child(this.strip(t, at)));
  }

  viewer(t, item, size, zoomed) {
    const box = div().id("artifact-viewport").relative().overflow_hidden().flex_1().min_h(0).rounded(7).bg(STAGE)
      .on_size_change((next, cx) => { this.viewport = { width: toLayout(next.width), height: toLayout(next.height) }; cx.notify(); });
    // Before its size is known it simply fits; zoom and pan start a moment later.
    // From another machine, the full image arrives a moment later: the thumbnail stands in.
    // Each image fades in on a stage that stays put, so it needs a steady id.
    const stage = (el) => div().id("artifact-stage").absolute().left(0).top(0).size_full().opacity(this.shown ? 1 : 0).transition("opacity", { duration: 160 }).child(el);
    if (!isFull(item, this.session?.on)) return box.child(stage(image(item.thumb).size_full()));
    if (!size) return box.child(stage(image(item.src).size_full()));
    const place = this.placement(size);
    if (this.markup) {
      const m = this.markup;
      return box.when(m.tool === "text", (el) => el.cursor_text()).when(m.tool !== "text", (el) => el.cursor_crosshair())
        .on_mouse_down("left", (e, cx) => {
          const at = this.markPoint(e, place);
          this.commitText();
          if (m.tool === "text") {
            m.editing = at;
            // After this press has finished moving focus to the panel.
            cx.timer.after(30, () => this.textInput.focus());
            cx.notify();
            return;
          }
          m.current = { tool: m.tool, color: m.color, points: [at, at] };
          cx.notify();
        })
        .on_mouse_move((e, cx) => {
          if (!m.current) return;
          const at = this.markPoint(e, place);
          if (m.current.tool === "pen") m.current.points.push(at);
          else m.current.points[1] = at;
          cx.notify();
        })
        .on_mouse_up("left", (_e, cx) => { this.endMark(size); cx.notify(); })
        // No release arrives once the pointer has left, so the mark ends there.
        .on_hover((over, cx) => { if (!over) { this.endMark(size); cx.notify(); } })
        .child(stage(image(item.src).absolute().left(place.left).top(place.top).w(place.width).h(place.height)))
        .child(this.marksLayer(size, place));
    }
    return box
      .when(!zoomed, (el) => el.cursor_default())
      // An open hand says it can be dragged, a closed one that it is.
      .when(zoomed, (el) => (this.drag ? el.cursor_grabbing() : el.cursor_grab()))
      .on_scroll_wheel((e, cx) => {
        if (!e.delta.y) return;
        this.zoomBy(size, Math.exp(e.delta.y * 0.002), pointIn(e.local_position));
        cx.notify();
      })
      .on_mouse_down("left", (e, cx) => {
        this.handle.focus();
        if (e.click_count === 2) {
          if (this.scale === null) this.zoomTo(size, 1, pointIn(e.local_position));
          else this.fit();
          this.drag = null;
        } else {
          const now = this.placement(size);
          this.pan = { x: now.left, y: now.top };
          this.drag = { x: e.position.x, y: e.position.y, left: now.left, top: now.top };
        }
        cx.notify();
      })
      .on_mouse_move((e, cx) => {
        if (!this.drag || this.scale === null) return;
        this.pan = { x: this.drag.left + toLayout(e.position.x - this.drag.x), y: this.drag.top + toLayout(e.position.y - this.drag.y) };
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => { this.drag = null; cx.notify(); })
      // No release arrives once the pointer has left, so the drag ends there.
      .on_hover((over, cx) => { if (!over && this.drag) { this.drag = null; cx.notify(); } })
      .child(stage(image(item.src).absolute().left(place.left).top(place.top).w(place.width).h(place.height)));
  }

  copyPath(item, cx) {
    cx.write_to_clipboard(item.path);
    this.copied = item.path;
    cx.timer.after(1500, (cx) => { this.copied = null; cx.notify(); });
  }

  empty(t) {
    // A story not started yet has no agents to talk about.
    const started = shared(STORY)?.started;
    const text = this.story
      ? this.state === "looking" ? "Looking for the story's Claude sessions…"
        : started ? "Screenshots its agents save show here." : "Screenshots show here once you start work and an agent takes one."
      : this.state === "looking" ? "Looking for this tab's Claude session…"
        : this.state === "no-session" ? "No Claude session in this tab."
        : "Screenshots Claude saves in this session appear here.";
    return v_flex().flex_1().min_h(0).gap(8).items_center().justify_center().text_color(t.dim)
      .child(icon("layers", 28))
      .child(div().font_semibold().text_size(TITLE).text_color(t.muted).child(this.story ? (this.state === "ready" ? "No screenshots yet" : "Screenshots") : this.state === "ready" ? "No artifacts yet" : "Artifacts"))
      .child(div().text_size(SMALL).child(text));
  }

  onKey(e, cx) {
    const k = e.key;
    if (this.markup?.editing) {
      if (k !== "escape") return false; // letters are for the text
      this.markup.editing = null;
      this.textInput.set_value("");
      this.handle.focus();
      return true;
    }
    if (this.markup) {
      if (k === "escape") this.markup = null;
      else if (k === "z" && e.modifiers.platform) (e.modifiers.shift ? redo : undo)(this.markup);
      else if (k === "b") this.markup.tool = "box";
      else if (k === "a") this.markup.tool = "arrow";
      else if (k === "p") this.markup.tool = "pen";
      else if (k === "t") this.markup.tool = "text";
      else return false;
      return true;
    }
    if (!this.open) {
      const direction = { left: "left", right: "right", up: "up", down: "down" }[k];
      if (direction) { this.selected = moveSelection(this.drawnRows ?? [], this.selected, direction); return true; }
      if (k === "space" || k === "enter") {
        const item = this.items.find((i) => i.src === this.selected) ?? this.items[0];
        if (item) this.show(item.path);
        return Boolean(item);
      }
      if (k === "escape" && this.selected) { this.selected = null; return true; }
      if (k === "=" || k === "+") { this.resize(1); return true; }
      if (k === "-") { this.resize(-1); return true; }
      return false;
    }
    const size = this.size(this.items.find((i) => i.path === this.open) ?? {});
    const zoomed = size && this.scale !== null && this.scale > this.fitScale(size);
    const nudge = { left: [1, 0], right: [-1, 0], up: [0, 1], down: [0, -1] }[k];
    if (k === "c" && e.modifiers.platform) {
      const item = this.items.find((i) => i.path === this.open);
      if (item) this.copyPath(item, cx);
      return Boolean(item);
    }
    if (k === "space") { this.open = null; this.resetView(); }
    else if (k === "escape") {
      if (this.scale !== null) this.fit();
      else { this.open = null; this.resetView(); }
    } else if (k === "[") this.step(-1);
    else if (k === "]") this.step(1);
    else if (nudge && zoomed) {
      const place = this.placement(size);
      this.pan = { x: place.left + nudge[0] * 80, y: place.top + nudge[1] * 80 };
    } else if (nudge) this.step(k === "left" || k === "up" ? -1 : 1);
    else if (!size) return false;
    else if (k === "=" || k === "+") this.zoomBy(size, 1.25);
    else if (k === "-") this.zoomBy(size, 1 / 1.25);
    else if (k === "0") this.fit();
    else if (k === "1") this.zoomTo(size, 1);
    else return false;
    return true;
  }

  render(cx) {
    const t = theme();
    // What's shown: the story (by key), else the shown tab's terminal.
    const scope = this.story ? shared(STORY)?.key ?? null : shownTerminal();
    if (scope !== this.scope) {
      this.scope = scope;
      if (!this.story) this.terminal = scope;
      this.session = null;
      this.items = [];
      this.open = null;
      this.markup = null;
      this.state = "looking";
      this.resetView();
    }
    if (this.state === "looking") this.refresh(cx);
    if (this.fadeIn) {
      this.fadeIn = false;
      this.shown = false;
      this.controls = true;
      cx.timer.after(30, (cx) => { this.shown = true; cx.notify(); });
    }
    const item = this.items.find((i) => i.path === this.open);
    if (this.open && !item) { this.open = null; this.markup = null; this.resetView(); }
    if (item && !this.sizes[item.path]) {
      this.sizes[item.path] = "loading";
      cx.spawn(async (cx) => {
        const on = this.session?.on;
        await fetchFull(item, on).catch((e) => console.log(`artifacts: ${e}`));
        this.sizes[item.path] = await pixelSize(item.path, on).catch(() => null) ?? "loading";
        cx.notify();
      });
    }
    return v_flex().id("artifacts").size_full().min_h(0).text_size(TEXT).text_color(t.foreground)
      .on_size_change((next, cx) => { this.width = toLayout(next.width); cx.notify(); })
      .track_focus(this.handle)
      .on_mouse_down("left", () => this.handle.focus())
      .on_key_down((e, cx) => { if (this.onKey(e, cx)) cx.notify(); })
      .when(!item, (el) => el.child(this.header(t)))
      .child(item ? this.large(t, item) : this.items.length ? this.grid(t) : this.empty(t));
  }
}
