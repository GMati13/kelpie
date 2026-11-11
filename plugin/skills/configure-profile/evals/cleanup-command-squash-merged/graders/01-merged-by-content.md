---
type: llm
focus: trace
weight: 1
---

The proposed clean-up decides whether a branch is merged by its content (main already has its patches, or merging it would change nothing), not only by git branch --merged, git branch -d or git merge-base --is-ancestor
