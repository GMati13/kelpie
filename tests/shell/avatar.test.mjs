// mods/kelpie/avatar.sh, run for real in a temp folder with a fake curl: it fetches only avatar
// addresses, over https, keeps only images, and never writes through a link.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeBin, put, repoFile, sh, tempDir } from "../lib/helpers.mjs";

const ATL = "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/5b10a2844c/0e1c2d3f/48";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const JPEG = Buffer.from("ffd8ffe000104a464946000101", "hex");

// A fake curl copying $AVATAR_SRC to its -o file.
function setup(bytes) {
  const root = tempDir(), dir = join(root, "avatars"), src = join(root, "src");
  writeFileSync(src, bytes);
  const fakes = fakeBin().add("curl", 'while [ $# -gt 0 ]; do [ "$1" = -o ] && { cp "$AVATAR_SRC" "$2"; exit 0; }; shift; done; exit 1');
  const run = (name, url) => sh("sh", [repoFile("mods/kelpie/avatar.sh"), dir, name, url], { env: { PATH: fakes.path, AVATAR_SRC: src } });
  return { dir, fakes, run };
}

describe("avatar.sh", () => {
  test("saves a picture under its name and type, and prints the file name", () => {
    const { dir, fakes, run } = setup(PNG);
    const r = run("abc123", ATL);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), "abc123.png");
    assert.deepEqual(readFileSync(join(dir, "abc123.png")), PNG);
    assert.deepEqual(readdirSync(dir), ["abc123.png"], "no temp file left");
    const argv = fakes.calls("curl")[0].argv;
    assert.ok(argv.includes("--proto") && argv.includes("=https") && argv.includes("--proto-redir"));
    assert.deepEqual(argv.slice(-2), ["--", ATL]);
    assert.equal(setup(JPEG).run("abc", ATL).stdout.trim(), "abc.jpg");
  });
  test("takes GitHub's avatar host too (a GitHub Project's assignees)", () => {
    const { run } = setup(PNG);
    const r = run("gh1", "https://avatars.githubusercontent.com/u/583231?u=82a1&v=4&s=48");
    assert.equal(r.code, 0, r.stderr);
    for (const url of ["http://avatars.githubusercontent.com/u/1", "https://avatars.githubusercontent.com.evil.example/u/1", "https://github.com/octocat.png"]) assert.equal(run("abc", url).code, 2, url);
  });
  test("anything that isn't an image is thrown away", () => {
    const { dir, run } = setup("<html>sign in</html>");
    assert.notEqual(run("abc", ATL).code, 0);
    assert.deepEqual(readdirSync(dir), []);
  });
  test("refuses addresses that aren't avatars' and names that aren't its own, before fetching", () => {
    const { fakes, run } = setup(PNG);
    for (const url of ["https://acme.atlassian.net/secure/useravatar?avatarId=1", "http://secure.gravatar.com/avatar/1",
      "https://secure.gravatar.com.evil.example/a", "https://secure.gravatar.com/a b", "-o/etc/x"]) assert.equal(run("abc", url).code, 2, url);
    for (const name of ["", "../x", "-rf", "A B"]) assert.equal(run(name, ATL).code, 2, name);
    assert.equal(fakes.calls("curl").length, 0);
  });
  test("a link in the way is replaced, never written through", () => {
    const { dir, run } = setup(PNG);
    const target = put(join(tempDir(), "mine.png"), "the person's");
    put(join(dir, ".keep"));
    symlinkSync(target, join(dir, "abc.png"));
    assert.equal(run("abc", ATL).code, 0);
    assert.equal(readFileSync(target, "utf8"), "the person's");
    assert.ok(!lstatSync(join(dir, "abc.png")).isSymbolicLink());
    assert.ok(existsSync(join(dir, "abc.png")));
  });
});
