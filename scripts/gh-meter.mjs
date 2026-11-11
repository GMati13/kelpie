#!/usr/bin/env node
// Measures what one story load of a profile asks of GitHub (#131): runs the story list's own load
// (stories.js Stories.fetch(), then the quick read of its pull requests, readPulls()) under the test
// stubs, with the real gh, and prints each call: what it asked, when it started, how many ran at once,
// how long it took and, for GraphQL, its cost in points (`cost` added to the query's `rateLimit`). It
// spends real points (a load's worth, ~20 for a few dozen stories) and writes nothing: the profile and
// its last load are read from Herdr's shared state file, and nothing is written back to it.
//   node scripts/gh-meter.mjs <shared.json> <profile id> [--json]
// shared.json is Herdr's (`~/.config/herdr-app/shared.json` by default). gh must be signed in to the
// profile's GitHub account. Not for CI: it reaches GitHub.
import { register } from "node:module";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

register("../tests/stubs/loader.mjs", import.meta.url);
const repo = new URL("../", import.meta.url);
const [sharedPath, id, ...flags] = process.argv.slice(2);
if (!sharedPath || !id) {
  console.error("Usage: node scripts/gh-meter.mjs <shared.json> <profile id> [--json]");
  process.exit(2);
}

const { mock } = await import("herdr");
const all = JSON.parse(readFileSync(sharedPath, "utf8"));
const profile = all["kelpie.profiles"]?.[id];
if (!profile) {
  console.error(`No profile ${id} in ${sharedPath}.`);
  process.exit(2);
}
// What the load reads of shared state: the profiles, and what keeps a story in the list.
for (const k of ["kelpie.profiles", "kelpie.paused", "kelpie.space.profile"]) if (all[k]) mock.state.shared.set(k, all[k]);
const prior = all["kelpie.stories.data"]?.[id]?.data ?? null;

const calls = [];
const t0 = Date.now();
let live = 0;
let peak = 0;
// Every exec the load makes runs for real, the mods' paths the repo's; a GraphQL query also asks its cost.
mock.on.exec = (command, args = []) => new Promise((resolve) => {
  const argv = args.map((a) => mock.repoPath(String(a)));
  const q = argv.findIndex((a) => a.startsWith("query="));
  const graphql = argv.includes("graphql") && q >= 0;
  if (graphql) argv[q] = argv[q].replace("rateLimit {", "rateLimit { cost");
  const what = graphql
    ? /^query=\s*(?:query|mutation)\s+(\w+)/.exec(argv[q])?.[1] ?? `search ${argv.find((a) => a.startsWith("q="))?.slice(2) ?? ""}`
    : argv.slice(argv.indexOf("api")).filter((a) => !a.startsWith("-")).slice(0, 2).join(" ") || [command, ...argv].join(" ");
  const call = { what, kind: graphql ? "GraphQL" : "REST", start: Date.now() - t0, together: ++live };
  peak = Math.max(peak, live);
  const p = spawn(command, argv, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  p.stdout.on("data", (d) => (stdout += d));
  p.stderr.on("data", (d) => (stderr += d));
  p.on("close", (code) => {
    live--;
    call.ms = Date.now() - t0 - call.start;
    call.ok = code === 0;
    if (graphql) try { const r = JSON.parse(stdout)?.data?.rateLimit; call.cost = r?.cost ?? null; call.remaining = r?.remaining ?? null; } catch { call.cost = null; }
    calls.push(call);
    resolve({ code: code ?? 1, stdout, stderr });
  });
});

const { Stories } = await import(new URL("mods/kelpie/stories.js", repo));
const { setupOf } = await import(new URL("mods/kelpie/config.js", repo));
const { readPulls } = await import(new URL("mods/kelpie/pulls.js", repo));
const list = new Stories();
list.fetchSessions = async () => []; // Claude's sessions aren't GitHub's
const setup = setupOf(null, profile);
const key = "meter";
list.cache = { [key]: { data: prior } };
let error = null;
let data = null;
try { data = await list.fetch({ space: null, setup, key }); } catch (e) { error = String(e?.message ?? e); }
const loadMs = Date.now() - t0;
const ids = [...(data?.prs ?? []).filter((p) => !p.merged), ...(data?.reviews ?? [])].map((p) => p.id).filter(Boolean);
if (ids.length) await readPulls(ids, { account: setup.github?.account ?? null }).catch(() => {});

const points = calls.reduce((n, c) => n + (c.cost ?? 0), 0);
const size = data ? { stories: data.parents.length, subtasks: data.children.length, yours: data.mine.length, kept: data.kept?.length ?? 0, pulls: data.prs.length, reviews: data.reviews.length } : null;
const out = { profile: id, error, size, calls: calls.sort((a, b) => a.start - b.start), points, requests: calls.length, together: peak, loadMs };
if (flags.includes("--json")) {
  console.log(JSON.stringify(out, null, 2));
} else {
  if (size) console.log(`${size.stories} stories, ${size.subtasks} subtasks (${size.yours} yours), ${size.kept} kept, ${size.pulls} pull requests, ${size.reviews} reviews`);
  if (error) console.log(`The load failed: ${error}`);
  for (const c of out.calls) console.log(`${String(c.start).padStart(6)} ms  ${String(c.ms).padStart(5)} ms  ×${c.together}  ${c.kind.padEnd(7)}  ${c.cost == null ? "   " : String(c.cost).padStart(3)}  ${c.ok ? "" : "FAILED  "}${c.what}`);
  console.log(`${calls.length} requests, ${points} points, at most ${peak} at once; the load took ${loadMs} ms.`);
}
process.exit(error ? 1 : 0);
