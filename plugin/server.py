"""Kelpie's MCP server for Claude Code (stdio, no dependencies): tools that show the person something in
Kelpie. One for now, show_passage: a Jira story opened in Kelpie with a passage of its description
marked where it is (Kelpie's `kelpie.show-passage` command, mods/kelpie/stories.js showPassageRequest).

It writes the request to <Herdr home>/kelpie/passage.json (HERDR_APP_HOME, else ~/.config/herdr-app),
runs `herdr-app do kelpie.show-passage` (no shell) and returns what Kelpie wrote to
passage.result.json. It only changes what Kelpie shows; Kelpie checks the request again.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time

KEY = re.compile(r"^[A-Z][A-Z0-9_]*-\d+$")
CONTROL = re.compile(r"[\x00-\x1f\x7f]+")
# Seconds Kelpie has to answer (it runs the command between frames); the tests shorten it.
WAIT = float(os.environ.get("KELPIE_SHOW_WAIT") or 5)

INSTRUCTIONS = (
    "Kelpie is the person's Herdr layout of Jira stories, pull requests and agents. When they ask where a "
    "story says something, or to show them, open it in Kelpie with show_passage rather than only quoting it."
)

TOOLS = [{
    "name": "show_passage",
    "title": "Show a passage in Kelpie",
    "description": (
        "Opens a Jira story in Kelpie, the person's story view, with a passage of its description scrolled "
        "into view and marked, so they read it where it is. Use it when they ask where the story says "
        "something, which part covers a point, or to show them. `quote` must be words copied exactly from "
        "the story's description (not a summary or paraphrase; a few sentences at most, '…' for words left "
        "out). `key` is the story's own key: a subtask's description isn't shown yet, and the story must be "
        "in the profile Kelpie shows. Kelpie says whether it found the passage; tell the person what happened."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "key": {"type": "string", "description": "The story's Jira key, like ABC-123."},
            "quote": {"type": "string", "description": "The passage, word for word from the description."},
            "note": {"type": "string", "description": "A few words on what the passage is, shown above it."},
        },
        "required": ["key", "quote"],
        "additionalProperties": False,
    },
    "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
}]


def clean(value, limit):
    return re.sub(r"\s+", " ", CONTROL.sub(" ", value)).strip()[:limit] if isinstance(value, str) else ""


def home():
    return os.environ.get("HERDR_APP_HOME") or os.path.join(os.path.expanduser("~"), ".config", "herdr-app")


def remove(path):
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def show_passage(args):
    """(text, is_error)."""
    key = clean(args.get("key"), 40).upper()
    quote, note = clean(args.get("quote"), 2000), clean(args.get("note"), 200)
    if not KEY.match(key):
        return "key: a Jira key, like ABC-123.", True
    if len(quote) < 3:
        return "quote: the passage's words, copied from the description.", True
    folder = os.path.join(home(), "kelpie")
    request, result = os.path.join(folder, "passage.json"), os.path.join(folder, "passage.result.json")
    os.makedirs(folder, exist_ok=True)
    remove(result)  # an answer from before isn't this one's
    # Written whole and private, then put in place (a link in the way is replaced, never written through).
    fd, part = tempfile.mkstemp(prefix=".passage-", dir=folder)
    with os.fdopen(fd, "w") as f:
        json.dump({"key": key, "quote": quote, "note": note}, f)
    os.replace(part, request)
    try:
        run = subprocess.run(["herdr-app", "do", "kelpie.show-passage"], capture_output=True, text=True, timeout=15)
    except FileNotFoundError:
        remove(request)
        return "Kelpie can't be reached: Herdr's herdr-app command isn't installed here.", True
    except subprocess.TimeoutExpired:
        remove(request)
        return "Kelpie can't be reached: Herdr didn't answer.", True
    if run.returncode != 0:
        remove(request)
        return f"Kelpie can't be reached: {(run.stderr or run.stdout).strip()[:300] or 'Herdr refused the command'}.", True
    deadline = time.monotonic() + WAIT
    while time.monotonic() < deadline:
        try:
            with open(result) as f:
                answer = json.load(f)
            break
        except (FileNotFoundError, json.JSONDecodeError):
            time.sleep(0.1)
    else:
        remove(request)  # so it doesn't show later, out of the blue
        return "Kelpie didn't answer: is Herdr open with a Kelpie layout?", True
    if answer.get("ok"):
        return f"Shown in Kelpie: {key}, with the passage marked in its description" + (f" ({note})." if note else "."), False
    return f"Kelpie didn't show it: {clean(answer.get('error'), 300) or 'no reason given'}", True


def reply(id_, result=None, error=None):
    msg = {"jsonrpc": "2.0", "id": id_}
    msg["error" if error else "result"] = error or result
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def handle(msg):
    method, id_, params = msg.get("method"), msg.get("id"), msg.get("params") or {}
    if id_ is None:
        return  # a notification: nothing to answer
    if method == "initialize":
        reply(id_, {"protocolVersion": params.get("protocolVersion") or "2025-06-18", "capabilities": {"tools": {}},
                    "serverInfo": {"name": "kelpie", "version": "0.1.0"}, "instructions": INSTRUCTIONS})
    elif method == "ping":
        reply(id_, {})
    elif method == "tools/list":
        reply(id_, {"tools": TOOLS})
    elif method == "tools/call":
        if params.get("name") != "show_passage":
            return reply(id_, error={"code": -32602, "message": f"No tool {params.get('name')!r}."})
        try:
            text, failed = show_passage(params.get("arguments") or {})
        except OSError as e:
            text, failed = f"Kelpie can't be reached: {e.strerror or e}.", True
        reply(id_, {"content": [{"type": "text", "text": text}], "isError": failed})
    else:
        reply(id_, error={"code": -32601, "message": f"No method {method!r}."})


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            reply(None, error={"code": -32700, "message": "Not JSON."})
            continue
        if isinstance(msg, dict):
            handle(msg)


if __name__ == "__main__":
    main()
