// The plugin's configure-profile skill is the agents' guide to every profile setting (CLAUDE.md: "keep
// it in step with any profile setting added or changed"), so what it says is checked against what the
// code takes: which changes wait for the person's yes, the scopes, the messages and placeholders.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readRepo } from "../lib/helpers.mjs";
import {
  ASK_PROMPTS, CONFIGURE_SCOPES, CONFIRM_KEYS, MERGE_FIELDS, PROMPT_FIELDS, REVIEW_FIELDS, SUGGEST_FIELDS,
} from "../../mods/kelpie/config.js";

const guide = readRepo("plugin/skills/configure-profile/SKILL.md");
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
    for (const k of ["handover", "solo", "moveToDone"]) {
      for (const section of ["jira", "project"]) assert.ok(!CONFIRM_KEYS[section].includes(k), `${section}.${k} applies at once`);
      assert.ok(rest.includes(`\`${k}\``), `${k} in the settings saved at once`);
      assert.ok(carry.includes(`\`${k}\``), `${k} carried over to the new board`);
    }
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
    for (const f of [...PROMPT_FIELDS, ...REVIEW_FIELDS, ...MERGE_FIELDS, ...SUGGEST_FIELDS, ...CONFIGURE_FIELDS]) assert.ok(guide.includes(`{${f}}`), `{${f}}`);
  });
});
