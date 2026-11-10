// The demo (demo.js): it answers every request Kelpie makes of Jira, GitHub and the local helpers
// from its fixture, and the fixture itself (demo/demo.json) holds together and can't reach anyone.
import { before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readRepo } from "../lib/helpers.mjs";
import { mock } from "herdr";
import { demoAccounts, demoBlob, demoFixture, demoJira, demoLocal, demoPullFiles, demoPulls, demoSessions } from "../../mods/kelpie/demo.js";
import { jira } from "../../mods/kelpie/sprint.js";
import { searchPulls } from "../../mods/kelpie/pulls.js";
import { adfBlocks, adfText } from "../../mods/kelpie/adf.js";

const FIXTURE = JSON.parse(readRepo("mods/kelpie/demo/demo.json"));
const PR = (repo, n) => `https://github.com/kelpie--demo/${repo}/pull/${n}`;
const MIN = 60e3;
beforeEach(() => mock.reset());

describe("demoJira: what Kelpie asks Jira", () => {
  test("the board's configuration: its columns and their status ids", async () => {
    const r = await demoJira(["get", "/rest/agile/1.0/board/7/configuration"]);
    assert.equal(r.code, 200);
    assert.equal(r.site, "https://jira.example.com");
    assert.deepEqual(r.body.columnConfig.columns.map((c) => [c.name, c.statuses.map((s) => s.id)]),
      [["To Do", ["10000"]], ["In Progress", ["3"]], ["Review", ["10101"]], ["QA", ["10102"]], ["Done", ["10001"]]]);
  });
  test("the active sprints, and the board (scrum)", async () => {
    assert.deepEqual((await demoJira(["get", "/rest/agile/1.0/board/7/sprint?state=active"])).body.values, [{ id: 24, name: "Trips Sprint 24" }]);
    assert.equal((await demoJira(["get", "/rest/agile/1.0/board/7"])).body.type, "scrum");
  });
  test("searches: yours, a story's subtasks, nothing else", async () => {
    const mine = (await demoJira(["search", "sprint in (24) AND assignee = currentUser() ORDER BY Rank", ""])).body;
    assert.equal(mine.isLast, true);
    assert.deepEqual(mine.issues.map((i) => i.key), FIXTURE.issues.filter((i) => i.mine).map((i) => i.key));
    const kids = (await demoJira(["search", "parent in (ACME-142, ACME-129) ORDER BY Rank", ""])).body.issues;
    assert.deepEqual(kids.map((i) => i.key), ["ACME-143", "ACME-144", "ACME-145", "ACME-130", "ACME-131"]);
    const both = (await demoJira(["search", "key in (ACME-142) OR parent in (ACME-142) ORDER BY Rank", ""])).body.issues;
    assert.deepEqual(both.map((i) => i.key), ["ACME-142", "ACME-143", "ACME-144", "ACME-145"]);
    assert.deepEqual(both.map((i) => i.fields.assignee?.displayName), ["Priya Nair", "Alex Morgan", "Alex Morgan", "Tomás Ruiz"]);
    assert.deepEqual((await demoJira(["search", "project = ACME", ""])).body.issues, []);
  });
  test("an issue's fields: a subtask with its story as parent, the status as Jira gives it", async () => {
    const { body } = await demoJira(["get", "/rest/api/3/issue/ACME-143?fields=summary,parent,issuetype"]);
    assert.equal(body.key, "ACME-143");
    assert.deepEqual(body.fields.issuetype, { name: "Sub-task", subtask: true });
    assert.deepEqual(body.fields.status, { id: "3", name: "In Progress", statusCategory: { key: "indeterminate" } });
    assert.equal(body.fields.parent.key, "ACME-142");
    assert.equal(body.fields.parent.fields.summary, "Offline mode for saved trips");
    assert.equal(body.fields.parent.fields.parent, undefined);
  });
  test("an issue's description, as Atlassian Document Format", async () => {
    const { body } = await demoJira(["get", "/rest/api/3/issue/ACME-142?fields=description"]);
    assert.equal(body.fields.description.type, "doc");
    const text = adfText(adfBlocks(body.fields.description));
    assert.match(text, /^Travellers open saved trips/);
    assert.match(text, /\n\n### What we want\n\n/, "## in the fixture is a level 3 heading");
    assert.match(text, /- Cache every trip .* in `IndexedDB`/);
  });
  test("an unknown issue is a 404, through jira() an error", async () => {
    assert.equal((await demoJira(["get", "/rest/api/3/issue/ACME-999"])).code, 404);
    await assert.rejects(jira({ demo: true }, "get", "/rest/api/3/issue/ACME-999"), /does not exist in the demo/);
    assert.equal((await demoJira(["delete", "/x"])).code, 400);
  });
  test("transitions: every other status; one moves the ticket until the mod reloads", async () => {
    const t = (await demoJira(["get", "/rest/api/3/issue/ACME-144/transitions"])).body.transitions;
    assert.deepEqual(t.map((x) => x.name), ["In Progress", "In Review", "In QA", "Done"]);
    assert.deepEqual(t[0], { id: "3", name: "In Progress", isAvailable: true, to: { name: "In Progress", statusCategory: { key: "indeterminate" } } });
    assert.equal((await demoJira(["transition", "ACME-144", "99"])).code, 400);
    assert.equal((await demoJira(["transition", "ACME-144", "3"])).code, 204);
    const moved = await demoJira(["get", "/rest/api/3/issue/ACME-144"]);
    assert.equal(moved.body.fields.status.name, "In Progress");
    assert.ok(!(await demoJira(["get", "/rest/api/3/issue/ACME-144/transitions"])).body.transitions.some((x) => x.name === "In Progress"));
    await demoJira(["transition", "ACME-144", "10000"]);
    assert.equal((await demoJira(["get", "/rest/api/3/issue/ACME-144"])).body.fields.status.name, "To Do");
  });
});

describe("demoPulls and the local helpers", () => {
  test("yours open, yours merged, and the reviews waiting for you", async () => {
    const mine = await searchPulls("user:kelpie--demo is:pr is:open author:@me", { demo: true });
    assert.deepEqual(mine.map((p) => `${p.repository.name}#${p.number}`), ["web#418", "payments#97", "search#233", "charts#58", "web#415", "web#423", "docs#58", "docs#61"]);
    assert.deepEqual((await demoPulls("user:kelpie--demo is:pr is:merged author:@me merged:>=2026-01-01")).map((p) => p.number), [291, 409, 412, 298]);
    const reviews = await demoPulls("user:kelpie--demo is:pr is:open review-requested:@me");
    assert.deepEqual(reviews.map((p) => [p.number, p.author.login]), [[421, "priya-n"], [305, "tomas-r"]]);
  });
  test("a pull request as GitHub's search gives it", async () => {
    const [p] = await demoPulls("is:open");
    assert.equal(p.url, PR("web", 418));
    assert.equal(p.author.login, "you");
    assert.equal(p.commits.nodes[0].commit.statusCheckRollup.state, "SUCCESS");
    assert.equal(p.isDraft, false);
    assert.equal(p.reviewDecision, null);
  });
  test("times are relative to now", async () => {
    const [p] = await demoPulls("is:open");
    assert.ok(Math.abs(Date.now() - 25 * MIN - Date.parse(p.updatedAt)) < MIN, p.updatedAt);
    const sessions = await demoSessions("/f");
    assert.deepEqual(sessions.map((s) => s.id), ["demo-s2", "demo-s4", "demo-s1", "demo-s6", "demo-s3"], "newest first");
    assert.ok(Math.abs(Date.now() - 3 * 60 * MIN - sessions[0].updated) < MIN);
    assert.deepEqual(sessions[0], { ...sessions[0], cwd: "/f", running: false, first: ["ACME-139"], keys: ["ACME-139"], title: "Token bucket per API key" });
  });
  test("a pull request's files, counted, with a sha each; an unknown one has none", async () => {
    const files = await demoPullFiles(PR("web", 418));
    assert.deepEqual(files.map((f) => [f.filename, f.status]), [["src/trips/cache.ts", "added"], ["src/trips/store.ts", "modified"], ["src/trips/types.ts", "modified"], ["package-lock.json", "modified"]]);
    for (const f of files) {
      const lines = f.patch.split("\n");
      assert.equal(f.additions, lines.filter((l) => l.startsWith("+")).length, f.filename);
      assert.equal(f.deletions, lines.filter((l) => l.startsWith("-")).length, f.filename);
      assert.match(f.sha, /^demo418\d$/);
    }
    assert.deepEqual(await demoPullFiles(PR("web", 1)), []);
  });
  test("a file's whole text when the fixture has it", async () => {
    assert.match(await demoBlob(PR("web", 418), "src/trips/cache.ts"), /^import \{ openDB/);
    await assert.rejects(demoBlob(PR("web", 418), "nope.ts"), /only this file's diff/);
  });
  test("uncommitted work in a story's ticket folders", async () => {
    const [r, ...rest] = await demoLocal("/f", ["ACME-143", "ACME-144"]);
    assert.deepEqual(rest, []);
    assert.deepEqual({ ...r, files: r.files.map((f) => [f.path, f.status, f.add, f.del]) },
      { repo: "web", path: "/f/ACME-143/web", branch: "ACME-143-trip-cache", key: "ACME-143", ticket: true, files: [["src/trips/sync-queue.ts", "added", 10, 0]] });
    assert.deepEqual(await demoLocal("/f", ["ACME-151"]), []);
  });
  test("the footer's limits, once the fixture is read", async () => {
    await demoFixture();
    const [a] = demoAccounts();
    assert.equal(a.five_hour.used_percentage, 38);
    assert.equal(a.seven_day.used_percentage, 61);
    assert.ok(Math.abs(a.five_hour.resets_at * 1000 - (Date.now() + 120 * MIN)) < MIN);
  });
});

describe("demo.json holds together", () => {
  const issues = new Map(FIXTURE.issues.map((i) => [i.key, i]));
  const statuses = FIXTURE.board.columns.flatMap((c) => c.statuses);
  test("issue keys are unique, of the profile's project", () => {
    assert.equal(issues.size, FIXTURE.issues.length);
    for (const k of issues.keys()) assert.match(k, new RegExp(`^${FIXTURE.profile.project}-\\d+$`));
  });
  test("every subtask's parent exists and is a story", () => {
    for (const i of FIXTURE.issues.filter((x) => x.parent)) {
      assert.ok(issues.has(i.parent), `${i.key}'s parent ${i.parent}`);
      assert.equal(issues.get(i.parent).parent, undefined, `${i.parent} is no subtask`);
    }
  });
  test("every status is one of the board's columns', with a Jira category", () => {
    for (const s of statuses) assert.ok(["new", "indeterminate", "done"].includes(s.category), s.name);
    assert.equal(new Set(statuses.map((s) => s.id)).size, statuses.length, "status ids unique");
    for (const i of FIXTURE.issues) assert.ok(statuses.some((s) => s.name === i.status), `${i.key}: ${i.status}`);
  });
  test("every pull request names a repo, a number, a title, and states GitHub has", () => {
    const seen = new Set();
    for (const p of FIXTURE.pulls) {
      const name = `${p.repo}#${p.number}`;
      assert.match(p.repo, /^[\w.-]+$/, name);
      assert.ok(Number.isInteger(p.number) && p.number > 0, name);
      assert.ok(!seen.has(name), `${name} once`); seen.add(name);
      assert.equal(typeof p.title, "string", name);
      assert.match(p.updated, /^[+-]\d+(\.\d+)?[mhd]$/, name);
      if (p.checks) assert.ok(["SUCCESS", "FAILURE", "ERROR", "PENDING", "EXPECTED"].includes(p.checks), name);
      if (p.review) assert.ok(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"].includes(p.review), name);
      for (const f of p.files ?? []) {
        assert.equal(typeof f.path, "string", name);
        assert.equal(typeof f.patch, "string", `${name} ${f.path}`);
        if (f.status) assert.ok(["added", "removed", "modified", "renamed", "copied", "changed"].includes(f.status), `${name} ${f.path}`);
      }
    }
  });
  test("every space's tabs have what demo/agent.sh needs", () => {
    for (const s of FIXTURE.spaces) {
      assert.ok(s.name && s.tabs.length, s.name);
      for (const t of s.tabs) {
        assert.equal(typeof t.name, "string", s.name);
        if (t.agent !== undefined) assert.ok(["idle", "working", "blocked", "done"].includes(t.agent), `${s.name}/${t.name}: ${t.agent}`);
        if (t.title !== undefined) assert.equal(typeof t.title, "string");
        if (t.screen !== undefined) assert.ok(Array.isArray(t.screen) && t.screen.every((l) => typeof l === "string"), `${s.name}/${t.name}`);
      }
    }
    const agent = readRepo("mods/kelpie/demo/agent.sh");
    for (const state of ["idle", "working", "blocked", "done", "shell"]) assert.match(agent, new RegExp(`\\b${state}\\b`));
  });
  test("sessions and paused agents resume as the stand-in (ids starting demo-)", () => {
    for (const s of FIXTURE.sessions) assert.match(s.id, /^demo-/);
    for (const [key, list] of Object.entries(FIXTURE.paused)) {
      assert.ok(issues.has(key), key);
      for (const x of list) if (x.id) assert.match(x.id, /^demo-/);
    }
  });
  test("every suggestion is a key, a pull request link or an idea, with an action", () => {
    for (const s of FIXTURE.suggest) {
      assert.ok(s.action, JSON.stringify(s));
      assert.ok(issues.has(s.key) || s.url || s.idea, JSON.stringify(s));
    }
  });
  test("its links can't reach anyone: only jira.example.com and the kelpie--demo GitHub owner", () => {
    assert.equal(new URL(FIXTURE.profile.site).host, "jira.example.com");
    assert.equal(FIXTURE.profile.owner, "kelpie--demo");
    // Outside file contents (code in a diff may name anything), every address.
    const found = [];
    const walk = (v, path) => {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}/${i}`));
      else if (v && typeof v === "object") { for (const [k, x] of Object.entries(v)) if (!(path.includes("/files/") && ["patch", "text"].includes(k))) walk(x, `${path}/${k}`); }
      else if (typeof v === "string") for (const [url] of v.matchAll(/https?:\/\/[^\s"'`)\\]+/g)) found.push([path, url]);
    };
    walk(FIXTURE, "");
    assert.ok(found.length >= 2);
    for (const [path, url] of found) {
      const u = new URL(url);
      const ok = u.host === "jira.example.com" || (u.host === "github.com" && u.pathname.startsWith("/kelpie--demo/")) || u.hostname === "localhost";
      assert.ok(ok, `${path}: ${url}`);
    }
  });
});

describe("the demo through Kelpie's own loaders", () => {
  before(() => mock.reset());
  test("jira() and searchPulls() answer a demo profile from the fixture, running nothing", async () => {
    await jira({ demo: true }, "get", "/rest/agile/1.0/board/7/configuration");
    await searchPulls("is:open author:@me", { demo: true });
    assert.deepEqual(mock.of("exec"), []);
  });
});
