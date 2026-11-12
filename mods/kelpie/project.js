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
import { demoLimit, demoProject } from "./demo.js";
import { limitMessage } from "./ghlimit.js";
import { GITHUB_LOGIN, prefixFor, priorityOf } from "./config.js";
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
const ISSUE = `id number title url state closedAt updatedAt repository { nameWithOwner }
  assignees(first: 10) { nodes { login name avatarUrl(size: 48) } }
  labels(first: 10) { nodes { name color } }
  parent { id number repository { nameWithOwner } }
  closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { nodes { url } }
  projectItems(first: 20) { nodes { id project { id } fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { optionId name updatedAt } }
    priority: fieldValueByName(name: $priority) @include(if: $withPriority) { ... on ProjectV2ItemFieldSingleSelectValue { optionId name } } } }`;
// The Project: its Status options, its iteration fields and a page of its items in its order. The
// filter is one of two constants (`FILTERS`): your items (`@me` is the account gh runs as, Jira's
// currentUser()), or on a board worked alone (`solo`) every issue, whoever it's assigned to.
// The priority field (the profile's project.priorityField, a single-select field) is asked only when
// one is named: `$priority` its name, `$withPriority` whether to ask (config.js priorityOf()).
const FILTERS = Object.freeze({ mine: "assignee:@me is:issue", all: "is:issue" });
const projectFields = (filter) => `id title url
  field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
  priorityField: field(name: $priority) @include(if: $withPriority) { ... on ProjectV2SingleSelectField { id options { id name } } }
  fields(first: 50) { nodes { ... on ProjectV2IterationField { id name configuration { iterations { id title startDate duration } } } } }
  items(first: 100, after: $cursor, query: "${filter}", orderBy: { field: POSITION, direction: ASC }) {
    pageInfo { hasNextPage endCursor }
    nodes { id type isArchived
      fieldValues(first: 30) { nodes { ... on ProjectV2ItemFieldIterationValue { iterationId field { ... on ProjectV2IterationField { id } } } } }
      content { ... on Issue { ${ISSUE} } } } }`;
// What GitHub says is left of the account's GraphQL budget, asked in every load's queries (pulls.js
// gh() keeps it: Kelpie loads less often when it runs low, ghlimit.js).
const BUDGET = "rateLimit { remaining limit resetAt }";
// Kept stories asked for in one query (keptProject()): KEPT_SLOTS slots, each a repo and an issue
// number, the unused ones skipped (`@include`). The text is the same every time; only variables vary.
export const KEPT_SLOTS = 25;
// The priority variables every query reading issues takes, off unless set.
const PRIORITY_VARS = `$priority: String = "", $withPriority: Boolean = false`;
const slots = Array.from({ length: KEPT_SLOTS }, (_, n) => n);
export const QUERIES = Object.freeze({
  user: `query KelpieProjectUser($owner: String!, $number: Int!, $cursor: String, ${PRIORITY_VARS}) { ${BUDGET} user(login: $owner) { projectV2(number: $number) { ${projectFields(FILTERS.mine)} } } }`,
  org: `query KelpieProjectOrg($owner: String!, $number: Int!, $cursor: String, ${PRIORITY_VARS}) { ${BUDGET} organization(login: $owner) { projectV2(number: $number) { ${projectFields(FILTERS.mine)} } } }`,
  // The same for a board worked alone: every issue of the Project, assigned or not.
  userAll: `query KelpieProjectUserAll($owner: String!, $number: Int!, $cursor: String, ${PRIORITY_VARS}) { ${BUDGET} user(login: $owner) { projectV2(number: $number) { ${projectFields(FILTERS.all)} } } }`,
  orgAll: `query KelpieProjectOrgAll($owner: String!, $number: Int!, $cursor: String, ${PRIORITY_VARS}) { ${BUDGET} organization(login: $owner) { projectV2(number: $number) { ${projectFields(FILTERS.all)} } } }`,
  // The stories, with only their sub-issues' ids: GitHub charges a nested connection for every item
  // it could hold, so the sub-issues' own fields asked here (50 slots × each one's connections) cost
  // 125 points for 61 stories, a load. They're asked flat instead (`subs`), about 4 points per 100.
  stories: `query KelpieStories($ids: [ID!]!, ${PRIORITY_VARS}) { ${BUDGET} nodes(ids: $ids) { ... on Issue { ${ISSUE} subIssues(first: 50) { nodes { id } } } } }`,
  subs: `query KelpieSubIssues($ids: [ID!]!, ${PRIORITY_VARS}) { ${BUDGET} nodes(ids: $ids) { ... on Issue { ${ISSUE} } } }`,
  // Kept stories' issues by key (keptProject()): each slot's node id and its parent's, and who gh runs as.
  kept: `query KelpieKept(${slots.map((n) => `$o${n}: String = "", $r${n}: String = "", $n${n}: Int = 0, $u${n}: Boolean = false`).join(", ")}) { ${BUDGET} viewer { login } ${slots.map((n) => `k${n}: repository(owner: $o${n}, name: $r${n}) @include(if: $u${n}) { issue(number: $n${n}) { id parent { id } } }`).join(" ")} }`,
});

// One GraphQL call, answered as its data, or an error in gh's own words. `partial`: an answer whose
// only errors are things GitHub says aren't there (an issue deleted or moved) is still its data.
async function ask(board, args, { partial = false } = {}) {
  const all = ["api", "graphql", ...args];
  if (board.cfg.demo) {
    const answer = await demoProject(all); // reads the fixture, so demoLimit() knows it
    const used = demoLimit();
    if (used?.until) throw new Error(limitMessage(used)); // the demo's GitHub limit used up (fixture github.limit)
    return answer.data;
  }
  const r = await gh(board.account, all);
  let out = null;
  try { out = JSON.parse(r.stdout || "null"); } catch { out = null; }
  const said = out?.errors?.[0]?.message ?? (r.stderr || "").trim().split("\n")[0].replace(/^gh: /, "");
  const notFound = Boolean(out?.errors?.length) && out.errors.every((x) => x?.type === "NOT_FOUND");
  if (partial && notFound && out?.data) return out.data;
  if (r.code !== 0 || !out?.data) throw new Error(said || "GitHub didn't answer the Project's question.");
  return out.data;
}

// The Project's address parts, checked before any of them is used.
function target(cfg) {
  const owner = String(cfg?.owner ?? "");
  if (!owner || owner.length > 39 || !(cfg?.demo ? DEMO_LOGIN : GITHUB_LOGIN).test(owner)) throw new Error("The profile's GitHub Project has no valid owner: set its address again in the profile.");
  const number = Number(cfg?.number);
  if (!Number.isInteger(number) || number < 1) throw new Error("The profile's GitHub Project has no valid number: set its address again in the profile.");
  const org = cfg.ownerType === "org", solo = cfg.solo === true;
  return { owner, number, solo, query: solo ? (org ? QUERIES.orgAll : QUERIES.userAll) : org ? QUERIES.org : QUERIES.user };
}

// Days since 1970 of a "YYYY-MM-DD", and of today where the person is.
const dayOf = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN; };
const today = () => { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5; };

// The stories of `keep.keys` (stories.js hereKeys(): something of them is still here) that the load
// doesn't have (`have`): each key's issue found in its repo (`repos`, by key prefix: a key of no known
// repo is skipped), a sub-issue's story taken instead, KEPT_SLOTS keys a query. { ids: the stories'
// node ids, viewer: the login gh runs as }. A key GitHub says isn't there (an issue deleted or moved)
// is skipped; any other failure fails the load, as one that left kept stories out would have their
// paused agents pruned.
const REPO_PART = /^[A-Za-z0-9._-]{1,100}$/;
async function keptProject(board, keep, have, repos) {
  const asks = [];
  for (const key of new Set(keep.keys ?? [])) {
    if (!KEY.test(key) || have.has(key)) continue;
    const at = key.lastIndexOf("-");
    const [owner, repo, extra] = String(repos[key.slice(0, at)] ?? "").split("/");
    if (extra !== undefined || !REPO_PART.test(owner ?? "") || !REPO_PART.test(repo ?? "")) continue;
    asks.push({ owner, repo, number: key.slice(at + 1) });
  }
  const ids = [];
  let viewer = null;
  for (let at = 0; at < asks.length; at += KEPT_SLOTS) {
    const chunk = asks.slice(at, at + KEPT_SLOTS);
    const vars = chunk.flatMap((a, n) => ["-f", `o${n}=${a.owner}`, "-f", `r${n}=${a.repo}`, "-F", `n${n}=${a.number}`, "-F", `u${n}=true`]);
    const data = await ask(board, [...vars, "-f", `query=${QUERIES.kept}`], { partial: true });
    viewer ??= data?.viewer?.login ?? null;
    chunk.forEach((_, n) => {
      const issue = data?.[`k${n}`]?.issue;
      const id = issue?.parent?.id ?? issue?.id;
      if (typeof id === "string" && NODE_ID.test(id) && !ids.includes(id)) ids.push(id);
    });
  }
  return { ids, viewer };
}

// The board's raw load, as board.js's header describes it. On a board worked alone (`solo`) every
// issue in scope is the person's, whoever it's assigned to: the items come without the assignee
// filter, and all of them, their stories and sub-issues are in `mine`. Past PAGES pages the rest is
// left out and the answer says so (`cut`: how many items were read), as a whole board can be more.
export async function loadProject(board, keep = {}) {
  const { owner, number, solo, query } = target(board.cfg);
  // The priority field, only while the profile orders or marks by it; its name goes as a variable,
  // like every other value.
  const use = priorityOf({ project: board.cfg });
  const priorityName = use.order || use.show ? use.field : null;
  const withPriority = priorityName ? ["-f", `priority=${priorityName}`, "-F", "withPriority=true"] : [];
  let project = null;
  const items = [];
  let cursor = null, cut = false;
  for (let page = 0; page < PAGES; page++) {
    const data = await ask(board, ["-f", `owner=${owner}`, "-F", `number=${number}`, ...(cursor ? ["-f", `cursor=${cursor}`] : []), ...withPriority, "-f", `query=${query}`]);
    const p = (board.cfg.ownerType === "org" ? data.organization : data.user)?.projectV2;
    if (!p) throw new Error(`GitHub has no Project ${number} of ${owner} that your account can read.`);
    project ??= p;
    items.push(...(p.items?.nodes ?? []));
    const next = p.items?.pageInfo;
    if (!next?.hasNextPage || !next.endCursor) break;
    if (page === PAGES - 1) { cut = true; break; }
    cursor = next.endCursor;
  }
  const options = project.field?.options ?? [];
  const columns = options.map((o) => ({ name: o.name, statuses: [o.id] }));
  const iterationField = (project.fields?.nodes ?? []).find((f) => f?.id && f.configuration);
  // The priority levels: the field's options in their order, highest first (none: the field isn't a
  // single-select field of this Project, so no ticket has a priority).
  const levels = priorityName ? (project.priorityField?.options ?? []).filter((o) => o?.id && o.name).map((o) => ({ id: String(o.id), name: String(o.name) })) : null;
  const levelIds = new Set((levels ?? []).map((l) => l.id));

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
  // Issues by node id, NODES a query.
  const byIds = async (list, query) => {
    const out = [];
    for (let at = 0; at < list.length; at += NODES) {
      const chunk = list.slice(at, at + NODES);
      const data = await ask(board, [...chunk.flatMap((id) => ["-f", `ids[]=${id}`]), ...withPriority, "-f", `query=${query}`]);
      out.push(...(data.nodes ?? []).filter((n) => n?.id));
    }
    return out;
  };
  // The stories, then their sub-issues by id, each put back under its story in the story's order.
  const storiesOf = async (list) => {
    const out = await byIds(list, QUERIES.stories);
    const subIds = [...new Set(out.flatMap((s) => (s.subIssues?.nodes ?? []).map((c) => c?.id)).filter((id) => typeof id === "string" && NODE_ID.test(id)))];
    const subs = new Map((await byIds(subIds, QUERIES.subs)).map((c) => [c.id, c]));
    return out.map((s) => ({ ...s, subIssues: { nodes: (s.subIssues?.nodes ?? []).map((c) => subs.get(c?.id)).filter(Boolean) } }));
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
    const level = own?.priority?.optionId && levelIds.has(String(own.priority.optionId)) ? levels.find((l) => l.id === String(own.priority.optionId)) : null;
    return {
      // `id` and `closed`: what closing it on GitHub needs (stories.js closePlan(), issues.js
      // closeIssue()), as a Status move to done leaves the issue open.
      key, url: i.url, item: own?.id ?? null, id: typeof i.id === "string" && NODE_ID.test(i.id) ? i.id : null, closed,
      fields: {
        summary: i.title ?? "",
        // GitHub's issues have no type of the board's: this one is Kelpie's own, never shown as a tag.
        issuetype: { name: i.parent ? "Sub-issue" : "Issue", subtask: Boolean(i.parent), madeUp: true },
        status: index >= 0
          ? { id: option, name: options[index].name, statusCategory: { key: projectCategory(index, options.length, closed, options[index].name) } }
          : { id: null, name: own ? "No status" : closed ? "Closed" : "Open", statusCategory: { key: projectCategory(-1, options.length, closed) } },
        parent: parent ? { key: parent } : null,
        // As GitHub gives them; cleaned and checked where they're kept (labelsOf() in stories.js).
        labels: (i.labels?.nodes ?? []).filter(Boolean).map((l) => ({ name: l.name, color: l.color })),
        ...(level ? { priority: level } : {}),
        // When it last moved (#141): its Status value's own time, else when it closed, both exact;
        // else when the issue last changed at all, a guess (stories.js movedOf() cleans it).
        ...((moved) => (moved ? { moved } : {}))(own?.fieldValueByName?.updatedAt ? { at: own.fieldValueByName.updatedAt, exact: true }
          : closed && i.closedAt ? { at: i.closedAt, exact: true } : i.updatedAt ? { at: i.updatedAt, exact: false } : null),
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
  // Worked alone, every story and sub-issue added is the person's, whoever has it.
  const counted = new Set(mine.map((i) => i.key));
  const allMine = (_raw, dressed) => { if (solo && !counted.has(dressed.key)) { counted.add(dressed.key); mine.push(dressed); } };
  add(stories, allMine);
  // Then the stories `keep` names that your items left out (reassigned since, or out of the
  // iteration), after the board's own; the issues of them assigned to the account gh runs as are yours.
  const kept = await keptProject(board, keep, seen, { ...(keep.repos ?? {}), ...repos });
  const fresh = kept.ids.filter((id) => !ids.includes(id));
  const before = parents.length;
  if (fresh.length) add(await storiesOf(fresh), (raw, dressed) => {
    if (solo) return allMine(raw, dressed);
    if (kept.viewer && (raw.assignees?.nodes ?? []).some((n) => n?.login === kept.viewer)) mine.push(dressed);
  });
  return {
    site: "https://github.com", columns, sprints, mine, parents, children, links, repos, kept: parents.slice(before).map((i) => i.key),
    ...(solo ? { solo: true } : {}), ...(cut ? { cut: items.length } : {}),
    project: { id: project.id, statusField: project.field?.id ?? null, title: project.title ?? "", url: project.url ?? "" },
    ...(levels ? { priorities: levels } : {}),
  };
}
