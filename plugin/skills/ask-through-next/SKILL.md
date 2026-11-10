---
name: ask-through-next
description: Put a question you're leaving for the person into their Next queue in Kelpie, so it doesn't sit unseen at the end of your turn. Use this every time you're about to end a turn waiting on the person before you can go on well: a choice only they can make (a product call, which of two designs, a trade-off the ticket leaves open), a plan or draft they should read before you build, a pull request of yours they need to look at. Use it even when they didn't mention Kelpie or Next, and even when you also ask in your reply. Not for reporting that you're done, for questions you can settle yourself, or for permission prompts.
---

# Ask through Next

The person runs many agents at once and works from Next, Kelpie's queue of what needs them. Kelpie flags an agent only while a permission prompt waits: an agent that ends its turn with a question looks finished, and the question waits in one terminal among many until they happen to look. A line in Next, under your tab's name, takes them to you.

## When

You're about to end your turn, and what you do next depends on them:

- a choice that's theirs to make (the ticket says so, or it changes what users are promised, costs a lot more, or can't easily be undone);
- a plan, design or draft they should read before you build on it;
- your pull request, ready for them to look at.

Not when you're reporting finished work, when you could reasonably decide yourself (say what you chose and why instead), or for a permission prompt (Kelpie shows those).

## How

1. Ask the question in your reply as you normally would, with what they need to answer it. Next only points them to it.
2. Before you finish, call `add_to_next` (the Kelpie plugin's tool) once:
   - `action`: what to do, a verb first, under 60 characters: "Choose read-only or synced offline trips".
   - `why`: one short line on what it's about or why it matters now.
   - `key`: the Jira key you're working on, when there is one; `url` instead for a GitHub page.
3. One call per question. Asking again with the same `action` replaces it, and three at most stay from you. It goes once they click or drop it, or when your terminal closes, so there's nothing to clean up.

If the tool isn't there or Kelpie can't be reached, just ask in your reply.
