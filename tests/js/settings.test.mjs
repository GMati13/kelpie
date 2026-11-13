// The shared permission list (.claude/settings.json) lets every agent working on this repo run what it
// allows without asking, so it allows only commands that read. `gh api` stays out whole: a prefix rule
// can't tell a read from a write, as -X, -f/-F and --input turn any path into one (and a GraphQL read is
// a POST too), so it asks each time (security.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readRepo } from "../lib/helpers.mjs";

const { permissions } = JSON.parse(readRepo(".claude/settings.json"));
const gh = (permissions.allow ?? []).filter((r) => /^Bash\(gh\b/.test(r));
// gh's subcommands that only read, whatever their flags.
const READING = ["search", "issue view", "issue list", "pr view", "pr list", "pr diff", "pr checks", "run view", "run list"];

test("no gh api call is allowed without asking", () => {
  assert.deepEqual(gh.filter((r) => /^Bash\(gh\s+api\b/.test(r)), []);
});

test("every gh command allowed only reads", () => {
  for (const rule of gh) {
    const command = rule.replace(/^Bash\(gh\s+/, "").replace(/(:\*)?\)$/, "");
    assert.ok(READING.includes(command), `${rule} isn't a reading command`);
  }
});

test("ending or removing a terminal always asks", () => {
  assert.ok(permissions.ask.includes("Bash(hc kill:*)"));
  assert.ok(permissions.ask.includes("Bash(hc rm:*)"));
});
