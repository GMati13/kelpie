"""Kelpie's MCP server for Claude Code (stdio, no dependencies): tools that let Claude show the person
something in Kelpie and set up their Kelpie profiles.

- show_passage: a Jira story opened in Kelpie with a passage of its description marked where it is
  (Kelpie's `kelpie.show-passage`, mods/kelpie/stories.js showPassageRequest).
- get_profile: the saved profiles, read from Herdr's shared state (<home>/shared.json).
- save_profile / save_status: a change to a profile, through Kelpie's `kelpie.apply-profile`
  (mods/kelpie/config.js applyProfileRequest), which checks it and holds what needs the person's yes
  for their click in Kelpie; save_status reads the answer again once they've given it.
- open_profile_page: the profile dialog on one of its pages (`kelpie.edit-profile-<tab>`), for the
  person to press a Check button or look over what was saved.

Each request is a file in <home>/kelpie/ (HERDR_APP_HOME, else ~/.config/herdr-app), written privately
and put in place whole, then `herdr-app do <command>` (no shell), then Kelpie's answer file is read.
Kelpie checks every request again: this server only saves Claude a few steps.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time

KEY = re.compile(r"^[A-Z][A-Z0-9_]*-\d+$")
PROFILE_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
CONTROL = re.compile(r"[\x00-\x1f\x7f]+")
# The profile dialog's pages (mods/kelpie/setup.js TABS).
TABS = ["general", "jira", "github", "web", "prompts", "messages", "commands"]
# Seconds Kelpie has to answer (it runs commands between frames); the tests shorten it.
WAIT = float(os.environ.get("KELPIE_SHOW_WAIT") or 5)

INSTRUCTIONS = (
    "Kelpie is the person's Herdr layout of Jira stories, pull requests and agents, set up per profile. "
    "When they ask where a story says something, or to show them, open it in Kelpie with show_passage "
    "rather than only quoting it. To set up a Kelpie profile, follow the configure-profile skill: read with "
    "get_profile, save with save_profile."
)

TOOLS = [
    {
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
    },
    {
        "name": "get_profile",
        "title": "Read a Kelpie profile",
        "description": (
            "The person's Kelpie profiles as saved. With `id`, that profile's settings (name, folder, claude, "
            "jira, github, web, prompts, notify, commands); without, every profile's id, name and folder. "
            "Read-only. Fields not in the profile dialog (sources, seen) are old or internal: leave them."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"id": {"type": "string", "description": "The profile's id, like work."}},
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "save_profile",
        "title": "Save a change to a Kelpie profile",
        "description": (
            "Saves a change to a Kelpie profile, checked by Kelpie as its dialog's Save is. `set` holds only "
            "what changes: name and folder replace; a section (jira, github, web, prompts, notify, commands, "
            "claude) given as an object is merged into the saved one; a key or section set to null is removed. "
            "Values are strings, except jira.board (a number) and notify.pulls (true/false). An id that doesn't "
            "exist yet makes a new profile (it needs name and folder). Never put a secret in it: keys like token "
            "or password are refused. Changes that can run commands, steer agents or move the Jira sign-in "
            "(commands, prompts, claude, web, the jira sign-in and address, the github prompts) aren't saved "
            "until the person confirms them in Kelpie: the answer then says it's waiting; tell them to look at "
            "Kelpie, and call save_status once they've answered. Save only what the person agreed to."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "description": "The profile's id."},
                "set": {"type": "object", "description": "The settings to change, as described."},
            },
            "required": ["id", "set"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "save_status",
        "title": "What happened to the last profile change",
        "description": (
            "Kelpie's answer to the last save_profile: saved, an error, still waiting for the person's yes, or "
            "their no. Call it after they've answered Kelpie's confirm dialog."
        ),
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "open_profile_page",
        "title": "Open the profile dialog on a page",
        "description": (
            "Opens Kelpie's profile dialog, for the profile Kelpie shows, on one page: general, jira, github, "
            "web, prompts, messages or commands. Use it for the person to press a Check button (Jira's checks "
            "their sign-in and lists the board's columns; GitHub's checks their pull requests) or to look over "
            "what you saved. It only opens the dialog."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"page": {"type": "string", "enum": TABS}},
            "required": ["page"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
]


def clean(value, limit):
    return re.sub(r"\s+", " ", CONTROL.sub(" ", value)).strip()[:limit] if isinstance(value, str) else ""


def home():
    return os.environ.get("HERDR_APP_HOME") or os.path.join(os.path.expanduser("~"), ".config", "herdr-app")


def folder():
    return os.path.join(home(), "kelpie")


def remove(path):
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def read_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


class Unreachable(Exception):
    """Kelpie can't be reached: the text says why."""


def kelpie(command):
    """Runs `herdr-app do kelpie.<command>`; Unreachable when Herdr isn't there or refuses."""
    try:
        run = subprocess.run(["herdr-app", "do", f"kelpie.{command}"], capture_output=True, text=True, timeout=15)
    except FileNotFoundError:
        raise Unreachable("Kelpie can't be reached: Herdr's herdr-app command isn't installed here.")
    except subprocess.TimeoutExpired:
        raise Unreachable("Kelpie can't be reached: Herdr didn't answer.")
    if run.returncode != 0:
        raise Unreachable(f"Kelpie can't be reached: {(run.stderr or run.stdout).strip()[:300] or 'Herdr refused the command'}.")


def ask(name, request, command):
    """Kelpie's answer to `request`: written as <name>.json, `command` run, <name>.result.json read.
    An answer from before is removed first; a request never answered is removed too, so it can't act
    later out of the blue. Unreachable when there's no answer."""
    os.makedirs(folder(), exist_ok=True)
    path, result = os.path.join(folder(), f"{name}.json"), os.path.join(folder(), f"{name}.result.json")
    remove(result)
    # Written whole and private, then put in place (a link in the way is replaced, never written through).
    fd, part = tempfile.mkstemp(prefix=f".{name}-", dir=folder())
    with os.fdopen(fd, "w") as f:
        json.dump(request, f)
    os.replace(part, path)
    try:
        kelpie(command)
    except Unreachable:
        remove(path)
        raise
    deadline = time.monotonic() + WAIT
    while time.monotonic() < deadline:
        answer = read_json(result)
        if answer is not None:
            return answer
        time.sleep(0.1)
    remove(path)
    raise Unreachable("Kelpie didn't answer: is Herdr open with a Kelpie layout?")


def show_passage(args):
    """(text, is_error)."""
    key = clean(args.get("key"), 40).upper()
    quote, note = clean(args.get("quote"), 2000), clean(args.get("note"), 200)
    if not KEY.match(key):
        return "key: a Jira key, like ABC-123.", True
    if len(quote) < 3:
        return "quote: the passage's words, copied from the description.", True
    answer = ask("passage", {"key": key, "quote": quote, "note": note}, "show-passage")
    if answer.get("ok"):
        return f"Shown in Kelpie: {key}, with the passage marked in its description" + (f" ({note})." if note else "."), False
    return f"Kelpie didn't show it: {clean(answer.get('error'), 300) or 'no reason given'}", True


def get_profile(args):
    shared = read_json(os.path.join(home(), "shared.json"))
    if not isinstance(shared, dict):
        return "Kelpie's settings can't be read: Herdr has no shared state here yet (is Kelpie installed?).", True
    profiles = shared.get("kelpie.profiles") or {}
    pid = args.get("id")
    if pid is None:
        listed = [{"id": k, "name": v.get("name"), "folder": v.get("folder")} for k, v in profiles.items() if isinstance(v, dict)]
        return json.dumps(listed, indent=2, ensure_ascii=False) if listed else "No profiles yet.", False
    if not isinstance(pid, str) or pid not in profiles:
        return f"No profile {pid!r}. Profiles: {', '.join(profiles) or 'none'}.", True
    return json.dumps(profiles[pid], indent=2, ensure_ascii=False), False


def answered(answer):
    if answer.get("pending"):
        return ("Not saved yet: it waits for the person's yes in Kelpie's confirm dialog (nothing else in this "
                "change is saved meanwhile). Tell them to look at Kelpie, then call save_status."), False
    if answer.get("ok"):
        return "Saved. The profile now:\n" + json.dumps(answer.get("profile"), indent=2, ensure_ascii=False), False
    return f"Not saved: {clean(answer.get('error'), 500) or 'no reason given'}", True


def save_profile(args):
    pid, change = args.get("id"), args.get("set")
    if not isinstance(pid, str) or not PROFILE_ID.match(pid):
        return "id: a profile id, lowercase letters, digits and dashes.", True
    if not isinstance(change, dict) or not change:
        return "set: an object of the settings to change.", True
    return answered(ask("profile-apply", {"id": pid, "set": change}, "apply-profile"))


def save_status(_args):
    answer = read_json(os.path.join(folder(), "profile-apply.result.json"))
    if answer is None:
        return "No answer from Kelpie to look at: save something first.", True
    return answered(answer)


def open_profile_page(args):
    page = args.get("page")
    if page not in TABS:
        return f"page: one of {', '.join(TABS)}.", True
    kelpie(f"edit-profile-{page}")
    return f"Opened the profile dialog on its {page} page.", False


CALLS = {"show_passage": show_passage, "get_profile": get_profile, "save_profile": save_profile,
         "save_status": save_status, "open_profile_page": open_profile_page}


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
                    "serverInfo": {"name": "kelpie", "version": "0.2.0"}, "instructions": INSTRUCTIONS})
    elif method == "ping":
        reply(id_, {})
    elif method == "tools/list":
        reply(id_, {"tools": TOOLS})
    elif method == "tools/call":
        call = CALLS.get(params.get("name"))
        if not call:
            return reply(id_, error={"code": -32602, "message": f"No tool {params.get('name')!r}."})
        args = params.get("arguments") or {}
        try:
            text, failed = call(args if isinstance(args, dict) else {})
        except Unreachable as e:
            text, failed = str(e), True
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
