// scripts/gh-meter.mjs, run for real with a fake gh: it runs the story list's own load of the profile
// named, asks each GraphQL query its cost, and adds up the requests and points; it saves nothing back.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeBin, put, repoFile, sh, tempDir } from "../lib/helpers.mjs";

const METER = repoFile("scripts/gh-meter.mjs");
const ISSUE = { id: "I_one", number: 7, title: "A story", url: "https://github.com/someone/app/issues/7", state: "OPEN", closedAt: null,
  repository: { nameWithOwner: "someone/app" }, assignees: { nodes: [{ login: "someone", name: "", avatarUrl: null }] }, labels: { nodes: [] },
  parent: null, closedByPullRequestsReferences: { nodes: [] }, projectItems: { nodes: [] } };
const PROJECT = { data: { rateLimit: { cost: 5, remaining: 4990, limit: 5000, resetAt: "2030-01-01T00:00:00Z" }, user: { projectV2: {
  id: "PVT_one", title: "Board", url: "https://github.com/users/someone/projects/1", field: { id: "F_status", options: [{ id: "o1", name: "Todo" }] },
  fields: { nodes: [] }, items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "PVTI_one", type: "ISSUE", isArchived: false, fieldValues: { nodes: [] }, content: ISSUE }] } } } } };
const STORIES = { data: { rateLimit: { cost: 3, remaining: 4987, limit: 5000, resetAt: "2030-01-01T00:00:00Z" }, nodes: [{ ...ISSUE, subIssues: { nodes: [] } }] } };
const SEARCH = { data: { rateLimit: { cost: 1, remaining: 4999, limit: 5000, resetAt: "2030-01-01T00:00:00Z" }, search: { nodes: [] } } };

// A fake gh answering Kelpie's queries by their operation name, the searches with nothing.
function setup() {
  const dir = tempDir();
  const answers = { project: put(join(dir, "project.json"), JSON.stringify(PROJECT)), stories: put(join(dir, "stories.json"), JSON.stringify(STORIES)), search: put(join(dir, "search.json"), JSON.stringify(SEARCH)) };
  // Each run's query in a file of its own: the load runs some side by side, and fakeBin()'s own log
  // numbers runs one after another.
  const asked = join(dir, "asked");
  const fakes = fakeBin().add("gh", `mkdir -p '${asked}'
for a in "$@"; do case "$a" in query=*) printf '%s' "$a" > "$(mktemp '${asked}/q.XXXXXX')" ;; esac; done
case "$*" in
  *KelpieProjectUser*) cat '${answers.project}' ;;
  *KelpieStories*) cat '${answers.stories}' ;;
  *search*) cat '${answers.search}' ;;
  *) echo '{"data":null}'; exit 1 ;;
esac`);
  const shared = put(join(dir, "shared.json"), JSON.stringify({ "kelpie.profiles": { p1: {
    id: "p1", name: "Test", folder: dir,
    project: { url: "https://github.com/users/someone/projects/1", owner: "someone", ownerType: "user", number: 1 },
    github: { owner: "someone" },
  } } }));
  const run = (...args) => sh(process.execPath, [METER, shared, ...args], { env: { PATH: fakes.path } });
  return { fakes, shared, run, asked };
}

describe("gh-meter.mjs", () => {
  test("runs the profile's load and adds up its requests and points", () => {
    const { run } = setup();
    const r = run("p1", "--json");
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.error, null);
    const asked = out.calls.map((c) => c.what.replace(/merged:>=\S+/, "merged:>=<date>")).sort();
    assert.deepEqual(asked, ["KelpieProjectUser", "KelpieStories", "search user:someone is:pr is:merged author:@me merged:>=<date>", "search user:someone is:pr is:open author:@me", "search user:someone is:pr is:open review-requested:@me"]);
    assert.equal(out.requests, 5);
    assert.equal(out.points, 5 + 3 + 1 + 1 + 1);
    assert.ok(out.together >= 1 && out.together <= 4);
    assert.deepEqual(out.size, { stories: 1, subtasks: 0, yours: 1, kept: 0, pulls: 0, reviews: 0 });
  });

  test("asks each GraphQL query its cost", () => {
    const { asked, run } = setup();
    assert.equal(run("p1").code, 0);
    const queries = readdirSync(asked).map((f) => readFileSync(join(asked, f), "utf8"));
    assert.equal(queries.length, 5);
    for (const q of queries) assert.match(q, /rateLimit \{ cost remaining/);
  });

  test("writes nothing to the shared state it reads", () => {
    const { shared, run } = setup();
    const before = readFileSync(shared, "utf8");
    assert.equal(run("p1").code, 0);
    assert.equal(readFileSync(shared, "utf8"), before);
  });

  test("a profile that isn't there runs nothing", () => {
    const { fakes, run } = setup();
    const r = run("nobody");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /No profile nobody/);
    assert.equal(fakes.calls("gh").length, 0);
  });
});
