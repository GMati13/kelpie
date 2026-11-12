// Add to chat's note (#14): the Artifacts panel's viewer puts an image in an agent's message box with a
// short note typed beside it ("the button is cut off here"), so the agent knows what to look at.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, texts } from "gpui-kit";
import { fakeCx } from "../lib/views.mjs";

// The panel keeps its grid size and ink in the browser-like storage Herdr gives mods.
globalThis.localStorage ??= { getItem: () => null, setItem() {} };
const { default: Artifacts, cleanNote, NOTE_MAX } = await import("../../mods/kelpie-artifacts/main.js");

const ITEM = { path: "/home/test/.claude/projects/acme/abc/scratchpad/cut-off.png", src: "art/cut-off.png", thumb: "art/cut-off-thumb.png", name: "cut-off.png", mtime: 1, session: "s1", key: null };

// A cx that also keeps the clipboard and lets the test run the timers it was given, in order.
function chatCx() {
  const cx = fakeCx();
  cx.clipboard = "what I had copied";
  cx.pasted = [];
  cx.timers = [];
  cx.read_from_clipboard = () => cx.clipboard;
  cx.write_to_clipboard = (text) => { cx.clipboard = text; };
  cx.timer = { every() {}, after: (ms, fn) => cx.timers.push({ ms, fn }) };
  cx.runTimers = () => { for (const { fn } of cx.timers.splice(0).sort((a, b) => a.ms - b.ms)) fn(cx); };
  // What each terminal.paste took from the clipboard, and into which pane.
  mock.on.run = (name, args) => {
    if (name === "pane.focus") cx.focusedPane = args.pane;
    if (name === "terminal.paste") cx.pasted.push({ pane: cx.focusedPane, text: cx.clipboard });
    return null;
  };
  return cx;
}

function viewer(cx) {
  const v = new Artifacts();
  v.init({}, cx);
  cx.tasks.length = 0; // its command loop waits for good (nextCommand never resolves here)
  v.items = [ITEM];
  v.open = ITEM.path;
  v.terminal = "t-agent"; // the side panel's copy: the shown tab's agent
  return v;
}

beforeEach(() => {
  mock.reset();
  mock.state.panes = [{ terminal: "t-agent", pane: "p-agent", tab: "tab1" }];
  mock.state.agents = [{ address: "t-agent", tab_name: "ACME-12" }];
});

test("a note is one clean line, cut to its length", () => {
  assert.equal(cleanNote("  the button\nis cut off\there  "), "the button is cut off here");
  assert.equal(cleanNote("look\r\nhere\u001b[31m now"), "look here [31m now");
  assert.equal(cleanNote(""), "");
  assert.equal(cleanNote(undefined), "");
  assert.equal(cleanNote("x".repeat(NOTE_MAX + 50)).length, NOTE_MAX);
});

test("Add to chat opens a note bar for the agent instead of pasting at once", () => {
  const cx = chatCx();
  const v = viewer(cx);
  handlers(v.chatButton({}, "artifact-add", ITEM, "Add to chat", false, "tip", (to, cx) => v.openNote(ITEM, to, cx)))
    .find((h) => h.id === "artifact-add").fn({}, cx);
  assert.deepEqual(v.noteFor, { terminal: "t-agent", path: ITEM.path, marks: false });
  assert.deepEqual(cx.pasted, [], "nothing pasted until the note is added");
  const bar = v.noteBar({});
  assert.ok(texts(bar).includes("To ACME-12"), texts(bar).join(" | "));
  assert.ok(handlers(bar).some((h) => h.id === "artifact-note-add"));
});

test("Enter puts the image's path, then the note, in the agent's message box, and gives the clipboard back", () => {
  const cx = chatCx();
  const v = viewer(cx);
  v.openNote(ITEM, "t-agent", cx);
  cx.runTimers();
  v.noteInput.set_value("the button is cut off here");
  const submit = v.noteInput.__state.calls.find(([m, a]) => m === "on" && a[0] === "submit")[1][1];
  submit({}, cx);
  assert.equal(v.noteFor, null, "the bar closes");
  assert.deepEqual(cx.pasted, [{ pane: "p-agent", text: `${ITEM.path} ` }], "the path alone first, so Claude takes it for an image");
  cx.runTimers();
  assert.deepEqual(cx.pasted, [
    { pane: "p-agent", text: `${ITEM.path} ` },
    { pane: "p-agent", text: "the button is cut off here " },
  ]);
  assert.equal(cx.clipboard, "what I had copied");
  assert.equal(mock.of("run").filter(([n]) => n === "terminal.paste").length, 2);
});

test("with no note it's the image alone, as before", () => {
  const cx = chatCx();
  const v = viewer(cx);
  v.openNote(ITEM, "t-agent", cx);
  v.noteInput.set_value("   ");
  handlers(v.noteBar({})).find((h) => h.id === "artifact-note-add").fn({}, cx);
  cx.runTimers();
  assert.deepEqual(cx.pasted, [{ pane: "p-agent", text: `${ITEM.path} ` }]);
  assert.equal(cx.clipboard, "what I had copied");
});

// The note lands in a terminal: a line break in it would press Enter there (sending the message, or
// running a line in a shell), so what's pasted never holds one.
test("a note typed with line breaks or escapes is pasted as one plain line", () => {
  const cx = chatCx();
  const v = viewer(cx);
  v.openNote(ITEM, "t-agent", cx);
  v.noteInput.set_value("cut off here\nrm -rf ~\r\u001b]0;x\u0007");
  v.sendNote(cx);
  cx.runTimers();
  const note = cx.pasted[1]?.text ?? "";
  assert.doesNotMatch(note, /[\u0000-\u001f\u007f-\u009f]/, JSON.stringify(note));
  assert.equal(note, "cut off here rm -rf ~ ]0;x ");
});

test("the note doesn't go anywhere else once its agent closed", () => {
  const cx = chatCx();
  const v = viewer(cx);
  v.openNote(ITEM, "t-agent", cx);
  v.noteInput.set_value("look here");
  v.sendNote(cx);
  mock.state.panes = [{ terminal: "t-shell", pane: "p-shell", tab: "tab1" }];
  cx.runTimers();
  assert.deepEqual(cx.pasted, [{ pane: "p-agent", text: `${ITEM.path} ` }]);
});

test("Esc closes the note bar without pasting; typed letters stay in the note", () => {
  const cx = chatCx();
  const v = viewer(cx);
  v.openNote(ITEM, "t-agent", cx);
  assert.equal(v.onKey({ key: "a", modifiers: {} }, cx), false, "letters are for the note");
  assert.equal(v.onKey({ key: "space", modifiers: {} }, cx), false, "Space doesn't close the image");
  assert.equal(v.open, ITEM.path);
  assert.equal(v.onKey({ key: "escape", modifiers: {} }, cx), true);
  assert.equal(v.noteFor, null);
  assert.equal(v.open, ITEM.path, "the image stays open");
  assert.deepEqual(cx.pasted, []);
});

test("the marked version goes with its note too", async () => {
  const cx = chatCx();
  const v = viewer(cx);
  v.sizes[ITEM.path] = { width: 800, height: 600 };
  v.markup = { tool: "box", color: "#ff453a", marks: [{ tool: "box", color: "#ff453a", points: [[0.1, 0.1], [0.5, 0.5]] }], undone: [], current: null, saving: false, error: null };
  mock.on.exec = (cmd) => (cmd === "sh" ? { code: 0, stdout: "/tmp/herdr-markup/marked.png\n", stderr: "" } : undefined);
  v.openNote(ITEM, "t-agent", cx, true);
  assert.equal(v.noteFor.marks, true);
  v.noteInput.set_value("this one");
  v.sendNote(cx);
  await cx.settle();
  cx.runTimers();
  assert.deepEqual(cx.pasted, [
    { pane: "p-agent", text: "/tmp/herdr-markup/marked.png " },
    { pane: "p-agent", text: "this one " },
  ]);
  assert.ok(v.markup, "you stay in mark-up");
});
