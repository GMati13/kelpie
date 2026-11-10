// A passage of a story's description shown where it is (stories.js showPassageRequest, showPassage,
// StoryBody.reader): what `kelpie.show-passage` takes from its request file (any program can run the
// command, so every value is checked), and what the details draw while a passage is shown.
import { DEMO, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mock } from "herdr";
import { handlers, texts } from "gpui-kit";
import { put, tempDir } from "../lib/helpers.mjs";
import { byId } from "../lib/snapshot.mjs";
import { StoryBody, StoryList, showPassageRequest } from "../../mods/kelpie/stories.js";
import { findPassage, markdownBlocks } from "../../mods/kelpie/adf.js";

let stories, home;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });
beforeEach(() => {
  setupDemoWorld({ stories });
  home = tempDir();
  mock.state.appHome = home;
  // The request and result files are real, in a temp Herdr home.
  mock.on.exec = (c, a, o) => mock.realExec(c, a, { ...o, env: { PATH: process.env.PATH } });
});

const request = (req) => put(`${home}/kelpie/passage.json`, typeof req === "string" ? req : JSON.stringify(req));
const result = () => JSON.parse(readFileSync(`${home}/kelpie/passage.result.json`, "utf8"));
const passage = () => mock.sharedValue("kelpie.passage");

test("a story of the list: shown with its passage, the request removed, ok in the result", async () => {
  request({ key: "ACME-180", quote: "with confirmation numbers and addresses", note: "What the PDF holds" });
  const r = await showPassageRequest();
  assert.equal(r.ok, true);
  assert.equal(result().ok, true);
  assert.ok(!existsSync(`${home}/kelpie/passage.json`), "the request is removed");
  assert.deepEqual({ ...passage(), at: 0 }, { profile: DEMO, key: "ACME-180", quote: "with confirmation numbers and addresses", note: "What the PDF holds", at: 0 });
  assert.equal(mock.sharedValue("kelpie.stories.preview")?.[DEMO], "ACME-180", "a story not started is previewed");
});

for (const key of ["../../etc/passwd", "ACME-180; rm -rf ~", "acme", "-ACME-1", "", null, 42]) {
  test(`refuses the key ${JSON.stringify(key)}`, async () => {
    request({ key, quote: "with confirmation numbers" });
    const r = await showPassageRequest();
    assert.equal(r.ok, false);
    assert.match(result().error, /^key:/);
    assert.equal(passage() ?? null, null, "nothing is shown");
  });
}

test("refuses a story the shown profile doesn't list, a missing quote, and a request that isn't JSON", async () => {
  request({ key: "XYZ-1", quote: "anything at all" });
  assert.match((await showPassageRequest()).error, /isn't a story/);
  request({ key: "ACME-180", quote: " " });
  assert.match((await showPassageRequest()).error, /^quote:/);
  request("not json");
  assert.equal((await showPassageRequest()).ok, false);
  assert.equal(passage() ?? null, null);
});

test("no request file: says so, shows nothing", async () => {
  const r = await showPassageRequest();
  assert.match(r.error, /No request/);
  assert.equal(passage() ?? null, null);
});

test("control characters and line breaks in the quote and note become spaces; long text is cut", async () => {
  request({ key: "acme-180", quote: "with\u001b[31m confirmation\nnumbers", note: `a\u0007b ${"x".repeat(500)}` });
  await showPassageRequest();
  const p = passage();
  assert.equal(p.key, "ACME-180", "a key in lower case is taken in upper");
  assert.equal(p.quote, "with [31m confirmation numbers");
  assert.ok(!/[\u0000-\u001f]/.test(p.note) && p.note.length <= 200);
});

test("the details show the passage bar while it's shown, and Back to the story ends it", async () => {
  mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-180" });
  mock.state.shared.set("kelpie.passage", { profile: DEMO, key: "ACME-180", quote: "with confirmation numbers and addresses", note: "What the PDF holds", at: Date.now() });
  const { el, cx } = await draw(new StoryBody());
  const bar = byId(el, "passage-bar");
  assert.ok(bar, "the passage bar is drawn");
  assert.ok(texts(bar).includes("Here in the description"));
  assert.ok(texts(bar).includes("What the PDF holds"));
  assert.equal(byId(el, "story-overview"), null, "the reader takes the overview's place");
  handlers(el).find((h) => h.id === "passage-back").fn({}, cx);
  assert.equal(passage(), null);
});

test("a passage the description doesn't hold says so", async () => {
  mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-180" });
  mock.state.shared.set("kelpie.passage", { profile: DEMO, key: "ACME-180", quote: "refunds go out within a week", note: "", at: Date.now() });
  const { el } = await draw(new StoryBody());
  assert.ok(texts(byId(el, "passage-bar")).includes("Couldn't find this passage in the description"));
});

test("another story, or another profile's passage, shows the details as usual", async () => {
  mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-142" });
  mock.state.shared.set("kelpie.passage", { profile: DEMO, key: "ACME-180", quote: "with confirmation numbers", note: "", at: Date.now() });
  assert.equal(byId((await draw(new StoryBody())).el, "passage-bar"), null);
  mock.state.shared.set("kelpie.stories.preview", { [DEMO]: "ACME-180" });
  mock.state.shared.set("kelpie.passage", { profile: "other", key: "ACME-180", quote: "with confirmation numbers", note: "", at: Date.now() });
  assert.equal(byId((await draw(new StoryBody())).el, "passage-bar"), null);
});

// A GitHub Project's issue description is Markdown (issues.js, markdownBlocks()): a passage is found
// in it as in a Jira ticket's.
test("a passage of a Markdown description (a GitHub issue's): found, marked and its block flagged", () => {
  const blocks = markdownBlocks([
    "<!-- the template's hint -->",
    "Travellers open **saved trips** offline.",
    "## Done when",
    "- [ ] A trip opened once opens again in airplane mode, within 300 ms",
    "- [x] An edit made offline shows on [another device](https://example.com/devices) after going back online",
  ].join("\n"));
  const r = findPassage(blocks, "an edit made offline shows on another device");
  assert.equal(r.exact, true);
  assert.deepEqual(r.blocks.map((b) => Boolean(b.hl)), blocks.map((_, i) => i === r.index));
  assert.equal(r.blocks[r.index].kind, "list");
  const marked = JSON.stringify(r.blocks).match(/"text":"[^"]*"(?=[^}]*"mark":true)/g)?.map((s) => s.slice(8, -1)) ?? [];
  assert.equal(marked.join(""), "An edit made offline shows on another device");
  assert.equal(findPassage(blocks, "Travellers open saved trips").index, 0, "bold marks are forgiven");
  assert.equal(findPassage(blocks, "the template's hint"), null, "an HTML comment isn't part of it");
});
