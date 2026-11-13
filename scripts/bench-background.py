#!/usr/bin/env python3
"""Times Kelpie's background scripts on a made-up home, never the person's own (#40).

    python3 -I scripts/bench-background.py [--sessions N] [--accounts N] [--repos N] [--runs N]

Builds a throwaway home in a private temp folder: Claude accounts (~/.claude, ~/.claude-2…) with
session files under a profile folder and its worktrees, and a profile folder of git repos with
ticket folders. Then runs, as Kelpie does (`python3 -I`, a clean environment):

  sessions.py   cold (no index), warm (nothing changed), one live session grown, and one account's
  changes.py    the keys of a story with uncommitted work, then many keys (the leftovers checks)
  review        REVIEW_CHECKOUT's steps on a repo with many files: the fetch, the worktree add, a
                second start moving it to a newer commit

Prints the median of `--runs` runs of each, in milliseconds, as each finishes (a busy machine makes
every number bigger: the bare `python3 -I` start is printed too, to compare against). Nothing leaves the temp folder, which
goes at the end. Needs python3 and git.
"""

import argparse
import json
import os
import random
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODS = os.path.join(REPO, "mods", "kelpie")


def env(home):
    return {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": home, "LANG": "C",
            "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "Bench", "GIT_AUTHOR_EMAIL": "bench@example.com",
            "GIT_COMMITTER_NAME": "Bench", "GIT_COMMITTER_EMAIL": "bench@example.com"}


def git(home, cwd, *args):
    subprocess.run(["git", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false", *args],
                   cwd=cwd, check=True, capture_output=True, env=env(home))


def timed(fn, runs):
    out = []
    for _ in range(runs):
        t = time.perf_counter()
        fn()
        out.append((time.perf_counter() - t) * 1000)
    return statistics.median(out)


class Results(dict):
    """Prints each result as it comes, as a whole run takes minutes."""
    def __setitem__(self, k, v):
        super().__setitem__(k, v)
        print(f"{k:<52}  {v:8.0f}", flush=True)


def script(home, name, *args):
    r = subprocess.run([sys.executable, "-I", os.path.join(MODS, name + ".py"), *args],
                       capture_output=True, text=True, env=env(home))
    if r.returncode != 0:
        raise SystemExit(f"{name}.py failed: {r.stderr}")
    return json.loads(r.stdout)


def line(**rec):
    return json.dumps(rec, separators=(",", ":")) + "\n"


def session_text(rng, n, folder):
    """A session as Claude Code writes one: a few hundred lines, mostly tool calls and results, a
    few of yours naming keys, Claude's title, the last prompt. Sizes vary as real ones do (a few KB
    to several MB)."""
    key = f"ACME-{rng.randint(1, 400)}"
    lines = [line(type="user", cwd=folder, gitBranch="main", message={"role": "user", "content": f"Work on {key}: make it so"})]
    filler = "x" * rng.choice([200, 800, 2000, 4000])
    for i in range(rng.choice([10, 40, 150, 400])):
        lines.append(line(type="assistant", message={"role": "assistant", "content": [{"type": "text", "text": filler}]}))
        lines.append(line(type="user", message={"role": "user", "content": [{"type": "tool_result", "tool_use_id": f"t{i}", "content": filler}]}))
        if i % 25 == 0:
            lines.append(line(type="user", message={"role": "user", "content": f"and {key} again, see ACME-{rng.randint(1, 400)}"}))
    lines.append(line(type="ai-title", aiTitle=f"Session {n} on {key}"))
    lines.append(line(type="last-prompt", lastPrompt="go on"))
    return "".join(lines)


def make_sessions(home, folder, sessions, accounts, rng):
    """`sessions` files spread over `accounts` accounts, in the folder and 40 worktrees under it."""
    places = [folder] + [os.path.join(folder, ".claude", "worktrees", f"ACME-{n}") for n in range(40)]
    files = []
    now = time.time()
    for n in range(sessions):
        account = ".claude" if n % accounts == 0 else f".claude-{n % accounts + 1}"
        place = rng.choice(places)
        encoded = re.sub(r"[^A-Za-z0-9]", "-", place)
        path = os.path.join(home, account, "projects", encoded, f"s{n:05d}.jsonl")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(session_text(rng, n, place))
        t = now - n * 600
        os.utime(path, (t, t))
        files.append(path)
    return files


def make_repos(home, folder, repos, keys):
    """`repos` repos right under the folder, a few on a key's branch, and ticket folders
    worktrees/<KEY>/<repo> holding a repo with uncommitted work, for the first `keys` keys."""
    for n in range(repos):
        repo = os.path.join(folder, f"repo{n:03d}")
        os.makedirs(repo)
        git(home, repo, "init", "-q")
        with open(os.path.join(repo, "a.txt"), "w") as f:
            f.write("one\n")
        git(home, repo, "add", ".")
        git(home, repo, "commit", "-qm", "first")
        if n < 3:
            git(home, repo, "checkout", "-qb", f"feature/ACME-{n}-work")
    for k in range(keys):
        repo = os.path.join(folder, "worktrees", f"ACME-{k}", "app")
        os.makedirs(repo)
        git(home, repo, "init", "-q")
        with open(os.path.join(repo, "a.txt"), "w") as f:
            f.write("one\n" * 200)
        git(home, repo, "add", ".")
        git(home, repo, "commit", "-qm", "first")
        with open(os.path.join(repo, "a.txt"), "a") as f:
            f.write("two\n" * 50)
        with open(os.path.join(repo, "new.txt"), "w") as f:
            f.write("new\n" * 50)


def review_steps(home, root, files, runs):
    """REVIEW_CHECKOUT's own commands (stories.js), each timed: an "origin" with a pull request ref,
    the clone at root/app; the fetch of pull/1/head, the worktree add, then a second start moving the
    worktree to a newer commit of the pull request."""
    origin = os.path.join(root, "origin.git")
    work = os.path.join(root, "seed")
    os.makedirs(work)
    git(home, work, "init", "-q")
    for n in range(files):
        d = os.path.join(work, f"dir{n // 100:03d}")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"f{n:05d}.ts"), "w") as f:
            f.write(f"export const v{n} = {n};\n" * 20)
    git(home, work, "add", ".")
    git(home, work, "commit", "-qm", "base")
    git(home, root, "clone", "-q", "--bare", work, origin)
    clone = os.path.join(root, "profile", "app")
    os.makedirs(os.path.dirname(clone))
    git(home, root, "clone", "-q", origin, clone)

    def push_pull(text):
        with open(os.path.join(work, "dir000", "f00000.ts"), "a") as f:
            f.write(text)
        git(home, work, "commit", "-qam", text)
        git(home, work, "push", "-qf", origin, "HEAD:refs/pull/1/head")

    push_pull("// pr\n")
    wt = os.path.join(root, "profile", "worktrees", "review-app-1")
    result = Results()

    def fetch():
        git(home, clone, "fetch", "--quiet", "origin", "pull/1/head")

    def add():
        if os.path.exists(wt):
            git(home, clone, "worktree", "remove", "--force", wt)
        git(home, clone, "worktree", "add", "--quiet", "--detach", wt, "FETCH_HEAD")

    result["review fetch (local origin)"] = timed(fetch, runs)
    result[f"review worktree add ({files} files)"] = timed(add, runs)

    def again():
        push_pull(f"// more {time.time()}\n")
        fetch()
        subprocess.run(["git", "-C", wt, "status", "--porcelain", "--untracked-files=no"], capture_output=True, env=env(home), check=True)
        # FETCH_HEAD is the clone's own: the worktree has none (REVIEW_CHECKOUT takes its sha).
        sha = subprocess.run(["git", "-C", clone, "rev-parse", "FETCH_HEAD"], capture_output=True, text=True, env=env(home), check=True).stdout.strip()
        git(home, wt, "checkout", "--quiet", "--detach", sha)

    result["review started again (fetch, status, checkout)"] = timed(again, runs)
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--sessions", type=int, default=1500)
    ap.add_argument("--accounts", type=int, default=2)
    ap.add_argument("--repos", type=int, default=200)
    ap.add_argument("--keys", type=int, default=30)
    ap.add_argument("--files", type=int, default=5000)
    ap.add_argument("--runs", type=int, default=5)
    a = ap.parse_args()
    rng = random.Random(40)
    home = os.path.realpath(tempfile.mkdtemp(prefix="kelpie-bench-"))
    try:
        folder = os.path.join(home, "code", "profile")
        os.makedirs(folder)
        print(f"Making {a.sessions} sessions on {a.accounts} accounts, {a.repos} repos, {a.keys} ticket folders…", file=sys.stderr)
        files = make_sessions(home, folder, a.sessions, a.accounts, rng)
        size = sum(os.path.getsize(p) for p in files)
        make_repos(home, folder, a.repos, a.keys)
        index = os.path.join(home, ".cache", "kelpie", "sessions.json")
        out = Results()

        def cold():
            if os.path.exists(index):
                os.remove(index)
            script(home, "sessions", folder, "200")

        out[f"sessions.py cold ({a.sessions} files, {size / 1e6:.0f} MB)"] = timed(cold, a.runs)
        out["sessions.py warm (nothing changed)"] = timed(lambda: script(home, "sessions", folder, "200"), a.runs)
        live = files[0]

        def grown():
            with open(live, "a") as f:
                f.write(line(type="assistant", message={"role": "assistant", "content": "more"}))
            script(home, "sessions", folder, "200")

        out["sessions.py warm, one live session grown"] = timed(grown, a.runs)
        out["sessions.py warm, one account"] = timed(lambda: script(home, "sessions", folder, "40", os.path.join(home, ".claude")), a.runs)
        out["sessions.py index size (KB)"] = os.path.getsize(index) / 1000
        out["python3 -I start alone"] = timed(lambda: subprocess.run([sys.executable, "-I", "-c", "pass"], env=env(home)), a.runs)
        one = ["ACME-0", "ACME-1", "ACME-2"]
        out[f"changes.py, a story's 3 keys ({a.repos} repos)"] = timed(lambda: script(home, "changes", folder, *one), a.runs)
        many = [f"ACME-{n}" for n in range(a.keys)]
        out[f"changes.py, {a.keys} keys with work"] = timed(lambda: script(home, "changes", folder, *many), a.runs)
        out[f"changes.py --unpushed, {a.keys} keys"] = timed(lambda: script(home, "changes", folder, "--unpushed", *many), a.runs)
        nothing = [f"ZZZ-{n}" for n in range(a.keys)]
        out[f"changes.py, {a.keys} keys with nothing"] = timed(lambda: script(home, "changes", folder, *nothing), a.runs)
        review_steps(home, os.path.join(home, "review"), a.files, a.runs)
    finally:
        shutil.rmtree(home, ignore_errors=True)


main()
