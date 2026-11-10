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

// A pull request's description (GitHub Markdown) as the same blocks, so the views draw it as they do
// a ticket's. Enough of Markdown to read by: headings, paragraphs (a line break stays one, as GitHub
// shows them), lists and task lists, fenced code, quotes, tables as a row a line, and inline code,
// bold, italic and links. HTML comments (templates' hints) and images go; other tags are dropped but
// their text kept. Others write these: only http(s) links stay links, the rest is text.
export function markdownBlocks(md) {
  const text = String(md ?? "").replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?(-->|$)/g, "");
  const lines = text.split("\n");
  const out = [];
  let para = null, list = null;
  const end = () => { para = null; list = null; };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const fence = /^\s*(```|~~~)/.exec(raw);
    if (fence) {
      const code = [];
      for (i++; i < lines.length && !lines[i].trimStart().startsWith(fence[1]); i++) code.push(lines[i]);
      end();
      out.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const line = stripTags(raw);
    if (!line.trim()) { end(); continue; }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { end(); out.push({ kind: "h", level: Math.min(6, h[1].length + 1), runs: mdRuns(h[2]) }); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { end(); continue; } // a rule
    const q = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (q) {
      const quote = [q[1]];
      while (i + 1 < lines.length && /^\s{0,3}>/.test(lines[i + 1])) quote.push(stripTags(lines[++i]).replace(/^\s{0,3}>\s?/, ""));
      end();
      const inner = markdownBlocks(quote.join("\n"));
      if (inner.length) out.push({ kind: "quote", blocks: inner });
      continue;
    }
    if (/^\s*\|/.test(line)) {
      end();
      if (/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line)) continue; // the row under a table's header
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length) out.push({ kind: "p", runs: mdRuns(cells.join("  ·  ")) });
      continue;
    }
    const item = /^\s*([-*+]|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      const ordered = Boolean(item[2]);
      const task = /^\[([ xX])\]\s+(.*)$/.exec(item[3]);
      const runs = task ? [{ text: task[1] === " " ? "☐ " : "☑ " }, ...mdRuns(task[2])] : mdRuns(item[3]);
      if (!list || list.ordered !== ordered) { para = null; list = { kind: "list", ordered, start: ordered ? Number(item[2]) : 1, items: [] }; out.push(list); }
      list.items.push([{ kind: "p", runs }]);
      continue;
    }
    // A line under a list item, indented, goes on with it; any other starts or goes on with a paragraph.
    if (list && /^\s+\S/.test(line)) { const runs = list.items[list.items.length - 1][0].runs; runs.push({ br: true }, ...mdRuns(line.trim())); continue; }
    list = null;
    if (para) para.runs.push({ br: true }, ...mdRuns(line.trim()));
    else { para = { kind: "p", runs: mdRuns(line.trim()) }; out.push(para); }
  }
  return out.filter((b) => b.kind !== "p" || b.runs.some((r) => r.br || r.text.trim()));
}

// Tags dropped (a line break tag kept as a space), their text kept; images and the like vanish.
const stripTags = (line) => line.replace(/<br\s*\/?>/gi, " ").replace(/<\/?[a-z][^>]*>/gi, "");

// Inline Markdown as runs: `code` first (nothing inside it is Markdown), then links, bold, italic.
function mdRuns(text) {
  const out = [];
  // A link's address may hold one level of brackets (a wiki page's, say), and a title after a space.
  const url = String.raw`((?:[^()\s]|\([^()\s]*\))*)(?:\s+"[^"]*")?`;
  const re = new RegExp(String.raw`\x60([^\x60]+)\x60|!\[([^\]]*)\]\(${url}\)|\[([^\]]+)\]\(${url}\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|(?<![\w])_([^_\s][^_]*)_(?![\w])`, "g");
  let at = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], code: true });
    else if (m[3] !== undefined) { /* an image: nothing to read */ }
    else if (m[4] !== undefined) out.push(/^https?:\/\//i.test(m[5]) ? { text: m[4], link: m[5] } : { text: m[4] });
    else if (m[6] !== undefined || m[7] !== undefined) out.push({ text: m[6] ?? m[7], bold: true });
    else out.push({ text: m[8] ?? m[9], italic: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out.map((r) => ({ bold: false, italic: false, code: false, link: null, ...r }));
}
