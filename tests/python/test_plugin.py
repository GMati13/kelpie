"""plugin/server.py, the Kelpie plugin's MCP server: the MCP handshake and its tool, show_passage, which
writes Kelpie's request file and runs `herdr-app do kelpie.show-passage`. A fake herdr-app stands in
for Kelpie, in a temp Herdr home; nothing real is reached."""
import json
import os
import stat
import subprocess
import sys
import unittest

from kelpie_test import REPO, temp_dir, write

SERVER = os.path.join(REPO, "plugin", "server.py")

# Kelpie as the server sees it: it logs each run, then answers as FAKE_ANSWER says (ok, refuse, silent
# or fail) and removes the request, as stories.js showPassageRequest does.
FAKE = """#!/bin/sh
dir="$HERDR_APP_HOME/kelpie"
printf '%s\\n' "$*" >> "$HERDR_APP_HOME/calls.log"
cp "$dir/passage.json" "$HERDR_APP_HOME/last-request.json" 2>/dev/null
case "$FAKE_ANSWER" in
  ok) printf '{"ok": true}' > "$dir/passage.result.json"; rm -f "$dir/passage.json" ;;
  refuse) printf '{"ok": false, "error": "XYZ-1 isn\\x27t a story in the shown profile\\x27s list."}' > "$dir/passage.result.json"; rm -f "$dir/passage.json" ;;
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

    def call(self, args, **kw):
        [reply] = self.talk({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "show_passage", "arguments": args}}, **kw)
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

    def test_the_handshake_lists_one_tool(self):
        init, listed = self.talk(
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        )
        self.assertEqual(init["result"]["protocolVersion"], "2025-06-18")
        self.assertIn("tools", init["result"]["capabilities"])
        self.assertEqual([t["name"] for t in listed["result"]["tools"]], ["show_passage"])
        self.assertEqual(listed["result"]["tools"][0]["inputSchema"]["required"], ["key", "quote"])

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


if __name__ == "__main__":
    unittest.main()
