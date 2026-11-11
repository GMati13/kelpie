// KELPIE-150: what a story load asks of GitHub stays inside its budget (#131). A full load of a
// realistic GitHub Project profile runs against a fake gh that counts what it's asked: how many
// requests, how many at once, and their cost in GraphQL points, as GitHub prices each query (measured
// with `rateLimit(dryRun: true) { cost }` on 11 Nov 2026; measure again when a query changes). Then
// the hour: the list's timer loads plus the quick read's timer while something is in flight.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { setupOf } from "../../mods/kelpie/config.js";
import { Stories } from "../../mods/kelpie/stories.js";

// The budget, per profile. GitHub gives an account 5,000 GraphQL points an hour, shared by everything
// signed in as it; Kelpie takes at most a fifth, idle or busy, at the size below.
const LOAD_POINTS = 25; // one full load
const LOAD_REQUESTS = 12;
const AT_ONCE = 4; // GitHub's secondary limits count requests running side by side
const HOUR_POINTS = 1000;
const QUICK_EVERY = 20e3; // stories.js: the quick read while something is in flight, 1 point

// GitHub's price of each query, by how many node ids it asks for (dryRun, 11 Nov 2026): the stories
// 1 for 25, 3 for 60, 5 for 100; their sub-issues 1 for 15, 2 for 40, 4 for 100; a Project page 5;
// the kept stories' 25 slots 1; each search 1.
const COST = {
  KelpieProjectUser: () => 5,
  KelpieProjectOrg: () => 5,
  KelpieStories: (n) => Math.max(1, Math.round(n / 20)),
  KelpieSubIssues: (n) => Math.max(1, Math.round(n / 25)),
  KelpieKept: () => 1,
  search: () => 1,
};

// A profile's Project at a realistic size: 60 stories of yours, 40 sub-issues of yours under them,
// 20 closed long ago (120 items, two pages), 25 more stories kept in the list (paused agents) of which
// 15 have a sub-issue, and a dozen pull requests of yours open, 8 merged, 3 waiting for your review.
const REPO = "acme/app";
const ME = { login: "me", name: "Me", avatarUrl: null };
const node = (n, { parent = null, state = "OPEN", closedAt = null } = {}) => ({
  id: `I_${n}`, number: n, title: `Issue ${n}`, url: `https://github.com/${REPO}/issues/${n}`, state, closedAt,
  repository: { nameWithOwner: REPO }, assignees: { nodes: [ME] }, labels: { nodes: [] },
  parent: parent ? { id: `I_${parent}`, number: parent, repository: { nameWithOwner: REPO } } : null,
  closedByPullRequestsReferences: { nodes: [] }, projectItems: { nodes: [{ id: `PVTI_${n}`, project: { id: "PVT_1" }, fieldValueByName: { optionId: "o1", name: "Todo" } }] },
});
const range = (from, count) => Array.from({ length: count }, (_, i) => from + i);
const STORIES = range(1, 60);
const SUBS = range(101, 40); // 101 under 1, 102 under 2, …
const OLD = range(201, 20);
const KEPT = range(300, 25);
const KEPT_SUBS = range(400, 15); // 400 under 300, …
const parentOf = (n) => (n >= 400 ? n - 100 : n >= 101 && n < 200 ? n - 100 : null);
const subsOf = (n) => [...SUBS, ...KEPT_SUBS].filter((c) => parentOf(c) === n);
const LONG_AGO = new Date(Date.now() - 60 * 864e5).toISOString();
const ITEMS = [...STORIES.map((n) => node(n)), ...SUBS.map((n) => node(n, { parent: parentOf(n) })), ...OLD.map((n) => node(n, { state: "CLOSED", closedAt: LONG_AGO }))]
  .map((content) => ({ id: `PVTI_${content.number}`, type: "ISSUE", isArchived: false, fieldValues: { nodes: [] }, content }));
const pull = (n) => ({ id: `PR_${n}`, number: n, title: `APP-${n} work`, url: `https://github.com/${REPO}/pull/${n}`, isDraft: false, updatedAt: new Date().toISOString(),
  reviewDecision: null, headRefOid: null, author: { login: "me" }, repository: { name: "app" }, viewerLatestReview: null, latestOpinionatedReviews: { nodes: [] }, commits: { nodes: [] } });

// gh's -f/-F fields, as gh reads them.
function vars(args) {
  const out = {};
  for (let n = 0; n < args.length; n++) {
    if (args[n] !== "-f" && args[n] !== "-F") continue;
    const [, name, value] = /^([^=]+)=([\s\S]*)$/.exec(args[++n]);
    if (name.endsWith("[]")) (out[name.slice(0, -2)] ??= []).push(value); else out[name] = value;
  }
  return out;
}
const data = (d) => ({ code: 0, stdout: JSON.stringify({ data: { rateLimit: { remaining: 4900, limit: 5000, resetAt: new Date(Date.now() + 3600e3).toISOString() }, ...d } }), stderr: "" });
function answer(op, v) {
  if (op === "KelpieProjectUser") {
    const page = v.cursor ? ITEMS.slice(100) : ITEMS.slice(0, 100);
    return data({ user: { projectV2: { id: "PVT_1", title: "Board", url: "https://github.com/users/me/projects/1", field: { id: "F_status", options: [{ id: "o1", name: "Todo" }, { id: "o2", name: "Done" }] },
      fields: { nodes: [] }, items: { pageInfo: { hasNextPage: !v.cursor, endCursor: v.cursor ? null : "c1" }, nodes: page } } } });
  }
  if (op === "KelpieStories") return data({ nodes: v.ids.map((id) => { const n = Number(id.slice(2)); return { ...node(n), subIssues: { nodes: subsOf(n).map((c) => ({ id: `I_${c}` })) } }; }) });
  if (op === "KelpieSubIssues") return data({ nodes: v.ids.map((id) => { const n = Number(id.slice(2)); return node(n, { parent: parentOf(n) }); }) });
  if (op === "KelpieKept") return data({ viewer: { login: "me" }, ...Object.fromEntries(range(0, 25).filter((n) => v[`u${n}`] === "true").map((n) => [`k${n}`, { issue: { id: `I_${v[`n${n}`]}`, parent: null } }])) });
  if (op === "search") {
    const q = v.q ?? "";
    return data({ search: { nodes: (q.includes("review-requested") ? range(900, 3) : q.includes("is:merged") ? range(800, 8) : range(700, 12)).map(pull) } });
  }
  return { code: 1, stdout: "", stderr: `the fake gh doesn't answer ${op}` };
}

beforeEach(() => mock.reset());

test("a full load of a realistic GitHub Project profile stays inside its budget", async () => {
  const profile = { id: "p", name: "Work", folder: "/work", jira: null,
    project: { url: "https://github.com/users/me/projects/1", owner: "me", ownerType: "user", number: 1 }, github: { owner: "acme" } };
  mock.state.shared.set("kelpie.profiles", { p: profile });
  mock.state.shared.set("kelpie.paused", { p: Object.fromEntries(KEPT.map((n) => [`APP-${n}`, [{ id: `s-${n}`, title: "x" }]])) });
  const calls = [];
  let live = 0, peak = 0;
  mock.on.exec = async (command, args) => {
    if (command !== "sh" || !String(args[0]).endsWith("/gh.sh")) return undefined;
    const gh = args.slice(2);
    if (gh[0] !== "api" || gh[1] !== "graphql") return { code: 1, stdout: "", stderr: "only GraphQL here" };
    const v = vars(gh);
    const op = /^query\s+(\w+)/.exec(v.query)?.[1] ?? "search";
    calls.push({ op, ids: v.ids?.length ?? 0 });
    peak = Math.max(peak, ++live);
    await new Promise((r) => setImmediate(r)); // side by side, as gh runs take a moment
    live--;
    return answer(op, v);
  };
  const list = new Stories();
  list.fetchSessions = async () => [];
  list.cache = { k: { data: { repos: { APP: REPO }, parents: [], children: [], mine: [], prs: [], reviews: [] } } };
  const loaded = await list.fetch({ space: null, setup: setupOf(null, profile), key: "k" });

  // The load is what the list shows: the size above, so the counts are of a real load.
  assert.equal(loaded.parents.length, 60 + 25);
  assert.equal(loaded.children.length, 40 + 15);
  assert.equal(loaded.prs.length, 12 + 8);
  assert.equal(loaded.reviews.length, 3);

  const points = calls.reduce((n, c) => n + COST[c.op](c.ids), 0);
  const asked = calls.map((c) => c.op).join(", ");
  assert.ok(calls.length <= LOAD_REQUESTS, `${calls.length} requests a load (${asked}), more than ${LOAD_REQUESTS}`);
  assert.ok(peak <= AT_ONCE, `${peak} requests at once, more than ${AT_ONCE}`);
  assert.ok(points <= LOAD_POINTS, `${points} points a load (${asked}), more than ${LOAD_POINTS}`);
  const hour = (3600e3 / list.every) * points + (3600e3 / QUICK_EVERY) * 1;
  assert.ok(hour <= HOUR_POINTS, `${hour} points an hour, more than ${HOUR_POINTS}`);
});
