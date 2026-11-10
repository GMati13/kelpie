// Jira descriptions (adf.js): Atlassian Document Format to the blocks the story views draw, their
// line estimate (adfLines) and their text for prompts (adfText). Nothing written may be lost.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { adfBlocks, adfLines, adfText } from "../../mods/kelpie/adf.js";
import { adfOf } from "../../mods/kelpie/demo.js";

const doc = (...content) => ({ type: "doc", version: 1, content });
const text = (t, ...marks) => ({ type: "text", text: t, ...(marks.length ? { marks } : {}) });
const p = (...content) => ({ type: "paragraph", content });
const plain = (t) => ({ text: t, bold: false, italic: false, code: false, link: null });

describe("adfBlocks", () => {
  test("nothing for null, a non-object or an empty doc", () => {
    assert.deepEqual(adfBlocks(null), []);
    assert.deepEqual(adfBlocks("text"), []);
    assert.deepEqual(adfBlocks(doc()), []);
    assert.deepEqual(adfBlocks(doc(p(), p(text("   ")))), [], "blank paragraphs are dropped");
  });
  test("paragraphs and headings of runs, with their marks", () => {
    const b = adfBlocks(doc(
      { type: "heading", attrs: { level: 3 }, content: [text("Why")] },
      p(text("Plain "), text("bold", { type: "strong" }), text("it", { type: "em" }), text("x()", { type: "code" }),
        text("site", { type: "link", attrs: { href: "https://example.com" } }), { type: "hardBreak" }, text("next")),
    ));
    assert.deepEqual(b[0], { kind: "h", level: 3, runs: [plain("Why")] });
    assert.deepEqual(b[1].runs, [plain("Plain "), { ...plain("bold"), bold: true }, { ...plain("it"), italic: true }, { ...plain("x()"), code: true },
      { ...plain("site"), link: "https://example.com" }, { br: true }, plain("next")]);
  });
  test("a heading without a level is level 2", () => {
    assert.equal(adfBlocks(doc({ type: "heading", content: [text("H")] }))[0].level, 2);
  });
  test("lists, ordered with their start, nested", () => {
    const li = (...c) => ({ type: "listItem", content: c });
    const [list] = adfBlocks(doc({ type: "orderedList", attrs: { order: 3 }, content: [li(p(text("a"))), li(p(text("b")), { type: "bulletList", content: [li(p(text("c")))] })] }));
    assert.equal(list.kind, "list");
    assert.equal(list.ordered, true);
    assert.equal(list.start, 3);
    assert.equal(list.items.length, 2);
    assert.deepEqual(list.items[1][1], { kind: "list", ordered: false, start: 1, items: [[{ kind: "p", runs: [plain("c")] }]] });
  });
  test("task lists as boxes, ticked when done", () => {
    const [list] = adfBlocks(doc({ type: "taskList", content: [{ type: "taskItem", attrs: { state: "DONE" }, content: [text("shipped")] }, { type: "taskItem", attrs: { state: "TODO" }, content: [text("next")] }] }));
    assert.deepEqual(list.items.map((i) => i[0].runs.map((r) => r.text).join("")), ["☑ shipped", "☐ next"]);
  });
  test("code blocks keep their text and lines; quotes and panels hold blocks", () => {
    const b = adfBlocks(doc({ type: "codeBlock", attrs: { language: "js" }, content: [text("a()\nb()")] },
      { type: "blockquote", content: [p(text("said"))] }, { type: "panel", attrs: { panelType: "info" }, content: [p(text("note"))] }));
    assert.deepEqual(b[0], { kind: "code", text: "a()\nb()" });
    assert.deepEqual(b[1], { kind: "quote", blocks: [{ kind: "p", runs: [plain("said")] }] });
    assert.equal(b[2].kind, "quote");
  });
  test("mentions, emoji, status, dates and cards read as their text", () => {
    const [b] = adfBlocks(doc(p(text("Ask "), { type: "mention", attrs: { text: "@Priya" } }, text(" "), { type: "emoji", attrs: { shortName: ":tada:", text: "🎉" } },
      { type: "status", attrs: { text: "BLOCKED" } }, { type: "date", attrs: { timestamp: "1700000000000" } },
      { type: "inlineCard", attrs: { url: "https://example.com/x" } })));
    assert.deepEqual(b.runs.map((r) => r.text), ["Ask ", "Priya", " ", "🎉", "BLOCKED", "2023-11-14", "https://example.com/x"]);
    assert.equal(b.runs.at(-1).link, "https://example.com/x", "an inline card is a link");
  });
  test("tables a row a line; expands as a heading and their content; media and rules left out", () => {
    const cell = (t) => ({ type: "tableCell", content: [p(text(t))] });
    const b = adfBlocks(doc(
      { type: "table", content: [{ type: "tableRow", content: [cell("a"), cell("b")] }, { type: "tableRow", content: [cell(""), cell("c")] }] },
      { type: "expand", attrs: { title: "More" }, content: [p(text("inside"))] },
      { type: "rule" }, { type: "mediaSingle", content: [{ type: "media", attrs: { id: "x" } }] },
    ));
    assert.deepEqual(b.map((x) => [x.kind, x.runs?.map((r) => r.text).join("")]), [["p", "a  ·  b"], ["p", "c"], ["h", "More"], ["p", "inside"]]);
  });
  test("an unknown node keeps its text: inline content as a paragraph, blocks inside it as blocks", () => {
    const b = adfBlocks(doc({ type: "someFutureNode", content: [text("kept")] }, { type: "layoutSection", content: [{ type: "layoutColumn", content: [p(text("col"))] }] },
      { type: "blockCard", attrs: { url: "https://example.com/card" } }));
    assert.deepEqual(b.map((x) => x.runs.map((r) => r.text).join("")), ["kept", "col", "https://example.com/card"]);
  });
  test("a bare node (not a doc) is read as one block", () => {
    assert.deepEqual(adfBlocks(p(text("alone"))), [{ kind: "p", runs: [plain("alone")] }]);
  });
});

describe("adfLines: about how many lines the blocks take", () => {
  test("a paragraph by its length, breaks and code lines counted", () => {
    assert.equal(adfLines([{ kind: "p", runs: [{ text: "x".repeat(181) }] }], 90), 3);
    assert.equal(adfLines([{ kind: "p", runs: [{ text: "a" }, { br: true }, { text: "b" }] }]), 2);
    assert.equal(adfLines([{ kind: "code", text: "a\nb\nc" }]), 3);
    assert.equal(adfLines([{ kind: "h", runs: [] }]), 1, "at least a line each");
  });
  test("lists and quotes narrower, each item a line at least", () => {
    assert.equal(adfLines([{ kind: "list", items: [[{ kind: "p", runs: [{ text: "x".repeat(87) }] }], []] }], 90), 3);
    assert.equal(adfLines([{ kind: "quote", blocks: [{ kind: "p", runs: [{ text: "x".repeat(87) }] }] }], 90), 2);
  });
});

describe("adfText: the blocks as text for a prompt", () => {
  test("headings with #, lists with - and numbers from their start, code fenced, quotes with >", () => {
    const b = adfBlocks(adfOf("# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n\n3. three\n4. four"));
    assert.equal(adfText(b), "## Title\n\nSome bold and `code`.\n\n- one\n- two\n\n1. three\n2. four");
    assert.equal(adfText([{ kind: "code", text: "x = 1" }]), "```\nx = 1\n```");
    assert.equal(adfText([{ kind: "quote", blocks: [{ kind: "p", runs: [{ text: "said" }] }] }]), "> said");
    assert.equal(adfText([{ kind: "list", ordered: true, start: 5, items: [[{ kind: "p", runs: [{ text: "five" }] }]] }]), "5. five");
  });
  test("links show their address unless the text is it", () => {
    assert.equal(adfText([{ kind: "p", runs: [{ text: "docs", link: "https://example.com" }, { text: " " }, { text: "https://e.x", link: "https://e.x" }] }]), "docs (https://example.com) https://e.x");
  });
  test("a heading level is capped at 6", () => {
    assert.equal(adfText([{ kind: "h", level: 9, runs: [{ text: "deep" }] }]), "###### deep");
  });
});
