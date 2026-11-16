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

// What the mark says: { n, here, words }. `here`: the only agent waiting is the focused pane, so a
// click has nowhere else to go and says so rather than jumping elsewhere.
export function attention() {
  const list = blockedAgents();
  const n = list.length;
  const here = n === 1 && list[0].pane === focused()?.pane;
  const words = !n ? "" : here ? "An agent needs you: it's here" : n === 1 ? "An agent needs you: show it" : `${n} agents need you: show the next`;
  return { n, here, words };
}
