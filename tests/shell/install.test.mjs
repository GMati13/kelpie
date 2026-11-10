// install.sh, mods/kelpie/icons/install.sh and mods/kelpie/skins/copy-art.sh, in temp Herdr homes:
// they install and re-install, never replace a file or folder of the person's, never write through a
// link, and remove only Kelpie's own broken links.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { REPO, put, sh, tempDir } from "../lib/helpers.mjs";

const install = (herdr, repo = REPO) => sh("sh", [join(repo, "install.sh")], { env: { HERDR_APP_HOME: herdr } });
const isLink = (p) => lstatSync(p).isSymbolicLink();
const text = (p) => readFileSync(p, "utf8");
const repoIcons = readdirSync(join(REPO, "mods/kelpie/icons")).filter((f) => f.endsWith(".svg"));
const skinArt = (skin) => readdirSync(join(REPO, "mods/kelpie/skins", skin, "art"), { recursive: true }).filter((f) => /\.(png|svg)$/.test(f));
const fonts = readdirSync(join(REPO, "mods/kelpie/skins/quiet-pages/fonts")).filter((f) => /\.(ttf|otf)$/.test(f));

// Every entry under a folder: its kind, link target or content hash.
function listing(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e), st = lstatSync(p), rel = relative(dir, p);
      if (st.isSymbolicLink()) out[rel] = `-> ${readlinkSync(p)}`;
      else if (st.isDirectory()) { out[rel] = "dir"; walk(p); }
      else out[rel] = createHash("sha1").update(readFileSync(p)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

function assertInstalled(herdr, repo = REPO) {
  for (const f of ["layouts/Kelpie.json", "layouts/Kelpie-Plain.json", "themes/Kelpie.json", "themes/Kelpie-Plain.json", "mods/kelpie", "mods/kelpie-artifacts"]) {
    assert.ok(isLink(join(herdr, f)), `${f} is a link`);
    assert.equal(readlinkSync(join(herdr, f)), join(repo, f), `${f} points into the repo`);
  }
  for (const f of ["Kelpie.svg", "Kelpie-Plain.svg"]) {
    assert.ok(!isLink(join(herdr, "layouts", f)), `${f} is a copy`);
    assert.equal(text(join(herdr, "layouts", f)), text(join(repo, "layouts", f)));
  }
  for (const f of repoIcons) assert.ok(lstatSync(join(herdr, "art/kelpie/icons", f)).isFile(), `icon ${f}`);
  for (const f of skinArt("quiet-pages")) assert.ok(lstatSync(join(herdr, "art/kelpie/skins/quiet-pages", f)).isFile(), `art ${f}`);
  for (const f of fonts) assert.ok(lstatSync(join(herdr, "fonts", f)).isFile(), `font ${f}`);
}

describe("install.sh", () => {
  test("a fresh install links the layouts, themes and mods and copies the rest", () => {
    const herdr = join(tempDir(), "herdr-app");
    const r = install(herdr);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Kelpie is installed in/);
    assertInstalled(herdr);
  });

  test("a second run changes nothing and succeeds", () => {
    const herdr = join(tempDir(), "herdr-app");
    assert.equal(install(herdr).code, 0);
    const first = listing(herdr);
    const r = install(herdr);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(listing(herdr), first);
  });

  for (const [what, path, make] of [
    ["a Kelpie.svg of yours", "layouts/Kelpie.svg", (p) => put(p, "<svg>my own</svg>")],
    ["a layout file of yours", "layouts/Kelpie.json", (p) => put(p, '{"mine": true}')],
    ["a theme file of yours", "themes/Kelpie.json", (p) => put(p, '{"mine": true}')],
    ["a mod folder of yours", "mods/kelpie", (p) => put(join(p, "main.js"), "// mine")],
  ]) {
    test(`${what} in the way is kept, named, and the run fails`, () => {
      const herdr = join(tempDir(), "herdr-app");
      const target = join(herdr, path);
      make(target);
      const before = listing(join(herdr, path.split("/")[0]));
      const r = install(herdr);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /Not installed/);
      assert.ok(r.stderr.includes(target), `names ${target}`);
      assert.doesNotMatch(r.stdout, /Kelpie is installed/);
      assert.ok(!isLink(target));
      const after = listing(join(herdr, path.split("/")[0]));
      for (const [k, v] of Object.entries(before)) assert.equal(after[k], v, `${k} untouched`);
    });
  }

  test("Kelpie's own earlier preview copy (it carries the marker) is replaced", () => {
    const herdr = join(tempDir(), "herdr-app");
    put(join(herdr, "layouts/Kelpie.svg"), "<svg><!-- Kelpie's layout preview --><text>old</text></svg>");
    const r = install(herdr);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(text(join(herdr, "layouts/Kelpie.svg")), text(join(REPO, "layouts/Kelpie.svg")));
  });

  test("a link where a preview goes is replaced by a copy, its target untouched", () => {
    const herdr = join(tempDir(), "herdr-app");
    const elsewhere = put(join(tempDir(), "precious.svg"), "precious");
    mkdirSync(join(herdr, "layouts"), { recursive: true });
    symlinkSync(elsewhere, join(herdr, "layouts/Kelpie.svg"));
    assert.equal(install(herdr).code, 0);
    assert.ok(!isLink(join(herdr, "layouts/Kelpie.svg")));
    assert.equal(text(elsewhere), "precious");
  });

  test("links in the way of icons, skin art and fonts are replaced, never written through", () => {
    const herdr = join(tempDir(), "herdr-app");
    const outside = tempDir();
    const icon = repoIcons[0], art = skinArt("quiet-pages").find((f) => f.endsWith(".svg")), font = fonts[0];
    const spots = [`art/kelpie/icons/${icon}`, `art/kelpie/skins/quiet-pages/${art}`, `fonts/${font}`];
    spots.forEach((s, i) => {
      put(join(outside, `target-${i}`), "precious");
      mkdirSync(join(herdr, s, ".."), { recursive: true });
      symlinkSync(join(outside, `target-${i}`), join(herdr, s));
    });
    const r = install(herdr);
    assert.equal(r.code, 0, r.stderr);
    spots.forEach((s, i) => {
      assert.ok(!isLink(join(herdr, s)), `${s} is a real file now`);
      assert.equal(text(join(outside, `target-${i}`)), "precious", `${s}'s old target untouched`);
    });
    assert.equal(readFileSync(join(herdr, spots[0]), "utf8"), text(join(REPO, "mods/kelpie/icons", icon)));
  });

  test("broken links to old Kelpie layouts and themes go; a broken link of yours stays", () => {
    const herdr = join(tempDir(), "herdr-app");
    const L = (name, target) => { mkdirSync(join(herdr, name, ".."), { recursive: true }); symlinkSync(target, join(herdr, name)); };
    L("layouts/Kelpie-Old.json", "/gone/old-clone/layouts/Kelpie-Old.json");
    L("layouts/kelpie-work.json", "/gone/old-clone/layouts/kelpie-work.json");
    L("themes/Kelpie-Old.json", "/gone/old-clone/themes/Kelpie-Old.json");
    L("layouts/mine.json", "/gone/my-dotfiles/mine.json");
    L("layouts/Kelpie-mine.json", "/gone/my-dotfiles/mine.json");
    L("themes/my-theme.json", "/gone/my-dotfiles/themes/my-theme.json");
    const real = put(join(tempDir(), "other.json"), "{}");
    L("layouts/other.json", real);
    assert.equal(install(herdr).code, 0);
    for (const gone of ["layouts/Kelpie-Old.json", "layouts/kelpie-work.json", "themes/Kelpie-Old.json"]) assert.equal(lstatExists(join(herdr, gone)), false, `${gone} removed`);
    for (const kept of ["layouts/mine.json", "layouts/Kelpie-mine.json", "themes/my-theme.json", "layouts/other.json"]) assert.ok(isLink(join(herdr, kept)), `${kept} kept`);
  });

  test("paths with spaces: the Herdr home and the repo", () => {
    const repo = join(tempDir(), "my kelpie clone");
    for (const f of ["install.sh", "layouts", "themes", "mods"]) cpSync(join(REPO, f), join(repo, f), { recursive: true });
    const herdr = join(tempDir(), "a home", "herdr app");
    const r = install(herdr, repo);
    assert.equal(r.code, 0, r.stderr);
    assertInstalled(herdr, repo);
    assert.equal(install(herdr, repo).code, 0);
  });
});

describe("icons/install.sh and copy-art.sh on their own", () => {
  test("icons/install.sh copies every icon to $HERDR_APP_HOME/art/kelpie/icons", () => {
    const herdr = join(tempDir(), "herdr home");
    const r = sh("sh", [join(REPO, "mods/kelpie/icons/install.sh")], { env: { HERDR_APP_HOME: herdr } });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(readdirSync(join(herdr, "art/kelpie/icons")).sort(), [...repoIcons].sort());
  });
  test("copy-art.sh copies art and fonts, again only what changed", () => {
    const d = tempDir();
    const art = join(d, "art dir"), fontsDir = join(d, "font dir");
    const run = () => sh("sh", [join(REPO, "mods/kelpie/skins/copy-art.sh"), join(REPO, "mods/kelpie/skins"), art, fontsDir]);
    assert.equal(run().code, 0);
    assert.deepEqual(readdirSync(join(art, "quiet-pages"), { recursive: true }).filter((f) => /\.(png|svg)$/.test(f)).sort(), skinArt("quiet-pages").sort());
    assert.deepEqual(readdirSync(fontsDir).sort(), [...fonts].sort());
    const first = listing(d);
    assert.equal(run().code, 0);
    assert.deepEqual(listing(d), first);
  });
});

function lstatExists(p) { try { lstatSync(p); return true; } catch { return false; } }
