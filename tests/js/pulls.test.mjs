// approvePull (pulls.js): approving a pull request as the person. Only a github.com pull request's
// address is taken, its parts go into gh's API path as one argument (no shell), and the approval is
// pinned to the head commit when the list loaded one.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { approvePull, pullBody, searchPulls } from "../../mods/kelpie/pulls.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const PR = { url: "https://github.com/acme/web/pull/42", number: 42, repository: { name: "web" }, headRefOid: SHA };
beforeEach(() => mock.reset());

test("approvePull: approves through the reviews API, pinned to the head commit", async () => {
  await approvePull(PR);
  assert.deepEqual(mock.of("exec"), [["gh", ["api", "--method", "POST", "repos/acme/web/pulls/42/reviews", "-f", "event=APPROVE", "-f", `commit_id=${SHA}`], {}]]);
});

test("approvePull: without a well-formed head commit, approves the pull request as it is", async () => {
  await approvePull({ ...PR, headRefOid: "main; rm -rf ~" });
  assert.deepEqual(mock.of("exec")[0][1], ["api", "--method", "POST", "repos/acme/web/pulls/42/reviews", "-f", "event=APPROVE"]);
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
  assert.deepEqual(mock.of("exec"), [["gh", ["api", "repos/acme/web/pulls/42", "--jq", '.body // ""'], {}]]);
  await assert.rejects(pullBody({ ...PR, url: "https://evil.example/acme/web/pull/42" }), /isn't a GitHub pull request's/);
  assert.equal(mock.of("exec").length, 1);
});
