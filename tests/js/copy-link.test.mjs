// KELPIE-239: Copy link (and Copy key, for a ticket) in the right-click menus of what Kelpie shows: a
// story's row and title row, a subtask, a pull request's line in the details, the sidebar's pull
// request rows and a lone pull request's title row. Only an http(s) link from the loaded data is
// copied, and a toast says so.
import { DEMO, draw, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers, texts, walk } from "gpui-kit";
import { byId } from "../lib/snapshot.mjs";
import { Stories, StoryBody, StoryList, copyKey, copyLink, linkOf } from "../../mods/kelpie/stories.js";
import { DEMO_PROJECT_PROFILE } from "../lib/stories.mjs";

const PROJECT = { jira: null, project: DEMO_PROJECT_PROFILE.project };
let stories, projectStories;
before(async () => {
  setupDemoWorld({ profile: PROJECT }); projectStories = await loadStories(StoryList);
  setupDemoWorld(); stories = await loadStories(StoryList);
});

// A right-click on the element with that id, then the menu's row with that label pressed; what went
// to the clipboard and the toasts shown.
async function pick(View, elId, menuId, label, { project = false, ...opts } = {}) {
  setupDemoWorld({ stories: project ? projectStories : stories, ...(project ? { profile: PROJECT } : {}), ...opts });
  if (opts.preview) mock.state.shared.set("kelpie.stories.preview", { [DEMO]: opts.preview });
  const { view, cx } = await draw(new View());
  const node = walk(view.render(cx)).find((n) => n.calls.some(([m, a]) => m === "id" && a[0] === elId) && n.calls.some(([m, a]) => m === "on_mouse_down" && a[0] === "right"));
  assert.ok(node, `${elId} opens a menu on a right-click`);
  node.calls.find(([m, a]) => m === "on_mouse_down" && a[0] === "right")[1][1]({ local_position: { x: 20, y: 10 } }, { ...cx, stop_propagation() {} });
  assert.equal(view.menu, menuId);
  const open = view.render(cx);
  const labels = texts(byId(open, `${menuId}-menu-list`));
  const clip = [];
  mock.calls.length = 0;
  if (label) {
    let i = 0;
    while (byId(open, `${menuId}-row-${i}`) && !texts(byId(open, `${menuId}-row-${i}`)).includes(label)) i++;
    assert.ok(byId(open, `${menuId}-row-${i}`), `${label} is in the menu`);
    handlers(open).find((h) => h.id === `${menuId}-row-${i}`).fn({}, { ...cx, write_to_clipboard: (x) => clip.push(x) });
  }
  return { labels, clip, toasts: mock.of("notify").map(([n]) => n.title) };
}

test("a story's row copies its link and its key, each with a toast", async () => {
  const link = await pick(StoryList, "story-ACME-142", "story-menu-ACME-142", "Copy link");
  assert.equal(link.clip.length, 1);
  assert.match(link.clip[0], /^https:\/\/jira\.example\.com\/browse\/ACME-142$/);
  assert.deepEqual(link.toasts, ["Copied link to ACME-142"]);
  const key = await pick(StoryList, "story-ACME-142", "story-menu-ACME-142", "Copy key");
  assert.deepEqual(key.clip, ["ACME-142"]);
  assert.deepEqual(key.toasts, ["Copied ACME-142"]);
});

test("on a GitHub Project, a story's row copies its GitHub issue's link", async () => {
  const { labels, clip, toasts } = await pick(StoryList, "story-ACME-142", "story-menu-ACME-142", "Copy link", { project: true });
  assert.ok(labels.includes("Open on GitHub"));
  assert.match(clip[0], /^https:\/\/github\.com\/kelpie--demo\/acme\/issues\/142$/);
  assert.deepEqual(toasts, ["Copied link to ACME-142"]);
});

test("a story's title row has a menu: open, copy link, copy key", async () => {
  const { labels, clip, toasts } = await pick(Stories, "story-head-text", "head-menu", "Copy link", { shown: "ACME-142" });
  for (const w of ["Open on the board", "Copy link", "Copy key"]) assert.ok(labels.includes(w), w);
  assert.match(clip[0], /\/browse\/ACME-142$/);
  assert.deepEqual(toasts, ["Copied link to ACME-142"]);
});

test("a lone pull request's title row copies the pull request's link", async () => {
  const { labels, clip, toasts } = await pick(Stories, "story-head-text", "head-menu", "Copy link", { preview: "pull:docs#58" });
  assert.deepEqual(labels.filter((w) => !/#/.test(w)), ["Open on GitHub", "Copy link"]);
  assert.match(clip[0], /^https:\/\/github\.com\/.+\/pull\/58$/);
  assert.deepEqual(toasts, ["Copied link to docs#58"]);
});

test("a subtask's row copies its link", async () => {
  const { clip, toasts } = await pick(StoryBody, "sub-row-ACME-143", "sub-menu-ACME-143", "Copy link", { shown: "ACME-142" });
  assert.match(clip[0], /\/browse\/ACME-143$/);
  assert.deepEqual(toasts, ["Copied link to ACME-143"]);
});

test("a pull request's line in the details copies its link, with a toast", async () => {
  const { clip, toasts } = await pick(StoryBody, "pr-row-web#418", "pr-menu-web#418", "Copy link", { shown: "ACME-142" });
  assert.match(clip[0], /^https:\/\/github\.com\/.+\/pull\/418$/);
  assert.deepEqual(toasts, ["Copied link to web#418"]);
});

test("the sidebar's pull request rows copy their links: a review for you and one of yours", async () => {
  const review = await pick(StoryList, "review-api#305", "review-menu-api#305", "Copy link");
  assert.deepEqual(review.labels.filter((w) => !/#/.test(w)), ["Open on GitHub", "Copy link"]);
  assert.match(review.clip[0], /\/pull\/305$/);
  assert.deepEqual(review.toasts, ["Copied link to api#305"]);
  const mine = await pick(StoryList, "mine-docs#58", "mine-menu-docs#58", "Copy link");
  assert.match(mine.clip[0], /\/pull\/58$/);
});

// Only an http(s) link from the loaded data: anything else is neither offered nor copied.
test("nothing but an http(s) link is copied, nor offered", async () => {
  assert.equal(linkOf("https://github.com/a/b/pull/1"), "https://github.com/a/b/pull/1");
  for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "https://x.example/a b", "", null, undefined, 42]) assert.equal(linkOf(bad), null, String(bad));
  const clip = [];
  mock.calls.length = 0;
  assert.equal(copyLink({ write_to_clipboard: (x) => clip.push(x) }, "file:///etc/passwd", "ACME-1"), false);
  assert.deepEqual(clip, []);
  assert.deepEqual(mock.of("notify"), [], "no toast when nothing was copied");
  setupDemoWorld({ stories });
  const { view } = await draw(new StoryBody());
  const p = { url: "javascript:alert(1)", number: 9, repository: { nameWithOwner: "x/y" } };
  const labels = view.prMenuRows({ profile: { id: DEMO } }, { key: "ACME-1" }, p, "y#9").map((r) => r.label);
  assert.ok(!labels.includes("Copy link"), "no Copy link for a link that isn't http(s)");
  copyKey({ write_to_clipboard: (x) => clip.push(x) }, "ACME-1");
  assert.deepEqual(clip, ["ACME-1"]);
});
