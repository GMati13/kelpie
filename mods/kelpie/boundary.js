// The account boundary (#254): which of Kelpie's profiles a Claude asking through the plugin may see
// and act on. Profiles can run on different Claude accounts (claude.config) so that one account's
// work stays away from the other's, so a tool hands a Claude only its own profile's work: never
// another's by default, never "every profile". Kelpie's own views still read everything; this is only
// what goes to a Claude.
//
// Who asks comes first from what Kelpie sees itself: the asking agent's terminal, listed by Herdr, in
// a profile's space, and the Claude account that terminal's own Claude runs on (its session record).
// Only without those does it take what the plugin's server says of its environment (KELPIE_PROFILE,
// CLAUDE_CONFIG_DIR). A request file can still be written by any program, so this keeps a misled
// Claude from being handed another account's work, not one set on crossing (security.md).
import { agents, spaces } from "./host.js";
import { claudeConfigOf, claudeKey, profileOf, profiles, sharedWith } from "./config.js";
import { claudeSession } from "./ui.js";

// An account as one string however it was written: "" for Claude's own ~/.claude (or none set), else
// its folder without a trailing slash; null when it isn't known (an older plugin sends none).
export const accountKey = (dir) => (dir === undefined || (dir !== null && typeof dir !== "string") ? null : claudeKey(dir));
// The account a profile's agents run on (claudeArgv()).
export const accountOf = (profile) => claudeKey(claudeConfigOf(profile));

// Who is asking: { profile, account, how, why }. `profile` is the asker's own, or null with `why` in
// plain words; `account` its Claude account (accountKey()), null when unknown; `how` where the profile
// came from ("terminal" or "environment"). `session` reads a terminal's Claude session (claudeSession,
// passed in by the tests).
export async function whoAsks(req, { session = claudeSession } = {}) {
  const agent = typeof req?.terminal === "string" ? agents().find((a) => a.address === req.terminal) : null;
  const space = agent ? spaces().find((s) => s.id === agent.space) : null;
  // The terminal's own Claude says its account; what the server says counts only without one.
  const rec = agent ? await session(agent.address).catch(() => null) : null;
  const account = rec ? accountKey(rec.config ?? null) : accountKey(req?.account);
  const inSpace = space ? profileOf(space) : null;
  const named = !inSpace && typeof req?.profile === "string" ? profiles().find((p) => p.id === req.profile) ?? null : null;
  const found = inSpace ?? named;
  const how = inSpace ? "terminal" : named ? "environment" : null;
  if (account === null) return { profile: null, account, how, why: "Kelpie can't tell which Claude account you run on, so it keeps its profiles' work from you. Kelpie's plugin may need updating." };
  if (!found) return { profile: null, account, how, why: "Kelpie can't tell which of its profiles you work in: you aren't running in one of its profiles' spaces." };
  if (account !== accountOf(found)) return { profile: null, account, how, why: "You run on another Claude account than the profile this space belongs to, so Kelpie keeps that profile's work from you. Start Claude from the profile in Kelpie to work on it." };
  return { profile: found, account, how, why: null };
}

// The profiles an asker may see: its own; an asker in none of them, the profiles on its own Claude
// account (their work is already that account's); nothing when its account isn't known.
export function allowedFor(asker) {
  if (asker?.profile) return [asker.profile];
  if (asker?.account === null || asker?.account === undefined || asker?.how) return [];
  return profiles().filter((p) => accountOf(p) === asker.account);
}
export const mayReach = (asker, profile) => Boolean(profile) && allowedFor(asker).some((p) => p.id === profile.id);
// The profiles whose agents an asker may find, show and message: its own (allowedFor()), and those the
// person paired with them in the profile dialog (config.js SHARE). Agents only: settings, Next and
// stories stay each profile's own.
export function agentProfilesFor(asker) {
  const own = allowedFor(asker), ids = new Set(own.map((p) => p.id));
  const paired = own.flatMap((p) => sharedWith(p.id)).filter((id) => !ids.has(id));
  return [...own, ...profiles().filter((p) => paired.includes(p.id))];
}
// A profile of agents the asker reaches only through a pair, said with each such agent (`crossed`).
export const crossedTo = (asker, profile) => Boolean(profile) && !mayReach(asker, profile) && agentProfilesFor(asker).some((p) => p.id === profile.id);
// An agent in a profile's space as its profile (a paired one too); one in a space of no profile only for
// an asker on the same Claude account as that agent's own session (`account`, null when unknown: then
// nobody).
export const mayReachAgent = (asker, { profile, account }) => (profile ? agentProfilesFor(asker).some((p) => p.id === profile.id)
  : account !== null && account !== undefined && asker?.account !== null && asker?.account !== undefined && account === asker.account);

// The one profile a request is about (Next, a story, a passage): the asker's own, else the only one on
// its account. Never the profile shown on screen, which may be another account's.
export function profileFor(asker) {
  if (asker?.profile) return asker.profile;
  const mine = allowedFor(asker);
  if (mine.length === 1) return mine[0];
  if (mine.length > 1) throw new Error("Kelpie can't tell which of its profiles you work in: more than one runs on your Claude account. Start Claude from the profile in Kelpie (its Desk or a story) to work on it.");
  throw new Error(asker?.why ?? "Kelpie can't tell which of its profiles you work in.");
}
