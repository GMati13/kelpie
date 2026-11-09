"""Previous Claude sessions started in a folder or under it, newest first, as JSON on stdout.

    python3 -I sessions.py <folder> [limit] [account]     (or python3 -I -c "<this file>" <folder> ...)

`account`: only that Claude config folder's sessions (~/.claude, ~/.claude-work…); else every one's.

Reads ~/.claude*/projects/<folder, encoded>*/*.jsonl and only the lines it needs (titles, the
last prompt, the folder and branch, and the ticket keys you wrote: "first" from the message that
started it, "keys" from all of yours), and "config", the Claude config folder it lives in when that
isn't the default ~/.claude (another account). Read only; an index under ~/.cache/kelpie keeps
what each file said and how far it was read, by any folder's run: an unchanged file isn't read
again, and one that grew (a live session's) is read on from there.
"""

import glob
import json
import os
import re
import sys

HOME = os.path.expanduser("~")
CACHE = os.path.join(HOME, ".cache", "kelpie", "sessions.json")
MARKS = (b'"type":"custom-title"', b'"type":"ai-title"', b'"type":"last-prompt"')
KEY = re.compile(rb"\b[A-Z][A-Z0-9]+-[0-9]+\b")
MAX_KEYS = 30


def blank():
    return {"title": None, "custom": None, "prompt": None, "cwd": None, "branch": None, "first": None, "keys": []}


def summarise(path, info=None, offset=0):
    """What the file says, read from byte `offset` on, added to `info` (what was read before it).
    Returns it and the offset to read on from next time: past the last whole line, so a line still
    being written is read again then. Reading a line twice changes nothing."""
    info = {**blank(), **(info or {})}
    keys = list(info["keys"])
    with open(path, "rb") as f:
        f.seek(offset)
        for line in f:
            if line.endswith(b"\n"):
                offset += len(line)
            # Your own messages (not tool results): the keys you asked about.
            if b'"type":"user"' in line and b'"tool_use_id"' not in line and len(keys) < MAX_KEYS:
                try:
                    content = json.loads(line).get("message", {}).get("content")
                except ValueError:
                    content = None
                text = content if isinstance(content, str) else " ".join(
                    c.get("text", "") for c in content or [] if isinstance(c, dict) and c.get("type") == "text")
                found = []
                for k in KEY.findall(text.encode()):
                    if k.decode() not in found:
                        found.append(k.decode())
                # The message that started the work: not Claude Code's own notes, nor a bare
                # command like /clear.
                said = not b'"isMeta":true' in line and not text.lstrip().startswith("<local-command") \
                    and not re.search(r"<command-name>[^<]*</command-name>", text) or re.search(r"<command-args>\s*[^<\s]", text)
                if info["first"] is None and said and text.strip():
                    info["first"] = found[:MAX_KEYS]
                keys += [k for k in found if k not in keys]
            if info["cwd"] is None and b'"cwd":"' in line:
                try:
                    rec = json.loads(line)
                    info["cwd"], info["branch"] = rec.get("cwd"), rec.get("gitBranch")
                except ValueError:
                    pass
            if not any(m in line for m in MARKS):
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            kind = rec.get("type")
            if kind == "custom-title":
                info["custom"] = rec.get("customTitle")
            elif kind == "ai-title":
                info["title"] = rec.get("aiTitle")
            elif kind == "last-prompt":
                info["prompt"] = rec.get("lastPrompt")
    info["keys"] = keys[:MAX_KEYS]
    return info, offset


def running():
    """Session ids of live Claude processes."""
    ids = {}
    for path in glob.glob(os.path.join(HOME, ".claude*", "sessions", "*.json")):
        try:
            with open(path) as f:
                rec = json.load(f)
            os.kill(int(rec["pid"]), 0)
            ids[rec["sessionId"]] = rec["pid"]
        except (OSError, ValueError, KeyError, TypeError):
            pass
    return ids


def main():
    folder = os.path.realpath(sys.argv[1])
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 40
    account = os.path.realpath(os.path.expanduser(sys.argv[3])) if len(sys.argv) > 3 and sys.argv[3] else None
    encoded = re.sub(r"[^A-Za-z0-9]", "-", folder)
    default = os.path.join(HOME, ".claude")
    files = []
    roots = [account] if account else glob.glob(os.path.join(HOME, ".claude*"))
    for d in [d for r in roots for d in glob.glob(os.path.join(r, "projects", encoded + "*"))]:
        name = os.path.basename(d)
        if name != encoded and not name.startswith(encoded + "-"):
            continue
        config = os.path.dirname(os.path.dirname(d))
        for p in glob.glob(os.path.join(d, "*.jsonl")):
            try:
                st = os.stat(p)
            except OSError:
                continue
            files.append((st.st_mtime, st.st_size, st.st_ino, p, None if config == default else config))
    files.sort(reverse=True)

    try:
        with open(CACHE) as f:
            cache = json.load(f)
    except (OSError, ValueError):
        cache = {}

    live = running()
    out, fresh = [], {}
    for mtime, size, ino, path, config in files:
        if len(out) >= limit:
            break
        # By path: what was read of it, and how far. The same file (inode) that only grew is read
        # on from there; one replaced or shortened is read again from the start.
        was = cache.get(path)
        same = isinstance(was, dict) and "offset" in was and was.get("ino") == ino and size >= was["offset"]
        if same and was["mtime"] == mtime and was["size"] == size:
            info, offset = was["info"], was["offset"]
        elif same:
            info, offset = summarise(path, was["info"], was["offset"])
        else:
            info, offset = summarise(path)
        fresh[path] = {"mtime": mtime, "size": size, "ino": ino, "offset": offset, "info": info}
        if not info.get("prompt") and not info.get("title"):
            continue
        cwd = info.get("cwd") or folder
        # Only sessions in this folder or under it: an encoded name can match a sibling folder.
        if cwd != folder and not cwd.startswith(folder + "/"):
            continue
        sid = os.path.basename(path)[:-6]
        out.append({
            "id": sid,
            "title": info.get("custom") or info.get("title") or info.get("prompt"),
            "prompt": info.get("prompt"),
            "cwd": cwd,
            "branch": info.get("branch"),
            "updated": int(mtime * 1000),
            "running": sid in live,
            "first": info.get("first") or [],
            "keys": info.get("keys") or [],
            "config": config,
        })

    # Several callers share the index (other folders, other limits): this run's entries go in beside
    # theirs. An entry goes once its file is gone; older entries (not by path) go too.
    listed = {f[3] for f in files}
    kept = {path: e for path, e in cache.items()
            if isinstance(e, dict) and "offset" in e and (path in listed or os.path.exists(path))}
    kept.update(fresh)
    if kept != cache:
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        tmp = f"{CACHE}.{os.getpid()}.tmp"  # callers running at once don't share a temp file
        with open(tmp, "w") as f:
            json.dump(kept, f)
        os.replace(tmp, CACHE)
    json.dump(out, sys.stdout)


main()
