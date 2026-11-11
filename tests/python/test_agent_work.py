"""agent-work.py: what running Claude sessions are about (their name, the message that started them,
the files they changed), read from fake ~/.claude*/projects JSONL files in a temp HOME (never the
person's own). Only the person's Claude account folders and well-formed session ids are read."""
import json
import os
import unittest

from kelpie_test import run_script, temp_dir, write

SID = "0b6d8f9e-1c2a-4e5f-9a7b-3c4d5e6f7a8b"


def line(**rec):
    # Claude Code writes compact JSON, and the script looks for its exact bytes ("type":"user").
    return json.dumps(rec, separators=(",", ":")) + "\n"


def user(text, **more):
    return line(type="user", message={"role": "user", "content": text}, **more)


def edit(tool, path, at, key="file_path"):
    return line(type="assistant", timestamp=at, message={"role": "assistant", "content": [
        {"type": "text", "text": "Changing it."}, {"type": "tool_use", "id": "t", "name": tool, "input": {key: path, "old_string": "a"}}]})


class AgentWork(unittest.TestCase):
    def setUp(self):
        self.home = temp_dir(self)

    def session(self, sid, *lines, account=".claude"):
        write(os.path.join(self.home, account, "projects", "-code-work", sid + ".jsonl"), "".join(lines))

    def run_it(self, *args):
        r = run_script("agent-work", list(args), self.home)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_its_name_first_message_and_changed_files_newest_first(self):
        self.session(SID,
                     user("<local-command-stdout>noise</local-command-stdout>"),
                     user("Fix the login test", isMeta=True),
                     user("Work on ABC-12: fix the   flaky\nlogin test"),
                     line(type="ai-title", aiTitle="Flaky login test"),
                     edit("Edit", "/code/work/web/login.ts", "2026-01-01T10:00:00Z"),
                     edit("Write", "/code/work/web/new.ts", "2026-01-01T10:05:00Z"),
                     edit("NotebookEdit", "/code/work/nb.ipynb", "2026-01-01T09:00:00Z", key="notebook_path"),
                     edit("Read", "/code/work/only-read.ts", "2026-01-01T11:00:00Z"),
                     edit("Edit", "/code/work/web/login.ts", "2026-01-01T10:10:00Z"),
                     line(type="custom-title", customTitle="Login test"))
        out = self.run_it("", SID)[SID]
        self.assertEqual(out["title"], "Login test")
        self.assertEqual(out["first"], "Work on ABC-12: fix the flaky login test")
        self.assertEqual([f["path"] for f in out["files"]], ["/code/work/web/login.ts", "/code/work/web/new.ts", "/code/work/nb.ipynb"])
        self.assertEqual(out["files"][0]["at"], "2026-01-01T10:10:00Z")

    def test_another_account_is_read_from_its_own_folder(self):
        self.session(SID, user("On the other account"), account=".claude-work")
        self.assertEqual(self.run_it("", SID), {})
        self.assertEqual(self.run_it(os.path.join(self.home, ".claude-work"), SID)[SID]["first"], "On the other account")

    def test_only_the_persons_claude_folders_and_real_session_ids_are_read(self):
        # A folder that isn't a Claude account of the home folder, or an id that would reach another
        # file, reads nothing.
        write(os.path.join(self.home, "elsewhere", "projects", "x", SID + ".jsonl"), user("not a Claude account"))
        self.session("..", user("a dotted id"))
        self.session(SID, user("fine"))
        for args in ((os.path.join(self.home, "elsewhere"), SID), ("/etc", SID), (os.path.join(self.home, ".claude", ".."), SID),
                     ("", "../x"), ("", "*"), ("", ".."), ("", "")):
            self.assertEqual(self.run_it(*args), {}, args)

    def test_several_sessions_in_one_run_and_lines_that_arent_json_skipped(self):
        other = "1" * 8 + "-2222-3333-4444-" + "5" * 12
        self.session(SID, "not json\n", user("first one"))
        self.session(other, user("second one"), edit("Edit", 42, "x"))
        out = self.run_it("", SID, "", other, "", "9" * 36)
        self.assertEqual(sorted(out), sorted([SID, other]))
        self.assertEqual(out[other]["files"], [])


if __name__ == "__main__":
    unittest.main()
