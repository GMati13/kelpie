# Kelpie's routine: address review comments

For when none of the person's own skills fits (SKILL.md).

1. **Read the review.** Through your own access, read every review comment on the pull request that isn't resolved yet, with its thread and the lines it's about.
2. **Sort them.** For each: a change you'll make, a question you can answer, something you disagree with (say why), or something beyond this change (list it for the person, don't do it). When it's unclear what a reviewer wants, ask the person rather than guess.
3. **Make the changes** the repository's way (its `CLAUDE.md`, rules and tests), keeping to what the pull request is about, and run its checks.
4. **Push** them to the pull request's branch as new commits, following the repository's commit conventions. Never force-push.
5. **Draft a reply** for each comment: what changed (with the commit), or the answer, or why not. Show the drafts; post them and resolve threads only when the person says so.
6. **Report** in a few lines: what you changed for which comment, what's left for the person to decide, and the drafted replies. Anything waiting on them also goes into their Next queue (the `ask-through-next` skill).
