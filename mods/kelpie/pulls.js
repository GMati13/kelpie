// Open pull requests of the space's GitHub owner (an organisation or a user, from its setup) through
// gh: the ones waiting for your review, and yours, with their checks and review state. A title opens
// the PR; the action starts a Claude agent on it in the space's folder.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec } from "herdr";
import { skinTheme } from "./skins/index.js";
import { SMALL, ago, avatar, chip, modFile, openExternal, textButton } from "./ui.js";
import { Source, empty, frame, needsSetup, startAgent } from "./source.js";
import { demoApprove, demoPullBody, demoPulls, demoReadPulls } from "./demo.js";

// What the list keeps of a pull request; `id` is its node id, for reading it again (readPulls()).
const FIELDS = `id number title url isDraft updatedAt reviewDecision headRefOid author { login } repository { name }
  viewerLatestReview { state } latestOpinionatedReviews(first: 20) { nodes { state } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`;
const QUERY = `query($q: String!) { search(query: $q, type: ISSUE, first: 50) { nodes { ... on PullRequest {
  ${FIELDS} } } } }`;
// "user:" covers organisations too.
const GROUPS = [
  { id: "review", label: "Waiting for your review", q: (owner) => `user:${owner} is:pr is:open review-requested:@me` },
  { id: "mine", label: "Your pull requests", q: (owner) => `user:${owner} is:pr is:open author:@me` },
];
// Review state and checks as chips: [label, theme colour].
const DECISION = { APPROVED: ["Approved", "done"], CHANGES_REQUESTED: ["Changes requested", "blocked"], REVIEW_REQUIRED: ["Review required", "muted"] };
const CHECKS = { SUCCESS: ["Checks pass", "done"], FAILURE: ["Checks fail", "blocked"], ERROR: ["Checks fail", "blocked"], PENDING: ["Checks running", "working"], EXPECTED: ["Checks running", "working"] };

const open = openExternal;
const checks = (pr) => pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null;

// For merged pull requests, only what tells them apart: checks and reviews no longer matter, and
// asking for them doubles the time GitHub takes.
const LIGHT = `query($q: String!) { search(query: $q, type: ISSUE, first: 50) { nodes { ... on PullRequest {
  id number title url updatedAt author { login } repository { name } } } } }`;

// Every gh call Kelpie makes, as a profile's GitHub account (`github.account`; none: gh's active one),
// through gh.sh, which hands gh that account's token itself.
export const gh = (account, args) => exec("sh", [modFile("gh.sh"), account ?? "", ...args]);
// The GitHub accounts gh is signed in to on this machine, for the profile dialog's choice.
export async function githubAccounts() {
  const r = await exec("gh", ["auth", "status", "--hostname", "github.com"]);
  const found = `${r.stdout}\n${r.stderr}`.matchAll(/Logged in to github\.com account ([A-Za-z0-9-]+)/g);
  return [...new Set([...found].map((m) => m[1]))];
}

// `demo`: a demo profile's (demo.js), answered from its fixture. `account`: the profile's GitHub account.
export async function searchPulls(q, { light = false, demo = false, account = null } = {}) {
  if (demo) return (await demoPulls(q)).map(decided);
  const r = await gh(account, ["api", "graphql", "-f", `q=${q}`, "-f", `query=${light ? LIGHT : QUERY}`]);
  if (r.code !== 0) throw new Error(r.stderr.trim().split("\n")[0] || "gh couldn't search pull requests.");
  return JSON.parse(r.stdout).data.search.nodes.filter((n) => n?.number).map(decided);
}

// Some pull requests read again by their node ids (the search's `id`), straight after something
// changed them (an agent's turn ending) and while they're in flight: quick, and unlike the search
// (whose index lags behind a merge or new checks) up to date. One constant query, the ids variables,
// each checked first; `state` says merged or closed. At most 100 (GitHub's most for nodes(ids:)).
const NODE_ID = /^[A-Za-z0-9_=-]{1,100}$/;
const READ = `query KelpiePulls($ids: [ID!]!) { nodes(ids: $ids) { ... on PullRequest { state ${FIELDS} } } }`;
export async function readPulls(ids, { demo = false, account = null } = {}) {
  const list = [...new Set(ids.filter((id) => typeof id === "string" && NODE_ID.test(id)))].slice(0, 100);
  if (!list.length) return [];
  if (demo) return (await demoReadPulls(list)).map(decided);
  const r = await gh(account, ["api", "graphql", ...list.flatMap((id) => ["-f", `ids[]=${id}`]), "-f", `query=${READ}`]);
  if (r.code !== 0) throw new Error(r.stderr.trim().split("\n")[0] || "gh couldn't read the pull requests.");
  return (JSON.parse(r.stdout).data?.nodes ?? []).filter((n) => n?.number).map(decided);
}

// Approves a pull request as the person, on their own click in a review's header (never an agent's
// message: agents approve through their own access). Only a github.com pull request's address is
// taken, its parts going into the API path, no shell. Pinned to the head commit the list loaded, when
// known, so a push after the person looked isn't approved unseen. `demo`: kept in demo.js's memory.
const PULL_URL = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/pull\/(\d+)$/;
export async function approvePull(pr, { demo = false, account = null } = {}) {
  const m = PULL_URL.exec(pr?.url ?? "");
  if (!m) throw new Error("its address isn't a GitHub pull request's.");
  if (demo) return demoApprove(pr.url);
  const at = /^[0-9a-f]{40}$/.test(pr.headRefOid ?? "") ? ["-f", `commit_id=${pr.headRefOid}`] : [];
  const r = await gh(account, ["api", "--method", "POST", `repos/${m[1]}/${m[2]}/pulls/${m[3]}/reviews`, "-f", "event=APPROVE", ...at]);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0].replace(/^gh: /, "") || "GitHub didn't take the approval.");
}

// A pull request's description (its Markdown), loaded when it's shown: the search doesn't carry it,
// as some are long. The same address check as approvePull; `demo`: the fixture's.
export async function pullBody(pr, { demo = false, account = null } = {}) {
  const m = PULL_URL.exec(pr?.url ?? "");
  if (!m) throw new Error("its address isn't a GitHub pull request's.");
  if (demo) return demoPullBody(pr.url);
  const r = await gh(account, ["api", `repos/${m[1]}/${m[2]}/pulls/${m[3]}`, "--jq", ".body // \"\""]);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0].replace(/^gh: /, "") || "GitHub didn't send the description.");
  return r.stdout.replace(/\n$/, "");
}

// GitHub gives a review decision only where the branch requires reviews; elsewhere it's null however
// the reviewers answered. Then each reviewer's latest review decides: a change request wins, else an
// approval approves. `viewerReview`: the state of your own latest review (APPROVED once you approved).
function decided({ latestOpinionatedReviews: latest, viewerLatestReview: own, ...raw }) {
  const pr = own === undefined ? raw : { ...raw, viewerReview: own?.state ?? null };
  if (pr.reviewDecision || !latest) return pr;
  const states = (latest.nodes ?? []).map((x) => x?.state);
  return { ...pr, reviewDecision: states.includes("CHANGES_REQUESTED") ? "CHANGES_REQUESTED" : states.includes("APPROVED") ? "APPROVED" : null };
}

export class Pulls extends Source {
  constructor() {
    super("pulls", 3 * 60 * 1000, "github");
  }

  async fetch({ setup }) {
    const lists = await Promise.all(GROUPS.map((g) => searchPulls(g.q(setup.github.owner), { demo: Boolean(setup.github.demo), account: setup.github.account })));
    return Object.fromEntries(GROUPS.map((g, i) => [g.id, lists[i]]));
  }

  count(data) {
    return data.review.length;
  }

  row(t, st, group, pr) {
    const key = `${pr.repository.name}#${pr.number}`;
    const state = checks(pr);
    // What's next for it: your review, or for yours, whatever is in the way.
    const action = group === "review" ? { label: "Review", task: `Review this pull request: ${pr.url}` }
      : state === "FAILURE" || state === "ERROR" ? { label: "Fix checks", task: `The checks fail on this pull request. Find out why and fix them: ${pr.url}` }
      : pr.reviewDecision === "CHANGES_REQUESTED" ? { label: "Address comments", task: `Address the review comments on this pull request: ${pr.url}` }
      : null;
    const chips = [
      pr.isDraft ? chip(t, "Draft", t.muted) : null,
      CHECKS[state] ? chip(t, CHECKS[state][0], t[CHECKS[state][1]]) : null,
      !pr.isDraft && DECISION[pr.reviewDecision] ? chip(t, DECISION[pr.reviewDecision][0], t[DECISION[pr.reviewDecision][1]]) : null,
    ].filter(Boolean);
    const meta = [group === "review" ? pr.author?.login : null, ago(Date.parse(pr.updatedAt))].filter(Boolean).join(" · ");
    return h_flex().id(`pr-${group}-${key}`).flex_none().px(10).py(8).gap(10).items_center().rounded(10).hover((s) => s.bg(t.hover))
      .child(avatar(t, pr.author?.login, 24))
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(div().id(`pr-title-${group}-${key}`).truncate().cursor_pointer().hover((s) => s.text_color(t.accent)).tooltip("Open on GitHub")
          .on_click(() => open(pr.url)).child(pr.title))
        .child(h_flex().gap(6).items_center().text_size(SMALL).text_color(t.dim)
          .child(div().flex_none().px(6).py(1).rounded(4).bg(t.raised).text_size(SMALL).text_color(t.muted).child(key))
          .children(chips)
          .child(div().min_w(0).truncate().child(meta))))
      .when(Boolean(action), (el) => el.child(textButton(t, `pr-act-${group}-${key}`, action.label, () => startAgent(st, { name: `PR ${key}`, task: action.task }))));
  }

  render(cx) {
    const st = this.state(cx);
    const t = skinTheme();
    if (!this.ready(st)) return needsSetup(t, st, "GitHub", "git-compare", "Name an organisation or user to see the pull requests waiting for your review, and your own.");
    const filters = [div().text_size(SMALL).text_color(t.dim).child(st.setup.github.owner)];
    if (!st.data) return frame(t, st, filters, st.error ? div().flex_1() : empty(t, "Looking for pull requests…"));
    const section = (g) => {
      const list = st.data[g.id];
      return v_flex().flex_none().gap(2)
        .child(h_flex().h(24).px(10).gap(6).items_center().text_size(SMALL).text_color(t.dim)
          .child(g.label).child(div().text_color(t.muted).child(String(list.length))))
        .children(list.length ? list.map((pr) => this.row(t, st, g.id, pr)) : [div().px(10).py(6).text_size(SMALL).text_color(t.dim).child(g.id === "review" ? "Nobody's waiting on you. All caught up!" : "You have no open pull requests.")]);
    };
    return frame(t, st, filters, v_flex().id("pulls-list").flex_1().min_h(0).gap(12).overflow_y_scrollbar().children(GROUPS.map(section)));
  }
}
