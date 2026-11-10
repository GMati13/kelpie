// Every question Kelpie asks a profile's board, whichever board it is: loading the stories, a
// ticket's link, description and status choices, moving it, and looking one up. Today a Jira board
// (sprint.js jira()); a profile's board comes from config.js boardOf(). What a load gives is the
// shape the story list keeps (stories.js issue(), build()): Jira's issues, the board's columns with
// the status ids each holds, and the sprints shown.
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

import { activeSprints, boardScope, jira } from "./sprint.js";
import { adfBlocks, adfText } from "./adf.js";

const PAGES = 5; // up to 500 tickets a search

// What a GitHub Project's Status option means to Kelpie, as Jira's status categories do: a closed
// issue, or one in the last option, is done; the first option is to do; any other is in progress.
// `index` the option's place in the Status field (-1: no Status), `count` how many options it has.
export function projectCategory(index, count, closed = false) {
  if (closed || (count > 0 && index === count - 1)) return "done";
  return index <= 0 ? "new" : "indeterminate";
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

// The board's current work as it answers it: { site, columns, sprints, mine, parents, children }, the
// issues still as the board gave them (the list trims them). The stories are the parents of your
// subtasks and your own issues, in the board's order, with all of their subtasks.
export async function loadBoard(board) {
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
  return { site: active.site, columns, sprints, mine, parents: [...parents.values()], children };
}

// The board's own address (a link to it is one an agent may offer, stories.js askLink()), from what
// the list loaded or else the profile's: "" when neither says.
export const boardSite = (board, data) => data?.site ?? board?.cfg?.site ?? "";

// A ticket's page on the board, or null when there's no address to make it from.
export function ticketUrl(board, data, key) {
  const site = boardSite(board, data);
  return site ? `${site}/browse/${key}` : null;
}

// A ticket's description, as the reader's blocks (adf.js).
export async function description(board, key) {
  return adfBlocks((await jira(board.cfg, "get", `/rest/api/3/issue/${encodeURIComponent(key)}?fields=description`)).body?.fields?.description);
}

// A ticket's summary, its parent's key and its description as text (the review prompt's).
export async function ticketText(board, key) {
  const f = (await jira(board.cfg, "get", `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,parent`)).body?.fields ?? {};
  return { summary: f.summary ?? "", parent: f.parent?.key ?? null, text: adfText(adfBlocks(f.description)) };
}

// A ticket the list doesn't have (Claude's pick of someone else's, say): { key, summary, story } with
// `story` its story's { key, summary } when it's a subtask (a story's own parent is its epic, never
// followed), or null when the board doesn't know it.
export async function lookUp(board, key) {
  if (!board) return null;
  const r = await jira(board.cfg, "get", `/rest/api/3/issue/${key}?fields=summary,parent,issuetype`).catch(() => null);
  if (!r?.body?.key) return null;
  const parent = r.body.fields?.issuetype?.subtask ? r.body.fields?.parent : null;
  return { key: r.body.key, summary: r.body.fields?.summary ?? "", story: parent?.key ? { key: parent.key, summary: parent.fields?.summary ?? "" } : null };
}

// Where a ticket can be moved: [{ id, name, to, category }], `to` the status it lands in.
export async function statusOptions(board, key) {
  const r = await jira(board.cfg, "get", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
  return (r.body?.transitions ?? []).filter((x) => x.isAvailable !== false)
    .map((x) => ({ id: x.id, name: x.name, to: x.to?.name ?? x.name, category: x.to?.statusCategory?.key }));
}

// Moves a ticket by one of statusOptions(), on the person's own click.
export async function moveStatus(board, key, option) {
  await jira(board.cfg, "transition", key, option.id);
}
