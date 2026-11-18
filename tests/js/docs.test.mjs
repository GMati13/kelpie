// The docs agents read: CLAUDE.md is loaded into every session, so it stays a map (the universal rules,
// the traps, where each part is described), and how each part works lives in docs/reference/, a doc
// per part, read when that part is touched. CLAUDE.md once grew past Claude Code's 150k-character limit
// (219k), costing every session its context. These tests keep the map short and whole: every doc in it,
// every row's doc there, and every script of the mods and the plugin described by some doc's `covers`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { REPO, readRepo, repoFile } from "../lib/helpers.mjs";

const CLAUDE_MAX = 40000;
const DOC_MAX = 30000;
const REFERENCE = "docs/reference";

function files(dir) {
  return readdirSync(repoFile(dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(repoFile(path)).isDirectory() ? files(path) : [path];
  });
}

const docs = files(REFERENCE).filter((f) => f.endsWith(".md")).sort();
const claude = readRepo("CLAUDE.md");

// A doc's `covers`: its front matter's list of paths, each a file or `folder/*` and `folder/*.ext`.
function coversOf(doc) {
  const text = readRepo(doc);
  const front = text.match(/^---\ncovers:\n((?:  - .+\n)+)---\n/);
  assert.ok(front, `${doc} starts with its covers`);
  return front[1].trim().split("\n").map((l) => l.replace(/^\s*- /, ""));
}

function matches(pattern) {
  if (!pattern.includes("*")) return existsSync(repoFile(pattern)) ? [pattern] : [];
  const dir = pattern.slice(0, pattern.lastIndexOf("/"));
  const ext = pattern.slice(pattern.lastIndexOf("*") + 1);
  return files(dir).filter((f) => f.slice(dir.length + 1).indexOf("/") === -1 && f.endsWith(ext));
}

test("CLAUDE.md stays a map, within its budget", () => {
  assert.ok(claude.length <= CLAUDE_MAX, `CLAUDE.md is ${claude.length} characters, past ${CLAUDE_MAX}: move how a part works into its doc under ${REFERENCE}/`);
});

test("each reference doc stays within its budget", () => {
  for (const doc of docs) {
    const size = readRepo(doc).length;
    assert.ok(size <= DOC_MAX, `${doc} is ${size} characters, past ${DOC_MAX}: split it by topic`);
  }
});

test("every reference doc is in CLAUDE.md's map, and every row has its doc", () => {
  const linked = [...claude.matchAll(/\]\((docs\/reference\/[^)]+\.md)\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(linked)].sort(), docs);
});

test("every doc's covers names files that exist", () => {
  for (const doc of docs) for (const c of coversOf(doc)) assert.ok(matches(c).length, `${doc} covers ${c}, which matches no file`);
});

test("every script of the mods and the plugin is covered by some doc", () => {
  const covered = new Set(docs.flatMap((d) => coversOf(d).flatMap(matches)));
  const scripts = [...files("mods"), "plugin/server.py"]
    .filter((f) => /\.(js|py|sh)$/.test(f) || f.endsWith("/bin/gh"));
  const missing = scripts.filter((f) => !covered.has(f));
  assert.deepEqual(missing, [], "add each to the covers of the doc that describes it");
});

test("docs link only to files that exist", () => {
  for (const doc of ["CLAUDE.md", ...docs]) {
    const text = readRepo(doc);
    for (const [, target] of text.matchAll(/\]\(([^)#\s]+\.md)\)/g)) {
      const from = doc === "CLAUDE.md" ? "" : doc.slice(0, doc.lastIndexOf("/"));
      assert.ok(existsSync(join(REPO, from, target)), `${doc} links to ${target}, which isn't there`);
    }
  }
});
