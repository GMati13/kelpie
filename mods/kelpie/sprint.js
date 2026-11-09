// A space's Jira board as Jira draws it: the board's own columns (each holds the statuses the board
// maps to it) and, grouped by story, one row per story with its sub-tasks in the columns, then
// "Other issues". A key opens the ticket; the >_ button starts a Claude agent on it in the space's
// folder (or shows the tab it already has). The board, its site and the Keychain item come from the
// space's setup (config.js).

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec } from "herdr";
import { skinTheme } from "./skins/index.js";
import { SMALL, avatar, chip, chrome, icon, iconButton, modFile, openExternal, platform, stop, textButton, tint } from "./ui.js";
import { Source, empty, frame, needsSetup, notice, startAgent } from "./source.js";
import { jiraTask } from "./config.js";
import { demoJira } from "./demo.js";

// A board can run more than one sprint at a time; all of its active ones show.
const PAGES = 10; // up to 1000 tickets, sub-tasks included
const SCOPES = {
  sprint: { label: "Whole sprint", jql: "" },
  mine: { label: "Mine", jql: " AND assignee = currentUser()" },
};
const GROUPS = { stories: "Stories", none: "No grouping" };
// Sign-in is a Jira Cloud API token: printed by the profile's token command when it has one, else
// kept in its Keychain item (macOS).
const TOKEN = "a Jira Cloud API token (id.atlassian.com → Security → API tokens)";
function tokenHelp(cfg) {
  if (cfg.tokenCommand) return `Check the token command in this profile: it should print ${TOKEN}, for the Jira email beside it.`;
  if (platform() !== "macos") return `There's no Keychain here: give this profile a token command that prints ${TOKEN}.`;
  return `Check the Keychain item "${cfg.keychain}" in this profile: its account is your Jira email, its password ${TOKEN}.`;
}

const open = openExternal;

// What kind of ticket, as a dot in Jira's colours: bugs red, stories green, tasks blue.
function typeDot(t, type) {
  const name = (type ?? "").toLowerCase();
  const color = name.includes("bug") || name.includes("incident") || name.includes("production") ? t.blocked
    : name.includes("story") ? t.done
    : name.includes("epic") ? t.ansi5
    : name.includes("task") ? t.accent
    : t.dim;
  return div().flex_none().size(8).rounded_full().bg(color).tooltip(type ?? "Ticket");
}

// A status as Jira draws it: a chip coloured by the status's category, in sentence case.
const sentence = (name) => { const s = (name ?? "").toLowerCase(); return s && s[0].toUpperCase() + s.slice(1); };
export function lozenge(t, name, category) {
  const [bg, fg] = category === "indeterminate" ? [tint(t.accent, "26"), t.accent]
    : category === "done" ? [tint(t.done, "26"), t.done]
    : [t.raised, t.muted];
  return chip(t, sentence(name), fg, bg);
}

function remember(key, fallback, allowed) {
  try {
    const v = localStorage.getItem(key);
    return v && (!allowed || allowed[v]) ? v : fallback;
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

// One request through jira.sh, for a setup's { site, keychain } or { site, email, tokenCommand }.
// The token command (and the email) go as arguments; the token it prints never leaves jira.sh's pipes.
// A demo profile's board (demo.js) answers from its fixture.
export async function jira(cfg, ...args) {
  let r;
  if (cfg?.demo) r = await demoJira(args);
  else {
    const signIn = cfg.tokenCommand ? ["--email", cfg.email ?? "", "--token-command", cfg.tokenCommand] : [];
    const out = await exec("sh", [modFile("jira.sh"), ...signIn, cfg.site, cfg.keychain ?? "", ...args]);
    r = JSON.parse(out.stdout || "{}");
  }
  if (r.error === "site") throw new Error("The board URL in this profile isn't an https:// Jira Cloud address.");
  if (r.error === "command") throw new Error(`The token command failed or printed nothing. ${tokenHelp(cfg)}`);
  if (r.error === "missing") throw new Error(`No Jira Cloud sign-in${cfg.tokenCommand ? "" : platform() === "macos" ? " in the Keychain" : ""}. ${tokenHelp(cfg)}`);
  if (r.code === 401 || r.code === 403 || (r.code === 200 && r.authed === false)) throw new Error(`Jira Cloud didn't accept the sign-in. ${tokenHelp(cfg)}`);
  if (r.code < 200 || r.code > 299) throw new Error([...(r.body?.errorMessages ?? []), ...Object.values(r.body?.errors ?? {})].join(" ") || `Jira answered ${r.code || "nothing"}.`);
  return r;
}

// A board's active sprints, as Jira answers them. A Kanban board has none (Jira refuses the
// question), so then the board itself comes back marked `kanban` (its name is in `body.name`).
export async function activeSprints(cfg) {
  try {
    return await jira(cfg, "get", `/rest/agile/1.0/board/${cfg.board}/sprint?state=active`);
  } catch (e) {
    const board = await jira(cfg, "get", `/rest/agile/1.0/board/${cfg.board}`).catch(() => null);
    if (board?.body?.type !== "kanban") throw e;
    return { ...board, kanban: true };
  }
}

// Which tickets are the board's current work, as JQL to go before " AND …" and " ORDER BY Rank":
// a scrum board's active sprints (null with none running), or on a Kanban board its own filter (and
// sub-filter) less what has been done for more than DONE_DAYS. `sprints` is what the views name: the
// sprints, or for Kanban the board as the one entry. `config` is the board's /configuration answer.
const DONE_DAYS = 14;
export function boardScope(active, config) {
  if (!active.kanban) {
    const sprints = (active.body?.values ?? []).map((s) => ({ id: s.id, name: s.name.replace(/\s+/g, " ") }));
    return { sprints, jql: sprints.length ? `sprint in (${sprints.map((s) => s.id).join(", ")})` : null };
  }
  const filter = config.body?.filter?.id;
  if (!filter) throw new Error("This Kanban board's filter can't be read: Jira Cloud gave no filter for it.");
  const sub = config.body?.subQuery?.query?.trim();
  return {
    sprints: [{ id: null, name: String(active.body?.name ?? "Kanban").replace(/\s+/g, " "), kanban: true }],
    jql: `filter = ${filter}${sub ? ` AND (${sub})` : ""} AND (statusCategory != Done OR statusCategoryChangedDate >= -${DONE_DAYS}d)`,
  };
}

// Rows as Jira's "Stories" swimlanes draw them: each parent of a sub-task in the result, in the
// order the board ranks them, with its sub-tasks; then every other ticket under "Other issues".
function storyLanes(issues) {
  const byKey = new Map(issues.map((i, n) => [i.key, { issue: i, rank: n }]));
  const lanes = new Map();
  issues.forEach((i, n) => {
    if (!i.fields?.issuetype?.subtask || !i.fields.parent) return;
    const key = i.fields.parent.key;
    if (!lanes.has(key)) lanes.set(key, { key, parent: byKey.get(key)?.issue ?? i.fields.parent, rank: byKey.get(key)?.rank ?? n, cards: [] });
    lanes.get(key).cards.push(i);
  });
  const rows = [...lanes.values()].sort((a, b) => a.rank - b.rank);
  const others = issues.filter((i) => !lanes.has(i.key) && !(i.fields?.issuetype?.subtask && i.fields.parent));
  return { rows, others };
}

export class Sprint extends Source {
  constructor() {
    super("sprint", 5 * 60 * 1000, "jira");
    this.scope = remember("scope", "sprint", SCOPES);
    this.group = remember("group", "stories", GROUPS);
    try { this.collapsed = new Set(JSON.parse(localStorage.getItem("collapsed") ?? "[]")); } catch { this.collapsed = new Set(); }
  }

  keyOf(setup) {
    return [setup.jira, this.scope];
  }

  async fetch({ setup }) {
    const cfg = setup.jira;
    const [config, active] = await Promise.all([
      jira(cfg, "get", `/rest/agile/1.0/board/${cfg.board}/configuration`),
      activeSprints(cfg),
    ]);
    const columns = (config.body?.columnConfig?.columns ?? []).map((c) => ({ name: c.name, statuses: new Set((c.statuses ?? []).map((s) => s.id)) }));
    const { sprints, jql: scope } = boardScope(active, config);
    if (!scope) return { site: config.site, columns, sprints, issues: [] };
    const jql = `${scope}${SCOPES[this.scope].jql} ORDER BY Rank`;
    const issues = [];
    let page = "";
    for (let i = 0; i < PAGES; i++) {
      const r = await jira(cfg, "search", jql, page);
      issues.push(...(r.body?.issues ?? []));
      page = r.body?.nextPageToken ?? "";
      if (r.body?.isLast !== false || !page) break;
    }
    return { site: config.site, columns, sprints, issues };
  }

  // Tickets not yet in the board's last column; sub-tasks count through their story.
  count(data) {
    const last = data.columns[data.columns.length - 1];
    return data.issues.filter((i) => !i.fields?.issuetype?.subtask && !last?.statuses.has(i.fields?.status?.id)).length;
  }

  setScope(scope, cx) {
    this.scope = scope;
    save("scope", scope);
    cx.notify();
  }

  setGroup(group, cx) {
    this.group = group;
    save("group", group);
    cx.notify();
  }

  toggle(key, cx) {
    if (this.collapsed.has(key)) this.collapsed.delete(key); else this.collapsed.add(key);
    save("collapsed", JSON.stringify([...this.collapsed]));
    cx.notify();
  }

  link(t, id, site, key) {
    return div().id(id).flex_none().text_size(SMALL).text_color(t.accent).cursor_pointer()
      .hover((s) => s.text_color(t.foreground)).tooltip("Open in Jira")
      .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); open(`${site}/browse/${key}`); }).child(key);
  }

  // fields: what the space's prompt template fills in (config.js jiraTask), less the url.
  start(t, id, site, fields) {
    const st = this.st;
    return iconButton(t, id, chrome("terminal"), (_e, cx) => {
      cx.stop_propagation();
      startAgent(st, { name: fields.key, task: jiraTask(st.setup.jira, { ...fields, url: `${site}/browse/${fields.key}` }) });
    }, "Start an agent on this ticket").size(20);
  }

  card(t, site, issue, lane) {
    const f = issue.fields ?? {};
    const id = `${lane}-${issue.key}`;
    const who = f.assignee?.displayName ?? null;
    return v_flex().id(`card-${id}`).flex_none().p(10).gap(6).rounded(8).bg(t.raised).border_1().border_color(t.border).text_size(SMALL)
      .hover((s) => s.border_color(t.input))
      .child(div().min_w(0).text_color(t.foreground).child(f.summary ?? ""))
      .child(h_flex().gap(6).items_center()
        .child(typeDot(t, f.issuetype?.name))
        .child(this.link(t, `key-${id}`, site, issue.key))
        .child(div().flex_1())
        .child(this.start(t, `start-${id}`, site, {
          key: issue.key, summary: f.summary, type: f.issuetype?.name, status: f.status?.name,
          parent: f.parent ? `${f.parent.key}: ${f.parent.fields?.summary ?? ""}` : "",
        }))
        .child(avatar(t, who)));
  }

  // One row of the board: a cell per column, each with that column's cards.
  cells(t, site, columns, cards, lane) {
    return h_flex().flex_none().gap(8).items_stretch().children(columns.map((c, n) => v_flex().flex_1().min_w(0).gap(6)
      .children(cards.filter((i) => c.statuses.has(i.fields?.status?.id)).map((i) => this.card(t, site, i, `${lane}-${n}`)))));
  }

  lane(t, site, columns, { key, title, kind, status, category, parent, cards }) {
    const shut = this.collapsed.has(key);
    return v_flex().flex_none().gap(8).pt(8).border_t_1().border_color(t.border)
      .child(h_flex().id(`lane-${key}`).h(26).flex_none().gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.toggle(key, cx))
        .child(icon(chrome(shut ? "chevron-right" : "chevron-down"), 12).text_color(t.dim))
        .when(Boolean(parent), (el) => el.child(this.link(t, `lane-key-${key}`, site, key)))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(title))
        .child(div().flex_none().text_size(SMALL).text_color(t.dim).child([kind, `${cards.length} ${parent ? (cards.length === 1 ? "sub-task" : "sub-tasks") : (cards.length === 1 ? "issue" : "issues")}`].filter(Boolean).join(" · ")))
        .when(Boolean(status), (el) => el.child(lozenge(t, status, category)))
        .when(Boolean(parent), (el) => el.child(this.start(t, `lane-start-${key}`, site, { key, summary: title, type: kind, status, parent: "" }))))
      .when(!shut, (el) => el.child(this.cells(t, site, columns, cards, key)));
  }

  render(cx) {
    const st = (this.st = this.state(cx));
    const t = skinTheme();
    if (!this.ready(st)) return needsSetup(t, st, "Jira", "layers", "Paste a board's URL to see its active sprint here, grouped by story, and start an agent on any ticket.");
    const filters = [
      ...Object.entries(SCOPES).map(([id, s]) => textButton(t, `scope-${id}`, s.label, (_e, cx) => this.setScope(id, cx), { on: this.scope === id })),
      div().w(12).flex_none(),
      ...Object.entries(GROUPS).map(([id, label]) => textButton(t, `group-${id}`, label, (_e, cx) => this.setGroup(id, cx), { on: this.group === id })),
    ];
    if (!st.data) return frame(t, st, filters, st.error ? div().flex_1() : empty(t, "Fetching your board…"));
    const { site, columns, sprints, issues } = st.data;
    filters.push(div().pl(8).min_w(0).truncate().text_size(SMALL).text_color(t.dim).child(sprints.map((s) => s.name).join(" · ")));
    if (!sprints.length) return frame(t, st, filters, empty(t, "No sprint running right now. Enjoy the calm."));
    if (!issues.length) return frame(t, st, filters, empty(t, this.scope === "mine" ? "Nothing assigned to you this sprint. Free to pick something up." : "This sprint is still empty."));

    // What the board shows: tickets in a status some column holds (Jira hides the rest).
    const shown = issues.filter((i) => columns.some((c) => c.statuses.has(i.fields?.status?.id)));
    const header = h_flex().flex_none().gap(8).pb(2).text_size(SMALL).font_medium().text_color(t.muted).children(columns.map((c) => h_flex().flex_1().min_w(0).gap(6).items_center()
      .child(div().truncate().child(c.name))
      .child(div().flex_none().px(5).rounded(5).bg(t.raised).text_color(t.muted).child(String(shown.filter((i) => c.statuses.has(i.fields?.status?.id)).length)))));

    // How far along it is: tickets in the board's last column, said kindly.
    const last = columns[columns.length - 1];
    const finished = last ? shown.filter((i) => last.statuses.has(i.fields?.status?.id)).length : 0;
    if (shown.length) filters.push(div().flex_none().pl(8).text_size(SMALL).text_color(finished ? t.done : t.dim)
      .child(finished === shown.length ? "All done. Lovely work!" : `${finished} of ${shown.length} done`));

    let body;
    if (this.group === "stories") {
      const { rows, others } = storyLanes(shown);
      const lanes = rows.map((r) => this.lane(t, site, columns, {
        key: r.key, parent: true, title: r.parent.fields?.summary ?? "", kind: r.parent.fields?.issuetype?.name, status: r.parent.fields?.status?.name, category: r.parent.fields?.status?.statusCategory?.key, cards: r.cards,
      }));
      if (others.length) lanes.push(this.lane(t, site, columns, { key: "other-issues", title: "Other issues", cards: others }));
      body = v_flex().gap(8).children(lanes);
    } else {
      body = this.cells(t, site, columns, shown, "all");
    }
    return frame(t, st, filters, v_flex().flex_1().min_h(0).gap(8)
      .child(header)
      .child(v_flex().id("board").flex_1().min_h(0).overflow_y_scrollbar().child(body.when(shown.length === 0, (el) => el.child(notice(t, "Nothing on the board yet.", t.dim))))));
  }
}
