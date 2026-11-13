// The Desk's Screenshots view (desk.js deskNow): the tab bar offers it beside the Desk's tabs, picking it
// shows the Artifacts panel's story copy ("story-shots") scoped to the Desk's agents' Claude sessions,
// those sessions are remembered once an agent's tab closes, and a tab or a new one goes back to the
// terminals.
import { DEMO, fakeCx, loadStories, setupDemoWorld } from "../lib/views.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "herdr";
import { handlers } from "gpui-kit";
import { render } from "../lib/snapshot.mjs";
import { StoryList } from "../../mods/kelpie/stories.js";
import { deskSessions, deskView } from "../../mods/kelpie/desk.js";
import { deskOf, profiles, saveProfile } from "../../mods/kelpie/config.js";
import Quiet from "../../mods/kelpie/main.js";
import { skinTheme } from "../../mods/kelpie/skins/index.js";

let stories;
before(async () => { setupDemoWorld(); stories = await loadStories(StoryList); });

const SESSION = "0a1b2c3d-1111-2222-3333-444455556666";
// The Desk shown, its agent's terminal running a Claude whose session is SESSION, with two images.
function world() {
  setupDemoWorld({ stories, shown: "Desk", props: { role: "toolbar" } });
  mock.on.hc = (args) => (args[0] === "get" ? { code: 0, stdout: JSON.stringify({ foreground: { pid: 4242 } }), stderr: "" } : undefined);
  mock.on.exec = (cmd, args) => {
    const script = String(args?.[1] ?? "");
    if (cmd === "sh" && script.includes("/sessions/")) return { code: 0, stdout: `\n${JSON.stringify({ sessionId: SESSION })}\n`, stderr: "" };
    if (cmd === "sh" && script.includes("scratchpad")) return { code: 0, stdout: "/t/a.png\n/t/b.png\n", stderr: "" };
    return undefined;
  };
  // Its key loop (nextCommand) never resolves under the stub, so init's tasks aren't kept.
  const view = new Quiet({});
  view.init({}, { ...fakeCx(), spawn() {} });
  return { view, cx: fakeCx() };
}
const deskAgent = () => mock.state.agents.find((a) => a.space === deskOf(profiles()[0]).id);
// The element's last click handler (a tab's own is replaced by the bar's, which also picks the view).
const click = (el, id) => handlers(el).findLast((h) => h.id === id).fn({}, fakeCx());

test("the Desk's tab bar offers Screenshots, counted from its agents' sessions", async () => {
  const { view, cx } = world();
  const first = render(view.render(cx), skinTheme());
  assert.match(first, /#view-shots/, "Screenshots beside the Desk's tabs");
  await cx.settle();
  assert.match(render(view.render(cx), skinTheme()), /#view-shots[\s\S]*?"2"/, "its count once gathered");
});

test("picking Screenshots shows the Artifacts panel scoped to the Desk's sessions", async () => {
  const { view, cx } = world();
  view.render(cx);
  await cx.settle();
  click(view.render(cx), "view-shots");
  const profile = profiles()[0];
  assert.equal(deskView(profile), "shots");
  view.render(cx);
  assert.deepEqual(mock.sharedValue("kelpie.artifacts.sessions"), {
    key: `desk:${DEMO}`, desk: true, ids: [SESSION], keys: {}, terminals: { [SESSION]: deskAgent().address },
    on: null, started: true, agents: [deskAgent().address],
  });
  assert.ok(mock.of("run").some(([name, args]) => name === "layout.select" && args.stack === "main-stack" && args.child === "story-shots"),
    "the main area shows the Screenshots block");
  // A tab of the Desk takes it back to its terminals.
  click(view.render(cx), `tab-${deskAgent().tab}`);
  assert.equal(deskView(profile), "agent");
  mock.calls.length = 0;
  view.render(cx);
  assert.ok(mock.of("run").some(([name, args]) => name === "layout.select" && args.child === "main"), "back on the terminals");
});

test("an agent's screenshots stay once its tab closes", async () => {
  world();
  const profile = profiles()[0];
  assert.deepEqual(await deskSessions(profile), [{ id: SESSION, terminal: deskAgent().address }]);
  mock.state.agents = mock.state.agents.filter((a) => a !== deskAgent());
  assert.deepEqual(await deskSessions(profile), [{ id: SESSION, terminal: null }], "remembered, with no terminal to chat to");
  saveProfile(profile.id, null);
  assert.equal(mock.sharedValue("kelpie.desk.sessions")?.[DEMO], undefined, "a deleted profile's go with it");
});

test("a story's space never gets the Desk's Screenshots", () => {
  setupDemoWorld({ stories, shown: "ACME-142", props: { role: "toolbar" } });
  const view = new Quiet({});
  view.init({}, { ...fakeCx(), spawn() {} });
  view.render(fakeCx());
  assert.equal(mock.sharedValue("kelpie.artifacts.sessions"), null);
  assert.equal(mock.of("hc").length, 0, "nothing gathered for the Desk");
});
