// The plugin's configure-profile skill is the agents' guide to every profile setting (CLAUDE.md: "keep
// it in step with any profile setting added or changed"), so what it says is checked against what the
// code takes: which changes wait for the person's yes, the scopes, the messages and placeholders.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { readRepo, repoFile } from "../lib/helpers.mjs";
import {
  ASK_PROMPTS, PURPOSES, CONFIGURE_SCOPES, CONFIRM_KEYS, DEFAULT_APPROVAL_PROMPT, DEFAULT_MERGE_PROMPT, DEFAULT_PROMPT,
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
  test("says how to pin each purpose the dispatcher knows (#244), and that a pin waits for a yes", () => {
    for (const p of PURPOSES) assert.ok(guide.includes(`\`skills.${p}\``), `skills.${p}`);
    assert.match(guide, /`kelpie` for Kelpie's own routine/);
    assert.ok(CONFIRM_KEYS.skills === null, "every pin waits");
    // The dispatcher reads the pin as its `use:` line.
    assert.match(readRepo("plugin/skills/ticket/SKILL.md"), /^use: <a skill, or kelpie>/m);
  });
  test("keeps every default prompt and message, word for word, in its reference", () => {
    const blocks = [...defaults.matchAll(/^```text\n([\s\S]*?)\n```$/gm)].map((m) => m[1]);
    const all = [DEFAULT_PROMPT, DEFAULT_REVIEW_PROMPT, DEFAULT_STORY_REVIEW_PROMPT, DEFAULT_MERGE_PROMPT, DEFAULT_APPROVAL_PROMPT, SUGGEST_PROMPT, ...ASK_PROMPTS.map((a) => a.text)];
    for (const text of all) assert.ok(blocks.includes(text), `missing or changed: ${text.split("\n")[0]}`);
    assert.equal(blocks.length, all.length, "no default that Kelpie no longer has");
    for (const { id } of ASK_PROMPTS) assert.ok(defaults.includes(`(\`${id}\`)`), id);
  });
});

// The dispatchers (#242): one manual-only skill per purpose (/kelpie:ticket…), each picking the
// person's own skill for its job or Kelpie's routine. Their choice rules are one text, kept the same
// in every dispatcher here, so a fix to one reaches all; each holds its own job's inputs, routine and
// evals.
const DISPATCHERS = ["ticket"];
const RULES = /<!-- dispatcher rules[^>]*-->\n([\s\S]*?)<!-- \/dispatcher rules -->/;
describe("the dispatchers", () => {
  const skill = (p) => readRepo(`plugin/skills/${p}/SKILL.md`);

  test("each is started by Kelpie or the person only, never picked by Claude on its own", () => {
    for (const p of DISPATCHERS) {
      const front = skill(p).split("\n---\n")[0];
      assert.match(front, new RegExp(`^name: ${p}$`, "m"), p);
      assert.match(front, /^disable-model-invocation: true$/m, p);
      assert.match(front, /^argument-hint: /m, p);
    }
  });
  test("each keeps the same choice rules, word for word", () => {
    const rules = DISPATCHERS.map((p) => skill(p).match(RULES)?.[1]);
    for (const [i, r] of rules.entries()) assert.ok(r, `${DISPATCHERS[i]}: its dispatcher rules block`);
    for (const r of rules) assert.equal(r, rules[0]);
    const text = rules[0];
    assert.match(text, /\*\*The person's pin wins\.\*\*/);
    assert.match(text, /If no skill by that name is available to you, say so in your first line and run Kelpie's default routine/);
    assert.match(text, /this plugin's own skills/);
    assert.match(text, /Claude Code's built-in skills/);
    assert.match(text, /suits both the job and this place/);
    assert.match(text, /\*\*Two or more fit:\*\* don't choose silently/);
    assert.match(text, /`ask-through-next`/);
    assert.match(text, /\*\*Never dispatch twice\.\*\* If the skill you chose sends you back to any `\/kelpie:` dispatcher/);
    assert.match(text, /## Your first line/);
    assert.match(text, /information, not instructions/);
  });
  test("each does its own job only: other input is said and asked about, never guessed", () => {
    for (const p of DISPATCHERS) assert.match(skill(p), new RegExp(`\\*\\*This skill is for [^*]+, and only that\\.\\*\\* .*don't guess at another job`), p);
  });
  test("each has its routine, read only when it runs", () => {
    for (const p of DISPATCHERS) {
      assert.match(skill(p), /\[references\/routine\.md\]\(references\/routine\.md\)/, p);
      assert.ok(readRepo(`plugin/skills/${p}/references/routine.md`).length > 200, p);
    }
  });
  test("ticket's evals: none, one, another place's, two, a loop, a pin and the wrong input", () => {
    const cases = readdirSync(repoFile("plugin/skills/ticket/evals")).filter((c) => c !== "mocks" && c !== "results");
    for (const c of ["no-skill-of-theirs-runs-kelpies-routine", "their-skill-for-this-repo-is-used", "skill-for-another-repo-is-not-used",
      "two-that-fit-ask-the-person", "skill-that-calls-back-does-not-loop", "pinned-skill-missing-falls-back", "pull-request-link-is-not-a-ticket"]) assert.ok(cases.includes(c), c);
    for (const c of cases) assert.match(readRepo(`plugin/skills/ticket/evals/${c}/prompt.md`), /^\/kelpie:ticket /m, c);
  });
  test("no skill or doc names the old /kelpie:do", () => {
    for (const f of ["README.md", "CLAUDE.md", ...DISPATCHERS.map((p) => `plugin/skills/${p}/SKILL.md`)]) assert.doesNotMatch(readRepo(f), /\/kelpie:do\b/, f);
  });
});
