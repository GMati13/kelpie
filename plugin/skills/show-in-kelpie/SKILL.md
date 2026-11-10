---
name: show-in-kelpie
description: Point the person to the exact place in a Jira story's description, opened and marked in Kelpie (their Herdr story view), instead of only quoting it. Use this whenever they ask where a story or ticket says, mentions, requires or describes something ("where does it say…", "which part covers…", "show me the acceptance criteria about…", "is that actually in the ticket?", "point me to it"), even when they don't mention Kelpie, and whenever you're about to quote a story's description back at them to back up an answer.
---

# Show it in Kelpie

The person reads their stories in Kelpie. When they ask where a story says something, a quote in the chat makes them go and find it again; opening the story with the passage marked lets them read it in its context, with what's around it. So show it there, and still answer in the chat.

## Steps

1. **Read the story's description** the way you normally reach Jira. If you can't reach it, say so and stop: don't guess a passage.
2. **Pick the passage**: the sentence or few that answer the question, nothing longer. If the description doesn't say it, tell them so rather than showing the closest thing.
3. **Call `show_passage`** (the Kelpie plugin's tool):
   - `key`: the story the description belongs to.
   - `quote`: the words copied exactly from the description. Kelpie finds the passage by its words, so a paraphrase or summary lands on a "closest match" or nothing at all. Case, spacing, quote marks and Markdown don't matter; use `…` for words you leave out of a longer passage.
   - `note`: a few words on what it is, shown above it ("Done when, point 2").
4. **Answer**: one line on what Kelpie did (shown, or what it said when it couldn't), then the answer to their question, with the passage quoted briefly if it helps.

## Limits

- **Subtasks:** Kelpie shows a story's own description, not a subtask's. When the passage is in a subtask's description, quote it, say which subtask it's in, and tell them it can't be shown in Kelpie yet.
- **Not in the shown profile:** Kelpie shows stories of the profile on screen; if it says the story isn't in the list, pass that on.
- **No tool:** if `show_passage` isn't available or Kelpie can't be reached, quote the passage and say where in the description it is (its heading, the list item).
