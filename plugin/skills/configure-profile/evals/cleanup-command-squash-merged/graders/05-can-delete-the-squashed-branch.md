---
type: llm
focus: trace
weight: 1
---

The proposed clean-up could actually delete 12-offline once it judges it merged: as git branch -d refuses a branch whose own commits aren't in main, it deletes with git branch -D (or another forced delete) after its own content check. A plan that deletes only with git branch -d, or says it never forces, fails this
