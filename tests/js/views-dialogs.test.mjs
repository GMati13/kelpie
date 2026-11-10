// What Kelpie's dialogs draw (dialogs.js Confirm and StoryPicker), opened the way the views open them,
// pinned as snapshots (tests/README.md, Snapshots): the clean-up confirm with its leftovers, Clean up
// all, the close dialog of a story's last tab, an agent's profile change waiting for a yes, the
// story picker, and the profile dialog's Agents and GitHub pages (accounts, with their guides).
import { DEMO, fakeCx, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, texts } from "gpui-kit";
import { byId, matchSnapshot, render } from "../lib/snapshot.mjs";
import { StoryList } from "../../mods/kelpie/stories.js";
import { Confirm, StoryPicker } from "../../mods/kelpie/dialogs.js";
import { Setup } from "../../mods/kelpie/setup.js";
import { requestProfileChange } from "../../mods/kelpie/config.js";
import Quiet from "../../mods/kelpie/main.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";

const snap = (name, el) => matchSnapshot(name, render(el, skinTheme()));
let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

// A profile with a leftovers check and a clean-up command, and what the check found for ACME-122
// (as checkLeftovers() keeps it: `ask` says what was asked, so it isn't asked again).
const COMMANDS = { leftovers: "check-leftovers {key}", cleanUp: "clean-up {key}" };
const LEFTOVERS = { [DEMO]: { at: Date.now(), ask: `3|${COMMANDS.leftovers}|${COMMANDS.cleanUp}|ACME-122 ACME-129`,
  found: { "ACME-122": { "ACME-123": ["worktrees/ACME-123/api: 2 files not pushed", "a branch ACME-123 in api"] } } } };

// The dialog the last openOverlay() asked for, drawn as Herdr would: its props, then Confirm.
function lastDialog(Role = Confirm) {
  const [spec] = mock.of("openOverlay").at(-1);
  mock.state.props = { ...spec.props, overlay: "overlay-1" };
  const d = new Role();
  d.init(fakeCx());
  return { spec, el: d.render(fakeCx()) };
}
const press = (el, id, cx = fakeCx()) => { for (const h of handlers(el).filter((x) => x.id === id)) h.fn({}, cx); };

test("the clean-up confirm lists what goes, its leftovers by key", async () => {
  setupDemoWorld({ stories, profile: { commands: COMMANDS } });
  mock.state.shared.set("kelpie.clean.leftovers", LEFTOVERS);
  const { el } = await draw(new StoryList());
  press(el, "clean-ACME-122");
  const { spec, el: dialog } = lastDialog();
  assert.equal(spec.props.title, "Clean up ACME-122?");
  assert.deepEqual(texts(byId(dialog, "confirm-yes")), ["Clean up"]);
  snap("dialogs/clean-up", dialog);
});

test("Clean up all lists every finished story with something left", async () => {
  setupDemoWorld({ stories });
  const { el } = await draw(new StoryList());
  press(el, "stories-clean-all");
  snap("dialogs/clean-up-all", lastDialog().el);
});

test("closing a story's last tab asks: Pause, or Close", () => {
  setupDemoWorld({ stories, shown: "ACME-122", props: { role: "toolbar" } });
  const cx = { ...fakeCx(), spawn() {} };
  const bar = new Quiet({});
  bar.init({}, cx);
  // Hovering the tab turns its mark into the ✕.
  handlers(bar.render(cx), "on_hover").find((h) => h.id === "tab-t5-0").fn(true, cx);
  press(bar.render(cx), "close-t5-0", cx);
  const { spec, el } = lastDialog();
  assert.equal(spec.props.title, "Leave ACME-122?");
  snap("dialogs/leave-story", el);
  mock.state.props = { role: "toolbar" };
  handlers(bar.render(cx), "on_hover").find((h) => h.id === "tab-t5-0").fn(false, cx);
});

test("an agent's profile change waits for the person's yes", () => {
  setupDemoWorld({ stories });
  const r = requestProfileChange(DEMO, { commands: { status: "git -C {key} status --short" }, prompts: { fix: "Fix the checks of {prs}." } });
  assert.equal(r.pending, true);
  const { el } = lastDialog();
  assert.deepEqual(texts(byId(el, "confirm-yes")), ["Save these changes"]);
  assert.deepEqual(texts(byId(el, "confirm-no")), ["Cancel"]);
  snap("dialogs/profile-change", el);
});

test("the story picker: every story, then filtered", () => {
  setupDemoWorld({ stories, props: { role: "story-picker", overlay: "overlay-1" } });
  const picker = new StoryPicker();
  const cx = fakeCx();
  picker.init(cx);
  snap("dialogs/story-picker", picker.render(cx));
  picker.filter = "pay";
  const filtered = picker.render(cx);
  assert.ok(byId(filtered, "sp-ACME-151"));
  assert.equal(byId(filtered, "sp-ACME-142"), null);
  snap("dialogs/story-picker-filtered", byId(filtered, "sp-list"));
});

test("Kelpie-Plain: the story picker and a confirm", () => {
  setupDemoWorld({ stories, layout: "Kelpie-Plain", props: { role: "story-picker", overlay: "overlay-1" } });
  const picker = new StoryPicker();
  picker.init(fakeCx());
  snap("plain/dialogs/story-picker", picker.render(fakeCx()));
  requestProfileChange(DEMO, { commands: { status: "git -C {key} status --short" } });
  snap("plain/dialogs/profile-change", lastDialog().el);
});

// The profile dialog opened on a page, as `herdr-app do kelpie.edit-profile-<page>` opens it.
function profilePage(focus, profile = {}) {
  setupDemoWorld({ stories, profile, props: { role: "setup", profile: DEMO, focus, overlay: "overlay-1" } });
  const d = new Setup();
  const cx = fakeCx();
  d.init(cx);
  return d.render(cx);
}

test("the profile dialog's Agents page: the Claude account, and how to add another", () => {
  const el = profilePage("agents");
  const words = texts(el).join("\n");
  for (const s of ["Claude account", "Another Claude account", "CLAUDE_CONFIG_DIR=~/.claude-demo claude", "claude-statusline.sh", "CLAUDE_ACCOUNT_CHOSEN"]) assert.ok(words.includes(s), s);
  snap("dialogs/profile-agents", el);
});

test("the profile dialog's GitHub page: with an account picked, the shell function to copy and its check", () => {
  const el = profilePage("github", { github: { owner: "kelpie--demo", demo: true, account: "kelpie-demo" } });
  const words = texts(el).join("\n");
  for (const s of ["GitHub account", "KELPIE_GH_ACCOUNT=kelpie-demo", "Check my shell"]) assert.ok(words.includes(s), s);
  assert.ok(byId(el, "setup-gh-copy"));
  snap("dialogs/profile-github", el);
});
