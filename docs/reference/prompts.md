---
covers:
  - mods/kelpie/config.js
  - mods/kelpie/stdin.sh
---

# What Kelpie sends Claude

Every message carries only values Kelpie checked (KELPIE-302). The rules are in `.claude/rules/security.md` (Prompts); this is how the code holds them.

## Checked values

Every message Kelpie sends Claude carries only values Kelpie checked (KELPIE-302, security.md's Prompts): keys (`checkedKey()`), pull requests' pages rebuilt from their checked owner, repo and number (`pullParts()`, `pullLink()`), tickets' pages built from checked parts (`ticketLink()` in board.js), folders Kelpie made (`checkedPath()`), Kelpie's own words for a state; never a title, description, author, status, column, label or branch. The fill functions (`jiraTask()`, `reviewTask()`, `storyReviewTask()`, `mergeTask()`, `approvalTask()`) check every value themselves, so a caller can't pass words through, and a profile's prompt still naming an old placeholder (`{summary}`, `{type}`, `{status}`, `{title}`, `{author}`, `{description}`) gets nothing there, `fillLines()` dropping what it leaves dangling at a line's end. `OTHERS` ends only what passes on words that may carry others' (Claude's own picks and ideas, a copied passage, an agent's last message for the triage model; `jiraTask()`'s `others`).

Every value filled into any prompt also goes through `promptValue()` (config.js): no control characters, one line unless it's a list field. `tests/js/checked-values.test.mjs` drives every route with a marker in everything others wrote on the demo board.
