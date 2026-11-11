// GitHub's API limits, per account: every gh call Kelpie makes (pulls.js gh()) goes through guarded().
// GitHub gives each account a budget an hour (GraphQL 5000 points, REST 5000 requests), shared by every
// program signed in as it, and refuses bursts beyond it too (its secondary limits). Once refused, Kelpie
// asks nothing more of that kind (GraphQL or REST) as that account until the budget comes back: asking
// on would only keep the account refused, for the person's own agents and scripts too. Each GraphQL
// answer that says what's left (`rateLimit`, asked in every load's queries) is kept, so the story list
// loads less often while it runs low (stories.js Stories.load()).

import { setShared, shared } from "herdr";
import { clock12 } from "./ui.js";

// { [account, "" for gh's active one]: { graphql|core: { until, hits } } }: refused until `until`,
// `hits` times in a row. Shared, so a reload or restart mid-limit doesn't ask again at once.
export const LIMIT = "kelpie.github.limit";
// What the last answer said is left, by `<account>:graphql`: { remaining, limit, reset }. Every copy of
// the mod runs in one context, so all of them see it; it isn't kept over a restart, where the first
// load's answer says it again.
const LEFT = {};
const LOW_SHARE = 0.1; // under a tenth of the budget left, it's low
export const LOW_EVERY = 10 * 60 * 1000; // how often the story list loads while it's low
// Refused with budget left (a secondary limit) and no time given: wait this long, doubling each time
// in a row, up to an hour.
const SECONDARY = 5 * 60 * 1000;
const MAX_WAIT = 60 * 60 * 1000;

const who = (account) => account || "";
// Which of the account's budgets a gh call spends: `api graphql` GraphQL's, any other `api` REST's.
const resourceOf = (args) => (args[0] !== "api" ? null : args[1] === "graphql" ? "graphql" : "core");
const RATE = /rate limit|abuse detection|HTTP 429/i;

// GitHub refusing a call for its limits: in gh's own message, or a GraphQL answer's errors (only a
// GraphQL answer is read: a REST answer's output is the thing asked for, a description say, which may
// say anything).
function refused(r, resource) {
  if (r.code === 0) return false;
  if (RATE.test(r.stderr ?? "")) return true;
  if (resource !== "graphql") return false;
  let out = null;
  try { out = JSON.parse(r.stdout || "null"); } catch { return false; }
  return (out?.errors ?? []).some((e) => /RATE_LIMIT/i.test(String(e?.type ?? "")) || RATE.test(String(e?.message ?? "")));
}

// The refusal in force for the account's `resource` (GraphQL by default), or null.
export function blockedFor(account, resource = "graphql", now = Date.now()) {
  const b = shared(LIMIT)?.[who(account)]?.[resource];
  return b && now < b.until ? b : null;
}

// What's left of the account's GraphQL budget when it's low (under a tenth), or null.
export function lowFor(account, now = Date.now()) {
  const b = LEFT[`${who(account)}:graphql`];
  return b && now < b.reset && b.limit > 0 && b.remaining < b.limit * LOW_SHARE ? b : null;
}

// What the person reads, in plain words with the time, never GitHub's own message (it names the
// account's user id).
export const limitMessage = (b) => `GitHub's limit for this account is used up: Kelpie tries again at ${clock12(new Date(b.until))}`;
export const lowMessage = (b) => `GitHub's limit for this account is running low: Kelpie loads less often until ${clock12(new Date(b.reset))}`;
// For the story list: the account's GitHub limit as it stands, { until } used up or { reset } running
// low, or null.
export function limitOf(account, now = Date.now()) {
  const b = blockedFor(account, "graphql", now) ?? blockedFor(account, "core", now);
  if (b) return { until: b.until };
  const low = lowFor(account, now);
  return low ? { reset: low.reset } : null;
}

// What a GraphQL answer says is left, kept for lowFor().
function note(account, r) {
  let left = null;
  try { left = JSON.parse(r.stdout || "null")?.data?.rateLimit; } catch { return; }
  const reset = Date.parse(left?.resetAt ?? "");
  if (Number.isFinite(left?.remaining) && Number.isFinite(left?.limit) && Number.isFinite(reset)) LEFT[`${who(account)}:graphql`] = { remaining: left.remaining, limit: left.limit, reset };
}

// Until when to stop asking, once refused: the budget's reset when it's used up (GitHub's rate_limit,
// which costs nothing), else a secondary limit's wait.
async function untilOf(account, resource, run, now) {
  const had = shared(LIMIT)?.[who(account)]?.[resource];
  const hits = had && now - had.until < MAX_WAIT ? (had.hits ?? 0) + 1 : 1;
  let reset = NaN;
  const r = await run(["api", "rate_limit"]).catch(() => null);
  try {
    const b = JSON.parse(r?.code === 0 ? r.stdout : "null")?.resources?.[resource];
    if (b && b.remaining === 0) reset = Number(b.reset) * 1000;
  } catch { /* the wait below */ }
  const until = Number.isFinite(reset) && reset > now ? reset : now + Math.min(SECONDARY * 2 ** (hits - 1), MAX_WAIT);
  return { until, hits };
}

// Runs a gh call (`run(args)`, gh.sh as the account) unless GitHub refuses that account now; a call
// GitHub refuses for its limits stops the rest until it can be asked again. Both answer as a failed
// gh run whose message says so in plain words.
export async function guarded(account, args, run, now = () => Date.now()) {
  const resource = resourceOf(args);
  if (!resource) return run(args);
  const b = blockedFor(account, resource, now());
  if (b) return { code: 1, stdout: "", stderr: limitMessage(b), limited: true };
  const r = await run(args);
  if (resource === "graphql" && r.code === 0) note(account, r);
  if (!refused(r, resource)) return r;
  const at = now();
  // Calls run side by side (a load's searches) are refused together: the first one's wait stands.
  const already = blockedFor(account, resource, at);
  if (already) return { code: 1, stdout: "", stderr: limitMessage(already), limited: true };
  const block = await untilOf(account, resource, run, at);
  const all = shared(LIMIT) ?? {};
  // Refusals long over are dropped as this one is written.
  const kept = Object.fromEntries(Object.entries(all).map(([a, v]) => [a, Object.fromEntries(Object.entries(v ?? {}).filter(([, x]) => at - (x?.until ?? 0) < MAX_WAIT))]));
  setShared(LIMIT, { ...kept, [who(account)]: { ...(kept[who(account)] ?? {}), [resource]: block } });
  return { code: 1, stdout: "", stderr: limitMessage(block), limited: true };
}
