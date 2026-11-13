"""What running Claude sessions are about, as JSON on stdout: for each, its name, the message that
started it and the files it changed (newest first), from the session's own transcript.

    python3 -I agent-work.py <config folder or ""> <session id> [<config folder or ""> <session id> ...]
    (or python3 -I -c "<this file>" ...)

A config folder is the Claude account's (~/.claude-work…; "" for Claude's own ~/.claude), as the
session's record named it (ui.js claudeSession). Its transcript is <config>/projects/*/<id>.jsonl.
Only a folder under the home folder named .claude… and a session id of letters, digits and dashes
are read; anything else is skipped. Read only.

Out: { "<id>": { "title", "first", "files": [{ "path", "at" }] } }, a session not found left out.
"""

import glob
import json
import os
import re
import sys

HOME = os.path.expanduser("~")
SESSION = re.compile(r"^[A-Za-z0-9-]{8,64}$")
# Claude Code's tools that change a file, and where each names it.
EDITS = {"Edit": "file_path", "MultiEdit": "file_path", "Write": "file_path", "NotebookEdit": "notebook_path"}
MAX_FILES = 40
FIRST = 300


def account(config):
    """The config folder to read, or None when it isn't one of the person's Claude accounts."""
    path = os.path.realpath(config or os.path.join(HOME, ".claude"))
    home = os.path.realpath(HOME)
    if os.path.dirname(path) != home or not os.path.basename(path).startswith(".claude"):
        return None
    return path


def said(message):
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, str):
        return content
    return " ".join(c.get("text", "") for c in content or [] if isinstance(c, dict) and c.get("type") == "text")


def read(path):
    out = {"title": None, "first": None, "files": []}
    custom, files = None, {}
    with open(path, "rb") as f:
        for line in f:
            quick = b'"tool_use"' in line or b'"type":"user"' in line or b'-title"' in line
            if not quick:
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if not isinstance(rec, dict):
                continue
            kind = rec.get("type")
            if kind == "custom-title" and isinstance(rec.get("customTitle"), str):
                custom = rec["customTitle"]
            elif kind == "ai-title" and isinstance(rec.get("aiTitle"), str):
                out["title"] = rec["aiTitle"]
            elif kind == "user" and out["first"] is None and not rec.get("isMeta"):
                text = said(rec.get("message")).strip()
                # Claude Code's own notes and bare commands (/clear) aren't what started the work.
                if text and not text.startswith("<local-command") and not re.match(r"^<command-name>[^<]*</command-name>\s*$", text):
                    out["first"] = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()[:FIRST] or None
            elif kind == "assistant":
                content = (rec.get("message") or {}).get("content")
                for c in content if isinstance(content, list) else []:
                    if not isinstance(c, dict) or c.get("type") != "tool_use" or c.get("name") not in EDITS:
                        continue
                    target = (c.get("input") or {}).get(EDITS[c["name"]])
                    if isinstance(target, str) and target:
                        files[target] = rec.get("timestamp") if isinstance(rec.get("timestamp"), str) else None
    out["title"] = custom or out["title"]
    newest = sorted(files.items(), key=lambda x: x[1] or "", reverse=True)[:MAX_FILES]
    out["files"] = [{"path": p, "at": at} for p, at in newest]
    return out


def main(args):
    found = {}
    for config, sid in zip(args[0::2], args[1::2]):
        folder = account(config)
        if not folder or not SESSION.match(sid) or sid in found:
            continue
        for path in glob.glob(os.path.join(glob.escape(folder), "projects", "*", glob.escape(sid) + ".jsonl")):
            try:
                found[sid] = read(path)
            except OSError:
                continue
            break
    json.dump(found, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1:])
