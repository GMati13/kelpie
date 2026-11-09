// A Jira description (Atlassian Document Format, a tree of nodes) as plain blocks the story views
// draw: paragraphs and headings of inline runs, lists, code blocks and quotes. Pure, no UI, so it can
// be tried outside Herdr. Anything not named here shows as its text, so nothing written is lost.
//   block  { kind: "p", runs } | { kind: "h", level, runs } | { kind: "code", text }
//          | { kind: "list", ordered, start, items: [blocks] } | { kind: "quote", blocks }
//   run    { text, bold, italic, code, link } | { br: true }

// Every bit of text under a node, for nodes drawn only as their text.
function textOf(n) {
  if (!n) return "";
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  if (n.type === "mention") return (n.attrs?.text ?? "").replace(/^@/, "");
  if (n.type === "emoji") return n.attrs?.text ?? n.attrs?.shortName ?? "";
  if (n.type === "inlineCard" || n.type === "blockCard" || n.type === "embedCard") return n.attrs?.url ?? "";
  if (n.type === "status") return n.attrs?.text ?? "";
  if (n.type === "date") return n.attrs?.timestamp ? new Date(Number(n.attrs.timestamp)).toISOString().slice(0, 10) : "";
  return (n.content ?? []).map(textOf).join("");
}

function runs(nodes) {
  const out = [];
  for (const n of nodes ?? []) {
    if (n.type === "hardBreak") { out.push({ br: true }); continue; }
    if (n.type === "text") {
      const m = (type) => (n.marks ?? []).find((x) => x.type === type);
      out.push({ text: n.text ?? "", bold: Boolean(m("strong")), italic: Boolean(m("em")), code: Boolean(m("code")), link: m("link")?.attrs?.href ?? null });
      continue;
    }
    if (n.type === "inlineCard") { const url = n.attrs?.url ?? ""; if (url) out.push({ text: url, link: url }); continue; }
    const text = textOf(n);
    if (text) out.push({ text });
  }
  return out;
}

const INLINE = new Set(["text", "hardBreak", "mention", "emoji", "inlineCard", "status", "date", "mediaInline", "placeholder", "inlineExtension"]);

function blocks(nodes) {
  const out = [];
  for (const n of nodes ?? []) {
    switch (n.type) {
      case "paragraph": { const r = runs(n.content); if (r.some((x) => x.br || x.text.trim())) out.push({ kind: "p", runs: r }); break; }
      case "heading": out.push({ kind: "h", level: n.attrs?.level ?? 2, runs: runs(n.content) }); break;
      case "bulletList": case "orderedList":
        out.push({ kind: "list", ordered: n.type === "orderedList", start: n.attrs?.order ?? 1, items: (n.content ?? []).map((li) => blocks(li.content)) });
        break;
      case "taskList":
        out.push({ kind: "list", ordered: false, items: (n.content ?? []).map((li) => [{ kind: "p", runs: [{ text: `${li.attrs?.state === "DONE" ? "☑" : "☐"} ` }, ...runs(li.content)] }]) });
        break;
      case "codeBlock": out.push({ kind: "code", text: textOf(n) }); break;
      case "blockquote": case "panel": { const b = blocks(n.content); if (b.length) out.push({ kind: "quote", blocks: b }); break; }
      case "expand": case "nestedExpand":
        if (n.attrs?.title) out.push({ kind: "h", level: 4, runs: [{ text: n.attrs.title }] });
        out.push(...blocks(n.content));
        break;
      case "table":
        // A row a line, its cells side by side.
        for (const row of n.content ?? []) {
          const cells = (row.content ?? []).map((c) => textOf(c).trim()).filter(Boolean);
          if (cells.length) out.push({ kind: "p", runs: [{ text: cells.join("  ·  ") }] });
        }
        break;
      case "rule": case "mediaSingle": case "mediaGroup": case "media": break; // nothing to read
      default:
        if (INLINE.has(n.type)) { const r = runs([n]); if (r.length) out.push({ kind: "p", runs: r }); }
        else if ((n.content ?? []).some((c) => !INLINE.has(c.type))) out.push(...blocks(n.content));
        else { const text = textOf(n).trim(); if (text) out.push({ kind: "p", runs: [{ text }] }); }
    }
  }
  return out;
}

// A description's blocks; none when it's empty (Jira sends null, or a doc with no text).
export const adfBlocks = (doc) => (doc && typeof doc === "object" ? blocks(doc.type === "doc" ? doc.content : [doc]) : []);

// About how many lines the blocks take at the story header's width, to know whether "Show more" has
// anything more to show. A guess: the views can't measure text.
export function adfLines(list, perLine = 90) {
  let n = 0;
  for (const b of list) {
    if (b.kind === "list") n += b.items.reduce((m, item) => m + Math.max(1, adfLines(item, perLine - 4)), 0);
    else if (b.kind === "quote") n += adfLines(b.blocks, perLine - 4);
    else if (b.kind === "code") n += b.text.split("\n").length;
    else n += b.runs.reduce((m, r) => m + (r.br ? 1 : 0), 0) + Math.max(1, Math.ceil(b.runs.reduce((m, r) => m + (r.text?.length ?? 0), 0) / perLine));
  }
  return n;
}

// The blocks as plain text (Markdown-ish), for a prompt: headings with #, lists with - or 1., code
// fenced, quotes with >.
export function adfText(list, indent = "") {
  const line = (runs) => runs.map((r) => (r.br ? "\n" : r.code ? `\`${r.text}\`` : r.link && r.link !== r.text ? `${r.text} (${r.link})` : r.text)).join("");
  return list.map((b) => {
    if (b.kind === "h") return `${indent}${"#".repeat(Math.min(6, b.level ?? 2))} ${line(b.runs)}`;
    if (b.kind === "code") return `${indent}\`\`\`\n${b.text}\n${indent}\`\`\``;
    if (b.kind === "quote") return adfText(b.blocks, `${indent}> `);
    if (b.kind === "list") return b.items.map((item, n) => `${indent}${b.ordered ? `${(b.start ?? 1) + n}.` : "-"} ${adfText(item, `${indent}  `).trimStart()}`).join("\n");
    return `${indent}${line(b.runs)}`;
  }).join("\n\n");
}
