"""plugin/server.py, the Kelpie plugin's MCP server: the MCP handshake and its tools, each writing
Kelpie's request file and running `herdr-app do kelpie.<command>` (show_passage, save_profile,
open_profile_page) or reading what Kelpie saved (get_profile, save_status). A fake herdr-app stands
in for Kelpie, in a temp Herdr home; nothing real is reached."""
import json
import os
import stat
import subprocess
import sys
import unittest

from kelpie_test import REPO, temp_dir, write

SERVER = os.path.join(REPO, "plugin", "server.py")

# Kelpie as the server sees it: it logs each run, then answers as FAKE_ANSWER says and removes the
# request, as stories.js showPassageRequest and config.js applyProfileRequest do. ok, refuse, silent
# or fail for any command; pending (waits for the person's yes) and badset for apply-profile.
FAKE = """#!/bin/sh
dir="$HERDR_APP_HOME/kelpie"
printf '%s\\n' "$*" >> "$HERDR_APP_HOME/calls.log"
case "$2" in
  kelpie.show-passage) name=passage ;;
  kelpie.apply-profile) name=profile-apply ;;
  *) name="" ;;
esac
[ -n "$name" ] && cp "$dir/$name.json" "$HERDR_APP_HOME/last-request.json" 2>/dev/null
answer() { [ -n "$name" ] && printf '%s' "$1" > "$dir/$name.result.json"; rm -f "$dir/$name.json"; }
case "$FAKE_ANSWER" in
  ok) answer '{"ok": true, "profile": {"name": "Work", "folder": "/work"}}' ;;
  refuse) answer '{"ok": false, "error": "XYZ-1 isn\\u0027t a story in the shown profile\\u0027s list."}' ;;
  pending) answer '{"ok": false, "pending": true, "error": "Waiting for the person to confirm these changes in Kelpie."}' ;;
  badset) answer '{"ok": false, "error": "jira.url: a Jira Cloud board\\u0027s address."}' ;;
  fail) echo "no Herdr window" >&2; exit 1 ;;
  silent) ;;
esac
"""


class Server(unittest.TestCase):
    def setUp(self):
        self.home = temp_dir(self)
        self.bin = os.path.join(self.home, "bin")
        fake = write(os.path.join(self.bin, "herdr-app"), FAKE)
        os.chmod(fake, os.stat(fake).st_mode | stat.S_IXUSR)

    def talk(self, *messages, answer="ok", path=None):
        """The server's replies to `messages` (one JSON-RPC message per line), by id."""
        env = {"PATH": path if path is not None else f"{self.bin}:/usr/bin:/bin", "HOME": self.home,
               "HERDR_APP_HOME": self.home, "FAKE_ANSWER": answer, "LANG": "C", "KELPIE_SHOW_WAIT": "0.5"}
        stdin = "".join((m if isinstance(m, str) else json.dumps(m)) + "\n" for m in messages)
        r = subprocess.run([sys.executable, "-I", SERVER], input=stdin, capture_output=True, text=True, env=env, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return [json.loads(line) for line in r.stdout.splitlines() if line.strip()]

    def call(self, args, tool="show_passage", **kw):
        [reply] = self.talk({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": args}}, **kw)
        res = reply["result"]
        return res["content"][0]["text"], res["isError"]

    def calls(self):
        try:
            with open(os.path.join(self.home, "calls.log")) as f:
                return f.read().splitlines()
        except FileNotFoundError:
            return []

    def kelpie(self, name):
        return os.path.join(self.home, "kelpie", name)

    def test_the_handshake_lists_the_tools(self):
        init, listed = self.talk(
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        )
        self.assertEqual(init["result"]["protocolVersion"], "2025-06-18")
        self.assertIn("tools", init["result"]["capabilities"])
        tools = {t["name"]: t for t in listed["result"]["tools"]}
        self.assertEqual(sorted(tools), ["get_profile", "open_profile_page", "save_profile", "save_status", "show_passage"])
        self.assertEqual(tools["show_passage"]["inputSchema"]["required"], ["key", "quote"])
        self.assertEqual(tools["save_profile"]["inputSchema"]["required"], ["id", "set"])
        self.assertTrue(tools["get_profile"]["annotations"]["readOnlyHint"])

    def test_unknown_methods_tools_and_bad_lines_are_errors_not_crashes(self):
        bad, unknown, tool, ping = self.talk(
            "not json",
            {"jsonrpc": "2.0", "id": 1, "method": "resources/list"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "rm", "arguments": {}}},
            {"jsonrpc": "2.0", "id": 3, "method": "ping"},
        )
        self.assertEqual(bad["error"]["code"], -32700)
        self.assertEqual(unknown["error"]["code"], -32601)
        self.assertEqual(tool["error"]["code"], -32602)
        self.assertEqual(ping["result"], {})
        self.assertEqual(self.calls(), [])

    def test_a_passage_is_written_for_kelpie_and_its_answer_returned(self):
        text, failed = self.call({"key": "abc-12", "quote": "Done  when\nit works", "note": "The criteria"})
        self.assertFalse(failed)
        self.assertIn("Shown in Kelpie: ABC-12", text)
        self.assertEqual(self.calls(), ["do kelpie.show-passage"])
        with open(os.path.join(self.home, "last-request.json")) as f:
            self.assertEqual(json.load(f), {"key": "ABC-12", "quote": "Done when it works", "note": "The criteria"})

    def test_the_request_is_private(self):
        self.call({"key": "ABC-12", "quote": "Done when it works"})
        mode = os.stat(os.path.join(self.home, "last-request.json")).st_mode  # cp keeps the mode
        self.assertEqual(stat.S_IMODE(mode) & 0o077, 0, "only the person can read it")

    def test_kelpies_refusal_is_passed_on_as_an_error(self):
        text, failed = self.call({"key": "XYZ-1", "quote": "anything at all"}, answer="refuse")
        self.assertTrue(failed)
        self.assertIn("isn't a story", text)

    def test_an_answer_from_before_isnt_taken_for_this_one(self):
        write(self.kelpie("passage.result.json"), '{"ok": true}')
        text, failed = self.call({"key": "ABC-12", "quote": "Done when it works"}, answer="silent")
        self.assertTrue(failed)
        self.assertIn("didn't answer", text)

    def test_no_answer_removes_the_request_so_it_doesnt_show_later(self):
        text, failed = self.call({"key": "ABC-12", "quote": "Done when it works"}, answer="silent")
        self.assertTrue(failed)
        self.assertFalse(os.path.exists(self.kelpie("passage.json")))

    def test_herdr_refusing_or_missing_is_said(self):
        text, failed = self.call({"key": "ABC-12", "quote": "Done when it works"}, answer="fail")
        self.assertTrue(failed)
        self.assertIn("no Herdr window", text)
        self.assertFalse(os.path.exists(self.kelpie("passage.json")))
        text, failed = self.call({"key": "ABC-12", "quote": "Done when it works"}, path="/usr/bin:/bin")
        self.assertTrue(failed)
        self.assertIn("isn't installed", text)

    def test_bad_keys_and_empty_quotes_are_refused_before_anything_runs(self):
        bad = ["../../x", "ABC-12; rm -rf ~", "-ABC-1", "", None, 12]
        asks = [{"key": k, "quote": "Done when it works"} for k in bad] + [{"key": "ABC-12", "quote": "  "}]
        replies = self.talk(*[{"jsonrpc": "2.0", "id": n, "method": "tools/call", "params": {"name": "show_passage", "arguments": a}} for n, a in enumerate(asks)])
        texts = [(r["result"]["content"][0]["text"], r["result"]["isError"]) for r in replies]
        for (text, failed), key in zip(texts, bad):
            self.assertTrue(failed, key)
            self.assertTrue(text.startswith("key:"), text)
        self.assertTrue(texts[-1][1])
        self.assertTrue(texts[-1][0].startswith("quote:"))
        self.assertEqual(self.calls(), [], "herdr-app never ran")
        self.assertFalse(os.path.exists(self.kelpie("passage.json")))

    def test_a_link_in_the_requests_place_is_replaced_not_written_through(self):
        target = write(os.path.join(self.home, "precious.txt"), "mine\n")
        os.makedirs(os.path.dirname(self.kelpie("x")), exist_ok=True)
        os.symlink(target, self.kelpie("passage.json"))
        self.call({"key": "ABC-12", "quote": "Done when it works"}, answer="silent")
        with open(target) as f:
            self.assertEqual(f.read(), "mine\n")


    # --- Profiles -------------------------------------------------------------------------------

    def shared(self, profiles):
        write(os.path.join(self.home, "shared.json"), json.dumps({"layout": "Kelpie", "kelpie.profiles": profiles}))

    def test_get_profile_lists_profiles_or_shows_one(self):
        self.shared({"work": {"id": "work", "name": "Work", "folder": "/work", "jira": {"board": 12}}, "home": {"id": "home", "name": "Home", "folder": "/h"}})
        text, failed = self.call({}, tool="get_profile")
        self.assertFalse(failed)
        self.assertEqual(json.loads(text), [{"id": "work", "name": "Work", "folder": "/work"}, {"id": "home", "name": "Home", "folder": "/h"}])
        text, failed = self.call({"id": "work"}, tool="get_profile")
        self.assertEqual(json.loads(text)["jira"], {"board": 12})
        text, failed = self.call({"id": "nope"}, tool="get_profile")
        self.assertTrue(failed)
        self.assertIn("work, home", text)
        self.assertEqual(self.calls(), [], "reading runs nothing")

    def test_get_profile_without_herdrs_state_says_so(self):
        text, failed = self.call({}, tool="get_profile")
        self.assertTrue(failed)
        self.assertIn("can't be read", text)

    def test_save_profile_sends_the_change_and_returns_the_saved_profile(self):
        text, failed = self.call({"id": "work", "set": {"name": "Work", "jira": {"handover": "QA"}}}, tool="save_profile")
        self.assertFalse(failed)
        self.assertTrue(text.startswith("Saved."))
        self.assertEqual(self.calls(), ["do kelpie.apply-profile"])
        with open(os.path.join(self.home, "last-request.json")) as f:
            self.assertEqual(json.load(f), {"id": "work", "set": {"name": "Work", "jira": {"handover": "QA"}}})

    def test_a_change_waiting_for_the_persons_yes_says_so_and_save_status_reads_it_again(self):
        text, failed = self.call({"id": "work", "set": {"commands": {"status": "make status"}}}, tool="save_profile", answer="pending")
        self.assertFalse(failed)
        self.assertIn("waits for the person's yes", text)
        write(self.kelpie("profile-apply.result.json"), '{"ok": false, "error": "The person said no to these changes: nothing was saved."}')
        text, failed = self.call({}, tool="save_status")
        self.assertTrue(failed)
        self.assertIn("said no", text)

    def test_kelpies_refusal_of_a_change_is_an_error(self):
        text, failed = self.call({"id": "work", "set": {"jira": {"url": "https://evil.example/boards/1"}}}, tool="save_profile", answer="badset")
        self.assertTrue(failed)
        self.assertIn("jira.url", text)

    def test_bad_ids_and_empty_changes_are_refused_before_anything_runs(self):
        for args in [{"id": "../x", "set": {"name": "x"}}, {"id": "Work", "set": {"name": "x"}}, {"id": "w", "set": {}}, {"id": "w", "set": "name=x"}, {"id": "w"}]:
            text, failed = self.call(args, tool="save_profile")
            self.assertTrue(failed, args)
        self.assertEqual(self.calls(), [])

    def test_save_status_with_nothing_saved_says_so(self):
        text, failed = self.call({}, tool="save_status")
        self.assertTrue(failed)
        self.assertIn("save something first", text)

    def test_open_profile_page_opens_only_a_known_page(self):
        text, failed = self.call({"page": "jira"}, tool="open_profile_page")
        self.assertFalse(failed)
        self.assertEqual(self.calls(), ["do kelpie.edit-profile-jira"])
        text, failed = self.call({"page": "jira; rm -rf ~"}, tool="open_profile_page")
        self.assertTrue(failed)
        self.assertEqual(self.calls(), ["do kelpie.edit-profile-jira"], "nothing else ran")


if __name__ == "__main__":
    unittest.main()
