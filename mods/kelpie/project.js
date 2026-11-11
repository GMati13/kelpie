// A GitHub Project as a profile's board (board.js loadBoard() for boardOf() kind "project"): its
// issues dressed as Jira's, in the shape board.js's header describes, so the story list, build() and
// every view read them as they read Jira's.
//   The scope is the Project's current iteration (its first iteration field), or with no iteration
//   field the board as a whole, like a Kanban board (open work and work closed in the last 14 days).
//   Your work: the Project's issues assigned to the account gh runs as. A story is such an issue's
//   parent (one level, as Jira's), else the issue itself; its sub-issues are its subtasks, on the
//   Project or not. Keys: the repo's prefix (config.js prefixFor()) and the issue's number. Then the
//   stories `keep` names (something of them is still here) that your items left out, by key.
// Everything goes through gh (pulls.js gh(), as the profile's GitHub account). Every query is a
// constant with its own operation name, and every value (owner, number, cursor, ids) goes as a
// variable, never into the query's text. A demo profile's (demo.js demoProject()) answers from its
// fixture by the operation's name.

import { gh } from "./pulls.js";
import { demoProject } from "./demo.js";
import { GITHUB_LOGIN, prefixFor } from "./config.js";
import { projectCategory } from "./board.js";

const PAGES = 10; // up to 1000 of your items
const NODES = 100; // stories asked for at once (GitHub's most for nodes(ids:))
const KANBAN_DAYS = 14; // without iterations, closed work this recent still shows
// A key as every key finder takes it (stories.js KEY, sessions.py): checked before a key leaves here,
// as keys name spaces and folders and go into `{key}` commands.
const KEY = /^[A-Z][A-Z0-9]+-\d+$/;
// GitHub's node ids, before one goes into a variable.
const NODE_ID = /^[A-Za-z0-9_=-]{1,100}$/;
const DEMO_LOGIN = /^[A-Za-z0-9-]{1,39}$/;

// What Kelpie reads of every issue: enough to dress it as Jira's, find its status in this Project and
// the pull requests that close it.
const ISSUE = `id number title url state closedAt repository { nameWithOwner }
  assignees(first: 10) { nodes { login name avatarUrl(size: 48) } }
  labels(first: 10) { nodes { name color } }
  parent { id number repository { nameWithOwner } }
  closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { nodes { url } }
  projectItems(first: 20) { nodes { id project { id } fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { optionId name } } } }`;
// The Project: its Status options, its iteration fields and a page of your items in its order. The
// filter is a constant: `@me` is the account gh runs as, Jira's currentUser().
const PROJECT = `id title url
  field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
  fields(first: 50) { nodes { ... on ProjectV2IterationField { id name configuration { iterations { id title startDate duration } } } } }
  items(first: 100, after: $cursor, query: "assignee:@me is:issue", orderBy: { field: POSITION, direction: ASC }) {
    pageInfo { hasNextPage endCursor }
    nodes { id type isArchived
      fieldValues(first: 30) { nodes { ... on ProjectV2ItemFieldIterationValue { iterationId field { ... on ProjectV2IterationField { id } } } } }
      content { ... on Issue { ${ISSUE} } } } }`;
export const QUERIES = Object.freeze({
  user: `query KelpieProjectUser($owner: String!, $number: Int!, $cursor: String) { user(login: $owner) { projectV2(number: $number) { ${PROJECT} } } }`,
  org: `query KelpieProjectOrg($owner: String!, $number: Int!, $cursor: String) { organization(login: $owner) { projectV2(number: $number) { ${PROJECT} } } }`,
  stories: `query KelpieStories($ids: [ID!]!) { nodes(ids: $ids) { ... on Issue { ${ISSUE} subIssues(first: 50) { nodes { ${ISSUE} } } } } }`,
  // A kept story's issue by its key (keptProject()): its node id and its parent's, and who gh runs as.
  kept: `query KelpieKept($owner: String!, $repo: String!, $number: Int!) { viewer { login } repository(owner: $owner, name: $repo) { issue(number: $number) { id parent { id } } } }`,
});

// One GraphQL call, answered as its data, or an error in gh's own words.
async function ask(board, args) {
  const all = ["api", "graphql", ...args];
  if (board.cfg.demo) return (await demoProject(all)).data;
  const r = await gh(board.account, all);
  let out = null;
  try { out = JSON.parse(r.stdout || "null"); } catch { out = null; }
  const said = out?.errors?.[0]?.message ?? (r.stderr || "").trim().split("\n")[0].replace(/^gh: /, "");
  if (r.code !== 0 || !out?.data) {
    const e = new Error(said || "GitHub didn't answer the Project's question.");
    // Only things GitHub says aren't there (an issue deleted or moved): keptProject() skips those.
    e.notFound = Boolean(out?.errors?.length) && out.errors.every((x) => x?.type === "NOT_FOUND");
    throw e;
  }
  return out.data;
}

// The Project's address parts, checked before any of them is used.
function target(cfg) {
  const owner = String(cfg?.owner ?? "");
  if (!owner || owner.length > 39 || !(cfg?.demo ? DEMO_LOGIN : GITHUB_LOGIN).test(owner)) throw new Error("The profile's GitHub Project has no valid owner: set its address again in the profile.");
  const number = Number(cfg?.number);
  if (!Number.isInteger(number) || number < 1) throw new Error("The profile's GitHub Project has no valid number: set its address again in the profile.");
  return { owner, number, query: cfg.ownerType === "org" ? QUERIES.org : QUERIES.user };
}

// Days since 1970 of a "YYYY-MM-DD", and of today where the person is.
const dayOf = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN; };
const today = () => { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5; };

// The stories of `keep.keys` (stories.js hereKeys(): something of them is still here) that the load
// doesn't have (`have`): each key's issue found in its repo (`repos`, by key prefix: a key of no known
// repo is skipped), a sub-issue's story taken instead. { ids: the stories' node ids, viewer: the login
// gh runs as }. A key GitHub says isn't there (an issue deleted or moved) is skipped; any other
// failure fails the load, as one that left kept stories out would have their paused agents pruned.
const REPO_PART = /^[A-Za-z0-9._-]{1,100}$/;
async function keptProject(board, keep, have, repos) {
  const ids = [];
  let viewer = null;
  for (const key of new Set(keep.keys ?? [])) {
    if (!KEY.test(key) || have.has(key)) continue;
    const at = key.lastIndexOf("-");
    const [owner, repo, extra] = String(repos[key.slice(0, at)] ?? "").split("/");
    if (extra !== undefined || !REPO_PART.test(owner ?? "") || !REPO_PART.test(repo ?? "")) continue;
    const data = await ask(board, ["-f", `owner=${owner}`, "-f", `repo=${repo}`, "-F", `number=${key.slice(at + 1)}`, "-f", `query=${QUERIES.kept}`]).catch((e) => { if (e?.notFound) return null; throw e; });
    viewer ??= data?.viewer?.login ?? null;
    const issue = data?.repository?.issue;
    const id = issue?.parent?.id ?? issue?.id;
    if (typeof id === "string" && NODE_ID.test(id) && !ids.includes(id)) ids.push(id);
  }
  return { ids, viewer };
}

// The board's raw load, as board.js's header describes it.
export async function loadProject(board, keep = {}) {
  const { owner, number, query } = target(board.cfg);
  let project = null;
  const items = [];
  let cursor = null;
  for (let page = 0; page < PAGES; page++) {
    const data = await ask(board, ["-f", `owner=${owner}`, "-F", `number=${number}`, ...(cursor ? ["-f", `cursor=${cursor}`] : []), "-f", `query=${query}`]);
    const p = (board.cfg.ownerType === "org" ? data.organization : data.user)?.projectV2;
    if (!p) throw new Error(`GitHub has no Project ${number} of ${owner} that your account can read.`);
    project ??= p;
    items.push(...(p.items?.nodes ?? []));
    const next = p.items?.pageInfo;
    if (!next?.hasNextPage || !next.endCursor) break;
    cursor = next.endCursor;
  }
  const options = project.field?.options ?? [];
  const columns = options.map((o) => ({ name: o.name, statuses: [o.id] }));
  const iterationField = (project.fields?.nodes ?? []).find((f) => f?.id && f.configuration);

  // The scope: the current iteration, the whole board, or nothing while no iteration runs.
  let sprints, inScope;
  if (iterationField) {
    const now = today();
    const it = (iterationField.configuration.iterations ?? []).find((x) => dayOf(x.startDate) <= now && now < dayOf(x.startDate) + Number(x.duration ?? 0));
    sprints = it ? [{ id: it.id, name: it.title }] : [];
    inScope = (item) => Boolean(it) && (item.fieldValues?.nodes ?? []).some((v) => v?.iterationId === it.id && v.field?.id === iterationField.id);
  } else {
    sprints = [{ id: null, name: project.title, kanban: true }];
    const since = Date.now() - KANBAN_DAYS * 864e5;
    inScope = (item) => item.content.state !== "CLOSED" || (Boolean(item.content.closedAt) && Date.parse(item.content.closedAt) >= since);
  }
  const mineItems = items.filter((x) => x?.type === "ISSUE" && !x.isArchived && x.content?.id && inScope(x));

  // Each key's prefix comes from its repo; two repos can't share one, as their keys would collide.
  const repos = {};
  const keyOf = (repo, n) => {
    const prefix = repo ? prefixFor(board.cfg, repo) : null;
    if (!prefix) return null;
    const had = repos[prefix];
    if (had && had.toLowerCase() !== repo.toLowerCase()) throw new Error(`${had} and ${repo} both make keys starting ${prefix}: give one of them its own prefix in the profile.`);
    repos[prefix] = had ?? repo;
    const key = `${prefix}-${n}`;
    return KEY.test(key) ? key : null;
  };
  const issueKey = (i) => (i ? keyOf(i.repository?.nameWithOwner, i.number) : null);

  // The stories: your issues' parents, else the issues themselves, in the Project's order.
  const ids = [];
  for (const x of mineItems) {
    const id = x.content.parent?.id ?? x.content.id;
    if (NODE_ID.test(id) && !ids.includes(id)) ids.push(id);
  }
  const storiesOf = async (list) => {
    const out = [];
    for (let at = 0; at < list.length; at += NODES) {
      const chunk = list.slice(at, at + NODES);
      const data = await ask(board, [...chunk.flatMap((id) => ["-f", `ids[]=${id}`]), "-f", `query=${QUERIES.stories}`]);
      out.push(...(data.nodes ?? []).filter((n) => n?.id));
    }
    return out;
  };
  const stories = await storiesOf(ids);

  const links = {};
  const dress = (i) => {
    const key = issueKey(i);
    if (!key) return null;
    const parent = i.parent ? issueKey(i.parent) : null;
    if (i.parent && !parent) return null; // a sub-issue whose story can't have a key has no story to be under
    for (const pr of i.closedByPullRequestsReferences?.nodes ?? []) if (pr?.url) links[pr.url] = key;
    const closed = i.state === "CLOSED";
    const own = (i.projectItems?.nodes ?? []).find((n) => n?.project?.id === project.id) ?? null;
    const option = own?.fieldValueByName?.optionId ?? null;
    const index = option ? options.findIndex((o) => o.id === option) : -1;
    const who = i.assignees?.nodes?.[0];
    return {
      key, url: i.url, item: own?.id ?? null,
      fields: {
        summary: i.title ?? "",
        issuetype: { name: i.parent ? "Sub-issue" : "Issue", subtask: Boolean(i.parent) },
        status: index >= 0
          ? { id: option, name: options[index].name, statusCategory: { key: projectCategory(index, options.length, closed, options[index].name) } }
          : { id: null, name: own ? "No status" : closed ? "Closed" : "Open", statusCategory: { key: projectCategory(-1, options.length, closed) } },
        parent: parent ? { key: parent } : null,
        // As GitHub gives them; cleaned and checked where they're kept (labelsOf() in stories.js).
        labels: (i.labels?.nodes ?? []).filter(Boolean).map((l) => ({ name: l.name, color: l.color })),
        ...(who ? { assignee: { displayName: who.name || who.login, avatarUrls: { "48x48": who.avatarUrl ?? null } } } : {}),
      },
    };
  };

  const mine = mineItems.map((x) => dress(x.content)).filter(Boolean);
  const parents = [];
  const children = [];
  const seen = new Set();
  // Each story and its sub-issues, dressed; `own(raw, dressed)` hears of each one added.
  const add = (list, own = () => {}) => {
    for (const s of list) {
      const story = dress({ ...s, parent: null });
      if (!story || seen.has(story.key)) continue;
      seen.add(story.key);
      parents.push(story);
      own(s, story);
      for (const c of s.subIssues?.nodes ?? []) {
        const child = dress({ ...c, parent: { number: s.number, repository: s.repository } });
        if (child && !seen.has(child.key)) { seen.add(child.key); children.push(child); own(c, child); }
      }
    }
  };
  add(stories);
  // Then the stories `keep` names that your items left out (reassigned since, or out of the
  // iteration), after the board's own; the issues of them assigned to the account gh runs as are yours.
  const kept = await keptProject(board, keep, seen, { ...(keep.repos ?? {}), ...repos });
  const fresh = kept.ids.filter((id) => !ids.includes(id));
  const before = parents.length;
  if (fresh.length) add(await storiesOf(fresh), (raw, dressed) => {
    if (kept.viewer && (raw.assignees?.nodes ?? []).some((n) => n?.login === kept.viewer)) mine.push(dressed);
  });
  return {
    site: "https://github.com", columns, sprints, mine, parents, children, links, repos, kept: parents.slice(before).map((i) => i.key),
    project: { id: project.id, statusField: project.field?.id ?? null, title: project.title ?? "", url: project.url ?? "" },
  };
}
