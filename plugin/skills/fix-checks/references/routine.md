# Kelpie's routine: fix checks

For when none of the person's own skills fits (SKILL.md).

1. **See what fails.** Through your own access, find each failing check on the pull request and read its log: the first real error, not the noise after it.
2. **Find why.** Reproduce it in the repository's own way where you can (the test, lint or build the check runs), in this folder, on the pull request's branch. Decide whether the change caused it, or it's outside the change (a flaky test, the check's own setup, something broken on the base branch).
3. **Fix what the change caused**, the repository's way (its `CLAUDE.md`, rules and tests), keeping to what the pull request is about. A failure outside the change isn't fixed by changing unrelated code: say what it is, and whether running the check again or a separate fix would clear it.
4. **Check it** by running the same thing the check runs, until it passes here.
5. **Push the fix** to the pull request's branch as new commits, following the repository's commit conventions, so the checks run again. Never force-push, skip or turn off a check.
6. **Report** in a few lines: what failed, why, what you changed, and whether you saw it pass. If the checks are still running, say so.
