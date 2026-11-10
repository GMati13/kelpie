// The profile dialog's Check for a GitHub Project (setup.js): whether the profile's GitHub account can
// read the Project, what it holds (its title, the Status field's options, whether it has an
// iteration field, its repos) and whether Kelpie may move its items, from the token's scopes.
// Everything goes through gh() (pulls.js), as the profile's GitHub account. The queries are
// constants: the owner and number only ever go in as GraphQL variables. A demo profile's Project
// answers from the fixture (mods/kelpie/demo/demo.json), running nothing.

import { gh } from "./pulls.js";
import { demoFixture } from "./demo.js";

const FIELDS = `title url viewerCanUpdate
      status: field(name: "Status") { ... on ProjectV2SingleSelectField { options { id name } } }
      fields(first: 50) { nodes { __typename ... on ProjectV2IterationField { name } } }
      repositories(first: 20) { nodes { nameWithOwner } }`;
// Exported for the tests.
export const CHECK_USER = `query KelpieCheckUser($owner: String!, $number: Int!) { owner: user(login: $owner) { projectV2(number: $number) {
      ${FIELDS} } } }`;
export const CHECK_ORG = `query KelpieCheckOrg($owner: String!, $number: Int!) { owner: organization(login: $owner) { projectV2(number: $number) {
      ${FIELDS} } } }`;

// What the person runs to give gh's sign-in the project scope. gh refreshes only its active account,
// so a named one is switched to first, and back after (gh auth switch with no account goes back
// when two are signed in, and asks which when there are more).
export function scopeCommand(account) {
  return account
    ? `gh auth switch -h github.com -u ${account}\ngh auth refresh -h github.com -s project\ngh auth switch -h github.com`
    : "gh auth refresh -h github.com -s project";
}

// The token's scopes from `gh api -i user`'s headers: "write" (project: read and move items),
// "read" (read:project only), "none" (neither: Projects can't be read), or "unknown" when the token
// doesn't list them (a fine-grained token, or GH_TOKEN set to one).
export function scopesOf(response) {
  const head = String(response ?? "").split(/\r?\n\r?\n/)[0];
  const line = head.split(/\r?\n/).find((l) => /^x-oauth-scopes\s*:/i.test(l));
  if (line === undefined) return "unknown";
  const scopes = line.replace(/^[^:]*:/, "").split(",").map((s) => s.trim().toLowerCase());
  return scopes.includes("project") ? "write" : scopes.includes("read:project") ? "read" : "none";
}

// The scope check, then the Project itself: { ok, text, fix?, project? }. `ok` false: it couldn't be
// read (`text` says why plainly); `fix` is a command for the person to run themselves; `project` is
// { title, url, canUpdate, options: [{ id, name }], iteration (its field's name or null), repos:
// ["owner/repo"], scopes }.
export async function checkProject(cfg, { account = null, demo = false, name = "" } = {}) {
  if (demo) return demoCheck(name);
  const who = account ? `the GitHub account ${account}` : "the account gh has active";
  const [scope, r] = await Promise.all([
    gh(account, ["api", "-i", "user"]).then((x) => (x.code === 0 ? scopesOf(x.stdout) : "unknown"), () => "unknown"),
    gh(account, ["api", "graphql", "-F", `number=${cfg.number}`, "-f", `owner=${cfg.owner}`, "-f", `query=${cfg.ownerType === "org" ? CHECK_ORG : CHECK_USER}`]),
  ]);
  let body = null;
  try { body = JSON.parse(r.stdout || "null"); } catch { /* not GitHub's answer: gh failed first */ }
  const p = body?.data?.owner?.projectV2;
  if (!p) {
    if (scope === "none") return { ok: false, text: `Kelpie can't read that Project: the gh sign-in of ${who} hasn't got the project scope, which Projects need. Add it in a terminal (a browser opens to confirm), then check again:`, fix: scopeCommand(account) };
    // gh.sh's own words (not signed in to that account) say what to do; GitHub's errors don't.
    const own = !body && /^gh isn't signed in|^That isn't a GitHub account/.test(r.stderr ?? "") ? ` ${String(r.stderr).trim().split("\n")[0]}` : "";
    return { ok: false, text: `Kelpie can't read that Project. Check the address, and that ${who} can see it on GitHub.${own}` };
  }
  return described({
    title: p.title ?? "", url: p.url ?? "", canUpdate: p.viewerCanUpdate !== false,
    options: (p.status?.options ?? []).map((o) => ({ id: o.id, name: o.name })),
    iteration: (p.fields?.nodes ?? []).find((f) => f?.__typename === "ProjectV2IterationField")?.name ?? null,
    repos: (p.repositories?.nodes ?? []).map((n) => n?.nameWithOwner).filter(Boolean),
    scopes: scope,
  }, account);
}

// What a readable Project's check says, in plain words.
function described(project, account) {
  const { title, options, iteration, repos, scopes, canUpdate } = project;
  const lines = [`Found “${title}”: ${options.length ? `${options.length} columns (${options.map((o) => o.name).join(", ")})` : "no Status field, so stories have no columns: add one on GitHub"}, ${repos.length} repo${repos.length === 1 ? "" : "s"}.`];
  lines.push(iteration ? `Its current ${iteration} is the sprint.` : "It has no iteration field, so all of its open work counts, like a Kanban board.");
  let fix;
  if (scopes === "write") lines.push(canUpdate ? "Kelpie can move its tickets." : "GitHub doesn't let you change this Project, so moving a ticket from Kelpie won't work.");
  else if (scopes === "read") {
    lines.push("Kelpie can read it but not move its tickets: the gh sign-in has read:project, not project. To move tickets from Kelpie, add the project scope in a terminal (a browser opens to confirm):");
    fix = scopeCommand(account);
  } else lines.push("Kelpie can't tell whether it may move tickets: gh signs in with a token that doesn't list its permissions (a fine-grained token, say). If a move fails, give that token read and write access to Projects.");
  return { ok: true, text: lines.join(" "), ...(fix ? { fix } : {}), project };
}

// The demo's Project: the fixture board's columns as its Status options, its repo, and moves allowed.
async function demoCheck(name) {
  const f = await demoFixture();
  const p = f.project && typeof f.project === "object" ? f.project : {};
  return described({
    title: p.title ?? name ?? "", url: "", canUpdate: true,
    options: (f.board?.columns ?? []).map((c) => ({ id: c.statuses?.[0]?.id ?? c.name, name: c.name })),
    iteration: p.iteration ?? null,
    repos: [p.repo ?? "kelpie--demo/acme"],
    scopes: "write",
  }, null);
}
