// The Artifacts panel's temp-file scripts, run for real in a temp folder with fake image tools:
// mark-up's flattened copy (FLATTEN_SCRIPT, markup.js) and a remote image's thumbnail (THUMB_SCRIPT,
// session.js) are made in private folders of their own, never a fixed or unreserved name another
// user could take first, and the clean-up removes only old folders of its own shape, not links.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { FLATTEN_SCRIPT } from "../../mods/kelpie-artifacts/markup.js";
import { THUMB_SCRIPT } from "../../mods/kelpie-artifacts/session.js";
import { fakeBin, sh, tempDir } from "../lib/helpers.mjs";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const DAYS_AGO = (n) => new Date(Date.now() - n * 86400000);
const mode = (path) => statSync(path).mode & 0o777;

// A source image, a TMPDIR of its own, and fake tools copying the source to their output.
function setup() {
  const root = tempDir(), tmp = join(root, "tmp"), src = join(root, "shot.png");
  mkdirSync(tmp);
  writeFileSync(src, PNG);
  const fakes = fakeBin()
    .add("magick", 'for a in "$@"; do last="$a"; done; [ -n "$MAGICK_FAILS" ] && exit 1; cp "$1" "$last"')
    .add("sips", '[ -n "$SIPS_FAILS" ] && exit 1; while [ $# -gt 0 ]; do [ "$1" = --out ] && { cp "$SRC" "$2"; exit 0; }; shift; done; exit 1');
  const env = (more = {}) => ({ PATH: fakes.path, TMPDIR: `${tmp}/`, SRC: src, ...more });
  return { root, tmp, src, fakes, env };
}

describe("mark-up's flattened copy (FLATTEN_SCRIPT)", () => {
  const flatten = (s, more) => sh("sh", ["-c", FLATTEN_SCRIPT, "sh", s.src, "-stroke", "red"], { env: s.env(more) });

  test("goes into a private folder of its own in TMPDIR, and prints its path", () => {
    const s = setup();
    const r = flatten(s);
    assert.equal(r.code, 0, r.stderr);
    const out = r.stdout;
    assert.match(out, /\/herdr-markup\.[A-Za-z0-9]{6}\/edit\.png$/);
    assert.equal(dirname(dirname(out)), s.tmp);
    assert.equal(mode(dirname(out)), 0o700, "only its owner can enter it");
    assert.deepEqual(readFileSync(out), PNG);
    const again = flatten(s).stdout;
    assert.notEqual(dirname(again), dirname(out), "every copy its own folder");
  });

  test("never writes into a fixed folder someone else could make first", () => {
    const s = setup(), theirs = join(s.root, "theirs");
    mkdirSync(theirs);
    symlinkSync(theirs, join(s.tmp, "herdr-markup"));
    const r = flatten(s);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(readdirSync(theirs), [], "nothing written through the old fixed name");
    assert.ok(!r.stdout.startsWith(join(s.tmp, "herdr-markup/")));
  });

  test("removes its own folders over a day old, nothing else", () => {
    const s = setup(), old = join(s.tmp, "herdr-markup.abc123"), fresh = join(s.tmp, "herdr-markup.def456");
    const other = join(s.tmp, "herdr-markup-keep"), target = join(s.root, "target"), link = join(s.tmp, "herdr-markup.lnk123");
    for (const d of [old, fresh, other, target]) { mkdirSync(d); writeFileSync(join(d, "edit.png"), PNG); }
    symlinkSync(target, link);
    for (const p of [old, other, target]) utimesSync(p, DAYS_AGO(2), DAYS_AGO(2));
    assert.equal(flatten(s).code, 0);
    assert.ok(!existsSync(old), "an old folder of its own goes");
    assert.ok(existsSync(join(fresh, "edit.png")), "a recent one stays");
    assert.ok(existsSync(join(other, "edit.png")), "another name stays");
    assert.ok(lstatSync(link).isSymbolicLink() && existsSync(join(target, "edit.png")), "a link and where it points stay");
  });

  test("leaves no folder behind when the copy fails", () => {
    const s = setup();
    const r = flatten(s, { MAGICK_FAILS: "1" });
    assert.notEqual(r.code, 0);
    assert.equal(r.stdout, "");
    assert.deepEqual(readdirSync(s.tmp), []);
  });
});

describe("a remote image's thumbnail (THUMB_SCRIPT)", () => {
  const thumb = (s, more) => sh("sh", ["-c", THUMB_SCRIPT, "sh", s.src], { env: s.env(more) });

  test("is made in a private folder of its own, printed as base64, and cleaned away", () => {
    const s = setup();
    const r = thumb(s);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(Buffer.from(r.stdout, "base64"), PNG);
    const out = s.fakes.calls("sips")[0].argv.at(-1);
    assert.match(out, /\/herdr-thumb\.[A-Za-z0-9]{6}\/thumb\.png$/);
    assert.equal(dirname(dirname(normalize(out))), s.tmp);
    assert.deepEqual(readdirSync(s.tmp), [], "nothing left in TMPDIR");
  });

  test("falls back to the image itself without sips, still leaving nothing", () => {
    const s = setup();
    const r = thumb(s, { SIPS_FAILS: "1" });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(Buffer.from(r.stdout, "base64"), PNG);
    assert.deepEqual(readdirSync(s.tmp), []);
  });

  test("says it failed when there's nothing to send", () => {
    const s = setup();
    const r = sh("sh", ["-c", THUMB_SCRIPT, "sh", join(s.root, "missing.png")], { env: s.env({ SIPS_FAILS: "1" }) });
    assert.notEqual(r.code, 0);
    assert.deepEqual(readdirSync(s.tmp), []);
  });
});
