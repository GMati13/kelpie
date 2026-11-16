# Kelpie's routine: work on a ticket

For when none of the person's own skills fits (SKILL.md). It's generic on purpose: it follows the repository's own ways, which it reads, rather than assuming any.

## 1. Understand the work

- Read the ticket through your own access: its description, its comments, and, for a story, its subtasks; for a subtask, its story. If you can't reach the board, say so, and ask the person what the ticket asks for rather than guessing from its key.
- Read what the repository says about how it's worked on: its `CLAUDE.md`, contributing notes, rules, the tests around the code you'll touch. Its conventions beat your habits.
- Say back in a few lines what you'll do, so a misunderstanding shows before any work is done.

## 2. Plan before a big change

A small, clear change (one place, one obvious way) can go ahead. Anything bigger, or with a choice the ticket leaves open, gets a short plan first: the parts in order, what each changes, how it's checked, and the questions only the person can answer. Then stop and wait for their OK, and put it in their Next queue (the `ask-through-next` skill). Building on your own guesses costs the person more than a question does.

## 3. Build it the repository's way

- Work on a branch of its own, unless the repository says otherwise. If another agent's uncommitted changes are in your way, don't stash, revert or overwrite them: find whose they are and tell the person.
- Keep the change to what the ticket asks. Note anything else you find for later instead of fixing it now.
- Add or update tests the way the repository does, and run its checks (tests, linters, type checks) before calling it done.

## 4. Deliver by its conventions

- Commit and open a pull request the way the repository does: its commit message format, its branch and title naming, the ticket key where its tools look for it. If the conventions aren't written down, follow the repository's recent history.
- Push and open a pull request only when the person has asked for it to be delivered. Never merge or deploy unasked.

## 5. Report

In a few lines: what changed, how it was checked, the pull request's link if there is one, and anything left open. Anything waiting on the person also goes into their Next queue.
