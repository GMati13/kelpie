# Performance: background scripts and loads

Part of the performance review (#29), for #40: what Kelpie's background work costs, measured, what's fine, and what's worth fixing.

## How it was measured

- **Scripts:** `scripts/bench-background.py` builds a throwaway home in a private temp folder and times each script the way Kelpie runs it (`python3 -I`, a clean environment). The home holds 1,500 Claude sessions (824 MB) on two accounts, spread over a profile folder and 40 worktrees under it, about the size of a busy real one. It also has 200 repos, 30 ticket folders with uncommitted work, and a 5,000-file repo with a pull request ref to check out. Run it again with `python3 -I scripts/bench-background.py` (flags for the sizes, `--help`). It never reads a real home.
- **Where the time goes:** `cProfile` on a warm `sessions.py` run, in-process, so starting Python doesn't hide the script's own work.
- **Stories load:** the requests a load makes, counted against fakes. Jira's are in `tests/js/jira-load.test.mjs`, a GitHub Project's in `tests/js/budget.test.mjs` (#150). How long the three pull request searches take, side by side or as one query, was timed with a few real calls on this public repo.
- **Machine:** a Mac running about 30 Claude sessions at once, with a load average around 225. Every time is inflated: a bare `python3 -I` start took 182 ms, about 9 times its usual. Compare times with that start, or with each other, rather than reading them as absolutes.

## Results

Each time is the median of 3 runs, in milliseconds, on the loaded machine above.

| What | ms | Read as |
|---|---:|---|
| `python3 -I` start alone | 182 | the baseline |
| sessions.py, cold (no index) | 12,244 | reads the 200 newest files whole |
| sessions.py, warm (nothing changed) | 1,726 | its own work is 55 ms (profiled), the rest is starting up |
| sessions.py, one live session grown | 1,949 | reads on from where it stopped |
| sessions.py, one account | 2,919 | as warm, within the noise |
| changes.py, a story's 3 keys among 200 repos | 12,954 | 6 matching repos, 3 git runs each |
| changes.py, 30 keys with work | 26,070 | 33 repos, 3 git runs each |
| changes.py `--unpushed`, 30 keys | 50,501 | a 4th git run per repo |
| changes.py, 30 keys with nothing | 2,754 | 200 `.git/HEAD` reads: cheap |
| review: fetch `pull/<n>/head` (local origin) | 1,443 | the network's, in real use |
| review: worktree add, 5,000 files | 22,081 | git writing every file |
| review: started again (fetch, status, checkout) | 6,026 | |
| `gh auth token --user` (real) | 4,044 | paid by every gh call made as a named account |
| 3 pull request searches side by side (real) | 7,642 | 3 requests, 3 points, 6 gh runs |
| the same 3 searches as one query (real) | 4,920 | 1 request, 2 points, 2 gh runs |

## What's fine

- **sessions.py.** The index does its job. A warm run is a glob, a stat per file and a 131 KB JSON read, about 55 ms of work for 1,500 sessions. Only a session that grew is read, and only from where it stopped. Starting Python costs more than the work, and that's no worse than any script. A cold run (the index deleted, or a first start) reads the newest 200 files whole, so it scales with their size. It happens once. Reading only one account's sessions saves nothing worth having.
- **changes.py's search.** Finding the repos is cheap: it reads `.git/HEAD` directly, as designed. With nothing matching, 200 repos cost about what starting Python costs. It runs only while Changes is shown (again after each 2-minute reload) and before a clean-up, never on a timer of its own.
- **Starting a review.** The fetch and the worktree add are git's own costs, and the checkout already runs beside the ticket lookup. Started again, it moves the worktree to the new commit, not a fresh checkout.
- **A GitHub Project's load** is already held to 10 requests, at most 4 at once, and 21 points (#150).

## Fixed here

- **A Jira board's load with kept stories waited on 5 to 6 round trips one after another; now 3 to 4.** (A Kanban board adds one to both: its sprint question fails first.) It used to ask for the board's settings and sprints, then your issues, then their stories, then the stories kept for what you have open here, and then once more which of those kept stories are yours. Two changes:
  - The kept stories are asked at the same time as the stories' own search (`loadBoard()` in `board.js`).
  - Which ones are yours is read from their assignee. jira.sh now prints the signed-in account's id, from the `X-AAccountId` header it already reads to tell a sign-in worked. When Jira names no account, it still asks.

  Each round trip is a jira.sh run with a Keychain read and a request to Jira, so a load with kept stories saves two of those. Without kept stories it was 3 already. `tests/js/jira-load.test.mjs` counts the rounds. It fails on the old code.

## Worth fixing, by what they'd gain

1. **Ask for the three pull request searches in one query.** Yours open, yours merged and reviews for you are three gh runs today, each its own request. As one GraphQL query with three aliased searches they took 4.9 s instead of 7.6 s, cost 2 points instead of 3, and saved 2 requests (`budget.test.mjs` would go from 10 to 8). Every load pays this, Jira or Project. Open choice: a failed answer then fails the reviews and your pull requests together, where today the reviews fail on their own.
2. **Ask a named GitHub account's token once per load, not once per gh run.** `gh.sh` runs `gh auth token --user` before every call (a second gh process and a Keychain read, 3 to 4 s under load here). A Project load makes up to 10 calls. Keeping the token in the mod's memory for one load would halve the gh processes. It's a security choice (the token would live in JavaScript memory, never in a file or shared state), so the person should decide.
3. **Read the Jira sign-in from the Keychain once per request, not twice.** jira.sh calls `security find-generic-password` once for the token and again for the email, and both are slow. Asked once (`-g` prints both), each request saves one Keychain read. That touches how the token is read, so it needs a careful test.
4. **changes.py: two git runs per repo instead of three, and one for a clean repo.** `git status --porcelain` first skips clean repos. Dirty ones get `git diff HEAD --numstat -p` for the counts and the patch together. That's a third fewer git processes for the Changes view and the clean-up check. A small gain, as it runs only on demand.

Starting a review and `sessions.py` need nothing.
