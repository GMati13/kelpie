// A profile, as a dialog (props: { profile, space, overlay, focus }): its name, the folder its agents
// start in (spaces in it belong to it), its board, one of two: a Jira Cloud board (a pasted board URL
// and how to sign in: a Keychain item on macOS, or a command that prints the API token, with the
// email) or a GitHub Project (its address, read as the profile's GitHub account, and each repo's key
// prefix), with the board's prompts and the column where your part of a ticket is done,
// its GitHub owner and account (whether its pull requests notify; the gh() function its agents'
// shell setup needs, with a check), its Agents page (the accounts agents run on: Claude's, with a
// guide to adding another) and its optional story commands. No profile id: a new one, starting from
// the space's folder. Each part has a check that asks the service; Save keeps it in shared state
// (config.js).

import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, Textarea, TextareaState } from "gpui-base";
import { closeOverlay, exec, pickFolder, props, setShared, shared, spaces } from "herdr";
import { skinTheme } from "./skins/index.js";
import { DIALOG, SMALL, TEXT, TITLE, agentLabels, chrome, icon, menuButton, modFile, own, platform, primaryButton, textButton } from "./ui.js";
import { deskAgents } from "./desk.js";
import { ASK_PROMPTS, askPlugin, hasPlugin, validEmail, CONFIGURE_PROMPT, SUGGEST_PROMPT, CONFIGURE_SCOPES, configureOnDesk, DEFAULT_APPROVAL_PROMPT, DEFAULT_MERGE_PROMPT, DEFAULT_PROMPT, DEFAULT_REVIEW_PROMPT, MERGE_FIELDS, PROMPT_FIELDS, REVIEW_FIELDS, claudeFolders, isOwnClaude, handoverFrom, sunkWords, liveFolder, loadedColumns, newProfileId, parseBoard, profileById, saveProfile, PREFIX, STORIES, defaultPrefix, parsePrefixes, parseProject } from "./config.js";

import { jira } from "./sprint.js";
import { jiraPriorities } from "./board.js";
import { githubAccounts, searchPulls } from "./pulls.js";
import { checkProject as readProject } from "./project-check.js";


// Stores a token without the 128-character limit of `security`'s own prompt, and without it ever
// being on a command line: zsh reads it hidden, `security -i` takes the command on stdin. The item
// and email are quoted for each reader in turn: `security -i` (double quotes), printf's format
// (`%%`, doubled backslashes), then the shell's single quotes.
const securityArg = (s) => `"${s.replace(/["\\]/g, "\\$&")}"`;
const formatText = (s) => s.replace(/\\/g, "\\\\").replace(/%/g, "%%");
const singleQuoted = (s) => s.replace(/'/g, "'\\''");
const storeCommand = (item, email) =>
  `read -rs "t?Jira token: " && printf '${singleQuoted(formatText(`add-generic-password -U -s ${securityArg(item)} -a ${securityArg(email)} -w `))}%s\\n' "$t" | security -i; unset t; echo`;

// The shell function that makes gh act as a profile's GitHub account in its agents and terminals:
// Kelpie starts them with KELPIE_GH_ACCOUNT (githubEnv in ui.js), and this, in the person's own shell
// setup, asks gh for that account's token for each run (Kelpie can't put it there: a function doesn't
// reach programs, and shell startup puts gh's own folder first in PATH). `gh auth …` and shells
// without the variable run gh as it is. The README's "Several accounts" shows the same lines (a test
// checks they match). zsh and bash; fish needs its own.
export const GH_FUNCTION = `gh() {
  if [ -n "$KELPIE_GH_ACCOUNT" ] && [ "$1" != auth ]; then
    local t
    t=$(command gh auth token --hostname github.com --user "$KELPIE_GH_ACCOUNT") \\
      || { echo "gh isn't signed in as $KELPIE_GH_ACCOUNT: gh auth login" >&2; return 1; }
    GH_TOKEN=$t command gh "$@"
  else
    command gh "$@"
  fi
}`;

const TAB_W = 200;
// The dialog's card in the window it fills (config.js openProfile()): at most `w` wide and `h` tall,
// shrinking to the window less `margin` on each side, so on a laptop (1440×900, zoomed too) Save and
// Cancel stay on screen and the page and the side tabs scroll instead. Exported for the tests.
export const FIT = { w: 820, h: 900, margin: 24 };
// The see-through dark laid over the window around the card, as Herdr dims behind its own dialogs.
const DIM = "#00000080";

// The dialog's side tabs, one section each, in groups (a heading over each but the first). `focus`
// in props may name one (jira, github…). Each tab's second line says what's set (`tabStatus()`).
const TABS = [
  { id: "general", label: "General", icon: own("house") },
  // The board: Jira or a GitHub Project. Its id stays `jira`, as kelpie.edit-profile-jira opens it.
  { id: "jira", label: "Board", icon: chrome("layers"), group: "Connections" },
  { id: "github", label: "GitHub", icon: own("git-pull-request") },
  { id: "web", label: "Web", icon: own("globe") },
  { id: "agents", label: "Agents", icon: own("bot"), group: "Agents" },
  { id: "prompts", label: "Prompts", icon: chrome("file-text") },
  { id: "messages", label: "Messages", icon: own("message-square") },
  { id: "commands", label: "Story commands", icon: chrome("terminal") },
];
// Other names `focus` may give a tab by.
const TAB_ALIAS = { board: "jira", project: "jira" };
// Which tab a check's part is on.
const TAB_OF = { name: "general", jira: "jira", project: "jira", github: "github", "github-shell": "github", web: "web" };
const NOT_PROJECT = "That isn't a GitHub Project's address: https://github.com/users/<you>/projects/<number>, or /orgs/<org>/projects/<number>.";
// A Project as the dialog compares them: the same owner and number is the same Project.
const projectKey = (p) => (p ? `${p.ownerType}/${String(p.owner).toLowerCase()}/${p.number}` : "");
// The messages a review's buttons send (the rest are a pull request's), in config.js ASK_PROMPTS.
const REVIEW_ASKS = ["post", "approve", "changes"];
// The messages What next?'s picks start agents with (an idea, Run all's stories): a group of their own.
const IDEA_ASKS = ["idea", "picked"];
// How long a careful button (Delete, Discard) stays armed for its second press.
const ARMED_MS = 4000;

const keychainAccount = async (item) =>
  (await exec("sh", ["-c", 'security find-generic-password -s "$1" 2>/dev/null | sed -n \'s/^ *"acct"<blob>="\\(.*\\)"$/\\1/p\'', "sh", item])).stdout.trim();

export class Setup {
  init(cx) {
    const space = spaces().find((s) => s.id === props()?.space) ?? null;
    this.space = space;
    this.profile = profileById(props()?.profile) ?? null;
    const saved = this.profile ?? {};
    const folderName = (liveFolder(space) ?? "").replace(/\/+$/, "").split("/").pop() ?? "";
    const field = (value, placeholder) => {
      const input = InputState.new({ value: value ?? "", placeholder });
      input.on("change", (_e, cx) => cx.notify());
      return input;
    };
    this.name = field(saved.name ?? folderName.replace(/^./, (c) => c.toUpperCase()), "What to call it, e.g. the team or client");
    this.folder = field(saved.folder ?? liveFolder(space), "The folder its agents start in; spaces in it belong to it");
    this.board = field(saved.jira?.url, "Paste the board's URL: https://<site>.atlassian.net/jira/software/…/boards/<id>");
    // The board is Jira's or a GitHub Project's, one or the other: Save keeps the one chosen.
    this.boardKind = saved.project && !saved.jira ? "project" : "jira";
    this.projectUrl = field(saved.project?.url, "https://github.com/users/<you>/projects/<n>, or /orgs/<org>/projects/<n>");
    // Each repo's key prefix, an input each (repo, lowercased -> { repo, state }): the saved ones,
    // then the repos a Check finds. Only prefixes other than the repo's own are saved.
    this.prefixes = {};
    let own = {};
    try { own = parsePrefixes(saved.project?.prefixes); } catch { /* a malformed saved value: the inputs start from the repos' own */ }
    for (const [repo, prefix] of Object.entries(own)) this.addPrefix(repo, prefix);
    // What the last Check found ({ key, title, options, … }, project-check.js), for its Project only.
    this.projectFound = null;
    // Sign-in: the macOS Keychain item by default, or a command that prints the token (any system),
    // with the email then saved beside it (a Keychain item keeps its own).
    this.mac = platform() === "macos";
    this.keychain = field(saved.jira?.keychain, "A Keychain item name, e.g. jira-work");
    this.tokenCommand = field(saved.jira?.tokenCommand, this.mac ? "Optional, e.g. op read op://Private/Jira/credential" : "e.g. pass show jira, or secret-tool lookup service jira");
    this.email = field(saved.jira?.tokenCommand ? saved.jira.email : "", "Your Jira email");
    this.owner = field(saved.github?.owner, "An organisation or user, e.g. my-org");
    this.webHome = field(saved.web?.home, "Optional, e.g. your team's chat or a dashboard: https://…");
    this.notifyPulls = saved.notify?.pulls !== false; // on unless turned off
    // The Claude account its new agents use: a config folder, or null for Claude's own ~/.claude.
    this.claudeConfig = saved.claude?.config ?? null;
    this.claudeDirs = [];
    cx.spawn(async (cx) => {
      const dirs = await claudeFolders().catch(() => []);
      if (dirs.length) { this.claudeDirs = dirs; cx.notify(); }
    });
    // The GitHub account Kelpie uses for it: one gh is signed in to, or null for gh's active one.
    this.githubAccount = saved.github?.account ?? null;
    this.githubAccounts = [];
    if (!saved.demo) cx.spawn(async (cx) => {
      const found = await githubAccounts().catch(() => []);
      if (found.length) { this.githubAccounts = found; cx.notify(); }
    });
    // The ticket prompt shows the default until changed; the default itself isn't saved. It, the
    // orchestrator and the handover column belong to whichever board is chosen.
    const board = saved.jira ?? saved.project ?? null;
    this.prompt = TextareaState.new({ value: board?.prompt || DEFAULT_PROMPT });
    this.prompt.set_auto_grow(3, 10);
    this.prompt.on("change", (_e, cx) => cx.notify());
    // The orchestrator prompt is empty unless set: then a story offers "Start orchestrator".
    this.orchestrator = TextareaState.new({ value: board?.orchestrator ?? "", placeholder: "Optional, e.g. Run {key}: {summary} through its subtasks, one agent each:\n{subtasks}" });
    this.orchestrator.set_auto_grow(2, 10);
    this.orchestrator.on("change", (_e, cx) => cx.notify());
    // The review prompt: the default until changed, which isn't saved, as the ticket prompt.
    this.reviewPrompt = TextareaState.new({ value: saved.github?.reviewPrompt || DEFAULT_REVIEW_PROMPT });
    this.reviewPrompt.set_auto_grow(3, 12);
    this.reviewPrompt.on("change", (_e, cx) => cx.notify());
    // The messages pull request buttons send to agents, folded away until opened; defaults aren't saved.
    this.asks = Object.fromEntries(ASK_PROMPTS.map((a) => {
      const state = TextareaState.new({ value: saved.prompts?.[a.id] || a.text });
      state.set_auto_grow(1, 8);
      state.on("change", (_e, cx) => cx.notify());
      return [a.id, state];
    }));
    this.asksOpen = false;
    // The merge prompt, the same way.
    this.mergePrompt = TextareaState.new({ value: saved.github?.mergePrompt || DEFAULT_MERGE_PROMPT });
    this.mergePrompt.set_auto_grow(3, 12);
    this.mergePrompt.on("change", (_e, cx) => cx.notify());
    // The approval prompt, the same way.
    this.approvalPrompt = TextareaState.new({ value: saved.github?.approvalPrompt || DEFAULT_APPROVAL_PROMPT });
    this.approvalPrompt.set_auto_grow(3, 12);
    this.approvalPrompt.on("change", (_e, cx) => cx.notify());
    // Optional story commands, run in the profile's folder ({key}: the story's key).
    // The clean-up command was saved as wrapUp before.
    this.cleanUp = field(saved.commands?.cleanUp ?? saved.commands?.wrapUp, "Optional, e.g. a script that removes worktrees/{key}");
    this.leftovers = field(saved.commands?.leftovers, "Optional, e.g. a script that lists worktrees/{key}");
    // What "Let me configure it for you" starts its Claude with (prompts.configure); the default isn't saved.
    this.configurePrompt = TextareaState.new({ value: saved.prompts?.configure || CONFIGURE_PROMPT });
    this.configurePrompt.set_auto_grow(3, 10);
    this.configurePrompt.on("change", (_e, cx) => cx.notify());
    // What the magic What next? button starts its Claude with (prompts.suggest); the default isn't saved.
    this.suggestPrompt = TextareaState.new({ value: saved.prompts?.suggest || SUGGEST_PROMPT });
    this.suggestPrompt.set_auto_grow(3, 12);
    this.suggestPrompt.on("change", (_e, cx) => cx.notify());
    this.status = field(saved.commands?.status, "Optional, e.g. a script that says whether {key}'s dev server runs");
    // An item that already exists knows the email it signs in with.
    this.keychain.on("blur", (_e, cx) => this.fillEmail(cx));
    // The handover column (a name; none: handoverFrom() picks one), chosen from the board's columns:
    // the ones the stories last loaded, until a Check asks the board itself. For that board only: a
    // Project's are its Status options.
    this.handover = board?.handover ?? null;
    // Whether the person works alone on the board: what the stories past that column wait on.
    this.solo = board?.solo === true;
    // Whether stories offer Move to Done (on unless turned off; saved only when off).
    this.moveToDone = board?.moveToDone !== false;
    // Priority (#122): whether the stories are ordered and marked by it, both off unless set; a
    // Project's comes from the single-select field named here, picked from those a Check finds.
    // `priorityLevels`: the board's levels as a Check found them (Jira's, or the Project's fields').
    this.byPriority = board?.byPriority === true;
    this.showPriority = board?.showPriority === true;
    this.priorityField = saved.project?.priorityField ?? null;
    this.priorityLevels = null;
    const columns = board ? loadedColumns(this.profile) : [];
    this.columns = columns.length && saved.jira ? { site: saved.jira.site, board: saved.jira.board, list: columns } : null;
    this.projectColumns = columns.length && saved.project && !saved.jira ? { key: projectKey(saved.project), list: columns } : null;
    this.checks = {}; // part -> { ok, text, fix }
    this.handle = cx.focus_handle();
    // The side tab shown: a section of the dialog (TABS), the one `focus` asks for, else Profile.
    // `project` opens the Board on the Project's form, unless the profile has a Jira board.
    const focus = TAB_ALIAS[props()?.focus] ?? props()?.focus;
    if (props()?.focus === "project" && !saved.jira) this.boardKind = "project";
    this.tab = TABS.some((x) => x.id === focus) ? focus : "general";
    this.focusTab();
    // Delete or Discard waiting for its second press ({ id, at }); it lapses after ARMED_MS.
    this.armed = null;
    // The Ask Claude menus' state (menuButton's host: a plain object, as `armed` is taken here).
    this.menus = {};
    cx.timer.every(1000, (cx) => { if (this.armed && Date.now() - this.armed.at >= ARMED_MS) { this.armed = null; cx.notify(); } });
    // What the dialog would save as it opened: anything else is an unsaved change.
    this.initial = JSON.stringify(this.draft().profile);
    if (saved.jira?.keychain && !saved.jira?.tokenCommand) this.fillEmail(cx);
  }

  // What signs in to Jira: { keychain } or { tokenCommand, email }, and what's missing, if anything.
  signIn() {
    if (this.profile?.demo) return {}; // the demo's board answers from its fixture (demo.js)
    const tokenCommand = this.tokenCommand.value().trim();
    const email = this.email.value().trim();
    if (tokenCommand && !email) return { missing: "Give the Jira email the token command's token belongs to." };
    if (tokenCommand && !validEmail(email)) return { missing: "That email has a quote, backslash or space in it, which a sign-in can't carry." };
    if (tokenCommand) return { tokenCommand, email };
    const keychain = this.mac ? this.keychain.value().trim() : "";
    if (keychain) return { keychain };
    return { missing: this.mac ? "Name the Keychain item to sign in with, or a token command." : "Give a token command that prints your Jira Cloud API token." };
  }

  fillEmail(cx) {
    const item = this.keychain.value().trim();
    if (!item || !this.mac || this.tokenCommand.value().trim()) return;
    cx.spawn(async (cx) => {
      const account = await keychainAccount(item).catch(() => "");
      if (account && !this.email.value()) { this.email.set_value(account); cx.notify(); }
    });
  }

  // Puts the focus on the shown tab's first field (the dialog itself where it has none), so a hidden
  // field never keeps it and Esc still reaches the dialog.
  focusTab() {
    const first = { general: this.profile ? null : this.name, jira: this.boardKind === "project" ? this.projectUrl : this.board, github: this.owner, web: this.webHome, commands: this.leftovers }[this.tab];
    (first ?? this.handle).focus();
  }

  showTab(id, cx) {
    if (this.tab === id) return;
    this.tab = id;
    this.focusTab();
    cx.notify();
  }

  // A check's outcome; a failed one shows its tab, as Save's checks can fail on a tab not shown.
  // `fix`: a command for the person to run themselves, shown under it to copy.
  result(part, ok, text, cx, fix = null) {
    this.checks[part] = { ok, text, ...(fix ? { fix } : {}) };
    const tab = TAB_OF[part];
    if (ok === false && tab && this.tab !== tab) { this.tab = tab; this.focusTab(); }
    cx.notify();
  }

  checkJira(cx) {
    const parsed = parseBoard(this.board.value(), { demo: Boolean(this.profile?.demo) });
    const { missing, ...signIn } = this.signIn();
    if (!parsed) return this.result("jira", false, "That isn't a Jira Cloud board URL: https://<name>.atlassian.net/…/boards/<number>.", cx);
    if (missing) return this.result("jira", false, missing, cx);
    this.result("jira", null, "Checking…", cx);
    cx.spawn(async (cx) => {
      try {
        const cfg = { ...parsed, ...signIn, ...(this.profile?.demo ? { demo: true } : {}) };
        const [r, config, levels] = await Promise.all([
          jira(cfg, "get", `/rest/agile/1.0/board/${parsed.board}`),
          jira(cfg, "get", `/rest/agile/1.0/board/${parsed.board}/configuration`).catch(() => null),
          jiraPriorities(cfg).catch(() => null),
        ]);
        const list = (config?.body?.columnConfig?.columns ?? []).map((c) => ({ name: c.name, statuses: (c.statuses ?? []).map((x) => x.id) }));
        if (list.length) this.columns = { ...parsed, list };
        this.priorityLevels = { kind: "jira", ...parsed, list: (levels ?? []).map((l) => l.name) };
        this.result("jira", true, `Signed in. Board “${r.body?.name}” (${r.body?.type ?? "board"}${r.body?.location?.projectKey ? `, ${r.body.location.projectKey}` : ""}).`, cx);
      } catch (e) {
        this.result("jira", false, String(e?.message ?? e), cx);
      }
    });
  }

  // A repo's key prefix input, kept once per repo (names compared as GitHub does, ignoring case).
  addPrefix(repo, prefix = null) {
    const key = String(repo).toLowerCase();
    if (this.prefixes[key]) return;
    const state = InputState.new({ value: prefix ?? defaultPrefix(repo) ?? "", placeholder: "A prefix, e.g. WEB" });
    state.on("change", (_e, cx) => cx.notify());
    this.prefixes[key] = { repo, state };
  }

  // Each repo's prefix as typed (else its own), whether it's its own, and what's wrong with it: not
  // one a key can start with, or one an earlier repo has too (keys must say which repo they're in).
  prefixList() {
    const rows = Object.entries(this.prefixes).map(([key, { repo, state }]) => {
      const fallback = defaultPrefix(repo);
      const prefix = state.value().trim().toUpperCase() || fallback;
      const error = !prefix ? "Its name doesn't make a prefix: give it one."
        : !PREFIX.test(prefix) ? "A prefix is a letter, then letters or digits: 2 to 20 of them."
        : null;
      return { key, repo, state, prefix, own: prefix && prefix !== fallback ? prefix : null, error };
    });
    const taken = new Map();
    for (const r of rows.filter((x) => !x.error)) {
      if (taken.has(r.prefix)) r.error = `${taken.get(r.prefix)} has ${r.prefix} too: give one of them its own.`;
      else taken.set(r.prefix, r.repo);
    }
    return rows;
  }

  // Reads the Project as the profile's GitHub account (project-check.js): what it holds, and whether
  // Kelpie may move its tickets. Its repos get a prefix each; its Status options become the columns.
  checkProject(cx) {
    const demo = Boolean(this.profile?.demo);
    const parsed = parseProject(this.projectUrl.value(), { demo });
    if (!parsed) return this.result("project", false, NOT_PROJECT, cx);
    this.result("project", null, "Checking…", cx);
    cx.spawn(async (cx) => {
      try {
        const r = await readProject(parsed, { account: this.githubAccount, demo, name: this.name.value().trim() });
        if (r.project) {
          const key = projectKey(parsed);
          this.projectFound = { key, ...r.project };
          this.priorityLevels = { kind: "project", key, selects: r.project.selects ?? [] };
          for (const repo of r.project.repos) this.addPrefix(repo);
          if (r.project.options.length) this.projectColumns = { key, list: r.project.options.map((o) => ({ name: o.name, statuses: [o.id] })) };
        }
        this.result("project", r.ok, r.text, cx, r.fix);
      } catch (e) {
        this.result("project", false, String(e?.message ?? e), cx);
      }
    });
  }

  checkGithub(cx) {
    const owner = this.owner.value().trim();
    if (!owner) return this.result("github", false, "Name an organisation or user.", cx);
    this.result("github", null, "Checking…", cx);
    cx.spawn(async (cx) => {
      try {
        const mine = await searchPulls(`user:${owner} is:pr is:open author:@me`, { demo: Boolean(this.profile?.demo), account: this.githubAccount });
        const as = this.githubAccount ? ` as ${this.githubAccount}` : "";
        this.result("github", true, `Found. ${mine.length} open pull request${mine.length === 1 ? "" : "s"} of yours${as}.`, cx);
      } catch (e) {
        this.result("github", false, String(e?.message ?? e), cx);
      }
    });
  }

  // Starts the person's shell as an agent's starts, with the account named, and asks GitHub whom its
  // gh acts as (gh-shell-check.sh): whether GH_FUNCTION is in their setup and the account signed in.
  checkShell(cx) {
    const account = this.githubAccount;
    if (!account) return;
    this.result("github-shell", null, "Starting your shell and asking GitHub…", cx);
    cx.spawn(async (cx) => {
      const r = await exec("sh", [modFile("gh-shell-check.sh"), account]).catch(() => ({ code: 1, stdout: "" }));
      const login = (r.stdout ?? "").trim().split("\n").pop()?.trim() ?? "";
      if (login === account) return this.result("github-shell", true, `Set up: gh in this profile's agents and terminals acts as ${account}.`, cx);
      if (login) return this.result("github-shell", false, `Your shell's gh acts as ${login}, not ${account}. Add the function below to your shell setup, then check again.`, cx);
      this.result("github-shell", false, `Your shell's gh didn't answer. Is the function below in your shell setup, and gh signed in to ${account}? (gh auth login)`, cx);
    });
  }

  chooseFolder(cx) {
    cx.spawn(async (cx) => {
      const picked = await pickFolder({ prompt: `Where ${this.name.value().trim() || "this profile"}'s agents start` });
      if (picked) { this.folder.set_value(picked); cx.notify(); }
    });
  }

  // The profile as Save would keep it, and the first thing wrong with it ([part, text]), if anything.
  // Fields this dialog doesn't edit (ones added later, say) are kept.
  draft() {
    const url = this.board.value().trim();
    const parsed = parseBoard(url, { demo: Boolean(this.profile?.demo) });
    const { missing, ...signIn } = this.signIn();
    // A Keychain item stays saved beside a token command, for when the command is taken out again.
    const keychain = this.keychain.value().trim();
    const owner = this.owner.value().trim();
    const prompt = this.prompt.value().trim();
    const orchestrator = this.orchestrator.value().trim();
    const reviewPrompt = this.reviewPrompt.value().trim();
    const mergePrompt = this.mergePrompt.value().trim();
    const approvalPrompt = this.approvalPrompt.value().trim();
    const asks = Object.fromEntries(ASK_PROMPTS.map((a) => [a.id, this.asks[a.id].value().trim()]).filter(([id, v]) => v && v !== ASK_PROMPTS.find((a) => a.id === id).text));
    const commands = { leftovers: this.leftovers.value().trim(), cleanUp: this.cleanUp.value().trim(), status: this.status.value().trim() };
    const configurePrompt = this.configurePrompt.value().trim();
    if (configurePrompt && configurePrompt !== CONFIGURE_PROMPT) asks.configure = configurePrompt;
    const suggestPrompt = this.suggestPrompt.value().trim();
    if (suggestPrompt && suggestPrompt !== SUGGEST_PROMPT) asks.suggest = suggestPrompt;
    const home = this.webHome.value().trim();
    const name = this.name.value().trim();
    const folder = this.folder.value().trim();
    // One board: the one chosen is saved, the other dropped (its fields keep their text until then).
    const onJira = this.boardKind === "jira";
    const projectUrl = this.projectUrl.value().trim();
    const project = onJira ? null : parseProject(projectUrl, { demo: Boolean(this.profile?.demo) });
    const prefixRows = project ? this.prefixList() : [];
    const badPrefix = prefixRows.find((r) => r.error);
    const prefixes = prefixRows.filter((r) => r.own).map((r) => `${r.key}=${r.own}`).join(", ");
    const boardParts = { ...(prompt && prompt !== DEFAULT_PROMPT ? { prompt } : {}), ...(orchestrator ? { orchestrator } : {}), ...(this.handover ? { handover: this.handover } : {}), ...(this.solo ? { solo: true } : {}), ...(this.moveToDone ? {} : { moveToDone: false }), ...(this.byPriority ? { byPriority: true } : {}), ...(this.showPriority ? { showPriority: true } : {}), ...(this.profile?.demo ? { demo: true } : {}) };
    const error = onJira && url && !parsed ? ["jira", "That isn't a Jira Cloud board URL: https://<name>.atlassian.net/…/boards/<number>."]
      : onJira && parsed && missing ? ["jira", missing]
      : !onJira && projectUrl && !project ? ["project", NOT_PROJECT]
      : badPrefix ? ["project", `The key prefix of ${badPrefix.repo}: ${badPrefix.error}`]
      : home && !/^https?:\/\//.test(home) ? ["web", "Start it with https://."]
      : !name ? ["name", "Give it a name."]
      : !folder ? ["name", "Choose its folder: spaces in it belong to it."]
      : null;
    return {
      error,
      profile: {
        ...(this.profile ?? {}),
        name,
        folder,
        jira: onJira && parsed ? { url, ...parsed, keychain, ...(signIn.tokenCommand ? signIn : {}), ...boardParts } : null,
        project: project ? { url: projectUrl, ...project, ...(prefixes ? { prefixes } : {}), ...(this.priorityField ? { priorityField: this.priorityField } : {}), ...boardParts } : null,
        github: owner ? { owner, ...(this.githubAccount ? { account: this.githubAccount } : {}), ...(reviewPrompt && reviewPrompt !== DEFAULT_REVIEW_PROMPT ? { reviewPrompt } : {}), ...(mergePrompt && mergePrompt !== DEFAULT_MERGE_PROMPT ? { mergePrompt } : {}), ...(approvalPrompt && approvalPrompt !== DEFAULT_APPROVAL_PROMPT ? { approvalPrompt } : {}), ...(this.profile?.demo ? { demo: true } : {}) } : null,
        commands: commands.leftovers || commands.cleanUp || commands.status ? commands : null,
        prompts: Object.keys(asks).length ? asks : null,
        notify: { pulls: this.notifyPulls },
        claude: this.claudeConfig ? { config: this.claudeConfig } : null,
        web: home ? { home } : null,
      },
    };
  }

  dirty() {
    return JSON.stringify(this.draft().profile) !== this.initial;
  }

  save(cx) {
    const { error, profile } = this.draft();
    if (error) return this.result(error[0], false, error[1], cx);
    saveProfile(this.profile?.id ?? newProfileId(profile.name), profile);
    closeOverlay(props().overlay);
  }

  // "Let me configure it for you": a new Claude on the Desk sets up `scope` (config.js
  // CONFIGURE_SCOPES) with the person, through the Kelpie plugin. It saves through the profile, so the
  // dialog's changes are saved first (a new profile too) and the dialog closes.
  // Whether the plugin is there is asked in a task of this dialog's, which closes the dialog last;
  // without it, the dialog saying so opens over this one first. A closed dialog's tasks are cancelled,
  // so closing first left the button doing nothing.
  configure(scope, cx, agent = null) {
    const overlay = props().overlay;
    let profile = this.profile;
    if (!profile || this.dirty()) {
      const { error, profile: draft } = this.draft();
      if (error) return this.result(error[0], false, error[1], cx);
      const id = profile?.id ?? newProfileId(draft.name);
      saveProfile(id, draft);
      profile = profileById(id);
    }
    cx.spawn(async () => {
      const ready = await hasPlugin(profile).catch(() => false);
      if (ready) await configureOnDesk(profile, scope, agent);
      else await askPlugin(profile, "configure", scope);
      closeOverlay(overlay);
    });
  }

  // A careful press: the first arms it (the button says what a second does), a second within
  // ARMED_MS does it.
  armedOn(id) {
    return this.armed?.id === id && Date.now() - this.armed.at < ARMED_MS;
  }
  careful(id, action, cx) {
    if (this.armedOn(id)) { this.armed = null; return action(); }
    this.armed = { id, at: Date.now() };
    cx.notify();
  }

  // Esc and Cancel: unsaved changes need a second press, so a stray Esc loses nothing.
  close(cx) {
    if (!this.dirty()) return closeOverlay(props().overlay);
    this.careful("discard", () => closeOverlay(props().overlay), cx);
  }

  // What each tab's second line says: what's set there, at a glance.
  tabStatus(id) {
    const custom = (n) => (n ? `${n} changed` : "Defaults");
    switch (id) {
      case "general": {
        const folder = this.folder.value().trim().replace(/\/+$/, "").split("/").pop();
        return folder || "No folder yet";
      }
      case "agents": return `Claude: ${this.claudeConfig ? this.claudeConfig.replace(/\/+$/, "").split("/").pop() : "default account"}`;
      case "jira": {
        if (this.boardKind === "project") {
          const p = parseProject(this.projectUrl.value(), { demo: Boolean(this.profile?.demo) });
          if (!p) return "Not connected";
          // Its title once a Check or the stories read it, else its owner and number.
          const loaded = projectKey(this.profile?.project) === projectKey(p) ? (shared(STORIES) ?? {})[this.profile.id]?.data?.project?.title : null;
          const title = (this.projectFound?.key === projectKey(p) ? this.projectFound.title : null) || loaded;
          return `GitHub · ${title || `${p.owner}/${p.number}`}`;
        }
        const parsed = parseBoard(this.board.value(), { demo: Boolean(this.profile?.demo) });
        return parsed ? `${parsed.site.replace(/^https:\/\//, "").split(".")[0]} · board ${parsed.board}` : "Not connected";
      }
      case "github": return this.owner.value().trim() ? [this.owner.value().trim(), this.githubAccount && `as ${this.githubAccount}`].filter(Boolean).join(" · ") : "Not connected";
      case "web": {
        const home = this.webHome.value().trim();
        return home ? home.replace(/^https?:\/\//, "").split("/")[0] : "Blank page";
      }
      case "prompts": return custom([
        this.prompt.value().trim() !== DEFAULT_PROMPT, Boolean(this.orchestrator.value().trim()),
        this.reviewPrompt.value().trim() !== DEFAULT_REVIEW_PROMPT, this.mergePrompt.value().trim() !== DEFAULT_MERGE_PROMPT,
        this.approvalPrompt.value().trim() !== DEFAULT_APPROVAL_PROMPT, this.suggestPrompt.value().trim() !== SUGGEST_PROMPT,
      ].filter(Boolean).length);
      case "messages": return custom(ASK_PROMPTS.filter((a) => this.asks[a.id].value().trim() !== a.text).length);
      case "commands": {
        const n = [this.leftovers, this.cleanUp, this.status].filter((f) => f.value().trim()).length;
        return n ? `${n} of 3 set` : "None set";
      }
    }
    return "";
  }

  render(cx) {
    const t = skinTheme();

    // The parts of a tab's page: a heading with what the tab is for, groups of fields under small
    // headings, and fields (a label, the control, a hint under it).
    const hint = (text) => div().pt(6).text_size(SMALL).text_color(t.dim).child(text);
    // Lines to run or paste, with Copy.
    const codeBlock = (id, code) => h_flex().p(8).gap(8).items_start().rounded(8).bg(t.background).border_1().border_color(t.border)
      .child(v_flex().flex_1().min_w(0).text_size(SMALL).text_color(t.muted).children(String(code).split("\n").map((l) => div().child(l.replace(/^ +/, (s) => "\u00a0".repeat(s.length)) || "\u00a0"))))
      .child(textButton(t, `${id}-copy`, "Copy", (_e, cx) => cx.write_to_clipboard(code)));
    // A step of a guide: what to do, then the lines to run or paste, with Copy.
    const step = (id, text, code) => v_flex().pt(DIALOG.section)
      .child(div().pb(6).text_size(SMALL).text_color(t.dim).child(text))
      .when(Boolean(code), (el) => el.child(codeBlock(id, code)));
    const input = (state) => Input.new(state).h(34).px(10).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(TEXT).text_color(t.foreground);
    const textarea = (state) => Textarea.new(state).px(10).py(8).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(TEXT).text_color(t.foreground);
    const row = (...children) => h_flex().gap(8).items_center().children(children.filter(Boolean));
    const grow = (el) => div().flex_1().min_w(0).child(el);
    const check = (part) => {
      const c = this.checks[part];
      if (!c) return null;
      const said = div().pt(DIALOG.gap).text_size(SMALL).text_color(c.ok === true ? t.done : c.ok === false ? t.blocked : t.dim).child(c.text);
      return c.fix ? v_flex().child(said).child(div().pt(6).child(codeBlock(`setup-${part}-fix`, c.fix))) : said;
    };
    // "Ask Claude" for one scope (CONFIGURE_SCOPES): a Claude on the Desk sets it up with you, a new
    // one or, from a menu while the Desk has Claudes open (not one waiting for your answer), one of those.
    const saving = this.dirty() || !this.profile;
    const askTip = saving ? "Saves this profile, then asks a Claude on its Desk to set this up with you" : "Asks a Claude on the Desk to set this up with you";
    const open = this.profile ? deskAgents(this.profile).filter((a) => a.status !== "blocked") : [];
    const names = agentLabels(open, spaces().flatMap((s) => s.tabs ?? []));
    const askRows = (scope) => [
      { header: `Set up ${CONFIGURE_SCOPES[scope] ?? scope} with` },
      { label: "New agent", hint: "on the Desk", action: (cx) => this.configure(scope, cx) },
      { header: "Or send it to the Desk's" },
      ...open.map((a) => ({ label: names.get(a.address) ?? a.tab_name ?? "Claude", hint: a.status === "working" ? "working" : "", action: (cx) => this.configure(scope, cx, a) })),
    ];
    const ask = (scope, label = "Ask Claude") => open.length
      ? menuButton(this.menus, t, `setup-ask-${scope}`, label, askRows(scope), { tip: askTip, dim: true, width: 340 })
      : textButton(t, `setup-ask-${scope}`, label, (_e, cx) => this.configure(scope, cx), { dim: true, tip: askTip });
    // "Let me configure it for you": everything at once, a quiet button at the start of the Save row.
    const configureButton = (id, action) => textButton(t, id, "Let me configure it for you", action, { tip: askTip, lead: div().text_color(t.accent).child(icon(own("message-square"))) });
    // A page's heading: its title (with Set up with Claude for the whole page) and what it's for.
    const page = (title, about, scope = this.tab) => v_flex().pb(4).gap(4)
      .child(h_flex().items_center().gap(8)
        .child(div().flex_1().min_w(0).text_size(TITLE).font_semibold().child(title))
        .child(ask(scope, "Set up with Claude")))
      .child(div().text_size(SMALL).text_color(t.dim).child(about));
    const group = (title, note, scope) => v_flex().pt(28).gap(2)
      .child(h_flex().pb(6).min_h(20).border_b_1().border_color(t.border).items_center().gap(8)
        .child(div().flex_1().min_w(0).text_size(TEXT).font_medium().child(title))
        .when(Boolean(note), (el) => el.child(div().min_w(0).text_size(SMALL).text_color(t.dim).child(note)))
        .when(Boolean(scope), (el) => el.child(ask(scope))));
    // A field: its label (with a Reset at the right when `reset` is given, and Ask Claude for a
    // `scope`), the control, a hint.
    const field = (label, control, about, reset, scope) => v_flex().pt(DIALOG.section)
      .child(h_flex().pb(6).items_center().min_h(20)
        .child(div().flex_1().text_size(SMALL).font_medium().text_color(t.muted).child(label))
        .when(Boolean(reset), (el) => el.child(textButton(t, reset?.id ?? "x", "Reset to default", reset?.action, { dim: true })))
        .when(Boolean(scope), (el) => el.child(ask(scope))))
      .child(control)
      .when(Boolean(about), (el) => el.child(hint(about)));
    // A prompt kept as its default until changed: Reset shows once it differs.
    const promptField = (id, label, state, fallback, about) => field(label, textarea(state), about,
      state.value().trim() !== fallback ? { id: `setup-${id}-reset`, action: (_e, cx) => { state.set_value(fallback); cx.notify(); } } : null);
    // An on/off switch, the whole row clickable.
    const toggle = (id, label, on, action, about) => h_flex().id(id).pt(DIALOG.section).gap(16).items_start().cursor_pointer().on_click(action)
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(TEXT).child(label))
        .when(Boolean(about), (el) => el.child(div().text_size(SMALL).text_color(t.dim).child(about))))
      .child(h_flex().flex_none().mt(1).w(34).h(20).p(2).rounded_full().bg(on ? t.accent : t.border).when(on, (el) => el.justify_end())
        .child(div().size(16).rounded_full().bg(on ? t.accent_foreground : t.muted)));
    // A choice of a few, as one row of quiet buttons with the chosen one lit.
    const choice = (id, options, pick) => h_flex().flex_wrap().gap(4)
      .children(options.map((o, i) => textButton(t, `${id}-${i}`, o.label, (_e, cx) => { pick(o.value); cx.notify(); }, { on: o.on, tip: o.tip })));

    const item = this.keychain.value().trim() || "<keychain item>";
    const email = this.email.value().trim() || "<jira email>";
    const tokenCommand = this.tokenCommand.value().trim();
    // The handover choice shows once the board in the field is the one whose columns are known.
    // For a Project, its Status options, once a Check or the stories read them for this Project.
    const onJira = this.boardKind === "jira";
    const parsed = parseBoard(this.board.value(), { demo: Boolean(this.profile?.demo) });
    const project = parseProject(this.projectUrl.value(), { demo: Boolean(this.profile?.demo) });
    const columns = onJira
      ? (this.columns && parsed?.site === this.columns.site && parsed?.board === this.columns.board ? this.columns.list : null)
      : (project && this.projectColumns?.key === projectKey(project) ? this.projectColumns.list : null);
    const from = columns ? handoverFrom(columns, this.handover) : -1;
    // Claude accounts by folder name; a saved folder no longer found still shows, so it can be changed.
    const dirName = (d) => d.replace(/\/+$/, "").split("/").pop();
    const dirs = [...new Set([...this.claudeDirs, ...[this.claudeConfig].filter(Boolean)])].filter((d) => !isOwnClaude(d));
    // GitHub accounts gh knows; a saved one no longer signed in still shows, so it can be changed.
    const ghAccounts = [...new Set([...this.githubAccounts, ...[this.githubAccount].filter(Boolean)])];
    const hasBoard = Boolean(onJira ? parsed : project), hasGithub = Boolean(this.owner.value().trim());
    const dirty = this.dirty();
    const fields = (list) => `Fills in ${list.map((f) => `{${f}}`).join(" ")}.`;

    // The Board page's form for Jira: the board's address and how to sign in.
    const jiraForm = () => [
      field("Board URL", input(this.board), "Open the board in Jira and copy the address: it ends in /boards/<number>."),
      group("Sign in", null, "jira-signin"),
      this.mac && field("Keychain item", input(this.keychain), "Where the API token is kept on this Mac."),
      field(this.mac ? "Or a token command" : "Token command", input(this.tokenCommand),
        `A shell command that prints the API token, from a password manager (op read …, pass …, secret-tool lookup …). It runs for each request${this.mac ? ", instead of the Keychain when set" : ""}; the token only goes to curl, through a pipe.`),
      field(tokenCommand ? "Jira email" : "Jira email, for storing the token", input(this.email), null),
      this.mac && !tokenCommand && v_flex().pt(DIALOG.section)
        .child(div().pb(6).text_size(SMALL).text_color(t.dim).child("No token stored yet? Make one at id.atlassian.com → Security → API tokens, then run this in a zsh terminal (the Mac's default shell) and paste it at the prompt:"))
        .child(h_flex().p(8).gap(8).items_center().rounded(8).bg(t.background).border_1().border_color(t.border)
          .child(div().flex_1().min_w(0).text_size(SMALL).text_color(t.muted).child(storeCommand(item, email)))
          .child(textButton(t, "setup-copy", "Copy", (_e, cx) => cx.write_to_clipboard(storeCommand(item, email))))),
      h_flex().pt(DIALOG.section).gap(DIALOG.gap).items_center()
        .child(textButton(t, "setup-jira-check", "Check connection", (_e, cx) => this.checkJira(cx), { tip: "Signs in and reads the board" })),
      check("jira"),
    ];
    // The Board page's form for a GitHub Project: its address, read as the profile's GitHub account
    // (no sign-in of its own), then each repo's key prefix.
    const who = this.githubAccount ? `the GitHub account ${this.githubAccount} (set on the GitHub page)` : "the GitHub account you're signed in to with gh (the GitHub page can name another)";
    const prefixRows = this.prefixList();
    const example = prefixRows.find((r) => !r.error)?.prefix ?? "WEB";
    const projectForm = () => [
      field("Project address", row(grow(input(this.projectUrl)), textButton(t, "setup-project-check", "Check", (_e, cx) => this.checkProject(cx), { tip: "Reads the Project and what Kelpie may do there" })),
        `Open the Project on GitHub and copy its address. Kelpie reads it as ${who}.`),
      check("project"),
      group("Ticket keys"),
      prefixRows.length
        ? v_flex().children(prefixRows.map((r) => v_flex().pt(DIALOG.gap)
          .child(row(div().flex_1().min_w(0).truncate().text_size(TEXT).child(r.repo), div().w(160).flex_none().child(input(r.state))))
          .when(Boolean(r.error), (el) => el.child(div().pt(4).text_size(SMALL).text_color(t.blocked).child(r.error)))))
        : null,
      hint(prefixRows.length
        ? `An issue's key is its repo's prefix and its number, like ${example}-42, and names its space and ticket folder. A prefix is a letter, then letters or digits; change one to make keys shorter.`
        : "Check the Project to list its repos and the key prefix each gives its issues."),
    ];

    // The Board page's priority settings (#122): where a Project's comes from (one of its single-select
    // fields, as a Check lists them), the levels the board has, and whether the list orders and marks
    // stories by it. Both off: the board's order, nothing shown.
    const priorityPart = () => {
      const found = this.priorityLevels;
      const selects = !onJira && found?.kind === "project" && project && found.key === projectKey(project) ? found.selects : null;
      const jiraLevels = onJira && found?.kind === "jira" && parsed && found.site === parsed.site && found.board === parsed.board ? found.list : null;
      const named = selects?.find((f) => f.name === this.priorityField) ?? null;
      const levels = onJira ? jiraLevels : named?.levels ?? null;
      // Said only while it's asked for: with nothing to go by, ordering and marks do nothing.
      const none = (this.byPriority || this.showPriority) && (onJira ? Boolean(jiraLevels) && !jiraLevels.length : !this.priorityField);
      const fieldPick = onJira ? null : selects?.length || this.priorityField
        ? field("Priority field", choice("setup-priority-field", [
          { label: "None", value: null, on: !this.priorityField, tip: "Its tickets have no priority" },
          ...[...new Set([...(selects ?? []).map((f) => f.name), ...[this.priorityField].filter(Boolean)])].map((n) => ({ label: n, value: n, on: this.priorityField === n })),
        ], (v) => { this.priorityField = v; }), "The Project's single-select field that holds a ticket's priority: its options, top to bottom, are the levels, highest first.")
        : hint(selects ? "This Project has no single-select field besides Status, so its tickets have no priority. Add one on GitHub (Priority, say) and check again." : "Check the Project to choose the field its tickets' priority is in.");
      return [
        group("Priority"),
        fieldPick,
        levels?.length ? hint(`Its levels, highest first: ${levels.join(", ")}.`) : onJira && !jiraLevels ? hint("Check the connection to see the site's priority levels.") : null,
        none ? hint(onJira ? "Jira gave no priority levels for this site, so there's nothing to order or show." : "Without a priority field there's nothing to order or show.") : null,
        toggle("setup-by-priority", "Order stories by priority", this.byPriority, (_e, cx) => { this.byPriority = !this.byPriority; cx.notify(); },
          this.byPriority ? "In each group, the highest priority first, then the board's order; tickets with none come last. What needs you still comes first." : "Off: stories keep the board's order (what needs you first)."),
        toggle("setup-show-priority", "Show priority", this.showPriority, (_e, cx) => { this.showPriority = !this.showPriority; cx.notify(); },
          this.showPriority ? "A small mark after each ticket's key: up for the levels above the middle, the highest in amber, down for those below; the middle level shows none." : "Off: no priority marks on the rows."),
      ];
    };

    const pages = {
      general: () => [
        page("General", "A piece of work with its own folder, and maybe a board: every space opened in its folder belongs to it, and each story you start becomes a space of its own."),
        field("Name", input(this.name), null),
        check("name"),
        field("Folder", row(grow(input(this.folder)), textButton(t, "setup-folder-pick", "Choose…", (_e, cx) => this.chooseFolder(cx))),
          "Its agents start here and its Claude sessions show; spaces opened in it, or under it, belong to this profile."),
        // Deleting sits at the end of its own page, far from Save and Let me configure it for you.
        this.profile ? group("Delete profile", null) : null,
        this.profile ? h_flex().pt(DIALOG.gap).gap(DIALOG.gap).items_center()
          .child(div().flex_1().min_w(0).text_size(SMALL).text_color(t.dim).child("Removes this profile from Kelpie. Its folder and what's in it stay."))
          .child(this.armedOn("delete")
            ? primaryButton(t, "setup-remove", `Delete ${this.profile.name}`, (_e, cx) => this.careful("delete", () => { saveProfile(this.profile.id, null); closeOverlay(props().overlay); }, cx)).bg(t.blocked)
            : textButton(t, "setup-remove", "Delete profile", (_e, cx) => this.careful("delete", () => {}, cx), { tip: "Asks once more" })) : null,
      ],

      agents: () => [
        page("Agents", "The accounts this profile's agents run on, so work and personal accounts stay apart."),
        group("Claude", null, "claude"),
        field("Claude account", choice("setup-claude", [
          { label: "Default", value: null, on: !this.claudeConfig, tip: "Claude's own folder, ~/.claude" },
          ...dirs.map((d) => ({ label: dirName(d), value: d, on: this.claudeConfig === d, tip: d })),
        ], (v) => { this.claudeConfig = v; }), "The Claude config folder this profile's new agents use (as CLAUDE_CONFIG_DIR): its agents, What next? and its terminals, where a claude you type uses it too. Lists your ~/.claude* folders that have a settings.json or projects/. Resuming a session keeps the account it ran on."),
        group("Another Claude account"),
        step("setup-claude-new", "Give it a config folder of its own and sign in there once, in a terminal. Then open this page again: the folder is listed above.",
          `CLAUDE_CONFIG_DIR=~/.claude-${this.profile?.id ?? "work"} claude`),
        step("setup-claude-limits", "For its usage limits in the footer, add this to that folder's settings.json (a word after the path names the account there):",
          `"statusLine": { "type": "command", "command": "sh ${modFile("claude-statusline.sh")}" }`),
        step("setup-claude-plugin", "Kelpie's Claude Code plugin goes on each account a profile uses: Kelpie offers to install it the first time it's needed (Let me configure it for you, What next?)."),
        step("setup-claude-shell", "Does your own shell pick a Claude account, by folder say (a claude function of yours)? Have it leave the choice alone when CLAUDE_ACCOUNT_CHOSEN is set: Kelpie's terminals set it, with the profile's account already chosen."),
      ],

      // The board: which kind, then that kind's form, then your part (either board's).
      jira: () => [
        page("Board", onJira
          ? "The board its stories come from: your part of its active sprints, or of a Kanban board's open work. Jira Cloud only (an atlassian.net site)."
          : "The GitHub Project its stories come from: your issues in its current iteration, or in all of its open work when it has no iteration field. On github.com.",
        onJira ? "jira" : "project"),
        field("Where its stories come from", choice("setup-board-kind", [
          { label: "Jira", value: "jira", on: onJira, tip: "A board on a Jira Cloud site" },
          { label: "GitHub Project", value: "project", on: !onJira, tip: "A Project on github.com, its issues as tickets" },
        ], (v) => { this.boardKind = v; this.focusTab(); }),
        onJira ? (this.projectUrl.value().trim() ? "A profile has one board: saving drops the GitHub Project." : null)
          : (this.board.value().trim() ? "A profile has one board: saving drops the Jira board." : null)),
        ...(onJira ? jiraForm() : projectForm()),
        group("Your part", null, "handover"),
        columns
          ? field("Done from column", choice("setup-handover", columns.map((c, i) => ({ label: c.name, value: c.name, on: i === from })), (v) => { this.handover = v; }),
            `A story whose subtasks of yours are all in ${columns[from]?.name ?? "it"} or further right ${this.solo ? "is yours to check" : "waits on others"}: it sinks to the end of your list.${this.handover ? "" : " Not chosen: the first testing column, else the board's last."}`,
            this.handover ? { id: "setup-handover-reset", action: (_e, cx) => { this.handover = null; cx.notify(); } } : null)
          : hint(onJira ? "Check the connection to choose the column where your part of a story is done." : "Check the Project to choose the column where your part of a story is done."),
        toggle("setup-solo", "I work alone", this.solo, (_e, cx) => { this.solo = !this.solo; cx.notify(); },
          this.solo ? `Nobody else has the stories past your part, so the list doesn't say they wait on others: they're under "${sunkWords({ cfg: { solo: true } }).heading}".` : "Off: the stories past your part are listed as waiting on others."),
        toggle("setup-move-to-done", "Move to Done", this.moveToDone, (_e, cx) => { this.moveToDone = !this.moveToDone; cx.notify(); },
          this.moveToDone ? "A double check in the story's header, and on each story past your part in the list, moves your subtasks and then the story to the board's last column in one go." : "Off: tickets move only one at a time, from their status chips."),
        ...priorityPart(),
      ],

      github: () => [
        page("GitHub", "The owner whose pull requests show, yours and the ones waiting on your review, through gh."),
        field("Owner", row(grow(input(this.owner)), textButton(t, "setup-github-check", "Check", (_e, cx) => this.checkGithub(cx), { tip: "Looks for your open pull requests there" })),
          "An organisation or a user."),
        check("github"),
        field("GitHub account", choice("setup-github-account", [
          { label: "Default", value: null, on: !this.githubAccount, tip: "The account gh has active" },
          ...ghAccounts.map((a) => ({ label: a, value: a, on: this.githubAccount === a })),
        ], (v) => { this.githubAccount = v; delete this.checks["github-shell"]; }), "Who Kelpie is on GitHub for this profile: whose pull requests show, and who approves. Lists the accounts gh is signed in to (gh auth login adds one). Default follows gh's active account, which another sign-in can change: keep your main account active (gh auth switch), and pick the others here."),
        this.githubAccount && v_flex().pt(DIALOG.section)
          .child(div().pb(6).text_size(SMALL).text_color(t.dim).child(`For agents and terminals too: Kelpie starts them with KELPIE_GH_ACCOUNT=${this.githubAccount}. Add this to your shell setup once (~/.zshrc, or for bash ~/.bashrc, with your ~/.bash_profile reading it), and the gh they run acts as that account. Agents started before it, and sessions resumed since, may still run without it: start a new one.`))
          .child(h_flex().p(8).gap(8).items_start().rounded(8).bg(t.background).border_1().border_color(t.border)
            .child(v_flex().flex_1().min_w(0).text_size(SMALL).text_color(t.muted).children(GH_FUNCTION.split("\n").map((l) => div().child(l.replace(/^ +/, (s) => "\u00a0".repeat(s.length)) || "\u00a0"))))
            .child(textButton(t, "setup-gh-copy", "Copy", (_e, cx) => cx.write_to_clipboard(GH_FUNCTION))))
          .child(h_flex().pt(DIALOG.gap).gap(DIALOG.gap).items_center()
            .child(textButton(t, "setup-gh-shell-check", "Check my shell", (_e, cx) => this.checkShell(cx), { tip: "Starts your shell as an agent's starts and asks GitHub who its gh is" })))
          .child(check("github-shell") ?? div()),
        toggle("setup-notify-pulls", "Notify about pull requests", this.notifyPulls, (_e, cx) => { this.notifyPulls = !this.notifyPulls; cx.notify(); },
          "When one of yours starts failing its checks, gets changes requested, or becomes ready to merge. Agents that need you notify anyway."),
      ],

      web: () => [
        page("Web", "The Web panel's browser: each profile has its own, with its own tabs and sign-ins kept while it runs."),
        field("Start page", input(this.webHome), "Opens when the profile's browser starts. Empty: a blank page."),
        check("web"),
      ],

      prompts: () => [
        page("Prompts", "The first message each kind of agent gets. Each starts as a default; Reset brings it back."),
        group("Stories", hasBoard ? null : "Saved once a board is connected"),
        promptField("prompt", "Agent started on a ticket", this.prompt, DEFAULT_PROMPT,
          `${fields(PROMPT_FIELDS)} {parent} is the story a subtask belongs to; {subtasks} lists a story's subtasks, a line each.`),
        field("Orchestrator", textarea(this.orchestrator), "For one agent that runs a whole story through its subtasks. When set, a story's More menu offers Start orchestrator; the same placeholders."),
        group("Pull requests", hasGithub ? null : "Saved once GitHub is connected"),
        promptField("review", "Review", this.reviewPrompt, DEFAULT_REVIEW_PROMPT,
          `Start review checks the pull request out in its own worktree (worktrees/review-<repo>-<number> under the profile's folder) and starts the agent in the profile's folder, pointed at the checkout to read, as it's someone else's code. ${fields(REVIEW_FIELDS)} {folder} is the checkout; {ticket}, {summary} and {description} the ticket its title names.`),
        promptField("merge", "Merge", this.mergePrompt, DEFAULT_MERGE_PROMPT,
          `The Merge icon on a story, in its header and on its row in the list: a new agent in the story's space, or a Claude already open there. ${fields(MERGE_FIELDS)} {prs} is a line per open pull request of yours on the story.`),
        promptField("approval", "Request approval", this.approvalPrompt, DEFAULT_APPROVAL_PROMPT,
          "The icon beside Merge while a pull request isn't approved yet. The same placeholders; {prs} only the ones not approved."),
        group("Next", hasBoard ? null : "Shown once a board is connected"),
        promptField("suggest", "What next?", this.suggestPrompt, SUGGEST_PROMPT,
          "The magic button in Next: Claude looks around in the background, reading only, with no tab of its own, and fills Next with what to do. {snapshot} is what the list knows (sprints, stories, subtasks, pull requests, reviews, agents); {board} the board's address; {owner} the GitHub owner; {name} the profile's. However this is worded, Kelpie asks for the picks itself, through its Claude Code plugin. Say here what kind of work you pick up (frontend, say)."),
        hint("A line whose placeholders all come out empty is left out."),
      ],

      messages: () => [
        page("Messages", "What a button sends to an agent. A pull request's buttons send to its agent, or start one with it when none is open; {prs} is the pull request's link, several joined by \"and\"."),
        group("Your pull requests"),
        ...ASK_PROMPTS.filter((a) => !REVIEW_ASKS.includes(a.id) && !IDEA_ASKS.includes(a.id)).map((a) => promptField(`ask-${a.id}`, a.label, this.asks[a.id], a.text, null)),
        group("Reviews", "Nothing is posted until you press one"),
        ...ASK_PROMPTS.filter((a) => REVIEW_ASKS.includes(a.id)).map((a) => promptField(`ask-${a.id}`, a.label.replace(/ \(review\)$/, ""), this.asks[a.id], a.text, null)),
        group("What next?"),
        ...ASK_PROMPTS.filter((a) => IDEA_ASKS.includes(a.id)).map((a) => (a.id === "idea"
          ? promptField(`ask-${a.id}`, "Start an idea", this.asks[a.id], a.text,
            "A click on one of Claude's improvement ideas in Next starts a Claude on the Desk with this. {idea} is Claude's brief, {where} the file or area, {why} why it pays off.")
          : promptField(`ask-${a.id}`, "Run a pick", this.asks[a.id], a.text,
            "Run all in Next starts each of Claude's picks in its own agent: this follows the ticket prompt in its first message. {action} is what Claude suggests, {why} why now."))),
        group("Setup"),
        promptField("configure", "Let me configure it for you", this.configurePrompt, CONFIGURE_PROMPT,
          "What a Set up with Claude or Ask Claude button starts a Claude on the Desk with. {name} and {id} are the profile's, {scope} and {about} what to set up, {home} Herdr's folder. Kelpie's Claude Code plugin does the rest."),
      ],

      commands: () => [
        page("Story commands", "Optional shell commands, run in the profile's folder. {key} is a ticket key: the finished stories' commands run once for the story and once for each of its subtasks, the status command for the story."),
        group("Finished stories"),
        field("Leftovers check", input(this.leftovers), "Prints what a finished story left behind (its worktrees, say), one human-readable line each, as the clean-up dialog lists them; nothing printed: nothing to clean. Runs every few minutes for each key of a finished story, 10 seconds at most each. Empty: a folder named after one of its keys in the profile's folder, or one level down, counts.", null, "leftovers"),
        field("Clean-up command", input(this.cleanUp), "Removes what the leftovers check finds: a finished story's broom shows while there's some, and runs this after closing its space, for each key something was found under. Its last line shows in the story's details.", null, "cleanUp"),
        group("Stories in progress"),
        field("Status command", input(this.status), "While a story has a space, its details show the first line this prints (a dev server's state, say), refreshed with the stories and every few minutes. It gets 4 seconds.", null, "status"),
      ],
    };

    const tabRow = (x) => {
      const on = this.tab === x.id;
      const failed = Object.entries(this.checks).some(([part, c]) => c.ok === false && TAB_OF[part] === x.id);
      return h_flex().id(`setup-tab-${x.id}`).px(10).py(6).gap(10).items_center().rounded(8).cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(on ? t.selected : t.hover))
        .on_click((_e, cx) => this.showTab(x.id, cx))
        .child(div().flex_none().text_color(on ? t.foreground : t.dim).child(icon(x.icon)))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(TEXT).font_medium().text_color(on ? t.foreground : t.muted).child(x.label))
          .child(div().truncate().text_size(SMALL).text_color(t.dim).child(this.tabStatus(x.id))))
        .when(failed, (el) => el.child(div().size(6).flex_none().rounded_full().bg(t.blocked)));
    };
    const discarding = this.armedOn("discard");

    // The window, then the card in its middle (FIT): the card is the dialog's frame. With no frame
    // Herdr dims nothing (the dialog is the whole window), so the window around the card is dimmed here.
    return div().id("work-setup-fit").size_full().bg(DIM).flex().items_center().justify_center().p(FIT.margin).child(v_flex().id("work-setup").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.close(cx); cx.stop_propagation(); } })
      .w_full().max_w(FIT.w).h_full().max_h(FIT.h).min_h(0).overflow_hidden().rounded(12).border_1().border_color(t.border).shadow_lg()
      .bg(t.popover).text_color(t.foreground).text_size(TEXT)
      .child(h_flex().flex_1().min_h(0)
        // The side: the profile's name over its tabs, which scroll when the window is short.
        .child(v_flex().w(TAB_W).flex_none().h_full().min_h(0).rounded_tl(11).bg(t.background).border_r_1().border_color(t.border)
          .child(v_flex().id("setup-tabs").flex_1().min_h(0).p(DIALOG.gap).pt(DIALOG.pad).gap(2).overflow_y_scrollbar()
            .child(v_flex().px(10).pb(DIALOG.section).gap(2)
              .child(div().text_size(SMALL).text_color(t.dim).child(this.profile ? "Profile" : "New profile"))
              .child(div().truncate().text_size(TITLE).font_semibold().child(this.name.value().trim() || "Untitled")))
            .children(TABS.flatMap((x) => [
              x.group ? div().px(10).pt(DIALOG.section).pb(4).text_size(SMALL).font_medium().text_color(t.dim).child(x.group) : null,
              tabRow(x),
            ].filter(Boolean)))))
        // The shown tab's page; its own scroll, from the top on each tab.
        .child(v_flex().id(`work-setup-body-${this.tab}`).flex_1().min_w(0).h_full().min_h(0).px(DIALOG.pad + 8).pt(DIALOG.pad).pb(DIALOG.pad + 8).overflow_y_scrollbar()
          .children(pages[this.tab]().filter(Boolean))))
      // Let me configure it for you, then Save and Cancel: outside both scrolls, always on screen.
      .child(h_flex().flex_none().px(DIALOG.pad).py(12).gap(DIALOG.gap).items_center().border_t_1().border_color(t.border)
        .child(open.length
          ? menuButton(this.menus, t, "setup-configure-all", "", askRows("all"), { anchor: "bottom_left", width: 340, trigger: (toggle) => configureButton("setup-configure-all-more", toggle) })
          : configureButton("setup-configure-all", (_e, cx) => this.configure("all", cx)))
        .child(div().flex_1())
        .when(dirty || discarding, (el) => el.child(h_flex().gap(6).items_center().text_size(SMALL).text_color(discarding ? t.working : t.dim)
          .child(div().size(6).rounded_full().bg(t.working))
          .child(discarding ? "Press again to discard your changes" : "Unsaved changes")))
        .child(textButton(t, "setup-cancel", discarding ? "Discard" : "Cancel", (_e, cx) => this.close(cx), { tip: "Esc" }))
        .child(primaryButton(t, "setup-save", "Save", (_e, cx) => this.save(cx)))));
  }
}
