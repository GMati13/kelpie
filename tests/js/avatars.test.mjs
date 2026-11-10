// Assignees' pictures (stories.js): which Jira avatar links are kept, and fetchAvatars() downloading
// each once through avatar.sh, remembering what it got and what failed, in shared `kelpie.avatars`.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { avatarUrl, fetchAvatars, issue } from "../../mods/kelpie/stories.js";

beforeEach(() => mock.reset());

const GRAVATAR = "https://secure.gravatar.com/avatar/0a1b2c?d=https%3A%2F%2Favatar-management--avatars.us-west-2.prod.public.atl-paas.net%2Finitials%2FPN-3.png";
const ATL = "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/5b10a2844c20165700ede21g/0e1c2d3f/48";
const jiraIssue = (key, url) => ({ key, fields: { summary: key, assignee: { displayName: "Priya Nair", avatarUrls: { "48x48": url, "24x24": "x" } } } });

describe("avatar links", () => {
  test("Gravatar's and Atlassian's public avatar host, over https", () => {
    assert.ok(avatarUrl(GRAVATAR));
    assert.ok(avatarUrl(ATL));
    for (const bad of [
      "https://acme.atlassian.net/secure/useravatar?avatarId=10122", // the Jira site: needs a sign-in
      "http://secure.gravatar.com/avatar/0a1b", "https://secure.gravatar.com.evil.example/avatar/1",
      "https://evil.example/?u=https://secure.gravatar.com/", "https://secure.gravatar.com/avatar/1 -o /tmp/x",
      "https://secure.gravatar.com/avatar/1'\"$(id)", "file:///etc/passwd", "", null, 42,
    ]) assert.equal(avatarUrl(bad), false, String(bad));
  });
  test("and GitHub's avatar host, for a GitHub Project's assignees", () => {
    const GH = "https://avatars.githubusercontent.com/u/583231?u=82a1&v=4&s=48";
    assert.ok(avatarUrl(GH));
    for (const bad of ["http://avatars.githubusercontent.com/u/1", "https://avatars.githubusercontent.com.evil.example/u/1", "https://github.com/octocat.png"]) assert.equal(avatarUrl(bad), false, bad);
    assert.deepEqual(issue(jiraIssue("A-3", GH)).fields.assignee, { displayName: "Priya Nair", avatar: GH });
  });
  test("the list keeps the 48px link only when it's one of those", () => {
    assert.deepEqual(issue(jiraIssue("A-1", ATL)).fields.assignee, { displayName: "Priya Nair", avatar: ATL });
    assert.deepEqual(issue(jiraIssue("A-2", "https://acme.atlassian.net/secure/useravatar?avatarId=1")).fields.assignee, { displayName: "Priya Nair" });
  });
});

describe("fetchAvatars", () => {
  const data = (...urls) => ({ parents: urls.map((u, i) => issue(jiraIssue(`A-${i}`, u))), children: urls.map((u, i) => issue(jiraIssue(`B-${i}`, u))) });
  const runs = () => mock.of("exec").filter(([cmd, args]) => cmd === "sh" && String(args[0]).endsWith("/avatar.sh"));

  test("downloads each picture once, into Herdr's art folder, and remembers its file", async () => {
    mock.on.exec = (_cmd, args) => ({ code: 0, stdout: `${args[2]}.png\n`, stderr: "" });
    await fetchAvatars(data(ATL, GRAVATAR, ATL));
    assert.equal(runs().length, 2, "one run per link, however many tickets share it");
    const [, args] = runs()[0];
    assert.equal(args[1], `${mock.state.appHome}/art/kelpie/avatars`);
    assert.match(args[2], /^[0-9a-z]+$/);
    assert.equal(args[3], ATL);
    const saved = mock.sharedValue("kelpie.avatars");
    assert.deepEqual(Object.values(saved).map((e) => e.file).sort(), Object.keys(saved).map((n) => `${n}.png`).sort());
    await fetchAvatars(data(ATL, GRAVATAR));
    assert.equal(runs().length, 2, "nothing downloaded again");
  });
  test("a failed download, or a file name it didn't ask for, is noted and not tried again soon", async () => {
    mock.on.exec = (_cmd, args) => (args[3] === ATL ? { code: 1, stdout: "", stderr: "curl: (22)" } : { code: 0, stdout: "../../evil.png", stderr: "" });
    await fetchAvatars(data(ATL, GRAVATAR));
    const saved = Object.values(mock.sharedValue("kelpie.avatars"));
    assert.equal(saved.length, 2);
    assert.ok(saved.every((e) => e.failed && !e.file));
    await fetchAvatars(data(ATL, GRAVATAR));
    assert.equal(runs().length, 2);
  });
  test("links that aren't avatars' are never downloaded", async () => {
    await fetchAvatars({ parents: [{ key: "A-1", fields: { assignee: { displayName: "X", avatar: "https://acme.atlassian.net/secure/useravatar" } } }], children: [] });
    assert.equal(runs().length, 0);
  });
});

describe("the avatar drawn", () => {
  test("with a picture: Herdr's Avatar, its initials as the fallback, the tooltip outside", async () => {
    const { avatar } = await import("../../mods/kelpie/ui.js");
    const { render } = await import("../lib/snapshot.mjs");
    const t = mock.state.theme;
    const out = render(avatar(t, "Priya Nair", 18, "Assigned to Priya Nair", "art/kelpie/avatars/abc.png"), t);
    assert.match(out, /tip="Assigned to Priya Nair"/);
    assert.match(out, /Avatar\.new/);
    assert.match(out, /AvatarImage\.new "art\/kelpie\/avatars\/abc\.png"/);
    assert.match(out, /AvatarFallback\.new[\s\S]*"PN"/);
    assert.doesNotMatch(render(avatar(t, "Priya Nair"), t), /Avatar\.new/, "no picture: the initials alone");
  });
});
