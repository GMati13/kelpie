// project-check.js: the profile dialog's Check for a GitHub Project. Every gh call goes through gh.sh as
// the profile's account, the queries are constants with the owner and number only as variables, the
// token's scopes come from `gh api -i user`'s X-OAuth-Scopes header, and what it says is plain.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { CHECK_ORG, CHECK_USER, checkProject, scopeCommand, scopesOf } from "../../mods/kelpie/project-check.js";
import { modFile } from "../../mods/kelpie/ui.js";

const PROJECT = { title: "Roadmap", url: "https://github.com/orgs/acme/projects/4", viewerCanUpdate: true,
  status: { options: [{ id: "a1", name: "Todo" }, { id: "b2", name: "In Progress" }, { id: "c3", name: "Done" }] },
  fields: { nodes: [{ __typename: "ProjectV2Field" }, { __typename: "ProjectV2SingleSelectField" }, { __typename: "ProjectV2IterationField", name: "Sprint" }] },
  repositories: { nodes: [{ nameWithOwner: "acme/web" }, { nameWithOwner: "acme/api" }] } };
const headers = (scopes) => `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n${scopes === null ? "" : `X-Oauth-Scopes: ${scopes}\r\n`}\r\n{"login":"me"}`;

// Answers gh.sh: the scopes call with `scopes` (null: no header), the query with `project` (null: none).
function github({ scopes = "repo, read:org, project", project = PROJECT, query = null } = {}) {
  mock.on.exec = (cmd, args) => {
    const gh = args.slice(2);
    if (gh[0] === "api" && gh[1] === "-i") return { code: 0, stdout: headers(scopes), stderr: "" };
    if (gh[1] === "graphql") return query ?? (project
      ? { code: 0, stdout: JSON.stringify({ data: { owner: { projectV2: project } } }), stderr: "" }
      : { code: 1, stdout: JSON.stringify({ data: { owner: { projectV2: null } }, errors: [{ message: "Could not resolve to a ProjectV2 with the number 4." }] }), stderr: "gh: Could not resolve to a ProjectV2 with the number 4.\n" });
    return undefined;
  };
}
const CFG = { owner: "acme", ownerType: "org", number: 4 };
beforeEach(() => mock.reset());

test("the Project is asked with a constant query, the owner and number only as variables, as the profile's account", async () => {
  github();
  await checkProject({ owner: "evil\") { x } #", ownerType: "user", number: 4 }, { account: "me-work" });
  const calls = mock.of("exec");
  assert.equal(calls.length, 2);
  for (const [cmd, args] of calls) {
    assert.equal(cmd, "sh");
    assert.equal(args[0], modFile("gh.sh"));
    assert.equal(args[1], "me-work");
  }
  assert.deepEqual(calls[0][1].slice(2), ["api", "-i", "user"]);
  assert.deepEqual(calls[1][1].slice(2), ["api", "graphql", "-F", "number=4", "-f", 'owner=evil") { x } #', "-f", `query=${CHECK_USER}`]);
  // Nothing of the profile's goes into either query's text.
  for (const q of [CHECK_USER, CHECK_ORG]) assert.doesNotMatch(q, /evil|acme/);
  assert.match(CHECK_USER, /^query KelpieCheckUser\(\$owner: String!, \$number: Int!\) \{ owner: user\(login: \$owner\)/);
  assert.match(CHECK_ORG, /^query KelpieCheckOrg\(\$owner: String!, \$number: Int!\) \{ owner: organization\(login: \$owner\)/);
});

test("an organisation's Project is asked with the organisation's query; Default runs gh's active account", async () => {
  github();
  await checkProject(CFG);
  const [, args] = mock.of("exec")[1];
  assert.equal(args[1], "");
  assert.equal(args.at(-1), `query=${CHECK_ORG}`);
});

test("a readable Project: its title, Status options in order, iteration, repos, and that tickets can move", async () => {
  github();
  const r = await checkProject(CFG);
  assert.equal(r.ok, true);
  assert.deepEqual(r.project.options.map((o) => o.name), ["Todo", "In Progress", "Done"]);
  assert.equal(r.project.iteration, "Sprint");
  assert.deepEqual(r.project.repos, ["acme/web", "acme/api"]);
  assert.equal(r.project.scopes, "write");
  assert.equal(r.fix, undefined);
  assert.equal(r.text, "Found “Roadmap”: 3 columns (Todo, In Progress, Done), 2 repos. Stories come from the current iteration of its “Sprint” field. Kelpie can move its tickets.");
});

test("no iteration field: the whole board counts; no right to change it: moves won't work", async () => {
  github({ project: { ...PROJECT, viewerCanUpdate: false, fields: { nodes: [{ __typename: "ProjectV2Field" }] } } });
  const r = await checkProject(CFG);
  assert.equal(r.project.iteration, null);
  assert.match(r.text, /no iteration field, so all of its open work counts, like a Kanban board/);
  assert.match(r.text, /GitHub doesn't let you change this Project, so moving a ticket from Kelpie won't work\./);
});

test("scopesOf reads X-OAuth-Scopes whatever its case: project, read:project, neither, or no header", () => {
  assert.equal(scopesOf(headers("repo, project")), "write");
  assert.equal(scopesOf(headers("read:project,repo")), "read");
  assert.equal(scopesOf(headers("repo, read:org, gist")), "none");
  assert.equal(scopesOf(headers("")), "none");
  assert.equal(scopesOf(headers(null)), "unknown");
  assert.equal(scopesOf("HTTP/1.1 200 OK\nx-oauth-scopes: project\n\n{}"), "write");
  // Only a header counts, not the body.
  assert.equal(scopesOf('HTTP/2.0 200 OK\r\n\r\n{"x-oauth-scopes: project": 1}'), "unknown");
  assert.equal(scopesOf(""), "unknown");
});

test("read:project only: it can read, not move, and says how the person adds the scope", async () => {
  github({ scopes: "repo, read:project" });
  const r = await checkProject(CFG, { account: "me-work" });
  assert.equal(r.ok, true);
  assert.match(r.text, /can read it but not move its tickets: the gh sign-in has read:project, not project/);
  assert.equal(r.fix, "gh auth switch -h github.com -u me-work\ngh auth refresh -h github.com -s project\ngh auth switch -h github.com");
});

test("no scopes listed (a fine-grained token): it says plainly Kelpie can't tell", async () => {
  github({ scopes: null });
  const r = await checkProject(CFG);
  assert.equal(r.ok, true);
  assert.equal(r.project.scopes, "unknown");
  assert.match(r.text, /Kelpie can't tell whether it may move tickets/);
  assert.equal(r.fix, undefined);
});

test("an unreadable Project says so plainly, naming the account, and no raw GitHub error", async () => {
  github({ project: null });
  const r = await checkProject(CFG, { account: "me-work" });
  assert.equal(r.ok, false);
  assert.equal(r.text, "Kelpie can't read that Project. Check the address, and that the GitHub account me-work can see it on GitHub.");
  github({ project: null });
  assert.match((await checkProject(CFG)).text, /that the account gh has active can see it/);
});

test("unreadable without the project scope: says what's missing, with the command for the active account", async () => {
  github({ project: null, scopes: "repo, read:org" });
  const r = await checkProject(CFG);
  assert.equal(r.ok, false);
  assert.match(r.text, /hasn't got the project scope/);
  assert.equal(r.fix, "gh auth refresh -h github.com -s project");
  assert.equal(scopeCommand(null), r.fix);
});

test("gh.sh's own words pass on when it couldn't sign in as the account", async () => {
  github({ query: { code: 1, stdout: "", stderr: "gh isn't signed in to the GitHub account me-work. Sign in to it in a terminal: gh auth login\n" } });
  const r = await checkProject(CFG, { account: "me-work" });
  assert.equal(r.ok, false);
  assert.match(r.text, /gh isn't signed in to the GitHub account me-work\. Sign in to it in a terminal: gh auth login$/);
});

test("a demo profile's Project answers from the fixture, running nothing", async () => {
  const r = await checkProject({ owner: "kelpie--demo", ownerType: "user", number: 1 }, { demo: true, name: "Acme" });
  assert.equal(mock.of("exec").length, 0);
  assert.equal(r.ok, true);
  assert.deepEqual(r.project.options.map((o) => o.name), ["To Do", "In Progress", "Review", "QA", "Done"]);
  assert.equal(r.project.scopes, "write");
  assert.equal(r.project.repos.length, 1);
  assert.match(r.project.repos[0], /^kelpie--demo\//);
});

test("for a named account, the command switches to it and back to the account gh has active", async () => {
  github({ project: null, scopes: "repo" });
  const ask = mock.on.exec;
  mock.on.exec = (cmd, args) => (args[1] === "" && args[2] === "api" && args[3] === "user" ? { code: 0, stdout: "me-home\n", stderr: "" } : ask(cmd, args));
  const r = await checkProject(CFG, { account: "me-work" });
  assert.equal(r.fix, "gh auth switch -h github.com -u me-work\ngh auth refresh -h github.com -s project\ngh auth switch -h github.com -u me-home");
  assert.equal(scopeCommand("me-work", "me-work"), "gh auth refresh -h github.com -s project", "already the active one: no switching");
  for (const bad of ["x; rm -rf ~", "me-work\nrm -rf ~", "-x", "a b"]) assert.equal(scopeCommand(bad, "me-home"), null, `${JSON.stringify(bad)}: no command with it in`);
  assert.equal(scopeCommand("me-work", "x; rm -rf ~"), "gh auth switch -h github.com -u me-work\ngh auth refresh -h github.com -s project\ngh auth switch -h github.com", "not a login: no name to switch back to");
});
