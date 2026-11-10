// scripts/e2e-demo.sh's guards, with every program it would start faked (uname, herdr-app, the Herdr
// binary): it refuses Herdr's own home, anything inside it or linked to it, a folder it didn't make,
// and anything but macOS, before it makes, installs or starts anything. The check itself (a real
// Herdr window) is never run here: tests/README.md, "The end-to-end demo check".
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fakeBin, put, repoFile, sh, tempDir } from "../lib/helpers.mjs";

function world(system = "Darwin") {
  const home = tempDir("kelpie-e2e-home-");
  const own = join(home, ".config/herdr-app");
  put(join(own, "settings.json"), "{}");
  const fakes = fakeBin().add("uname", `echo ${system}`).add("herdr-app", "exit 0").add("herdr", "exit 0");
  const run = (target) => sh("sh", [repoFile("scripts/e2e-demo.sh"), target], { env: { HOME: home, PATH: fakes.path, HERDR_BIN: join(fakes.bin, "herdr") } });
  // Nothing but uname ran: no herdr-app, no Herdr, and Herdr's own home is as it was.
  const untouched = () => {
    assert.deepEqual(fakes.calls().map((c) => c.name).filter((n) => n !== "uname"), []);
    assert.deepEqual(readdirSync(own), ["settings.json"]);
  };
  return { home, own, run, untouched };
}

test("it refuses Herdr's own home, a folder inside it, and a link to it", () => {
  const w = world();
  for (const target of [w.own, join(w.own, "mods"), join(w.own, "new")]) {
    const r = w.run(target);
    assert.equal(r.code, 1, target);
    assert.match(r.stderr, /Herdr's own home/);
  }
  symlinkSync(w.own, join(w.home, "looks-new"));
  assert.equal(w.run(join(w.home, "looks-new")).code, 1);
  assert.equal(existsSync(join(w.own, "new")), false, "nothing made inside it");
  w.untouched();
});

test("it refuses a folder holding something it didn't make, and the home folder", () => {
  const w = world();
  const busy = join(w.home, "busy");
  put(join(busy, "notes.txt"), "mine");
  const r = w.run(busy);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /isn't empty/);
  assert.equal(w.run(w.home).code, 1);
  assert.deepEqual(readdirSync(busy), ["notes.txt"]);
  w.untouched();
});

test("it refuses anything but macOS", () => {
  const w = world("Linux");
  const target = join(w.home, "e2e");
  mkdirSync(target);
  const r = w.run(target);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /macOS only/);
  assert.deepEqual(readdirSync(target), []);
  w.untouched();
});
