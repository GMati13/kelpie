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

// A passage someone pointed to (Claude, quoting a ticket) found in the blocks, so the view can show it
// where it is instead of as a quote. Matching forgives what quoting changes: case, runs of spaces and
// line breaks, double quotes (a quote's own), curly quotes and dashes, Markdown's * _ ` marks, and "…" for left-out words (each piece
// found in order). `{ index, exact, blocks }`: the first top-level block it's in, whether the words
// were found as they are, and a copy of the blocks with the passage's runs marked (`mark: true`; a
// code block wholly, `marked`) and each top-level block it touches flagged `hl`. A passage not found
// word for word falls back to the block holding most of its words (`exact: false`, nothing marked);
// null when none holds most of them.
const FOLD = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " " };
function squash(s) {
  let out = "", space = false;
  const map = [];
  for (let i = 0; i < s.length; i++) {
    const c = FOLD[s[i]] ?? s[i];
    if (c === "*" || c === "_" || c === "`" || c === '"') continue;
    if (/\s/.test(c)) { if (out && !space) { out += " "; map.push(i); space = true; } continue; }
    space = false;
    out += c.toLowerCase();
    map.push(i);
  }
  return { out, map };
}
const leafText = (b) => (b.kind === "code" ? b.text : b.runs.map((r) => (r.br ? "\n" : r.text)).join(""));
// Every block with text of its own (paragraph, heading, code), in reading order, with its top-level index.
function leaves(list, top = null, out = []) {
  list.forEach((b, i) => {
    const at = top ?? i;
    if (b.kind === "list") b.items.forEach((item) => leaves(item, at, out));
    else if (b.kind === "quote") leaves(b.blocks, at, out);
    else out.push({ top: at, block: b });
  });
  return out;
}
function markRuns(runs, s, e) {
  const out = [];
  let pos = 0;
  for (const r of runs) {
    if (r.br) { out.push(r); pos += 1; continue; }
    const a = pos, b = pos + r.text.length;
    pos = b;
    if (e <= a || s >= b) { out.push(r); continue; }
    const x = Math.max(s, a) - a, y = Math.min(e, b) - a;
    if (x > 0) out.push({ ...r, text: r.text.slice(0, x) });
    out.push({ ...r, text: r.text.slice(x, y), mark: true });
    if (y < r.text.length) out.push({ ...r, text: r.text.slice(y) });
  }
  return out;
}
// The blocks again, each leaf through `fn` (in leaves()' order), each top-level block through `top`.
function remap(list, fn, top, counter = { n: 0 }, depth = 0) {
  return list.map((b, i) => {
    let c;
    if (b.kind === "list") c = { ...b, items: b.items.map((item) => remap(item, fn, top, counter, depth + 1)) };
    else if (b.kind === "quote") c = { ...b, blocks: remap(b.blocks, fn, top, counter, depth + 1) };
    else c = fn(b, counter.n++);
    return depth === 0 ? top(c, i) : c;
  });
}
export function findPassage(list, quote) {
  const pieces = String(quote ?? "").split(/…|\.\.\./).map((p) => squash(p).out.trim()).filter((p) => p.length >= 3);
  if (!list?.length || !pieces.length) return null;
  const all = leaves(list);
  let doc = "";
  const spans = all.map((l) => { const start = doc.length; doc += leafText(l.block); const span = [start, doc.length]; doc += "\n"; return span; });
  const { out, map } = squash(doc);
  let from = 0, first = -1, last = -1;
  for (const p of pieces) {
    const at = out.indexOf(p, from);
    if (at < 0) { first = -1; break; }
    if (first < 0) first = at;
    last = at + p.length;
    from = last;
  }
  if (first >= 0) {
    const s = map[first], e = map[last - 1] + 1;
    const touched = new Set(all.filter((_, i) => spans[i][0] < e && spans[i][1] > s).map((l) => l.top));
    const blocks = remap(list, (b, i) => {
      const [a, z] = spans[i];
      if (z <= s || a >= e) return b;
      return b.kind === "code" ? { ...b, marked: true } : { ...b, runs: markRuns(b.runs, Math.max(s, a) - a, Math.min(e, z) - a) };
    }, (b, i) => (touched.has(i) ? { ...b, hl: true } : b));
    return { index: Math.min(...touched), exact: true, share: 1, blocks };
  }
  // Not word for word: the top-level block holding most of the passage's words, if most of them.
  const words = [...new Set(pieces.join(" ").split(" ").filter((w) => w.length >= 3))];
  if (!words.length) return null;
  let best = null;
  for (let i = 0; i < list.length; i++) {
    const text = all.filter((l) => l.top === i).map((l) => squash(leafText(l.block)).out).join(" ");
    const share = words.filter((w) => text.includes(w)).length / words.length;
    if (share >= 0.6 && (!best || share > best.share)) best = { i, share };
  }
  if (!best) return null;
  return { index: best.i, exact: false, share: best.share, blocks: list.map((b, i) => (i === best.i ? { ...b, hl: true } : b)) };
}

// Where a quote is in a ticket: its description (`description`, blocks) or one of its comments
// (`comments`, [{ blocks }], oldest first): { where: "description" | "comment", n (the comment's place,
// -1 for the description), found (findPassage()'s) }, or null. Word for word wins over a closest match
// wherever it is; the description is looked in first, then the comments newest first (the later word on
// something is usually the one asked about), and between closest matches the one sharing most of the
// quote's words wins, the description on a tie.
export function findInTicket(description, comments, quote) {
  const tries = [{ where: "description", n: -1, blocks: description }, ...(comments ?? []).map((c, n) => ({ where: "comment", n, blocks: c?.blocks })).reverse()];
  let best = null;
  for (const x of tries) {
    const found = x.blocks?.length ? findPassage(x.blocks, quote) : null;
    if (!found) continue;
    if (found.exact) return { where: x.where, n: x.n, found };
    if (!best || found.share > best.found.share) best = { where: x.where, n: x.n, found };
  }
  return best;
}
