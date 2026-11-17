# Kelpie's routine: what next

For when none of the person's own planning skills fits (SKILL.md). Read only, unattended.

What already needs the person (an agent waiting on them, failing checks, requested changes, a review asked of them, something to clean up) is in their Next queue: don't pick that, find what comes after it.

1. **Check the live state**, reading only, with the access you already have; Kelpie's snapshot is a starting point, and where the board or GitHub say otherwise, trust them. If something is out of reach, skip it and work with the rest.
   - The board: the current sprint, then the backlog.
   - GitHub: open pull requests, the person's and their team's.
2. **Rank what they could do** on this ladder. Don't offer a lower rung while a higher one has something real:
   1. Finish their own sprint work: their tickets not started yet; anything of theirs that's blocked, and what would unblock it. A ticket already in progress (on the board, or open in Kelpie with a space, an agent or a pull request) is in their hands already: don't pick it.
   2. Help the sprint land: unassigned sprint tickets that fit the work they do (judge it from their own tickets and pull requests), teammates' pull requests waiting for a review, tickets that look done but weren't moved.
   3. Get ahead: backlog tickets likely to come next that fit their work, and unclear ones worth asking about now. If no sprint is running, the next planned sprint first, then the backlog.
   4. Only when 1 to 3 have nothing real, make things better: in the repositories under this folder they've worked in lately, 2 or 3 small, concrete improvements (flaky or slow tests, TODO or FIXME notes worth doing, outdated or vulnerable dependencies, missing docs or types, CI warnings, a small refactor near recent work), each with the file or area and why it pays off.
3. **Pick 3 to 5, best first.** Name each the way their sidebar shows it: a story, or a task without a parent, by its own key; a subtask by its story's key (say which subtask in why). One per story. Improvements from rung 4 have no ticket: they're ideas.
4. **Hand the picks to Kelpie**, best first: each a ticket key, a pull request link, or an idea (a short brief for an agent, and where), with `action`, what their Next queue shows (a verb first, under 60 characters), and `why`, one short line on why now.
