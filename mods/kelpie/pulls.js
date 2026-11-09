// Open pull requests of the space's GitHub owner (an organisation or a user, from its setup) through
// gh: the ones waiting for your review, and yours, with their checks and review state. A title opens
// the PR; the action starts a Claude agent on it in the space's folder.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec } from "herdr";
import { skinTheme } from "./skins/index.js";
import { SMALL, ago, avatar, chip, openExternal, textButton } from "./ui.js";
import { Source, empty, frame, needsSetup, startAgent } from "./source.js";
import { demoPulls } from "./demo.js";

const QUERY = `query($q: String!) { search(query: $q, type: ISSUE, first: 50) { nodes { ... on PullRequest {
  number title url isDraft updatedAt reviewDecision author { login } repository { name }
  latestOpinionatedReviews(first: 20) { nodes { state } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } } }`;
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
  number title url updatedAt author { login } repository { name } } } } }`;

// `demo`: a demo profile's (demo.js), answered from its fixture.
export async function searchPulls(q, { light = false, demo = false } = {}) {
  if (demo) return (await demoPulls(q)).map(decided);
  const r = await exec("gh", ["api", "graphql", "-f", `q=${q}`, "-f", `query=${light ? LIGHT : QUERY}`]);
  if (r.code !== 0) throw new Error(r.stderr.trim().split("\n")[0] || "gh couldn't search pull requests.");
  return JSON.parse(r.stdout).data.search.nodes.filter((n) => n?.number).map(decided);
}

// GitHub gives a review decision only where the branch requires reviews; elsewhere it's null however
// the reviewers answered. Then each reviewer's latest review decides: a change request wins, else an
// approval approves.
function decided({ latestOpinionatedReviews: latest, ...pr }) {
  if (pr.reviewDecision || !latest) return pr;
  const states = (latest.nodes ?? []).map((x) => x?.state);
  return { ...pr, reviewDecision: states.includes("CHANGES_REQUESTED") ? "CHANGES_REQUESTED" : states.includes("APPROVED") ? "APPROVED" : null };
}

export class Pulls extends Source {
  constructor() {
    super("pulls", 3 * 60 * 1000, "github");
  }

  async fetch({ setup }) {
    const lists = await Promise.all(GROUPS.map((g) => searchPulls(g.q(setup.github.owner), { demo: Boolean(setup.github.demo) })));
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
