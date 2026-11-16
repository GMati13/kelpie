// What needs the person's attention, for the marks that count it (#249). So far: the agents waiting
// for the person on a prompt (Herdr's `blocked`), every profile's, and what the footer's attention mark
// says about them. Its words and its click (kelpie.next-agent, stories.js nextAgent()) both come from
// here, so they can't disagree again (#250: the mark counted agents while its click went through the
// shown profile's Next and opened Clean up all). Host reads only, so a skin can use it too.
import { agents, focused } from "./host.js";

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
