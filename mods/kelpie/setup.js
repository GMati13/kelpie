// A profile, as a dialog (props: { profile, space, overlay, focus }): its name, the folder its agents
// start in (spaces in it belong to it), its Jira Cloud board (a pasted board URL and how to sign in:
// a Keychain item on macOS, or a command that prints the API token, with the email; the prompts, and
// the column where your part of a ticket is done),
// its GitHub owner (and whether its pull requests notify), its Claude account (and the machine's default one) and its optional story commands. No profile id: a new one, starting from
// the space's folder. Each part has a check that asks the service; Save keeps it in shared state
// (config.js).

import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, Textarea, TextareaState } from "gpui-base";
import { closeOverlay, exec, pickFolder, props, setShared, shared, spaces } from "herdr";
import { skinTheme } from "./skins/index.js";
import { DIALOG, SMALL, TEXT, TITLE, agentLabels, chrome, icon, menuButton, own, platform, primaryButton, textButton } from "./ui.js";
import { deskAgents } from "./desk.js";
import { ASK_PROMPTS, validEmail, CONFIGURE_PROMPT, SUGGEST_PROMPT, CONFIGURE_SCOPES, configureOnDesk, DEFAULT_APPROVAL_PROMPT, DEFAULT_MERGE_PROMPT, DEFAULT_PROMPT, DEFAULT_REVIEW_PROMPT, MERGE_FIELDS, PROMPT_FIELDS, REVIEW_FIELDS, claudeFolders, isOwnClaude, handoverFrom, liveFolder, loadedColumns, newProfileId, parseBoard, profileById, saveProfile } from "./config.js";

import { jira } from "./sprint.js";
import { searchPulls } from "./pulls.js";


// Stores a token without the 128-character limit of `security`'s own prompt, and without it ever
// being on a command line: zsh reads it hidden, `security -i` takes the command on stdin. The item
// and email are quoted for each reader in turn: `security -i` (double quotes), printf's format
// (`%%`, doubled backslashes), then the shell's single quotes.
const securityArg = (s) => `"${s.replace(/["\\]/g, "\\$&")}"`;
const formatText = (s) => s.replace(/\\/g, "\\\\").replace(/%/g, "%%");
const singleQuoted = (s) => s.replace(/'/g, "'\\''");
const storeCommand = (item, email) =>
  `read -rs "t?Jira token: " && printf '${singleQuoted(formatText(`add-generic-password -U -s ${securityArg(item)} -a ${securityArg(email)} -w `))}%s\\n' "$t" | security -i; unset t; echo`;

const TAB_W = 200;

// The dialog's side tabs, one section each, in groups (a heading over each but the first). `focus`
// in props may name one (jira, github…). Each tab's second line says what's set (`tabStatus()`).
const TABS = [
  { id: "general", label: "General", icon: own("house") },
  { id: "jira", label: "Jira", icon: chrome("layers"), group: "Connections" },
  { id: "github", label: "GitHub", icon: own("git-pull-request") },
  { id: "web", label: "Web", icon: own("globe") },
  { id: "prompts", label: "Prompts", icon: chrome("file-text"), group: "Agents" },
  { id: "messages", label: "Messages", icon: own("message-square") },
  { id: "commands", label: "Story commands", icon: chrome("terminal") },
];
// Which tab a check's part is on.
const TAB_OF = { name: "general", jira: "jira", github: "github", web: "web" };
// The messages a review's buttons send (the rest are a pull request's), in config.js ASK_PROMPTS.
const REVIEW_ASKS = ["post", "approve", "changes"];
// The message a What next? idea starts its Desk agent with: in a group of its own.
const IDEA_ASKS = ["idea"];
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
    // The ticket prompt shows the default until changed; the default itself isn't saved.
    this.prompt = TextareaState.new({ value: saved.jira?.prompt || DEFAULT_PROMPT });
    this.prompt.set_auto_grow(3, 10);
    this.prompt.on("change", (_e, cx) => cx.notify());
    // The orchestrator prompt is empty unless set: then a story offers "Start orchestrator".
    this.orchestrator = TextareaState.new({ value: saved.jira?.orchestrator ?? "", placeholder: "Optional, e.g. Run {key}: {summary} through its subtasks, one agent each:\n{subtasks}" });
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
    // the ones the stories last loaded, until a Check asks the board itself. For that board only.
    this.handover = saved.jira?.handover ?? null;
    const columns = saved.jira ? loadedColumns(this.profile) : [];
    this.columns = columns.length ? { site: saved.jira.site, board: saved.jira.board, list: columns } : null;
    this.checks = {}; // part -> { ok, text }
    this.handle = cx.focus_handle();
    // The side tab shown: a section of the dialog (TABS), the one `focus` asks for, else Profile.
    this.tab = TABS.some((x) => x.id === props()?.focus) ? props().focus : "general";
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
    const first = { general: this.profile ? null : this.name, jira: this.board, github: this.owner, web: this.webHome, commands: this.leftovers }[this.tab];
    (first ?? this.handle).focus();
  }

  showTab(id, cx) {
    if (this.tab === id) return;
    this.tab = id;
    this.focusTab();
    cx.notify();
  }

  // A check's outcome; a failed one shows its tab, as Save's checks can fail on a tab not shown.
  result(part, ok, text, cx) {
    this.checks[part] = { ok, text };
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
        const [r, config] = await Promise.all([
          jira(cfg, "get", `/rest/agile/1.0/board/${parsed.board}`),
          jira(cfg, "get", `/rest/agile/1.0/board/${parsed.board}/configuration`).catch(() => null),
        ]);
        const list = (config?.body?.columnConfig?.columns ?? []).map((c) => ({ name: c.name, statuses: (c.statuses ?? []).map((x) => x.id) }));
        if (list.length) this.columns = { ...parsed, list };
        this.result("jira", true, `Signed in. Board “${r.body?.name}” (${r.body?.type ?? "board"}${r.body?.location?.projectKey ? `, ${r.body.location.projectKey}` : ""}).`, cx);
      } catch (e) {
        this.result("jira", false, String(e?.message ?? e), cx);
      }
    });
  }

  checkGithub(cx) {
    const owner = this.owner.value().trim();
    if (!owner) return this.result("github", false, "Name an organisation or user.", cx);
    this.result("github", null, "Checking…", cx);
    cx.spawn(async (cx) => {
      try {
        const mine = await searchPulls(`user:${owner} is:pr is:open author:@me`, { demo: Boolean(this.profile?.demo) });
        this.result("github", true, `Found. ${mine.length} open pull request${mine.length === 1 ? "" : "s"} of yours.`, cx);
      } catch (e) {
        this.result("github", false, String(e?.message ?? e), cx);
      }
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
    const error = url && !parsed ? ["jira", "That isn't a Jira Cloud board URL: https://<name>.atlassian.net/…/boards/<number>."]
      : parsed && missing ? ["jira", missing]
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
        jira: parsed ? { url, ...parsed, keychain, ...(signIn.tokenCommand ? signIn : {}), ...(prompt && prompt !== DEFAULT_PROMPT ? { prompt } : {}), ...(orchestrator ? { orchestrator } : {}), ...(this.handover ? { handover: this.handover } : {}), ...(this.profile?.demo ? { demo: true } : {}) } : null,
        github: owner ? { owner, ...(reviewPrompt && reviewPrompt !== DEFAULT_REVIEW_PROMPT ? { reviewPrompt } : {}), ...(mergePrompt && mergePrompt !== DEFAULT_MERGE_PROMPT ? { mergePrompt } : {}), ...(approvalPrompt && approvalPrompt !== DEFAULT_APPROVAL_PROMPT ? { approvalPrompt } : {}), ...(this.profile?.demo ? { demo: true } : {}) } : null,
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
  // CONFIGURE_SCOPES) with the person, from the setup guide. It saves through the profile, so the
  // dialog's changes are saved first (a new profile too) and the dialog closes.
  configure(scope, cx, agent = null) {
    let profile = this.profile;
    if (!profile || this.dirty()) {
      const { error, profile: draft } = this.draft();
      if (error) return this.result(error[0], false, error[1], cx);
      const id = profile?.id ?? newProfileId(draft.name);
      saveProfile(id, draft);
      profile = profileById(id);
    }
    closeOverlay(props().overlay);
    configureOnDesk(profile, scope, agent);
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
      case "jira": {
        const parsed = parseBoard(this.board.value(), { demo: Boolean(this.profile?.demo) });
        return parsed ? `${parsed.site.replace(/^https:\/\//, "").split(".")[0]} · board ${parsed.board}` : "Not connected";
      }
      case "github": return this.owner.value().trim() || "Not connected";
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
    const input = (state) => Input.new(state).h(34).px(10).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(TEXT).text_color(t.foreground);
    const textarea = (state) => Textarea.new(state).px(10).py(8).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(TEXT).text_color(t.foreground);
    const row = (...children) => h_flex().gap(8).items_center().children(children.filter(Boolean));
    const grow = (el) => div().flex_1().min_w(0).child(el);
    const check = (part) => {
      const c = this.checks[part];
      return c ? div().pt(DIALOG.gap).text_size(SMALL).text_color(c.ok === true ? t.done : c.ok === false ? t.blocked : t.dim).child(c.text) : null;
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
    // The sidebar's "Let me configure it for you": everything at once.
    const configureCard = (id, action) => v_flex().id(id).p(12).gap(4).rounded(10).border_1().border_color(t.border).bg(t.popover).cursor_pointer()
      .hover((s) => s.bg(t.hover)).tooltip(askTip).on_click(action)
      .child(h_flex().gap(8).items_start()
        .child(div().flex_none().mt(2).text_color(t.accent).child(icon(own("message-square"))))
        .child(div().flex_1().min_w(0).text_size(TEXT).font_medium().child("Let me configure it for you")))
      .child(div().text_size(SMALL).text_color(t.dim).child("A Claude on the Desk goes through every setting with you, checks them and saves them."));
    // A page's heading: its title (with Set up with Claude for the whole page) and what it's for.
    const page = (title, about, scope = this.tab) => v_flex().pb(4).gap(4)
      .child(h_flex().items_center().gap(8)
        .child(div().flex_1().text_size(TITLE).font_semibold().child(title))
        .child(ask(scope, "Set up with Claude")))
      .child(div().text_size(SMALL).text_color(t.dim).child(about));
    const group = (title, note, scope) => v_flex().pt(28).gap(2)
      .child(h_flex().pb(6).min_h(20).border_b_1().border_color(t.border).items_center().gap(8)
        .child(div().flex_1().text_size(TEXT).font_medium().child(title))
        .when(Boolean(note), (el) => el.child(div().text_size(SMALL).text_color(t.dim).child(note)))
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
    const parsed = parseBoard(this.board.value(), { demo: Boolean(this.profile?.demo) });
    const columns = this.columns && parsed?.site === this.columns.site && parsed?.board === this.columns.board ? this.columns.list : null;
    const from = columns ? handoverFrom(columns, this.handover) : -1;
    // Claude accounts by folder name; a saved folder no longer found still shows, so it can be changed.
    const dirName = (d) => d.replace(/\/+$/, "").split("/").pop();
    const dirs = [...new Set([...this.claudeDirs, ...[this.claudeConfig].filter(Boolean)])].filter((d) => !isOwnClaude(d));
    const hasJira = Boolean(parsed), hasGithub = Boolean(this.owner.value().trim());
    const dirty = this.dirty();
    const fields = (list) => `Fills in ${list.map((f) => `{${f}}`).join(" ")}.`;

    const pages = {
      general: () => [
        page("General", "A piece of work with its own folder, and with Jira its board: every space opened in its folder belongs to it, and each story you start becomes a space of its own."),
        field("Name", input(this.name), null),
        check("name"),
        field("Folder", row(grow(input(this.folder)), textButton(t, "setup-folder-pick", "Choose…", (_e, cx) => this.chooseFolder(cx))),
          "Its agents start here and its Claude sessions show; spaces opened in it, or under it, belong to this profile."),
        field("Claude account", choice("setup-claude", [
          { label: "Default", value: null, on: !this.claudeConfig, tip: "Claude's own folder, ~/.claude" },
          ...dirs.map((d) => ({ label: dirName(d), value: d, on: this.claudeConfig === d, tip: d })),
        ], (v) => { this.claudeConfig = v; }), "The Claude config folder this profile's new agents use (as CLAUDE_CONFIG_DIR). Lists your ~/.claude* folders that have a settings.json or projects/ (any you've run Claude with via CLAUDE_CONFIG_DIR). Resuming a session keeps the account it ran on."),
      ],

      jira: () => [
        page("Jira", "The board its stories come from: your part of its active sprints, or of a Kanban board's open work. Jira Cloud only (an atlassian.net site)."),
        field("Board URL", input(this.board), "Open the board in Jira and copy the address: it ends in /boards/<number>."),
        group("Sign in", null, "jira-signin"),
        this.mac && field("Keychain item", input(this.keychain), "Where the API token is kept on this Mac."),
        field(this.mac ? "Or a token command" : "Token command", input(this.tokenCommand),
          `A shell command that prints the API token, from a password manager (op read …, pass …, secret-tool lookup …). It runs for each request${this.mac ? ", instead of the Keychain when set" : ""}; the token only goes to curl, through a pipe.`),
        field(tokenCommand ? "Jira email" : "Jira email, for storing the token", input(this.email), null),
        this.mac && !tokenCommand && v_flex().pt(DIALOG.section)
          .child(div().pb(6).text_size(SMALL).text_color(t.dim).child("No token stored yet? Make one at id.atlassian.com → Security → API tokens, then run this in a terminal and paste it at the prompt:"))
          .child(h_flex().p(8).gap(8).items_center().rounded(8).bg(t.background).border_1().border_color(t.border)
            .child(div().flex_1().min_w(0).text_size(SMALL).text_color(t.muted).child(storeCommand(item, email)))
            .child(textButton(t, "setup-copy", "Copy", (_e, cx) => cx.write_to_clipboard(storeCommand(item, email))))),
        h_flex().pt(DIALOG.section).gap(DIALOG.gap).items_center()
          .child(textButton(t, "setup-jira-check", "Check connection", (_e, cx) => this.checkJira(cx), { tip: "Signs in and reads the board" })),
        check("jira"),
        group("Your part", null, "handover"),
        columns
          ? field("Done from column", choice("setup-handover", columns.map((c, i) => ({ label: c.name, value: c.name, on: i === from })), (v) => { this.handover = v; }),
            `A story whose subtasks of yours are all in ${columns[from]?.name ?? "it"} or further right waits on others: it sinks to the end of your list.${this.handover ? "" : " Not chosen: the first testing column, else the board's last."}`,
            this.handover ? { id: "setup-handover-reset", action: (_e, cx) => { this.handover = null; cx.notify(); } } : null)
          : hint("Check the connection to choose the column where your part of a story is done."),
      ],

      github: () => [
        page("GitHub", "The owner whose pull requests show, yours and the ones waiting on your review, through gh."),
        field("Owner", row(grow(input(this.owner)), textButton(t, "setup-github-check", "Check", (_e, cx) => this.checkGithub(cx), { tip: "Looks for your open pull requests there" })),
          "An organisation or a user."),
        check("github"),
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
        group("Stories", hasJira ? null : "Saved once Jira is connected"),
        promptField("prompt", "Agent started on a ticket", this.prompt, DEFAULT_PROMPT,
          `${fields(PROMPT_FIELDS)} {parent} is the story a sub-task belongs to; {subtasks} lists a story's subtasks, a line each.`),
        field("Orchestrator", textarea(this.orchestrator), "For one agent that runs a whole story through its subtasks. Set, a story offers Start orchestrator beside Start work; the same placeholders."),
        group("Pull requests", hasGithub ? null : "Saved once GitHub is connected"),
        promptField("review", "Review", this.reviewPrompt, DEFAULT_REVIEW_PROMPT,
          `Start review checks the pull request out in its own worktree (worktrees/review-<repo>-<number> under the profile's folder) and starts the agent there. ${fields(REVIEW_FIELDS)} {folder} is the checkout; {ticket}, {summary} and {description} the ticket its title names.`),
        promptField("merge", "Merge", this.mergePrompt, DEFAULT_MERGE_PROMPT,
          `The Merge icon on a story's heading under Your pull requests: a new agent in the story's space, or a Claude already open there. ${fields(MERGE_FIELDS)} {prs} is a line per open pull request of yours on the story.`),
        promptField("approval", "Request approval", this.approvalPrompt, DEFAULT_APPROVAL_PROMPT,
          "The icon beside Merge while a pull request isn't approved yet. The same placeholders; {prs} only the ones not approved."),
        group("When nothing needs you", hasJira ? null : "Shown once Jira is connected"),
        promptField("suggest", "What next?", this.suggestPrompt, SUGGEST_PROMPT,
          "The magic button in the Next place of the story list, while nothing needs you: a Claude on the Desk that suggests what to do. {snapshot} is what the list knows (sprints, stories, subtasks, pull requests, reviews, agents); {board} the Jira board's address; {owner} the GitHub owner; {name} the profile's. It runs in the background: its answer must end in the JSON block of picks the default asks for (keep that part). Say here what kind of work you pick up (frontend, say)."),
        hint("A line whose placeholders all come out empty is left out."),
      ],

      messages: () => [
        page("Messages", "What a button sends to an agent already working on the pull request. {prs} is the pull request's link, several joined by \"and\"."),
        group("Your pull requests"),
        ...ASK_PROMPTS.filter((a) => !REVIEW_ASKS.includes(a.id) && !IDEA_ASKS.includes(a.id)).map((a) => promptField(`ask-${a.id}`, a.label, this.asks[a.id], a.text, null)),
        group("Reviews", "Nothing is posted until you press one"),
        ...ASK_PROMPTS.filter((a) => REVIEW_ASKS.includes(a.id)).map((a) => promptField(`ask-${a.id}`, a.label.replace(/ \(review\)$/, ""), this.asks[a.id], a.text, null)),
        group("What next?"),
        ...ASK_PROMPTS.filter((a) => IDEA_ASKS.includes(a.id)).map((a) => promptField(`ask-${a.id}`, "Start an idea", this.asks[a.id], a.text,
          "A click on one of Claude's improvement ideas in Next starts a Claude on the Desk with this. {idea} is Claude's brief, {where} the file or area, {why} why it pays off.")),
        group("Setup"),
        promptField("configure", "Let me configure it for you", this.configurePrompt, CONFIGURE_PROMPT,
          "What a Set up with Claude or Ask Claude button starts a Claude on the Desk with. {name} and {id} are the profile's, {scope} and {about} what to set up, {guide} the setup guide it follows, {home} Herdr's folder."),
      ],

      commands: () => [
        page("Story commands", "Optional shell commands, run in the profile's folder. {key} is a ticket key: the finished stories' commands run once for the story and once for each of its subtasks, the status command for the story."),
        group("Finished stories"),
        field("Leftovers check", input(this.leftovers), "Prints what a finished story left behind (its worktrees, say), one human-readable line each, as the clean-up dialog lists them; nothing printed: nothing to clean. Runs every few minutes for each key of a finished story, 10 seconds at most each. Empty: a folder named after one of its keys in the profile's folder, or one level down, counts.", null, "leftovers"),
        field("Clean-up command", input(this.cleanUp), "Removes what the leftovers check finds: a finished story's broom shows while there's some, and runs this after closing its space, for each key something was found under. Its last line shows in the story header.", null, "cleanUp"),
        group("Stories in progress"),
        field("Status command", input(this.status), "While a story has a space, its header shows the first line this prints (a dev server's state, say), refreshed with the stories and every few minutes. It gets 4 seconds.", null, "status"),
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
    const deleting = this.armedOn("delete");

    return v_flex().id("work-setup").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.close(cx); cx.stop_propagation(); } })
      .size_full().min_h(0).bg(t.popover).text_color(t.foreground).text_size(TEXT)
      .child(h_flex().flex_1().min_h(0)
        // The side: the profile's name over its tabs.
        .child(v_flex().w(TAB_W).flex_none().h_full().p(DIALOG.gap).pt(DIALOG.pad).gap(2).bg(t.background).border_r_1().border_color(t.border)
          .child(v_flex().px(10).pb(DIALOG.section).gap(2)
            .child(div().text_size(SMALL).text_color(t.dim).child(this.profile ? "Profile" : "New profile"))
            .child(div().truncate().text_size(TITLE).font_semibold().child(this.name.value().trim() || "Untitled")))
          .children(TABS.flatMap((x) => [
            x.group ? div().px(10).pt(DIALOG.section).pb(4).text_size(SMALL).font_medium().text_color(t.dim).child(x.group) : null,
            tabRow(x),
          ].filter(Boolean)))
          .child(div().flex_1())
          .child(open.length
            ? menuButton(this.menus, t, "setup-configure-all", "", askRows("all"), { anchor: "bottom_left", width: 340, trigger: (toggle) => configureCard("setup-configure-all-more", toggle) })
            : configureCard("setup-configure-all", (_e, cx) => this.configure("all", cx))))
        // The shown tab's page; its own scroll, from the top on each tab.
        .child(v_flex().id(`work-setup-body-${this.tab}`).flex_1().min_w(0).h_full().min_h(0).px(DIALOG.pad + 8).pt(DIALOG.pad).pb(DIALOG.pad + 8).overflow_y_scrollbar()
          .children(pages[this.tab]().filter(Boolean))))
      .child(h_flex().flex_none().px(DIALOG.pad).py(12).gap(DIALOG.gap).items_center().border_t_1().border_color(t.border)
        .when(Boolean(this.profile), (el) => el.child(deleting
          ? primaryButton(t, "setup-remove", `Delete ${this.profile.name}`, (_e, cx) => this.careful("delete", () => { saveProfile(this.profile.id, null); closeOverlay(props().overlay); }, cx)).bg(t.blocked)
          : textButton(t, "setup-remove", "Delete profile", (_e, cx) => this.careful("delete", () => {}, cx), { dim: true, tip: "Asks once more" })))
        .child(div().flex_1())
        .when(dirty || discarding, (el) => el.child(h_flex().gap(6).items_center().text_size(SMALL).text_color(discarding ? t.working : t.dim)
          .child(div().size(6).rounded_full().bg(t.working))
          .child(discarding ? "Press again to discard your changes" : "Unsaved changes")))
        .child(textButton(t, "setup-cancel", discarding ? "Discard" : "Cancel", (_e, cx) => this.close(cx), { tip: "Esc" }))
        .child(primaryButton(t, "setup-save", "Save", (_e, cx) => this.save(cx))));
  }
}
