// approvePull (pulls.js): approving a pull request as the person. Only a github.com pull request's
// address is taken, its parts go into gh's API path as one argument (no shell), and the approval is
// pinned to the head commit when the list loaded one. Every gh call goes through gh.sh, as the
// profile's GitHub account when it has one.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { approvePull, githubAccounts, pullBody, searchPulls } from "../../mods/kelpie/pulls.js";
import { modFile } from "../../mods/kelpie/ui.js";
import { buildProfile, needsYes, saveProfile } from "../../mods/kelpie/config.js";

// The exec call gh.sh gets for these gh arguments ("" for no account: gh's active one).
const gh = (args, account = "") => ["sh", [modFile("gh.sh"), account, ...args], {}];

const SHA = "0123456789abcdef0123456789abcdef01234567";
const PR = { url: "https://github.com/acme/web/pull/42", number: 42, repository: { name: "web" }, headRefOid: SHA };
beforeEach(() => mock.reset());

test("approvePull: approves through the reviews API, pinned to the head commit", async () => {
  await approvePull(PR);
  assert.deepEqual(mock.of("exec"), [gh(["api", "--method", "POST", "repos/acme/web/pulls/42/reviews", "-f", "event=APPROVE", "-f", `commit_id=${SHA}`])]);
});

test("approvePull: without a well-formed head commit, approves the pull request as it is", async () => {
  await approvePull({ ...PR, headRefOid: "main; rm -rf ~" });
  assert.deepEqual(mock.of("exec")[0], gh(["api", "--method", "POST", "repos/acme/web/pulls/42/reviews", "-f", "event=APPROVE"]));
});

test("approvePull: refuses any address that isn't a github.com pull request's, running nothing", async () => {
  for (const url of ["https://evil.example/acme/web/pull/42", "https://github.com/acme/web/pull/42/../../x", "https://github.com/acme/web/issues/42",
    "https://github.com/-acme/web/pull/42?x", "https://github.com/ac me/web/pull/42", "", undefined]) {
    await assert.rejects(approvePull({ ...PR, url }), /isn't a GitHub pull request's/, String(url));
  }
  assert.deepEqual(mock.of("exec"), []);
});

test("approvePull: GitHub's refusal comes back readable", async () => {
  mock.on.exec = () => ({ code: 1, stdout: "", stderr: "gh: Can not approve your own pull request (HTTP 422)\n" });
  await assert.rejects(approvePull(PR), { message: "Can not approve your own pull request (HTTP 422)" });
});

test("searchPulls: your own latest review comes as viewerReview", async () => {
  const node = (n, own) => ({ number: n, title: "t", url: `https://github.com/acme/web/pull/${n}`, reviewDecision: null, repository: { name: "web" },
    latestOpinionatedReviews: { nodes: [] }, viewerLatestReview: own });
  mock.on.exec = () => ({ code: 0, stderr: "", stdout: JSON.stringify({ data: { search: { nodes: [node(1, { state: "APPROVED" }), node(2, null)] } } }) });
  const prs = await searchPulls("is:pr");
  assert.deepEqual(prs.map((p) => p.viewerReview), ["APPROVED", null]);
  assert.ok(prs.every((p) => !("viewerLatestReview" in p)));
});

test("pullBody: reads the description through the API, for a github.com pull request only", async () => {
  mock.on.exec = () => ({ code: 0, stderr: "", stdout: "## What\nIt does this.\n" });
  assert.equal(await pullBody(PR), "## What\nIt does this.");
  assert.deepEqual(mock.of("exec"), [gh(["api", "repos/acme/web/pulls/42", "--jq", '.body // ""'])]);
  await assert.rejects(pullBody({ ...PR, url: "https://evil.example/acme/web/pull/42" }), /isn't a GitHub pull request's/);
  assert.equal(mock.of("exec").length, 1);
});

test("the profile's GitHub account goes to gh.sh for searches, approvals and descriptions", async () => {
  mock.on.exec = () => ({ code: 0, stderr: "", stdout: JSON.stringify({ data: { search: { nodes: [] } } }) });
  await searchPulls("is:pr", { account: "work-me" });
  await approvePull(PR, { account: "work-me" });
  await pullBody(PR, { account: "work-me" });
  assert.deepEqual(mock.of("exec").map(([cmd, [script, account]]) => [cmd, script, account]), Array(3).fill(["sh", modFile("gh.sh"), "work-me"]));
});

test("githubAccounts: the accounts gh status lists as signed in, once each", async () => {
  mock.on.exec = () => ({ code: 0, stdout: "", stderr: "github.com\n  ✓ Logged in to github.com account work-me (keyring)\n  - Active account: true\n  ✓ Logged in to github.com account side-me (keyring)\n  - Active account: false\n" });
  assert.deepEqual(await githubAccounts(), ["work-me", "side-me"]);
  assert.deepEqual(mock.of("exec")[0].slice(0, 2), ["gh", ["auth", "status", "--hostname", "github.com"]]);
});

test("github.account: only a GitHub name is kept, and an agent setting it waits for the person's yes", () => {
  saveProfile("p", { name: "P", folder: "/w", github: { owner: "acme" } });
  assert.equal(buildProfile("p", { github: { account: "work-me" } }).github.account, "work-me");
  for (const bad of ["-o", "a b", "x;y", "-", "a--b"]) assert.throws(() => buildProfile("p", { github: { account: bad } }), /github\.account/, bad);
  assert.deepEqual(needsYes("p", { github: { account: "work-me" } }), [{ key: "github.account", text: "work-me" }]);
  assert.deepEqual(needsYes("p", { github: { owner: "other" } }), []);
  saveProfile("p", null);
});
