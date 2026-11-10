// The Changes view's diff logic (stories.js): a patch as rows (diffRows), the words that changed in a
// line (wordChanges), a file's status letter (fileStatus), GitHub's five squares (changeSquares),
// light syntax colours (syntaxOf, syntaxSpans) and the patch hash viewed ticks are stored by.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { changeSquares, diffRows, fileStatus, patchHash, syntaxOf, syntaxSpans, wordChanges } from "../../mods/kelpie/stories.js";

const PATCH = [
  "@@ -1,3 +1,4 @@ function start()",
  " first",
  "-the old line here",
  "+the new line here",
  "+\tadded",
  " last",
  "@@ -10,2 +11,2 @@",
  "-x = 1",
  "+x = 2",
  " end",
].join("\n");
const lines = (rows) => rows.map((r) => (r.kind === "hunk" ? `@ ${r.gap}${r.trailing ? " trailing" : ""}` : `${r.kind} ${r.old ?? "-"} ${r.new ?? "-"} ${r.text}`));

describe("diffRows: a patch as rows", () => {
  test("old and new line numbers per line, the +/- moved out of the text, tabs as spaces", () => {
    assert.deepEqual(lines(diffRows(PATCH)), [
      "@ 0", "ctx 1 1 first", "del 2 - the old line here", "add - 2 the new line here", "add - 3     added", "ctx 3 4 last",
      "@ 1", "del 10 - x = 1", "add - 11 x = 2", "ctx 11 12 end",
      "@ 2 trailing",
    ]);
  });
  test("each hunk says where it is, what it skips and the function it's in", () => {
    const hunks = diffRows(PATCH).filter((r) => r.kind === "hunk");
    assert.deepEqual(hunks.map(({ gap, skipped, from, at, delta, context, trailing }) => ({ gap, skipped, from, at, delta, context, trailing })), [
      { gap: 0, skipped: 0, from: 1, at: 1, delta: 0, context: "function start()", trailing: undefined },
      { gap: 1, skipped: 6, from: 5, at: 11, delta: 1, context: "", trailing: undefined },
      { gap: 2, skipped: null, from: 13, at: null, delta: 1, context: "", trailing: true },
    ]);
  });
  test("a removed line and the added line it pairs with mark the words that changed", () => {
    const rows = diffRows(PATCH);
    assert.deepEqual(rows[2].marks, [[4, 7]], "old");
    assert.deepEqual(rows[3].marks, [[4, 7]], "new");
    assert.equal(rows[4].marks, undefined, "an added line with no pair is unmarked");
    assert.deepEqual([rows[7].marks, rows[8].marks], [[[4, 5]], [[4, 5]]]);
  });
  test("a removed line pairs with the added line most like it, not one added above it", () => {
    const rows = diffRows("@@ -1,1 +1,2 @@\n-const total = price * count;\n+// the total\n+const total = price * count + tax;");
    assert.equal(rows[2].marks, undefined);
    assert.deepEqual(rows[3].marks, [[27, 33]]);
  });
  test("a new or deleted file has no gap after it", () => {
    assert.deepEqual(lines(diffRows("@@ -0,0 +1,2 @@\n+a\n+b")), ["@ 0", "add - 1 a", "add - 2 b"]);
    assert.deepEqual(lines(diffRows("@@ -1,1 +0,0 @@\n-a")), ["@ 0", "del 1 - a"]);
  });
  test("notes: no newline at the end, a diff cut short (no gap after it)", () => {
    const rows = diffRows("@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n… cut here, the diff is too long");
    assert.deepEqual(rows.filter((r) => r.kind === "note").map((r) => r.text), ["No newline at end of file", "… cut here, the diff is too long"]);
    assert.ok(!rows.some((r) => r.trailing));
  });
  test("a patch with no lines says why", () => {
    assert.deepEqual(diffRows(""), [{ kind: "note", text: "No lines changed: renamed, or only its mode changed." }]);
  });
  test("parsed once per patch", () => {
    assert.equal(diffRows(PATCH), diffRows(PATCH));
  });
});

describe("wordChanges: what changed inside a line", () => {
  test("the changed words' ranges in each version", () => {
    assert.deepEqual(wordChanges("let a = compute(x)", "let a = compute(y)"), [[[16, 17]], [[16, 17]]]);
    assert.deepEqual(wordChanges("one two", "one two three"), [[], [[7, 13]]]);
  });
  // stories.js wordChanges() says "Spaces between two changed words join them", but a space both
  // versions share is kept by the LCS, so the two words come out as two ranges.
  test("neighbouring changed words join across the spaces between them", { todo: "BUG: mods/kelpie/stories.js:836 wordChanges(): a shared space between two changed words splits them into two ranges ([5,6],[7,8]), against its own comment" }, () => {
    assert.deepEqual(wordChanges("keep a b keep", "keep c d keep"), [[[5, 8]], [[5, 8]]]);
  });
  test("a change of spaces alone isn't marked", () => {
    assert.deepEqual(wordChanges("a b", "a   b"), [[], []]);
  });
  test("lines with under 40% in common read as rewritten: nothing marked", () => {
    assert.equal(wordChanges("return value", "throw new Error()"), null);
    assert.notEqual(wordChanges("alpha beta gamma delta", "alpha beta gamma epsilon"), null);
  });
  test("empty or huge lines aren't compared", () => {
    assert.equal(wordChanges("", "x"), null);
    const long = Array.from({ length: 250 }, (_, i) => `w${i}`).join(" ");
    assert.equal(wordChanges(long, `${long} more`), null);
  });
});

describe("fileStatus: what happened to a file", () => {
  test("GitHub's status, copied counting as added", () => {
    assert.equal(fileStatus("removed", ""), "removed");
    assert.equal(fileStatus("added", ""), "added");
    assert.equal(fileStatus("copied", ""), "added");
    assert.equal(fileStatus("renamed", ""), "renamed");
    assert.equal(fileStatus("changed", ""), "modified");
    assert.equal(fileStatus(undefined, undefined), "modified");
  });
  test("else the local patch's own mode and rename lines", () => {
    assert.equal(fileStatus("modified", "deleted file mode 100644\n@@ -1 +0,0 @@\n-a"), "removed");
    assert.equal(fileStatus("modified", "new file mode 100644\n@@ -0,0 +1 @@\n+a"), "added");
    assert.equal(fileStatus("modified", "similarity index 90%\nrename from a.js\nrename to b.js"), "renamed");
  });
  test("the same patch answers each status apart", () => {
    const p = "@@ -1 +1 @@\n-a\n+b";
    assert.equal(fileStatus("removed", p), "removed");
    assert.equal(fileStatus("modified", p), "modified");
  });
});

describe("changeSquares: GitHub's five squares", () => {
  test("split between added and removed lines, the rest empty", () => {
    assert.deepEqual(changeSquares(0, 0), ["none", "none", "none", "none", "none"]);
    assert.deepEqual(changeSquares(10, 0), ["add", "add", "add", "add", "add"]);
    assert.deepEqual(changeSquares(0, 3), ["del", "del", "del", "del", "del"]);
    assert.deepEqual(changeSquares(1, 1), ["add", "add", "add", "del", "del"]);
    assert.deepEqual(changeSquares(1, 99), ["del", "del", "del", "del", "del"]);
    assert.deepEqual(changeSquares(3, 1), ["add", "add", "add", "add", "del"]);
  });
  test("always five", () => {
    for (const [a, d] of [[1, 2], [2, 7], [5, 5], [13, 4]]) assert.equal(changeSquares(a, d).length, 5);
  });
});

describe("syntaxOf and syntaxSpans: light syntax colours", () => {
  test("the comment style by extension; prose and unknown files plain", () => {
    assert.deepEqual(syntaxOf("src/a.ts"), { line: "//", block: true });
    assert.deepEqual(syntaxOf("x.py"), { line: "#", block: false });
    assert.deepEqual(syntaxOf("build/Makefile"), { line: "#", block: false });
    assert.deepEqual(syntaxOf("q.sql"), { line: "--", block: false });
    for (const p of ["README.md", "notes.txt", "", undefined]) assert.equal(syntaxOf(p), null);
  });
  test("keywords, strings, numbers and comments", () => {
    const js = syntaxOf("a.js");
    assert.deepEqual(syntaxSpans('const x = "s"; // c', js), [[0, 5, "keyword"], [10, 13, "string"], [15, 19, "comment"]]);
    assert.deepEqual(syntaxSpans("let n = 42", js), [[0, 3, "keyword"], [8, 10, "number"]]);
    assert.deepEqual(syntaxSpans("def f(): # why", syntaxOf("a.py")), [[0, 3, "keyword"], [9, 14, "comment"]]);
    assert.deepEqual(syntaxSpans("select 1 -- note", syntaxOf("a.sql")), [[7, 8, "number"], [9, 16, "comment"]]);
  });
  test("a line starting a block comment is all comment; no language, no colours", () => {
    assert.deepEqual(syntaxSpans("  * docs here", syntaxOf("a.ts")), [[0, 13, "comment"]]);
    assert.deepEqual(syntaxSpans("  * a list item", syntaxOf("a.py")).length, 0);
    assert.deepEqual(syntaxSpans("const x", null), []);
  });
});

describe("patchHash: what viewed ticks are stored by", () => {
  test("the same patch, the same hash, across restarts (FNV-1a in base 36)", () => {
    assert.equal(patchHash(""), (0x811c9dc5).toString(36));
    assert.equal(patchHash("abc"), (0x1a47e90b).toString(36));
  });
  test("a changed patch, another hash", () => {
    assert.notEqual(patchHash("@@ -1 +1 @@\n-a\n+b"), patchHash("@@ -1 +1 @@\n-a\n+c"));
    assert.equal(patchHash(PATCH), patchHash(PATCH.slice()));
  });
});
