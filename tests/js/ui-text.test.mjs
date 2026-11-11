// What the UI says in words (#32): plain, accurate, one wording for one thing, no internal names.
// Each test pins a wording that was wrong once.
import { DEMO, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { render } from "../lib/snapshot.mjs";
import { Stories, StoryBody, StoryList } from "../../mods/kelpie/stories.js";
import { mock } from "herdr";
import { skinTheme } from "../../mods/kelpie/skins/index.js";
import { Setup } from "../../mods/kelpie/setup.js";
import { fakeCx } from "../lib/views.mjs";
import { texts } from "gpui-kit";

let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

const sidebar = async (opts = {}) => {
  setupDemoWorld({ stories, ...opts });
  return render((await draw(new StoryList())).el, skinTheme());
};
// The story header, previewing `preview` from the list.
const header = async (preview, opts = {}) => {
  setupDemoWorld({ stories, ...opts });
  mock.state.shared.set("kelpie.stories.preview", { [DEMO]: preview });
  return render((await draw(new Stories())).el, skinTheme());
};

// The subtasks' tooltip names the board's handover column (the demo's is QA), not "testing", which
// only some boards have.
test("a story row's subtasks tooltip names the handover column", async () => {
  const out = await sidebar();
  assert.match(out, /Your subtasks: 0 of 1 past QA · 1 in QA/);
  assert.doesNotMatch(out, /testing/);
});

// The list's counts read as a sentence in their tooltips: "1 needs you", "2 need you".
test("the story list's counts agree with their number", async () => {
  const out = await sidebar();
  assert.match(out, /tip="1 needs you"/);
  assert.doesNotMatch(out, /tip="1 need you"/);
});

// A paused story's Resume: one session is "it", several "they".
test("Resume's tooltip agrees with how many sessions are paused", async () => {
  const out = await header("ACME-138");
  assert.match(out, /Bring back its paused session where it left off/);
});

// A pull request waiting on reviewers says so in the words the list uses ("Waiting for review").
test("a lone pull request waiting on reviewers says Waiting for review", async () => {
  const waiting = { ...stories, data: { ...stories.data, prs: stories.data.prs.map((p) => (/docs/.test(p.repository?.nameWithOwner ?? p.url ?? "") && p.number === 58 ? { ...p, isDraft: false, reviewDecision: "REVIEW_REQUIRED" } : p)) } };
  setupDemoWorld({ stories: waiting });
  mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "pull:docs#58" });
  const out = render((await draw(new StoryBody())).el, skinTheme());
  assert.match(out, /"Waiting for review"/);
  assert.doesNotMatch(out, /Review waiting/);
});

// Pull requests that didn't load: a sentence saying what to do (the story's details; Your pull
// requests says the same words, PULLS_FAILED).
test("pull requests that didn't load say to refresh, as a sentence", async () => {
  const failed = { ...stories, data: { ...stories.data, prError: "GitHub didn't answer." } };
  setupDemoWorld({ stories: failed, shown: "ACME-142" });
  const out = render((await draw(new StoryBody())).el, skinTheme());
  assert.match(out, /"Pull requests didn't load: Refresh to try again\."/);
});

// The profile dialog on a page, its words as one text.
const profilePage = (focus) => {
  setupDemoWorld({ stories, props: { role: "setup", profile: DEMO, focus, overlay: "overlay-1" } });
  const d = new Setup(), cx = fakeCx();
  d.init(cx);
  return texts(d.render(cx)).join("\n");
};

// The Prompts page says what What next? does now: in the background, its picks handed in through the
// plugin (it once said a Claude on the Desk answered with a JSON block), and where Start orchestrator is.
test("the Prompts page describes What next? and the orchestrator as they work", () => {
  const words = profilePage("prompts");
  assert.match(words, /in the background, reading only, with no tab of its own/);
  assert.match(words, /through its Claude Code plugin/);
  assert.doesNotMatch(words, /JSON/);
  assert.doesNotMatch(words, /a Claude on the Desk that suggests/);
  assert.match(words, /When set, a story's More menu offers Start orchestrator/);
});

// Move to Done's switch names the stories it shows on by what they are for a team too, not "built",
// which is the word for someone who works alone.
test("the Board page's Move to Done hint doesn't say built", () => {
  const words = profilePage("jira");
  assert.match(words, /on each story past your part in the list/);
  assert.doesNotMatch(words, /each built story/);
});

// A tooltip gives its key after its words the same way everywhere, "Hide the sidebar ⌘B", never in
// brackets as some did ("Split right (⌘D)").
test("tooltips give their keys one way", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { repoFile } = await import("../lib/helpers.mjs");
  for (const mod of ["mods/kelpie", "mods/kelpie-artifacts"]) {
    for (const f of readdirSync(repoFile(mod)).filter((x) => x.endsWith(".js"))) {
      const found = readFileSync(repoFile(`${mod}/${f}`), "utf8").match(/\([⌃⌥⇧⌘]+[^)]{1,3}\)/gu);
      assert.equal(found, null, `${mod}/${f}: ${found}`);
    }
  }
});
