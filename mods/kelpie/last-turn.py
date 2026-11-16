"""How running Claude sessions' last turns ended, as JSON on stdout: for each, the last message Claude
wrote in it, for Kelpie to tell whether the agent is waiting on the person (#251, triage.js).

    python3 -I last-turn.py <config folder or ""> <session id> [<config folder or ""> <session id> ...]
    (or python3 -I -c "<this file>" ...)

A config folder is the Claude account's (~/.claude-work…; "" for Claude's own ~/.claude), as the
session's record named it (ui.js claudeSession). Its transcript is <config>/projects/*/<id>.jsonl.
Only a folder under the home folder named .claude… and a session id of letters, digits and dashes
are read; anything else is skipped. Read only, and only the end of each file: a long session's
transcript runs to many megabytes, and only its last turn counts.

Out: { "<id>": { "text", "turn", "at", "asked" } }: `text` the last message Claude wrote (its end,
at most TEXT characters), `turn` that message's id (a turn read twice is the same turn), `at` when it
was written, `asked` when the person's message that started the turn was. A session whose last turn
has no message from Claude (it ended on a tool, or nothing was read) is left out.
"""

import glob
import json
import os
import re
import sys

HOME = os.path.expanduser("~")
SESSION = re.compile(r"^[A-Za-z0-9-]{8,64}$")
TEXT = 2000
BLOCK = 64 * 1024
MOST = 4 * 1024 * 1024  # read no further back than this


def account(config):
    """The config folder to read, or None when it isn't one of the person's Claude accounts."""
    path = os.path.realpath(config or os.path.join(HOME, ".claude"))
    home = os.path.realpath(HOME)
    if os.path.dirname(path) != home or not os.path.basename(path).startswith(".claude"):
        return None
    return path


def blocks(content):
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    return [c for c in content or [] if isinstance(c, dict)]


def person(rec):
    """A message the person wrote (not a tool's result, not Claude Code's own note)."""
    if rec.get("type") != "user" or rec.get("isMeta") or rec.get("isSidechain"):
        return False
    parts = blocks((rec.get("message") or {}).get("content"))
    if any(c.get("type") == "tool_result" for c in parts):
        return False
    text = " ".join(c.get("text", "") for c in parts if c.get("type") == "text").strip()
    return bool(text) and not text.startswith("<local-command")


def last_turn(records):
    """The last turn's closing message, from the records newest first: the text blocks Claude wrote
    after its last tool call, up to the person's message that started the turn."""
    said, out = [], None
    for rec in records:
        if not isinstance(rec, dict) or rec.get("isSidechain"):
            continue
        if person(rec):
            if out is not None:
                out["asked"] = rec.get("timestamp") if isinstance(rec.get("timestamp"), str) else None
            break
        if out is not None and out.get("closed"):
            continue
        kind = rec.get("type")
        if kind == "user":
            if not any(c.get("type") == "tool_result" for c in blocks((rec.get("message") or {}).get("content"))):
                continue  # Claude Code's own note (a command's output, a meta line)
            # A tool's result: whatever came before it isn't the closing message.
            if out is None:
                return None  # waiting on a tool's result: the turn hasn't ended
            out["closed"] = True
            continue
        if kind != "assistant":
            continue
        parts = blocks((rec.get("message") or {}).get("content"))
        if any(c.get("type") == "tool_use" for c in parts):
            if out is None:
                return None  # the turn ended on a tool: still going, or stopped mid-way
            out["closed"] = True
            continue
        text = "\n".join(c.get("text", "") for c in parts if c.get("type") == "text" and isinstance(c.get("text"), str)).strip()
        if not text:
            continue
        said.insert(0, text)
        if out is None:
            out = {"turn": rec.get("uuid") if isinstance(rec.get("uuid"), str) else None,
                   "at": rec.get("timestamp") if isinstance(rec.get("timestamp"), str) else None, "asked": None}
    if out is None:
        return None
    text = "\n\n".join(said)
    return {"text": text[-TEXT:], "turn": out["turn"], "at": out["at"], "asked": out["asked"]}


def tail(path):
    """The file's records, newest first, reading back from its end only as far as needed."""
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        want = BLOCK
        while True:
            start = max(0, size - want)
            f.seek(start)
            data = f.read(size - start)
            lines = data.split(b"\n")
            if start > 0:
                lines = lines[1:]  # cut mid-line
            records = []
            for line in reversed(lines):
                if not line.strip():
                    continue
                try:
                    records.append(json.loads(line))
                except ValueError:
                    continue
            found = last_turn(records)
            if found is not None and (found["asked"] is not None or start == 0):
                return found
            if start == 0 or want >= MOST:
                return found
            want *= 4


def main(args):
    found = {}
    for config, sid in zip(args[0::2], args[1::2]):
        folder = account(config)
        if not folder or not SESSION.match(sid) or sid in found:
            continue
        for path in glob.glob(os.path.join(glob.escape(folder), "projects", "*", glob.escape(sid) + ".jsonl")):
            if os.path.islink(path):
                continue
            try:
                turn = tail(path)
            except OSError:
                continue
            if turn:
                found[sid] = turn
            break
    json.dump(found, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1:])
