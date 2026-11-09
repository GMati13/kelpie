"""Uncommitted changes in the repos working on some ticket keys, as JSON on stdout.

    python3 -I changes.py <folder> <key> [key ...]     (or python3 -I -c "<this file>" ...)

A repo counts for a key in two ways:
  - it sits in a ticket folder, a folder named exactly after the key up to two levels under <folder>
    (<folder>/KEY or <folder>/worktrees/KEY, say): the folder itself when it is a repo, and every
    repo right inside it, whatever their branches are called;
  - else, it is <folder> itself or a folder right under it, and its checked-out branch names the key
    (feature/ABC-123-…).
Reads .git/HEAD directly, so hundreds of repos cost next to nothing; git only runs in the ones that
match. Every matching repo is listed, with or without changes; "ticket" is its ticket folder, if any:
    [{"repo", "path", "branch", "key", "ticket", "files": [{"path", "add", "del", "status", "patch"}]}]
"""

import json
import os
import re
import subprocess
import sys

MAX_PATCH = 400_000  # characters per repo; the rest is cut and marked


def branch_of(repo):
    git = os.path.join(repo, ".git")
    try:
        if os.path.isfile(git):  # a worktree: "gitdir: <path>"
            with open(git) as f:
                git = f.read().split(":", 1)[1].strip()
            git = git if os.path.isabs(git) else os.path.join(repo, git)
        with open(os.path.join(git, "HEAD")) as f:
            head = f.read().strip()
    except (OSError, IndexError):
        return None
    return head[len("ref: refs/heads/"):] if head.startswith("ref: refs/heads/") else None


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, errors="replace").stdout


def renamed(path):
    """A rename in --numstat ("src/{old => new}/f.ts", "old.ts => new.ts") as its new path, the one
    the diff's own header names."""
    if " => " not in path:
        return path
    if "{" in path:
        return re.sub(r"\{[^{}]*? => ([^{}]*)\}", r"\1", path).replace("//", "/")
    return path.split(" => ", 1)[1]


def new_file(path, limit=200000, rows=1500):
    """A file git doesn't track yet, as a diff adding all of it (its first lines when long)."""
    try:
        with open(path, "rb") as f:
            data = f.read(limit + 1)
    except OSError:
        return {"add": 0, "del": 0, "patch": "(new file, not added to git yet; couldn't read it)"}
    if b"\0" in data:
        return {"add": 0, "del": 0, "patch": "(new binary file, not added to git yet)"}
    lines = data[:limit].decode("utf-8", "replace").splitlines()
    shown = lines[:rows]
    patch = "\n".join([f"@@ -0,0 +1,{len(shown)} @@ not added to git yet", *("+" + l for l in shown)])
    if len(lines) > rows or len(data) > limit:
        patch += "\n… cut here, the file is too long"
    return {"add": len(lines), "del": 0, "patch": patch}


def changes(repo):
    files = {}
    for line in git(repo, "diff", "HEAD", "--numstat").splitlines():
        parts = line.split("\t")
        if len(parts) == 3:
            add, rem, path = parts
            path = renamed(path)
            files[path] = {"path": path, "add": int(add) if add.isdigit() else 0, "del": int(rem) if rem.isdigit() else 0, "status": "modified", "patch": ""}
    for path in git(repo, "ls-files", "--others", "--exclude-standard").splitlines():
        files[path] = {"path": path, "status": "added", **new_file(os.path.join(repo, path))}
    if not files:
        return []
    patch, current = git(repo, "diff", "HEAD"), None
    patch = patch[:MAX_PATCH] + ("\n… cut here, the diff is too long" if len(patch) > MAX_PATCH else "")
    chunks = {}
    for line in patch.splitlines():
        if line.startswith("diff --git "):
            current = line.split(" b/", 1)[-1]
            chunks[current] = []
        elif current is not None and not line.startswith(("index ", "--- ", "+++ ")):
            chunks[current].append(line)
    for path, lines in chunks.items():
        if path in files:
            files[path]["patch"] = "\n".join(lines)
    return sorted(files.values(), key=lambda f: f["path"])


def is_repo(path):
    return os.path.isdir(path) and os.path.exists(os.path.join(path, ".git"))


def subfolders(path):
    try:
        return [os.path.join(path, n) for n in sorted(os.listdir(path)) if not n.startswith(".")]
    except OSError:
        return []


def ticket_folders(folder, keys):
    """(key, ticket folder) for each folder named after a key, one or two levels under <folder>.
    Looks the keys up by name, so the second level costs one stat per key and folder."""
    found = []
    for parent in [folder] + [d for d in subfolders(folder) if os.path.isdir(d)]:
        for k in keys:
            path = os.path.join(parent, k)
            if os.path.isdir(path):
                found.append((k, path))
    return found


def main():
    folder = os.path.realpath(sys.argv[1])
    keys = sys.argv[2:]
    out, seen = [], set()

    def add(repo, key, ticket):
        real = os.path.realpath(repo)
        if real in seen:
            return
        seen.add(real)
        out.append({"repo": os.path.basename(repo), "path": repo, "branch": branch_of(repo), "key": key, "ticket": ticket, "files": changes(repo)})

    # Ticket folders first: what's in them is the ticket's, whatever the branch is called.
    for key, ticket in ticket_folders(folder, keys):
        for repo in [ticket] + subfolders(ticket):
            if is_repo(repo):
                add(repo, key, ticket)
    for repo in [folder] + subfolders(folder):
        if not is_repo(repo):
            continue
        branch = branch_of(repo)
        # The whole key: ABC-12 isn't on feature/ABC-123.
        key = next((k for k in keys if branch and re.search(rf"(?<![A-Z0-9]){re.escape(k)}(?!\d)", branch)), None)
        if key:
            add(repo, key, None)
    json.dump(out, sys.stdout)


main()
