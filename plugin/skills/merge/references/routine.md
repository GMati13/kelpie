# Kelpie's routine: merge

For when none of the person's own skills fits (SKILL.md).

## 1. Check each pull request is ready

Through your own access, for each pull request listed: its checks pass, its reviews are approved, no review comments are left unresolved, it's up to date with its base branch and merges without conflicts, and nothing in the change looks risky for what it says it does. Read what the repository says about merging too (its `CLAUDE.md`, contributing notes, branch rules): its conventions beat your habits. Say plainly what blocks each one that isn't ready.

## 2. Without the person's go: plan, then stop

Write a merge and deploy plan:
- the order to merge them in, and why (what depends on what, across repositories too);
- what to do before and after each merge;
- how it gets deployed, how to check it worked, and how to roll it back.

Then stop. Don't merge, push, comment or deploy anything: say the plan waits for their go, and put that in their Next queue (the `ask-through-next` skill).

## 3. With the person's go: merge what's ready

- Merge each pull request the go covers that step 1 found ready, the way the repository merges (the method its settings or conventions call for), one at a time, checking the next is still ready after each merge.
- One that isn't ready isn't merged: say what blocks it, and leave the rest of the order as the plan would.
- Deploying, releasing and closing tickets are not part of the go: say what comes next, and leave it to the person.

## 4. Report

In a few lines: what was merged (each pull request's link), what wasn't and why, and what's left for the person.
