---
name: find-the-agent
description: Find which of the person's Claude agents is working on something, the Claude agent itself, so you can take them to it in Kelpie (their Herdr layout of stories and agents) or message it directly, with Kelpie's find_agents and show_agent. Use this whenever they ask who or which agent is editing, changing or working on a file, folder, repo or ticket ("who's touching tokens.ts?", "which agent has ACME-12?", "what is the agent in the web repo doing?"), to be switched to, taken to or shown an agent ("take me there", "show me that agent", "switch me to the one fixing login"), or to tell, ask or hand something to another agent ("tell ACME-12's agent the API changed", "ask the one on the web repo whether it's done with tokens.ts"). Use it too, unasked, whenever another agent's work is in your way: uncommitted changes you didn't make blocking a pull, checkout, rebase or merge, or edits to a file you're about to change. Find whose work it is and point the person to it, instead of stashing, reverting, resetting or overwriting it.
---

# Find the agent

The person runs many Claude agents at once, often several in one folder. Kelpie knows every one: its tab and space, its story, its state, its folder, and what its session started on and changed. So "who is editing this?" is one question to Kelpie, not a dig through session transcripts, process files or Herdr's internals, which are slow, fragile and not yours to rely on.

## Finding

Call `find_agents` with what you know, as narrow as you can make it:

- a file: `file`, a full path or one relative to the repo (`web/src/app.ts`): the agents whose sessions changed it;
- a folder or repo: `folder`, a full path;
- a ticket: `key`;
- anything else (a feature, a phrase from the task): `words`.

Each agent comes back with `claude`, the Claude agent itself (its session's `name` and messaging `address`, what you reach it by), an `id` (for show_agent), its tab and space, its ticket, its state (working, waiting for you, done, idle), its folder, its session's name, the message that started it and the files it changed lately. Your own entry is marked `you`: leave it out of what you report.

Answer in a line or two per agent: its tab and space (what the person sees in Kelpie), what it's doing, its state, and why it matches (the file it changed, and when). If none match, say so, and that the change may have been made by hand or by an agent that has since closed. Don't then go looking in Claude's or Herdr's own files.

## Taking them there

When they ask to be taken to an agent, call `show_agent` with its `id` from `find_agents`, never one you made up or read from a terminal. It only switches what's on their screen; it sends the agent nothing. Say which agent you showed them. With several matches, show the one they mean; if that's unclear, list them and ask which.

## Reaching the agent itself

When the person asks you to tell, ask or hand something to another agent, or you found something it needs (an API it calls changed, a file it edits is one you need too), find it with `find_agents` and message that Claude directly with Claude's own messaging between sessions, addressed by its `claude.address` (else its `claude.name`). Only its `claude` from `find_agents` names it: never an address you made up or read from a terminal. Without a `claude` (an agent on another machine has no `address`; a demo's stand-in has none), say you can't reach it and offer to take the person there instead.

In the message, say who you are (your tab and ticket), what you found or ask, and that it comes from you, not the person. Keep it to information and questions: don't give it work the person didn't ask for, don't tell it to change, commit or drop its work unless the person said so, and don't message it to chase it or to ask over and over whether it's done. Tell the person what you sent and to whom.

## When another agent's work is in your way

You find changes you didn't make: `git pull` or a checkout refuses because of local edits, a file you're about to edit has uncommitted changes, a branch moved under you. In a folder several agents share, those are most likely another agent's work in progress. Stashing, reverting, resetting, checking out over them or overwriting them can destroy work the person can't get back, and the other agent then carries on from a state that's gone.

So leave them as they are:

1. Call `find_agents` with the files in the way (or the folder).
2. Tell the person whose work it is (tab, space, ticket, state) and what's blocked, and ask how they'd like it settled: the other agent commits or finishes first, you work in a worktree of your own, or they decide.
3. Offer to take them to it with `show_agent`, or to let it know its changes block you (a message as above, asking, not telling it what to do with them); if you're ending your turn waiting on their answer, also put it in their Next queue (`add_to_next`), as they may not be watching your terminal.

Only touch the other changes once the person says so.

## When Kelpie can't help

If the tools aren't there or Kelpie can't be reached, say so plainly, and still don't touch changes that aren't yours: tell the person what's in the way and ask.
