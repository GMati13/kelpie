# Kelpie's routine: write a test for it

For when none of the person's own skills fits (SKILL.md).

1. **Read the code and what it promises**: the file or lines, what calls them, and the ticket or pull request they're part of.
2. **Find the tests around it** and follow them: the same framework, folder, naming and style. No new test tools unless the repository has none.
3. **Write the test** for what the code promises: the usual case, its edges, and the bug the person points at, if any.
4. **Run it** the repository's way, where you may (not someone else's pull request).
5. **Report** in a few lines: what it covers, whether it passed or what its failure shows, and what's still untested.
