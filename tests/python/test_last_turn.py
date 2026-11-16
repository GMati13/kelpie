"""last-turn.py: how running Claude sessions' last turns ended (the last message Claude wrote), read
from fake ~/.claude*/projects JSONL files in a temp HOME (never the person's own), for Kelpie to tell
an agent waiting on the person (#251). Only the person's Claude account folders and well-formed
session ids are read, only the end of each file, and never through a link."""
import json
import os
import unittest

from kelpie_test import load, run_script, temp_dir, write

SID = "0b6d8f9e-1c2a-4e5f-9a7b-3c4d5e6f7a8b"


def line(**rec):
    return json.dumps(rec, separators=(",", ":")) + "\n"


def user(text, at="2026-01-01T10:00:00Z", **more):
    return line(type="user", timestamp=at, message={"role": "user", "content": text}, **more)


def said(text, uuid, at="2026-01-01T10:05:00Z"):
    return line(type="assistant", uuid=uuid, timestamp=at, message={"role": "assistant", "content": [{"type": "text", "text": text}]})


def tool(uuid="t1"):
    return line(type="assistant", uuid=uuid, message={"role": "assistant", "content": [{"type": "tool_use", "id": "x", "name": "Read", "input": {}}]})


def result():
    return line(type="user", message={"role": "user", "content": [{"type": "tool_result", "tool_use_id": "x", "content": "ok"}]})


class LastTurn(unittest.TestCase):
    def setUp(self):
        self.home = temp_dir(self)

    def session(self, sid, *lines, account=".claude"):
        path = os.path.join(self.home, account, "projects", "-code-work", sid + ".jsonl")
        write(path, "".join(lines))
        return path

    def run_it(self, *args):
        r = run_script("last-turn", list(args), self.home)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_the_closing_message_after_its_last_tool_with_the_turn_it_closes(self):
        self.session(SID,
                     user("Earlier", at="2026-01-01T09:00:00Z"), said("Old answer.", "a0"),
                     user("Build the footer", at="2026-01-01T10:00:00Z"),
                     said("Looking at it first.", "a1"), tool(), result(),
                     said("I've drafted two layouts.", "a2"),
                     said("Should the footer show both counts, or only the most urgent?", "a3", at="2026-01-01T10:07:00Z"))
        out = self.run_it("", SID)[SID]
        self.assertEqual(out["text"], "I've drafted two layouts.\n\nShould the footer show both counts, or only the most urgent?")
        self.assertEqual(out["turn"], "a3")
        self.assertEqual(out["at"], "2026-01-01T10:07:00Z")
        self.assertEqual(out["asked"], "2026-01-01T10:00:00Z")

    def test_a_turn_ending_on_a_tool_or_waiting_on_its_result_has_no_closing_message(self):
        self.session(SID, user("Go"), said("On it.", "a1"), tool())
        self.assertEqual(self.run_it("", SID), {})
        self.session(SID, user("Go"), said("On it.", "a1"), tool(), result())
        self.assertEqual(self.run_it("", SID), {})

    def test_claude_codes_own_notes_dont_start_a_turn(self):
        self.session(SID, user("Do it"), said("Which branch: main or dev?", "a1"),
                     user("<local-command-stdout>ok</local-command-stdout>"), user("note", isMeta=True))
        self.assertEqual(self.run_it("", SID)[SID]["text"], "Which branch: main or dev?")

    def test_only_its_end_is_kept(self):
        self.session(SID, user("Go"), said("x" * 5000 + "Which one?", "a1"))
        text = self.run_it("", SID)[SID]["text"]
        self.assertEqual(len(text), 2000)
        self.assertTrue(text.endswith("Which one?"))

    def test_only_the_end_of_a_long_file_is_read(self):
        script = load("last-turn")
        big = "".join(said("filler " * 100, "f%d" % n) for n in range(2000))  # about 1.5 MB
        path = self.session(SID, user("Old"), big, user("Now", at="2026-01-01T11:00:00Z"), said("Done: the PR is open.", "end"))
        opened = []
        real_open = open

        def spy(p, *a, **k):
            f = real_open(p, *a, **k)
            reads = []
            orig = f.read

            def read(n=-1):
                data = orig(n)
                reads.append(len(data))
                return data
            f.read = read
            opened.append(reads)
            return f
        script.open = spy
        out = script.tail(path)
        self.assertEqual(out["text"], "Done: the PR is open.")
        self.assertEqual(out["asked"], "2026-01-01T11:00:00Z")
        self.assertLessEqual(sum(opened[0]), script.BLOCK, "one block from the end was enough")

    def test_another_accounts_session_is_read_from_its_own_folder(self):
        self.session(SID, user("Go"), said("Done.", "a1"), account=".claude-work")
        self.assertEqual(self.run_it("", SID), {})
        self.assertEqual(self.run_it(os.path.join(self.home, ".claude-work"), SID)[SID]["text"], "Done.")

    def test_a_folder_outside_the_accounts_or_an_odd_id_is_never_read(self):
        write(os.path.join(self.home, "elsewhere", "projects", "-x", SID + ".jsonl"), user("Go") + said("Secret?", "a1"))
        self.assertEqual(self.run_it(os.path.join(self.home, "elsewhere"), SID), {})
        self.assertEqual(self.run_it("/etc", SID), {})
        self.session("../x", user("Go"), said("Hm?", "a1"))
        self.assertEqual(self.run_it("", "../x"), {})
        self.assertEqual(self.run_it("", "*"), {})

    def test_a_transcript_that_is_a_link_is_never_followed(self):
        target = os.path.join(self.home, "outside.jsonl")
        write(target, user("Go") + said("Read through a link?", "a1"))
        folder = os.path.join(self.home, ".claude", "projects", "-code-work")
        os.makedirs(folder, exist_ok=True)
        os.symlink(target, os.path.join(folder, SID + ".jsonl"))
        self.assertEqual(self.run_it("", SID), {})


if __name__ == "__main__":
    unittest.main()
