// Writes of shared state that change nothing (#39): every write rewrites Herdr's whole shared.json
// and redraws every copy of the mod, so a value already there isn't written again.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { setCounts } from "../../mods/kelpie/stories.js";

const writes = () => mock.of("setShared").filter(([key]) => key === "kelpie.stories.counts").length;

beforeEach(() => mock.reset());

test("a story's counts are written when they change, not again when they're the same", () => {
  setCounts("ACME-1", { files: 3, shots: 0, repo: null });
  assert.equal(writes(), 1, "the first count is written");
  // The Screenshots count, asked again every 5 s while a new agent has no session yet.
  setCounts("ACME-1", { shots: 0 });
  setCounts("ACME-1", { files: 3, shots: 0, repo: null });
  assert.equal(writes(), 1, "the same counts aren't written again");
  setCounts("ACME-1", { shots: 2 });
  assert.equal(writes(), 2);
  assert.deepEqual(mock.sharedValue("kelpie.stories.counts"), { "ACME-1": { files: 3, shots: 2, repo: null } });
  setCounts("ACME-2", { shots: 0 });
  assert.equal(writes(), 3, "another story's first count is written");
});
