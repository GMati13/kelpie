// A GitHub Project's issues, for the board layer (board.js): which issue a ticket key is, its
// description, its title and parent, and moving it to another Status option. What the Project's load
// gives (board.js's header) finds an issue; gh answers the rest, as the profile's GitHub account
// (pulls.js gh()). A demo board (its `demo` flag) runs nothing: its fixture answers.
//   Others write issues: a body is drawn through markdownBlocks() (only http(s) links, no HTML), and
//   every question to GitHub is a constant query with its values as variables, never in its text.

import { gh } from "./pulls.js";
import { adfText, markdownBlocks } from "./adf.js";
import { prefixFor } from "./config.js";
import { demoCommentsOf, demoFixture, demoMoveTo } from "./demo.js";

// A Project ticket key: a repo's prefix and the issue's number (config.js PREFIX).
const TICKET = /^([A-Z][A-Z0-9]+)-(\d+)$/;
// An issue's page, the only address whose parts go into an API path (as pulls.js PULL_URL).
const ISSUE_URL = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/issues\/(\d+)$/;
const REPO = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/;
// GitHub's node and option ids: what a Status move sends, checked before gh runs.
const ID = /^[A-Za-z0-9_=-]{1,100}$/;

// One issue: its title, and its parent's (a sub-issue's story), with the body for the review prompt.
const ISSUE = `query KelpieIssue($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { issue(number: $number) {
  number title body parent { number title repository { nameWithOwner } } } } }`;
// How many of a ticket's comments are shown (the newest), on either board.
export const COMMENTS_MAX = 50;
// A comment's author as shown: no control characters, one line, 80 characters at most.
export const commentAuthor = (v) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) : "") || "Someone";
// An issue's newest comments (COMMENTS_MAX), oldest of them first, with what's left
// of the budget (ghlimit.js reads it off every GraphQL answer).
const COMMENTS = `query KelpieComments($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { issue(number: $number) {
  comments(last: 50) { totalCount nodes { id createdAt body author { login avatarUrl(size: 48) ... on User { name } } } } } } rateLimit { remaining limit resetAt } }`;
// A Project item's Status set to one of its options.
const MOVE = `mutation KelpieMove($project: ID!, $item: ID!, $field: ID!, $option: String!) { updateProjectV2ItemFieldValue(input: {projectId: $project, itemId: $item, fieldId: $field, value: {singleSelectOptionId: $option}}) { projectV2Item { id } } }`;

const firstLine = (r, fallback) => (r.stderr || r.stdout || "").trim().split("\n")[0].replace(/^gh: /, "") || fallback;

// The issue the list loaded under a key, or null.
export const loadedIssue = (data, key) => [...(data?.parents ?? []), ...(data?.children ?? [])].find((i) => i.key === key) ?? null;

// Which issue a key is: { owner, repo, number, url, item }, from the issue the list loaded (its page
// and Project item), else from the repo its prefix names (data.repos) and the key's number, with no
// item known. Null for anything that isn't a key, or a prefix no repo has.
export function issueRef(board, data, key) {
  const k = TICKET.exec(typeof key === "string" ? key : "");
  if (!k) return null;
  const loaded = loadedIssue(data, key);
  if (loaded?.url) {
    const m = ISSUE_URL.exec(loaded.url);
    return { owner: m?.[1] ?? null, repo: m?.[2] ?? null, number: m ? Number(m[3]) : null, url: loaded.url, item: loaded.item ?? null };
  }
  const r = REPO.exec(data?.repos?.[k[1]] ?? "");
  if (!r) return null;
  return { owner: r[1], repo: r[2], number: Number(k[2]), url: `https://github.com/${r[1]}/${r[2]}/issues/${k[2]}`, item: loaded?.item ?? null };
}

// The key a repo's issue has under the Project: the prefix the load gave the repo, else the profile's.
function keyFor(board, data, repo, number) {
  const prefix = Object.entries(data?.repos ?? {}).find(([, r]) => String(r).toLowerCase() === String(repo).toLowerCase())?.[0] ?? prefixFor(board.cfg, repo);
  return prefix ? `${prefix}-${number}` : null;
}

const demoIssue = async (key) => (await demoFixture()).issues.find((i) => i.key === key) ?? null;

// An issue's body (its Markdown), "" when it has none. Only an issue page's address is taken, its
// parts going into the API path, no shell.
export async function issueBody(board, ref) {
  const m = ISSUE_URL.exec(ref?.url ?? "");
  if (!m) throw new Error("its address isn't a GitHub issue's.");
  const r = await gh(board.account, ["api", `repos/${m[1]}/${m[2]}/issues/${m[3]}`, "--jq", ".body // \"\""]);
  if (r.code !== 0) throw new Error(firstLine(r, "GitHub didn't send the description."));
  return r.stdout.replace(/\n$/, "");
}

// A ticket's description, as the reader's blocks.
export async function issueDescription(board, data, key) {
  if (board.cfg?.demo) return markdownBlocks((await demoIssue(key))?.description ?? "");
  const ref = issueRef(board, data, key);
  if (!ref) throw new Error(`Kelpie doesn't know which repo ${key} is in.`);
  return markdownBlocks(await issueBody(board, ref));
}

// A ticket's comments (board.js comments()): { total, list: [{ id, author, avatar, at, blocks }] }, the
// bodies GitHub's Markdown, drawn through markdownBlocks(). One constant query, the issue's owner, repo
// and number its variables. The demo's come from its fixture.
export async function issueComments(board, data, key) {
  const shape = (c) => ({ id: String(c.id ?? ""), author: commentAuthor(c.author), avatar: c.avatar ?? null, at: c.at, blocks: markdownBlocks(c.body ?? "") });
  if (board.cfg?.demo) {
    const list = demoCommentsOf(await demoIssue(key));
    return { total: list.length, list: list.map(shape) };
  }
  const ref = issueRef(board, data, key);
  if (!ref?.owner || !ref.repo || !ref.number) throw new Error(`Kelpie doesn't know which repo ${key} is in.`);
  const r = await gh(board.account, ["api", "graphql", "-f", `owner=${ref.owner}`, "-f", `repo=${ref.repo}`, "-F", `number=${ref.number}`, "-f", `query=${COMMENTS}`]);
  if (r.code !== 0) throw new Error(firstLine(r, `GitHub didn't send ${key}'s comments.`));
  const c = JSON.parse(r.stdout)?.data?.repository?.issue?.comments;
  const list = (c?.nodes ?? []).slice(-COMMENTS_MAX).map((n) => shape({ id: n.id, author: n.author?.name || n.author?.login, avatar: n.author?.avatarUrl, at: Date.parse(n.createdAt) || null, body: n.body }));
  return { total: Math.max(Number(c?.totalCount) || 0, list.length), list };
}

// The issue as GitHub answers it ({ number, title, body, parent }), or null when there's none.
async function askIssue(board, data, key) {
  const ref = issueRef(board, data, key);
  if (!ref?.owner || !ref.repo || !ref.number) throw new Error(`Kelpie doesn't know which repo ${key} is in.`);
  const r = await gh(board.account, ["api", "graphql", "-f", `owner=${ref.owner}`, "-f", `repo=${ref.repo}`, "-F", `number=${ref.number}`, "-f", `query=${ISSUE}`]);
  if (r.code !== 0) throw new Error(firstLine(r, `GitHub didn't answer for ${key}.`));
  return JSON.parse(r.stdout)?.data?.repository?.issue ?? null;
}
const parentOf = (board, data, issue) => (issue?.parent ? { key: keyFor(board, data, issue.parent.repository?.nameWithOwner ?? "", issue.parent.number), summary: issue.parent.title ?? "" } : null);

// A ticket's title, its parent's key and its description as text (the review prompt's).
export async function issueText(board, data, key) {
  if (board.cfg?.demo) {
    const i = await demoIssue(key);
    if (!i) throw new Error(`The demo has no ${key}.`);
    return { summary: i.summary ?? "", parent: i.parent ?? null, text: adfText(markdownBlocks(i.description ?? "")) };
  }
  const i = await askIssue(board, data, key);
  if (!i) throw new Error(`GitHub has no ${key}.`);
  return { summary: i.title ?? "", parent: parentOf(board, data, i)?.key ?? null, text: adfText(markdownBlocks(i.body ?? "")) };
}

// A ticket the list doesn't have: { key, summary, story }, `story` the parent of a sub-issue (as
// Jira's subtask goes to its story), or null when GitHub doesn't know it.
export async function issueLookUp(board, data, key) {
  if (board.cfg?.demo) {
    const i = await demoIssue(key);
    const p = i?.parent ? await demoIssue(i.parent) : null;
    return i ? { key, summary: i.summary ?? "", story: p ? { key: p.key, summary: p.summary ?? "" } : null } : null;
  }
  const i = await askIssue(board, data, key).catch(() => null);
  if (!i) return null;
  const story = parentOf(board, data, i);
  return { key, summary: i.title ?? "", story: story?.key ? story : null };
}

// Moves an issue to one of the Project's Status options (board.js statusOptions()), on the person's
// own click in its status chip, never on an agent's word. Every id is checked before gh runs, and the
// option must be one of the loaded columns'.
export async function setStatus(board, data, key, option) {
  const ref = issueRef(board, data, key);
  if (!ref?.item) throw new Error("it isn't on the board's Project, so its status can't be changed here.");
  if (!(data?.columns ?? []).some((c) => c.statuses?.[0] === option?.id)) throw new Error("that isn't one of the Project's statuses.");
  const ids = { project: data?.project?.id, item: ref.item, field: data?.project?.statusField, option: option?.id };
  if (!Object.values(ids).every((v) => typeof v === "string" && ID.test(v))) throw new Error("the Project's answer didn't say clearly what to change, so nothing was moved.");
  if (board.cfg?.demo) return demoMoveTo(key, option.to ?? option.name);
  const r = await gh(board.account, ["api", "graphql", ...Object.entries(ids).flatMap(([k, v]) => ["-f", `${k}=${v}`]), "-f", `query=${MOVE}`]);
  if (r.code !== 0) throw new Error(firstLine(r, "GitHub didn't take the move."));
}
