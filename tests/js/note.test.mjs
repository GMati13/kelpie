// The last action's note (stories.js `say()`, shared kelpie.stories.note by profile): a note about one
// story shows in that story's details only, one about several stories or the whole list beside the
// list's freshness line, and another profile's never shows.
import { DEMO, demoProfile, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { texts } from "gpui-kit";
import { byId } from "../lib/snapshot.mjs";
import { StoryBody, StoryList, sendStoryTask } from "../../mods/kelpie/stories.js";

const NOTE = "kelpie.stories.note";
let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

// The demo's world with `preview` shown and the note as `note` (by profile), then what the story's
// details and the list say.
async function shown(preview, note) {
  setupDemoWorld({ stories });
  mock.state.shared.set("kelpie.stories.preview", { [DEMO]: preview });
  if (note) mock.state.shared.set(NOTE, note);
  const body = (await draw(new StoryBody())).el, list = (await draw(new StoryList())).el;
  return { body: texts(byId(body, "story-note") ?? { children: [] }).join(""), list: texts(byId(list, "stories-note") ?? { children: [] }).join("") };
}
const fresh = (text, keys) => ({ text, full: null, keys, at: Date.now() });

test("a note about one story shows in its details, not in another story's nor beside the list", async () => {
  // Said by an action on ACME-142: a send to its Claude, refused as the Claude waits for an answer.
  setupDemoWorld({ stories });
  await sendStoryTask("merge", demoProfile(), { key: "ACME-142", title: "" }, [], { tab_name: "ACME-142", status: "blocked", space: "s0", pane: "p0-0", address: "a0-0" });
  const note = mock.sharedValue(NOTE);
  assert.deepEqual(note[DEMO].keys, ["ACME-142"]);
  assert.match(note[DEMO].text, /^Couldn't send it to ACME-142/);
  const own = await shown("ACME-142", note);
  assert.match(own.body, /^Couldn't send it to ACME-142/);
  assert.equal(own.list, "");
  const other = await shown("ACME-180", note);
  assert.equal(other.body, "", "another story's details don't show it");
  assert.equal(other.list, "");
});

test("a note about one of a story's subtasks shows in the story's details", async () => {
  const at = await shown("ACME-142", { [DEMO]: fresh("Pausing ACME-143…", ["ACME-143"]) });
  assert.equal(at.body, "Pausing ACME-143…");
});

test("a note about the whole list, or several stories, shows beside the list, in no story's details", async () => {
  for (const keys of [[], ["ACME-142", "ACME-180"]]) {
    const at = await shown("ACME-142", { [DEMO]: fresh("Cleaned up 2 stories: ACME-142, ACME-180.", keys) });
    assert.equal(at.body, "", `keys ${JSON.stringify(keys)}`);
    assert.equal(at.list, "Cleaned up 2 stories: ACME-142, ACME-180.");
  }
});

test("another profile's note never shows; the shown profile's own stays beside it", async () => {
  const other = { other: fresh("Cleaned up ACME-142.", ["ACME-142"]) };
  const at = await shown("ACME-142", other);
  assert.deepEqual(at, { body: "", list: "" });
  const both = await shown("ACME-142", { ...other, [DEMO]: fresh("Moving ACME-142 to Done…", ["ACME-142"]) });
  assert.equal(both.body, "Moving ACME-142 to Done…");
});

test("a note past its few minutes, or in the old one-for-everything shape, shows nowhere", async () => {
  const old = await shown("ACME-142", { [DEMO]: { ...fresh("Pausing ACME-142…", ["ACME-142"]), at: Date.now() - 6 * 60e3 } });
  assert.deepEqual(old, { body: "", list: "" });
  const flat = await shown("ACME-142", { text: "Pausing ACME-142…", full: null, at: Date.now() });
  assert.deepEqual(flat, { body: "", list: "" });
});

// The status line under the title (the profile's status command): kept by profile and key, as two
// profiles' boards may share a key; another profile's line for the same key isn't shown.
test("the status line is the profile's own, even for a key another profile's board has", async () => {
  setupDemoWorld({ stories });
  const t = { muted: "muted", dim: "dim" };
  mock.on.exec = (cmd, args) => (cmd === "sh" ? { code: 0, stdout: `status of ${args[3].split(" ")[1]}`, stderr: "" } : undefined);
  const view = new StoryBody();
  const cx = (await draw(view)).cx;
  const it = { key: "ACME-142", space: { id: "s0" } };
  const st = (id) => ({ profile: { id, folder: "/x", commands: { status: `echo ${id}` } }, space: null });
  view.statusLine(t, st("one"), it, cx);
  await cx.settle();
  const line = (id) => texts(view.statusLine(t, st(id), it, cx) ?? { children: [] }).join("");
  assert.equal(line("one"), "status of one");
  view.statusLine(t, st("two"), it, cx);
  await cx.settle();
  assert.equal(line("two"), "status of two", "not the first profile's line");
  assert.equal(line("one"), "status of one");
});
