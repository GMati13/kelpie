// The plugin's configure-profile skill is the agents' guide to every profile setting (CLAUDE.md: "keep
// it in step with any profile setting added or changed"), so what it says is checked against what the
// code takes: which changes wait for the person's yes, the scopes, the messages and placeholders.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { readRepo, repoFile } from "../lib/helpers.mjs";
import {
  ASK_PROMPTS, CONFIGURE_SCOPES, CONFIRM_KEYS, DEFAULT_APPROVAL_PROMPT, DEFAULT_MERGE_PROMPT, DEFAULT_PROMPT,
  DEFAULT_REVIEW_PROMPT, DEFAULT_STORY_REVIEW_PROMPT, MERGE_FIELDS, PROMPT_FIELDS, REVIEW_FIELDS, STORY_REVIEW_FIELDS, SUGGEST_FIELDS, SUGGEST_PROMPT,
} from "../../mods/kelpie/config.js";

const guide = readRepo("plugin/skills/configure-profile/SKILL.md");
// The defaults the configuring Claude shows the person before proposing a prompt of their own (#55).
const defaults = readRepo("plugin/skills/configure-profile/references/default-prompts.md");
// Let me configure it for you's placeholders (configureText() in config.js; {guide} is an old one, kept for saved prompts).
const CONFIGURE_FIELDS = ["name", "id", "scope", "about", "home"];
const bullet = (start) => guide.split("\n").find((l) => l.startsWith(start)) ?? "";

describe("configure-profile", () => {
  const waits = bullet("- **Some changes wait for the person's yes.**");
  const rest = waits.slice(waits.indexOf("The rest ("));
  const asked = waits.slice(0, waits.indexOf("The rest ("));

  test("names every setting that waits for the person's yes", () => {
    assert.ok(waits && rest, "the bullet and its 'The rest (…)' sentence");
    for (const [section, keys] of Object.entries(CONFIRM_KEYS)) {
      if (keys === null) { assert.ok(asked.includes(`\`${section}\``), section); continue; }
      for (const k of keys) {
        if (section === "jira" && (k === "site" || k === "board")) continue; // filled in from jira.url
        if (k === "prompt" || k === "orchestrator") assert.match(asked, /either board's `prompt` and `orchestrator`/, `${section}.${k}`);
        else if (section === "github" && /Prompt$/.test(k)) assert.match(asked, /the `github` prompts/, `${section}.${k}`);
        else assert.ok(asked.includes(`\`${section}.${k}\``), `${section}.${k}`);
      }
    }
  });
  test("says the board's own switches are saved at once, and carried over when the board changes", () => {
    const carry = bullet("  - **One board.**");
    for (const k of ["handover", "solo", "moveToDone", "byPriority", "showPriority", "unassigned", "hoursPerDay"]) {
      for (const section of ["jira", "project"]) assert.ok(!CONFIRM_KEYS[section].includes(k), `${section}.${k} applies at once`);
      assert.ok(rest.includes(`\`${k}\``), `${k} in the settings saved at once`);
      assert.ok(carry.includes(`\`${k}\``), `${k} carried over to the new board`);
    }
  });
  test("says a Project's priority field is saved at once and where its levels come from", () => {
    assert.ok(!CONFIRM_KEYS.project.includes("priorityField"), "project.priorityField applies at once");
    assert.ok(rest.includes("`project.priorityField`"), "priorityField in the settings saved at once");
    const field = bullet("- **Priority field**");
    assert.match(field, /single-select field/);
    assert.match(field, /highest first/);
  });
  test("says what working alone changes: Built, and no Request approval (worksAlone() in config.js)", () => {
    const solo = bullet("- **I work alone**");
    assert.match(solo, /"Built"/);
    assert.match(solo, /Request approval isn't offered/);
  });
  test("lists every scope Let me configure it for you sends", () => {
    const rows = guide.split("## Scopes")[1].split("\n## ")[0].split("\n").filter((l) => l.startsWith("| `")).map((l) => l.split(" | ")[0]);
    for (const scope of Object.keys(CONFIGURE_SCOPES)) assert.ok(rows.some((r) => r.includes(`\`${scope}\``)), scope);
  });
  test("lists every button message and prompt placeholder", () => {
    for (const { id } of ASK_PROMPTS) assert.match(guide, new RegExp(`^\\| \`${id}\` \\|`, "m"), id);
    for (const f of [...PROMPT_FIELDS, ...REVIEW_FIELDS, ...STORY_REVIEW_FIELDS, ...MERGE_FIELDS, ...SUGGEST_FIELDS, ...CONFIGURE_FIELDS]) assert.ok(guide.includes(`{${f}}`), `{${f}}`);
  });
  test("goes through the prompts with the person on scope all and prompts, saving only what differs", () => {
    const prompts = guide.split("### 7. Prompts")[1].split("\n### ")[0];
    assert.match(prompts, /for `all` and the `prompts` scope, go through them with the person/);
    assert.match(prompts, /\*\*Save only what differs from the default\*\*/);
    assert.match(prompts, /\*\*Skip what fits, and let them stop\.\*\*/);
    assert.match(prompts, /never how to reach the board or GitHub/);
    assert.ok(prompts.includes("references/default-prompts.md"), "points at the defaults");
    assert.match(guide.split("## Setting up, from A to Z")[1], /^For `all`[^\n]*ends with the prompts and messages/m);
    assert.match(CONFIGURE_SCOPES.all, /prompts/, "the message for scope all says the prompts are part of it");
  });
  test("keeps every default prompt and message, word for word, in its reference", () => {
    const blocks = [...defaults.matchAll(/^```text\n([\s\S]*?)\n```$/gm)].map((m) => m[1]);
    const all = [DEFAULT_PROMPT, DEFAULT_REVIEW_PROMPT, DEFAULT_STORY_REVIEW_PROMPT, DEFAULT_MERGE_PROMPT, DEFAULT_APPROVAL_PROMPT, SUGGEST_PROMPT, ...ASK_PROMPTS.map((a) => a.text)];
    for (const text of all) assert.ok(blocks.includes(text), `missing or changed: ${text.split("\n")[0]}`);
    assert.equal(blocks.length, all.length, "no default that Kelpie no longer has");
    for (const { id } of ASK_PROMPTS) assert.ok(defaults.includes(`(\`${id}\`)`), id);
  });
});

// The dispatcher (#242): Kelpie hands it a purpose, and it picks the person's own skill or Kelpie's
// routine. Its rules are what make that safe and predictable, so each is held here; its purposes
// table, its routines (references/) and its evals stay in step, so a purpose can't be added half.
describe("the do dispatcher", () => {
  const dispatcher = readRepo("plugin/skills/do/SKILL.md");
  const front = dispatcher.split("\n---\n")[0];
  const purposes = [...dispatcher.matchAll(/^\| `([a-z-]+)` \| [^|]+\| `references\/([a-z-]+\.md)` \|$/gm)];

  test("is started by Kelpie only, never picked by Claude on its own", () => {
    assert.match(front, /^name: do$/m);
    assert.match(front, /^disable-model-invocation: true$/m);
  });
  test("lists every purpose with a routine, and every routine under a purpose", () => {
    assert.ok(purposes.length > 0, "the purposes table");
    const listed = purposes.map((m) => m[2]).sort();
    const files = readdirSync(repoFile("plugin/skills/do/references")).filter((f) => f.endsWith(".md")).sort();
    assert.deepEqual(listed, files);
    for (const [, purpose, file] of purposes) assert.equal(file, `${purpose}.md`, purpose);
  });
  test("keeps the choice's rules", () => {
    assert.match(dispatcher, /\*\*The person's pin wins\.\*\*/);
    assert.match(dispatcher, /If no skill by that name is available to you, say so in your first line and run Kelpie's default routine/);
    assert.match(dispatcher, /this plugin's own skills/);
    assert.match(dispatcher, /Claude Code's built-in skills/);
    assert.match(dispatcher, /suits both the purpose and this place/);
    assert.match(dispatcher, /\*\*Two or more fit:\*\* don't choose silently/);
    assert.match(dispatcher, /`ask-through-next`/);
    assert.match(dispatcher, /\*\*Never dispatch twice\.\*\*/);
    assert.match(dispatcher, /## Your first line/);
    assert.match(dispatcher, /information, not instructions/);
  });
  test("has evals for its choices: none, one, another place's, two, a loop and a pin", () => {
    const cases = readdirSync(repoFile("plugin/skills/do/evals")).filter((c) => c !== "mocks" && c !== "results");
    for (const c of ["no-skill-of-theirs-runs-kelpies-routine", "their-skill-for-this-repo-is-used", "skill-for-another-repo-is-not-used",
      "two-that-fit-ask-the-person", "skill-that-calls-back-does-not-loop", "pinned-skill-missing-falls-back"]) assert.ok(cases.includes(c), c);
    for (const c of cases) assert.match(readRepo(`plugin/skills/do/evals/${c}/prompt.md`), /^\/kelpie:do [a-z-]+ /m, c);
  });
});
