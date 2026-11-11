---
type: llm
focus: trace
weight: 1
---

The run finds why the branch is kept: 12-offline's changes reached main under other commit hashes (rebased or squashed), so the script's commit-based check (merge-base --is-ancestor) calls it not merged
