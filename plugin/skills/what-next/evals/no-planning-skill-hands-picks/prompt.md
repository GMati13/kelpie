---
tags: [skill-creator]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, mcp__plugin_kelpie_kelpie__add_to_next, mcp__plugin_kelpie_kelpie__get_next, mcp__plugin_kelpie_kelpie__suggest_next]
---

/kelpie:what-next Acme
board: https://jira.example.com/jira/software/projects/ACME/boards/7
owner: acme

Kelpie's snapshot: profile Acme, board ACME (sprint 14, ends Friday).
Columns: To Do, In Progress, In Review, QA, Done.
Stories:
- ACME-142: In Progress, yours, an agent working, pull request web#410 open (checks failing)
- ACME-176: To Do, yours, priority Low
- ACME-178: To Do, yours, priority Highest
- ACME-180: To Do, yours, priority High
- ACME-185: To Do, unassigned
- ACME-190: QA, yours
Reviews for you: web#421 (ACME-166)
Desk agents: none

Hand your picks to Kelpie in one call of the Kelpie tool for suggestions: that's the only answer read. If it drops some, it says why: fix those and hand them in again.
