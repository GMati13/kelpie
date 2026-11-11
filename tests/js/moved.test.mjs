// A ticket moved in Kelpie (its status chip, Move to Done) shows its new status everywhere at once,
// not only on its chip, and keeps it until a load shows it too: Jira's search lags behind a move, so a
// load right after one still gives the old status (noteMoved()/settleMoved() in stories.js).
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mock, setShared } from "herdr";
import { noteMoved, settleMoved } from "../../mods/kelpie/stories.js";
import { data, issue } from "../lib/stories.mjs";

const PROFILE = { id: "p1" };
const JIRA = { kind: "jira" };
const QA = { id: "21", name: "Send to QA", to: "In QA", toId: "3", category: "indeterminate" };
const loaded = (status) => data({ parents: [issue("ACME-1", "doing")], children: [issue("ACME-2", status, "ACME-1")], mine: ["ACME-2"] });
const shownStatus = () => mock.sharedValue("kelpie.stories.data").p1.data.children[0].fields.status;

beforeEach(() => {
  mock.reset();
  setShared("kelpie.stories.data", { p1: { key: "k", data: loaded("doing"), at: 1, error: null } });
  settleMoved(loaded("qa")); // nothing left over from another test
});

test("a move shows in the shared stories at once, with the status id the list groups by", () => {
  noteMoved(PROFILE, "ACME-2", QA, JIRA);
  assert.deepEqual(shownStatus(), { id: "3", name: "In QA", statusCategory: { key: "indeterminate" } });
});

test("a load that still gives the old status keeps the move, not only for a minute", () => {
  noteMoved(PROFILE, "ACME-2", QA, JIRA);
  const realNow = Date.now;
  Date.now = () => realNow() + 5 * 60 * 1000; // five minutes on, the search still lags
  try {
    assert.equal(settleMoved(loaded("doing")).children[0].fields.status.name, "In QA");
  } finally { Date.now = realNow; }
});

test("once a load shows the move it's forgotten, so a later move by someone else shows", () => {
  noteMoved(PROFILE, "ACME-2", QA, JIRA);
  assert.equal(settleMoved(loaded("qa")).children[0].fields.status.name, "In QA");
  assert.equal(settleMoved(loaded("doing")).children[0].fields.status.name, "In Progress");
});

test("a GitHub Project's option is its own status id", () => {
  noteMoved(PROFILE, "ACME-2", { id: "opt-3", name: "QA", to: "QA", category: "indeterminate" }, { kind: "project" });
  assert.equal(shownStatus().id, "opt-3");
});
