// Every question Kelpie asks a profile's board, whichever board it is: loading the stories, a
// ticket's link, description and status choices, moving it, and looking one up. Today a Jira board
// (sprint.js jira()); a profile's board comes from config.js boardOf(). What a load gives is the
// shape the story list keeps (stories.js issue(), build()): Jira's issues, the board's columns with
// the status ids each holds, and the sprints shown; `kept`, the keys of the stories it gave only as
// the list asked for them (something of them is still here, stories.js hereKeys()).
//
// A GitHub Project (boardOf() kind "project", issue #1) answers the same questions in the same shape,
// its issues dressed as Jira's. What its load gives, beyond Jira's:
//   site      "https://github.com"
//   columns   the Status field's options in order, { name, statuses: [option id] }
//   sprints   the current iteration [{ id, name }], none running [], or no iteration field: the board
//             as one [{ id: null, name: <Project title>, kanban: true }]
//   issues    { key: PREFIX-<number>, url (the issue's page), item (its Project item id, null when
//             it's not on the Project), fields: { summary, issuetype: { name, subtask: has a parent },
//             status: { id: option id or null, name, statusCategory: { key: new|indeterminate|done } },
//             parent: { key } or null, assignee: { displayName, avatarUrls: { "48x48": url } } } }
//   links     { [pull request url]: key }: the pull requests that close an issue (GitHub's link)
//   repos     { [PREFIX]: "owner/repo" }: which repo a key's issue is in
//   project   { id, statusField, title, url }: what a Status move needs
// Either board, with the profile's `unassigned` set: `unassigned` { parents, children, error? }, the
// work nobody has (unassignedOf()), apart from the person's.

import { activeSprints, boardScope, jira } from "./sprint.js";
import { adfBlocks, adfText } from "./adf.js";
import { issueDescription, issueLookUp, issueRef, issueText, loadedIssue, setStatus } from "./issues.js";
import { loadProject } from "./project.js";

const PAGES = 5; // up to 500 tickets a search

// What a GitHub Project's Status option means to Kelpie, as Jira's status categories do: a closed
// issue, or one in the last option, is done; the first option, or one named as work not started yet
// (Backlog then Todo, say: GitHub has no categories of its own), is to do; any other is in progress.
// `index` the option's place in the Status field (-1: no Status), `count` how many options it has.
const NOT_STARTED = /^(backlog|to ?do|ready|new|triage|icebox|planned|up next|next up)$/i;
export function projectCategory(index, count, closed = false, name = "") {
  if (closed || (count > 0 && index === count - 1)) return "done";
  return index <= 0 || NOT_STARTED.test(String(name).trim()) ? "new" : "indeterminate";
}

async function search(cfg, jql) {
  const out = [];
  let page = "";
  for (let i = 0; i < PAGES; i++) {
    const r = await jira(cfg, "search", jql, page);
    out.push(...(r.body?.issues ?? []));
    page = r.body?.nextPageToken ?? "";
    if (r.body?.isLast !== false || !page) break;
  }
  return out;
}

// A key as Jira makes them, checked before one goes into a search (security.md).
const KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

// The stories and subtasks a search finds by key: `key in (…) OR parent in (…)` (with `and`, only
// the keys' own issues that match it too). A key Jira doesn't know (a ticket deleted or moved since)
// makes it refuse the whole search (400), so then each key is asked alone and the ones it refuses are
// skipped. Any other failure fails the load: one that left kept stories out would have pruneShared()
// drop their paused agents.
const refused = (e) => e?.status === 400;
async function byKeys(cfg, keys, and = null) {
  const jql = (ks) => and ? `key in (${ks.join(", ")}) AND ${and} ORDER BY Rank` : `key in (${ks.join(", ")}) OR parent in (${ks.join(", ")}) ORDER BY Rank`;
  try { return await search(cfg, jql(keys)); } catch (e) {
    if (!refused(e)) throw e;
    const out = [];
    if (keys.length > 1) for (const k of keys) out.push(...await search(cfg, jql([k])).catch((e) => { if (refused(e)) return []; throw e; }));
    return out;
  }
}

// Stories the person still has something of here (`keep.keys`: a space, a paused agent, an open pull
// request; stories.js hereKeys()) that the search by assignee left out, as they're someone else's now
// (or out of the sprint): { parents, children, mine } to add to the load. Only keys of the board's
// projects (this load's, or `keep.projects`, the last load's) are asked for; a subtask's key brings
// its story. `mine`: those of them Jira gives as the person's own (`assignee = currentUser()`).
async function keptJira(cfg, keep, have) {
  const projects = new Set([...(keep.projects ?? []), ...[...have].map((k) => k.split("-")[0])]);
  const asked = [...new Set(keep.keys ?? [])].filter((k) => KEY.test(k) && !have.has(k) && projects.has(k.split("-")[0]));
  if (!asked.length) return { parents: [], children: [], mine: [] };
  const got = await byKeys(cfg, asked);
  const found = new Set(got.map((i) => i.key));
  const up = [...new Set(got.filter((i) => i.fields?.issuetype?.subtask).map((i) => i.fields?.parent?.key))]
    .filter((k) => k && KEY.test(k) && !found.has(k) && !have.has(k));
  const all = [...got, ...(up.length ? await byKeys(cfg, up) : [])].filter((i, n, a) => KEY.test(i.key) && !have.has(i.key) && a.findIndex((x) => x.key === i.key) === n);
  const parents = all.filter((i) => !i.fields?.issuetype?.subtask);
  const stories = new Set(parents.map((i) => i.key));
  const children = all.filter((i) => i.fields?.issuetype?.subtask && stories.has(i.fields?.parent?.key));
  const keys = [...parents, ...children].map((i) => i.key);
  const own = keys.length ? new Set((await byKeys(cfg, keys, "assignee = currentUser()")).map((i) => i.key)) : new Set();
  return { parents: parents.map((i) => ({ key: i.key, fields: i.fields })), children, mine: [...parents, ...children].filter((i) => own.has(i.key)) };
}

// The work nobody has, for the list's Unassigned section (the profile's `unassigned`, config.js
// showsUnassigned()), kept apart from the person's so the list's groups, counts and Next don't change:
// { parents, children }. `got`: the board's unassigned issues in its order, each { key, fields } (a
// Project's with its url and item), a subtask's `fields.parent` its story ({ key, fields? }, a
// Project's with its url). The stories nobody has come as they are; a subtask nobody has whose story
// someone else has brings that story as a heading over it (`taken`), made from what the subtask says
// of it. What `have` holds (the person's stories and subtasks) is left out, and a subtask of one of
// their stories too: it's in that story's own details already. Exported for the tests.
export function unassignedOf(got, have) {
  const parents = [], children = [], seen = new Set();
  const stories = new Set(got.filter((i) => !i.fields?.issuetype?.subtask).map((i) => i.key));
  for (const i of got) {
    if (!KEY.test(i.key ?? "") || have.has(i.key) || seen.has(i.key)) continue;
    if (!i.fields?.issuetype?.subtask) { seen.add(i.key); parents.push(i); continue; }
    const up = i.fields?.parent;
    if (!up?.key || !KEY.test(up.key) || have.has(up.key)) continue;
    if (!stories.has(up.key) && !seen.has(up.key)) {
      seen.add(up.key);
      parents.push({ ...up, key: up.key, taken: true, fields: { ...(up.fields ?? {}), parent: null } });
    }
    seen.add(i.key);
    children.push(i);
  }
  return { parents, children };
}

// Jira's: the board's scope (its active sprints, or a Kanban board's open work) with no assignee. Its
// failing doesn't fail the load: the section says so and the rest shows.
async function unassignedJira(cfg, scope, have) {
  if (!scope) return { parents: [], children: [] };
  try {
    const got = await search(cfg, `${scope} AND assignee is EMPTY ORDER BY Rank`);
    return unassignedOf(got.map((i) => ({ key: i.key, fields: i.fields })), have);
  } catch (e) {
    return { parents: [], children: [], error: String(e?.message ?? e) };
  }
}

// The board's current work as it answers it: { site, columns, sprints, mine, parents, children }, the
// issues still as the board gave them (the list trims them). The stories are the parents of your
// subtasks and your own issues, in the board's order, with all of their subtasks, then the stories
// `keep` names that the board no longer gives as yours (keptJira(), project.js), each with its subtasks.
export async function loadBoard(board, keep = {}) {
  if (board.kind === "project") return loadProject(board, keep);
  const cfg = board.cfg;
  // The board's columns (each with the status ids it holds) place a ticket for the handover rule.
  const [config, active] = await Promise.all([
    jira(cfg, "get", `/rest/agile/1.0/board/${cfg.board}/configuration`),
    activeSprints(cfg),
  ]);
  const columns = (config.body?.columnConfig?.columns ?? []).map((c) => ({ name: c.name, statuses: (c.statuses ?? []).map((x) => x.id) }));
  // A scrum board's active sprints, or a Kanban board's open work (sprint.js boardScope).
  const { sprints, jql: scope } = boardScope(active, config);
  const mine = scope ? await search(cfg, `${scope} AND assignee = currentUser() ORDER BY Rank`) : [];
  const parents = new Map();
  for (const i of mine) {
    const p = i.fields?.issuetype?.subtask ? i.fields.parent : i;
    if (p && !parents.has(p.key)) parents.set(p.key, { key: p.key, fields: p.fields });
  }
  // The children and, in the same search, the parents themselves: a subtask's embedded parent
  // carries no assignee, so a story's own fields come from here when it answers.
  const keys = [...parents.keys()].join(", ");
  const found = parents.size ? await search(cfg, `key in (${keys}) OR parent in (${keys}) ORDER BY Rank`) : [];
  for (const i of found) if (parents.has(i.key)) parents.set(i.key, { key: i.key, fields: i.fields });
  const children = found.filter((i) => !parents.has(i.key));
  const kept = await keptJira(cfg, keep, new Set([...parents.keys(), ...children.map((i) => i.key)]));
  const out = { site: active.site, columns, sprints, mine: [...mine, ...kept.mine], parents: [...parents.values(), ...kept.parents], children: [...children, ...kept.children], kept: kept.parents.map((i) => i.key) };
  if (cfg.unassigned === true && cfg.solo !== true) out.unassigned = await unassignedJira(cfg, scope, new Set([...out.parents, ...out.children].map((i) => i.key)));
  return out;
}

// The board's own address (a link to it is one an agent may offer, stories.js askLink()), from what
// the list loaded or else the profile's: "" when neither says.
export const boardSite = (board, data) => data?.site ?? board?.cfg?.site ?? "";

// A ticket's page on the board, or null when there's no address to make it from. A Project's issue:
// the page the load gave it, else made from its key's repo (data.repos) when that's known.
export function ticketUrl(board, data, key) {
  if (board?.kind === "project") {
    const loaded = loadedIssue(data, key)?.url;
    if (loaded) return loaded;
    const m = /^([A-Z][A-Z0-9]+)-(\d+)$/.exec(key ?? "");
    const repo = m && data?.repos?.[m[1]];
    return repo ? `https://github.com/${repo}/issues/${m[2]}` : null;
  }
  const site = boardSite(board, data);
  return site ? `${site}/browse/${key}` : null;
}

// A ticket's description, as the reader's blocks (adf.js). `data`, here and below: what the list
// loaded, where a Project's issue is found (issues.js); Jira asks by key alone.
export async function description(board, key, data) {
  if (board.kind === "project") return issueDescription(board, data, key);
  return adfBlocks((await jira(board.cfg, "get", `/rest/api/3/issue/${encodeURIComponent(key)}?fields=description`)).body?.fields?.description);
}

// A ticket's summary, its parent's key and its description as text (the review prompt's).
export async function ticketText(board, key, data) {
  if (board.kind === "project") return issueText(board, data, key);
  const f = (await jira(board.cfg, "get", `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,parent`)).body?.fields ?? {};
  return { summary: f.summary ?? "", parent: f.parent?.key ?? null, text: adfText(adfBlocks(f.description)) };
}

// A ticket the list doesn't have (Claude's pick of someone else's, say): { key, summary, story } with
// `story` its story's { key, summary } when it's a subtask (a story's own parent is its epic, never
// followed; a Project's sub-issue goes to its parent issue), or null when the board doesn't know it.
export async function lookUp(board, key, data) {
  if (!board) return null;
  if (board.kind === "project") return issueLookUp(board, data, key);
  const r = await jira(board.cfg, "get", `/rest/api/3/issue/${key}?fields=summary,parent,issuetype`).catch(() => null);
  if (!r?.body?.key) return null;
  const parent = r.body.fields?.issuetype?.subtask ? r.body.fields?.parent : null;
  return { key: r.body.key, summary: r.body.fields?.summary ?? "", story: parent?.key ? { key: parent.key, summary: parent.fields?.summary ?? "" } : null };
}

// Whether a ticket's status can be changed from its chip: always on Jira (its workflow says where);
// on a Project only for an issue that's on it (one off it has no Status there).
export const movable = (board, key, data) => board?.kind !== "project" || Boolean(issueRef(board, data, key)?.item);

// Where a ticket can be moved: [{ id, name, to, category }], `to` the status it lands in. A Project's
// are its Status options (the loaded columns) but the one it's in; none for an issue off the Project.
export async function statusOptions(board, key, data) {
  if (board.kind === "project") {
    if (!movable(board, key, data)) return [];
    const columns = data?.columns ?? [], now = loadedIssue(data, key)?.fields?.status?.id;
    return columns.map((c, i) => ({ id: c.statuses?.[0], name: c.name, to: c.name, category: projectCategory(i, columns.length, false, c.name) }))
      .filter((o) => o.id && o.id !== now);
  }
  const r = await jira(board.cfg, "get", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
  return (r.body?.transitions ?? []).filter((x) => x.isAvailable !== false)
    .map((x) => ({ id: x.id, name: x.name, to: x.to?.name ?? x.name, toId: x.to?.id, category: x.to?.statusCategory?.key }));
}

// The move that takes a ticket to the board's done column (Move to Done, stories.js): the option
// landing in its last column (a Jira status it holds, or a Project's last Status option), else one
// landing in a done status. It throws, saying why in a few words, when there's none from where the
// ticket is (a Jira workflow without a way straight to done, an issue off the Project).
export async function doneOption(board, key, data) {
  if (!movable(board, key, data)) throw new Error("it isn't on the board's Project, so it has no status there");
  const options = await statusOptions(board, key, data);
  // A Project's option is the status itself; a Jira transition's id is not a status's, its `toId` is.
  const last = data?.columns?.at(-1)?.statuses ?? [];
  const o = options.find((x) => last.includes(board.kind === "project" ? x.id : x.toId)) ?? options.find((x) => x.category === "done");
  if (!o) throw new Error("its workflow has no move straight to done from where it is");
  return o;
}

// Moves a ticket by one of statusOptions(), on the person's own click.
export async function moveStatus(board, key, option, data) {
  if (board.kind === "project") return setStatus(board, data, key, option);
  await jira(board.cfg, "transition", key, option.id);
}
