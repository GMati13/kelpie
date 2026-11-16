// What needs the person's attention, for the marks that count it (#249). So far: the agents waiting
// for the person on a prompt (Herdr's `blocked`), every profile's, and what the footer's attention mark
// says about them. Its words and its click (kelpie.next-agent, stories.js nextAgent()) both come from
// here, so they can't disagree again (#250: the mark counted agents while its click went through the
// shown profile's Next and opened Clean up all). Host reads only, so a skin can use it too.
import { agents, focused, memo, shared } from "./host.js";

// Agents that ended their turn waiting on the person (#251, triage.js keeps them): shared, by profile,
// then agent address. Here so a view can read it without the triage code.
export const WAITING = "kelpie.waiting";
const RESTING = new Set(["done", "idle"]);
// Every agent's entry, by address, whatever its profile (one read per render, memo()).
const entries = () => memo("waiting", () => new Map(Object.values(shared(WAITING) ?? {}).flatMap((byAgent) => Object.entries(byAgent ?? {}))));
// What an agent waits on the person for, while it rests: its entry ({ line, kind, at, seen, … }), or
// null. Set aside with its ✕ (`aside`), it doesn't count until its next turn.
export function waitsOnYou(a, state = "waiting") {
  if (!a || !RESTING.has(a.status)) return null;
  const e = entries().get(a.address);
  return e?.state === state && !e.aside ? e : null;
}
// An agent's state for its mark (ui.js agentMark()): Herdr's, or "asks" while it waits on the person
// (#252): the same in the tab bar, a pane's header, the sidebar's rows and a subtask's slot.
export const agentStatus = (a) => (waitsOnYou(a) ? "asks" : a?.status ?? null);

// The agents waiting for the person on a prompt, each with a pane to show.
export const blockedAgents = () => agents().filter((a) => a.status === "blocked" && a.pane);
// The agents that ended their turn waiting on the person (#252), every profile's, each with a pane to
// show, the longest waiting first.
export const waitingAgents = () => agents().filter((a) => a.pane && waitsOnYou(a))
  .sort((x, y) => (entries().get(x.address)?.at ?? 0) - (entries().get(y.address)?.at ?? 0));

// What the mark says: { n, w, here, words }: `n` agents blocked on a prompt, `w` waiting on you.
// `here`: the only one is the focused pane, so a click has nowhere else to go and says so rather than
// jumping elsewhere. A click goes blocked first, then the longest waiting (stories.js nextAgent()).
export function attention() {
  const blocked = blockedAgents(), waiting = waitingAgents();
  const n = blocked.length, w = waiting.length;
  const only = n + w === 1 ? blocked[0] ?? waiting[0] : null;
  const here = Boolean(only) && only.pane === focused()?.pane;
  const needs = n ? (n === 1 ? "An agent needs you" : `${n} agents need you`) : "";
  const waits = w ? (n ? `${w} waiting on you` : w === 1 ? "An agent is waiting on you" : `${w} agents are waiting on you`) : "";
  const said = [needs, waits].filter(Boolean).join(" · ");
  const words = !said ? "" : here ? `${said}: it's here` : `${said}: show ${only ? "it" : "the next"}`;
  return { n, w, here, words };
}
