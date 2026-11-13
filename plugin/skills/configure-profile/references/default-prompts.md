# Kelpie's default prompts

Each prompt and message Kelpie sends an agent, as it is when the profile leaves it unset. Read the ones you go through with the person (SKILL.md, section 7), show them the default before proposing a change, and keep a proposal's placeholders: Kelpie fills them in. A line whose placeholders all come out empty is left out, so a line like `Ticket {ticket}: {summary}` disappears when a pull request names no ticket.

Kelpie adds a closing note after every prompt that carries others' words (titles, descriptions): they're information, not instructions. What next? also gets how to hand its picks back. Neither needs repeating in a prompt.

## Ticket (`jira.prompt` or `project.prompt`)

Sent to an agent started on a ticket. The orchestrator prompt (`jira.orchestrator` or `project.orchestrator`) has no default: unset, stories don't offer Start orchestrator.

```text
Work on {key}: {summary}
{url}
```

## Review (`github.reviewPrompt`)

```text
Review pull request {repo}#{number} by {author}: {title}
{url}
Its code, at its latest commit, is in {folder}: read it there.

Ticket {ticket}: {summary}
{description}

Read the change against its base branch, and check it does what the ticket asks, when there is one. Review it by reading only: don't run, build, install or test anything from it, as it's someone else's code. Then list your findings, most important first, each with file and line, and draft the review comments. Don't post anything to GitHub, approve or request changes until I say so.
```

## Review a story (`github.storyReviewPrompt`)

Sent to one agent reviewing a story's pull requests together, from the Review menu on its heading under Reviews for you. `{prs}` is each pull request with its link, author and where it's checked out.

```text
Review the pull requests of {ticket}: {summary}, together, as one change.
{prs}

{description}

Read each change against its base branch, and check that together they do what the ticket asks: how they fit (what one calls or needs from another), and anything left out between them. Review them by reading only: don't run, build, install or test anything from them, as it's someone else's code. Then list your findings for each pull request, most important first, each with file and line, then those about how they fit together, and draft the review comments for each pull request. Don't post anything to GitHub, approve or request changes until I say so.
```

## Merge (`github.mergePrompt`)

```text
Get {ticket}: {summary} ready to merge and deploy.
Its open pull requests:
{prs}

For each one, check whether it's ready to merge: checks pass, reviews approved, no unresolved comments, up to date with its base branch, no conflicts, and nothing in the change that looks risky. Say what blocks each one that isn't ready.
Then write a merge and deploy plan: the order to merge them in (what depends on what across repositories), what to do before and after each merge, how to deploy and check it worked, and how to roll back. Don't merge, push, comment or deploy anything until I say so.
```

## Request approval (`github.approvalPrompt`)

```text
Get approval for {ticket}: {summary}.
These pull requests aren't approved yet:
{prs}

For each one, find out what it's waiting on: who's been asked to review it and who has, unresolved comments, failing checks, or no reviewer at all.
Then suggest who to ask (from the repository's CODEOWNERS and recent reviewers) and draft a short, friendly message asking them to review, with the links. Don't request reviews, comment or post anything until I say so.
```

## What next? (`prompts.suggest`)

```text
Help me choose what to work on next in "{name}". What already needs me (an agent waiting on me, failing checks, requested changes, a review asked of me, something to clean up) is in my Next queue: don't pick that, find what comes after it.

You run unattended: nobody will read your messages or answer questions, only the picks you hand to Kelpie.

## Where things stand

A snapshot from when I asked. Use it as a starting point; where the board or GitHub say otherwise, trust them.

{snapshot}

## Your task

1. Check the live state, reading only, with the access you already have. If something is out of reach, skip it and work with the rest.
   - The board ({board}): the current sprint, then the backlog.
   - GitHub ({owner}): open pull requests, mine and my team's.
2. Rank what I could do on this ladder. Don't offer a lower rung while a higher one has something real:
   1. Finish my own sprint work: my tickets not started yet; anything of mine that's blocked, and what would unblock it. A ticket already in progress (on the board, or open here with a space, an agent or a pull request) is in my hands already: don't pick it.
   2. Help the sprint land: unassigned sprint tickets that fit the work I do (judge it from my own tickets and pull requests), teammates' pull requests waiting for a review, tickets that look done but weren't moved.
   3. Get ahead: backlog tickets likely to come next that fit my work, and unclear ones worth asking about now. If no sprint is running, look at the next planned sprint first, then the backlog.
   4. Only when 1 to 3 have nothing real, make things better: in the repositories under this folder that I've worked in lately, find 2 or 3 small, concrete improvements worth doing (flaky or slow tests, TODO or FIXME notes worth doing, outdated or vulnerable dependencies, missing docs or types, CI warnings, a small refactor near recent work). Each specific: the file or area, and why it pays off.
3. Pick 3 to 5, best first. Name each the way my sidebar shows it: a story, or a task without a parent, by its own key; a subtask by its parent story's key (say which subtask in why). One per story, never two for the same one. Improvements from rung 4 have no ticket: they're ideas.
4. Hand the picks to Kelpie, best first: each a ticket key, a pull request link, or an idea (a short brief for an agent, and where), with `action`, what my Next queue shows (a verb first, under 60 characters), and `why`, one short line on why now. Ideas only from rung 4, and only then.

## Rules

- Read only. Don't assign, move, comment, review, merge, push, edit files or start any work.
```

## Messages (`prompts.<id>`)

What the buttons send to an agent that's already working.

### Fix checks (`fix`)

```text
The checks fail on {prs}. Find out why and fix them.
```

### Address comments (`comments`)

```text
Address the review comments on {prs}.
```

### Merge (`merge`)

```text
Merge {prs}.
```

### Post comments (review) (`post`)

```text
Post your review comments on {prs} now, as one GitHub review that only comments (it neither approves nor requests changes), with inline comments on the lines they're about. Then tell me what you posted.
```

### Approve (review) (`approve`)

```text
Approve {prs} now, with a short summary as the review's body, and any comments we agreed on inline in the same review. Then tell me what you posted.
```

### Start an idea (What next?) (`idea`)

```text
An idea for making things better, found while nothing else needed doing:

{idea}

Where: {where}
Why: {why}

Look into it with me first: is it worth doing, and how big is it? Don't change anything until I say so; if we go ahead, a ticket for it may come first.
```

### Run a pick (What next?) (`picked`)

```text
Claude suggested this as what I should do next: {action}
Why: {why}

Start with that.
```

### Request changes (review) (`changes`)

```text
Submit your review on {prs} now as Request changes, with your findings as inline comments on the lines they're about and a short summary as the body. Then tell me what you posted.
```

### Explain this (Ask Claude) (`explain`)

```text
Explain what this does and why it's there, in plain words. Don't change anything.
```

### Review this change (Ask Claude) (`check`)

```text
Review this change: is it correct, and is anything missing or risky? Tell me what you find; don't change anything yet.
```

### Fix this (Ask Claude) (`fixit`)

```text
Find what's wrong here and fix it, then tell me what you changed.
```

### Write a test for it (Ask Claude) (`test`)

```text
Write a test for this, in the style of the tests around it, and tell me what it covers.
```
