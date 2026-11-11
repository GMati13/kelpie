"""The Claude Artifacts some Claude sessions published, newest first, as JSON on stdout.

    python3 -I artifacts.py <session id> [session id…]     (or python3 -I -c "<this file>" <id> ...)

Reads each session's log (~/.claude*/projects/*/<id>.jsonl) for its Artifact tool calls: a publish
whose answer gave a claude.ai link counts, with the title it answered, the description it was sent
and the page's local source file. Each Artifact once, by its link: how many times it was published,
when first and last, by which session, and the Claude config folder that session ran on ("config",
null for the default ~/.claude), as an Artifact belongs to the account that published it.

Read only: nothing here signs in or reaches claude.ai. An index under ~/.cache/kelpie keeps what
each file said and how far it was read, so an unchanged log isn't read again and a live one is read
on from there. It holds titles and descriptions, so it's private to the person (0600).
"""

import glob
import json
import os
import re
import sys
from datetime import datetime

HOME = os.path.expanduser("~")
CACHE = os.path.join(HOME, ".cache", "kelpie", "artifacts.json")
SESSION = re.compile(r"^[0-9a-f-]{8,64}$")
# An Artifact's own page: claude.ai/artifact/<id> or claude.ai/code/artifact/<id>, nothing else.
LINK = re.compile(r"^https://claude\.ai/(?:code/)?artifact/[A-Za-z0-9_-]{1,100}$")
TEXT_MAX = 300
PENDING_MAX = 50


def blank():
    return {"pending": {}, "published": []}


def clean(value, limit=TEXT_MAX):
    """Text from the log, as one short line: it's shown in Kelpie, and anyone's words may be in it."""
    if not isinstance(value, str):
        return None
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", value).strip()
    return text[:limit] or None


def when(stamp):
    """A log line's time ("2026-11-11T09:30:00.000Z") as ms since the epoch, or None."""
    if not isinstance(stamp, str):
        return None
    try:
        return int(datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


def summarise(path, info=None, offset=0):
    """The publishes the file holds, read from byte `offset` on, added to `info` (what was read
    before it). A call and its answer are on different lines, maybe read in different runs, so calls
    still waiting for an answer are kept (`pending`). Returns it and the offset past the last whole
    line, so a line still being written is read again next time."""
    info = {**blank(), **(info or {})}
    pending = dict(info["pending"])
    published = list(info["published"])
    with open(path, "rb") as f:
        f.seek(offset)
        for line in f:
            if not line.endswith(b"\n"):
                break
            offset += len(line)
            calls = b'"name":"Artifact"' in line
            answer = b'"toolUseResult"' in line and pending
            if not calls and not answer:
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            content = (rec.get("message") or {}).get("content")
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "tool_use" and block.get("name") == "Artifact":
                    given = block.get("input") or {}
                    # Only a page's publish: not reading, listing or opening one, nor a file uploaded
                    # to an Artifact's store.
                    if given.get("action", "publish") != "publish" or given.get("asset"):
                        continue
                    if isinstance(block.get("id"), str) and len(pending) < PENDING_MAX:
                        pending[block["id"]] = {"description": clean(given.get("description")), "title": clean(given.get("title"))}
                elif block.get("type") == "tool_result" and block.get("tool_use_id") in pending:
                    call = pending.pop(block["tool_use_id"])
                    result = rec.get("toolUseResult")
                    if block.get("is_error") or not isinstance(result, dict):
                        continue
                    url = result.get("url")
                    if not isinstance(url, str) or not LINK.match(url):
                        continue
                    source = result.get("path")
                    published.append({
                        "url": url,
                        "title": clean(result.get("title")) or call["title"],
                        "description": call["description"],
                        "path": source if isinstance(source, str) and source.startswith("/") else None,
                        "at": when(rec.get("timestamp")),
                    })
    info["pending"], info["published"] = pending, published
    return info, offset


def logs(ids):
    """Each session's log file and the config folder it's in: [(id, path, config)]."""
    default = os.path.join(HOME, ".claude")
    found = []
    for sid in ids:
        for path in glob.glob(os.path.join(HOME, ".claude*", "projects", "*", sid + ".jsonl")):
            config = os.path.dirname(os.path.dirname(os.path.dirname(path)))
            found.append((sid, path, None if config == default else config))
    return found


def private_dump(data, path):
    """Writes JSON readable by the person only, through a temp file of this run's own, so callers
    running at once don't share one and nothing is written through a link in the cache's place."""
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def main():
    ids = [a for a in sys.argv[1:] if SESSION.match(a)]
    try:
        with open(CACHE) as f:
            cache = json.load(f)
    except (OSError, ValueError):
        cache = {}
    if not isinstance(cache, dict):
        cache = {}

    by_url, fresh = {}, {}
    for sid, path, config in logs(ids):
        try:
            st = os.stat(path)
        except OSError:
            continue
        # By path, as sessions.py: an unchanged file isn't read, one that only grew is read on.
        was = cache.get(path)
        same = isinstance(was, dict) and "offset" in was and was.get("ino") == st.st_ino and st.st_size >= was["offset"]
        if same and was["mtime"] == st.st_mtime and was["size"] == st.st_size:
            info, offset = was["info"], was["offset"]
        elif same:
            info, offset = summarise(path, was["info"], was["offset"])
        else:
            info, offset = summarise(path)
        fresh[path] = {"mtime": st.st_mtime, "size": st.st_size, "ino": st.st_ino, "offset": offset, "info": info}
        for p in info["published"]:
            a = by_url.get(p["url"])
            if a is None:
                a = by_url[p["url"]] = {"url": p["url"], "title": None, "description": None, "path": None,
                                        "first": p["at"], "last": p["at"], "count": 0, "session": sid, "config": config}
            a["count"] += 1
            at = p["at"] or 0
            # The latest publish names it: its title, its session (who to ask about it), its source.
            if at >= (a["last"] or 0):
                a["last"], a["session"], a["config"] = p["at"], sid, config
                a["title"] = p["title"] or a["title"]
                a["description"] = p["description"] or a["description"]
                a["path"] = p["path"] or a["path"]
            else:
                a["title"] = a["title"] or p["title"]
                a["description"] = a["description"] or p["description"]
            if p["at"] and (a["first"] is None or p["at"] < a["first"]):
                a["first"] = p["at"]

    # Other callers' entries stay; an entry goes once its file is gone.
    kept = {path: e for path, e in cache.items() if isinstance(e, dict) and "offset" in e and os.path.exists(path)}
    kept.update(fresh)
    if kept != cache:
        private_dump(kept, CACHE)
    out = sorted(by_url.values(), key=lambda a: a["last"] or 0, reverse=True)
    json.dump(out, sys.stdout)


main()
