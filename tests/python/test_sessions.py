"""sessions.py: earlier Claude sessions under a folder, read from fake ~/.claude*/projects JSONL files
in a temp HOME (never the person's own), and the index that keeps it cheap."""
import json
import os
import re
import unittest

from kelpie_test import run_script, temp_dir, write


def line(**rec):
    # Claude Code writes compact JSON, and sessions.py looks for its exact bytes ("type":"user").
    return json.dumps(rec, separators=(",", ":")) + "\n"


def user(text, **more):
    return line(type="user", message={"role": "user", "content": text}, **more)


class Sessions(unittest.TestCase):
    def setUp(self):
        self.home = temp_dir(self)
        self.folder = os.path.join(self.home, "code", "work")
        os.makedirs(self.folder)

    def session(self, sid, *lines, account=".claude", folder=None, cwd=None, mtime=None):
        """A session file of `account` for `folder` (the profile's folder by default), its first line
        carrying its cwd."""
        folder = folder or self.folder
        encoded = re.sub(r"[^A-Za-z0-9]", "-", folder)
        path = os.path.join(self.home, account, "projects", encoded, sid + ".jsonl")
        write(path, line(type="system", cwd=cwd or folder, gitBranch="main") + "".join(lines))
        if mtime:
            os.utime(path, (mtime, mtime))
        return path

    def run_it(self, *args, folder=None):
        r = run_script("sessions", [folder or self.folder, *args], self.home)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def index(self):
        with open(os.path.join(self.home, ".cache", "kelpie", "sessions.json")) as f:
            return json.load(f)

    def save_index(self, data):
        with open(os.path.join(self.home, ".cache", "kelpie", "sessions.json"), "w") as f:
            json.dump(data, f)

    def test_titles_custom_then_claudes_then_the_last_prompt(self):
        self.session("a", user("hi"), line(type="ai-title", aiTitle="Claude's"), line(type="custom-title", customTitle="Mine"), mtime=3000)
        self.session("b", user("hi"), line(type="ai-title", aiTitle="Claude's"), line(type="last-prompt", lastPrompt="go on"), mtime=2000)
        self.session("c", user("hi"), line(type="last-prompt", lastPrompt="go on"), mtime=1000)
        self.session("untitled", user("hi"), mtime=500)
        out = self.run_it()
        self.assertEqual([(s["id"], s["title"]) for s in out], [("a", "Mine"), ("b", "Claude's"), ("c", "go on")])
        self.assertEqual(out[1]["prompt"], "go on")
        self.assertEqual((out[0]["cwd"], out[0]["branch"], out[0]["updated"]), (self.folder, "main", 3000000))

    def test_first_keys_from_the_message_that_started_it_and_keys_from_all_yours(self):
        self.session("a",
                     user("<local-command-stdout>ZZ-1</local-command-stdout>"),
                     user("Caveat ZZ-2", isMeta=True),
                     user("<command-name>/clear</command-name> ZZ-3"),
                     user([{"type": "text", "text": "Work on ABC-1 and ABC-2, then ABC-1"}]),
                     line(type="user", message={"content": [{"type": "tool_result", "tool_use_id": "t", "content": "XYZ-9"}]}),
                     user("Now ABC-3"),
                     line(type="ai-title", aiTitle="T"))
        [s] = self.run_it()
        self.assertEqual(s["first"], ["ABC-1", "ABC-2"])
        self.assertEqual(s["keys"], ["ZZ-1", "ZZ-2", "ZZ-3", "ABC-1", "ABC-2", "ABC-3"])

    def test_a_command_with_arguments_starts_the_work(self):
        self.session("a", user("<command-name>/review</command-name><command-args>ABC-7</command-args>"), line(type="ai-title", aiTitle="T"))
        self.assertEqual(self.run_it()[0]["first"], ["ABC-7"])

    def test_sessions_under_the_folder_count_a_sibling_folders_dont(self):
        self.session("under", line(type="ai-title", aiTitle="T"), folder=os.path.join(self.folder, "api"))
        self.session("sibling", line(type="ai-title", aiTitle="T"), folder=self.folder + "-old")
        # An encoded name can match a folder it isn't under ("work/x" and "work-x"): the cwd decides.
        self.session("lookalike", line(type="ai-title", aiTitle="T"), folder=os.path.join(self.folder, "x"), cwd=self.folder + "-x")
        self.assertEqual([s["id"] for s in self.run_it()], ["under"])

    def test_newest_first_up_to_the_limit(self):
        for n in range(5):
            self.session(f"s{n}", line(type="ai-title", aiTitle=f"T{n}"), mtime=1000 + n)
        self.assertEqual([s["id"] for s in self.run_it("3")], ["s4", "s3", "s2"])

    def test_each_says_its_account_and_one_account_can_be_asked_for(self):
        self.session("own", line(type="ai-title", aiTitle="T"), mtime=2000)
        self.session("work", line(type="ai-title", aiTitle="T"), account=".claude-work", mtime=1000)
        out = {s["id"]: s["config"] for s in self.run_it()}
        self.assertEqual(out, {"own": None, "work": os.path.join(self.home, ".claude-work")})
        self.assertEqual([s["id"] for s in self.run_it("40", os.path.join(self.home, ".claude-work"))], ["work"])
        self.assertEqual([s["id"] for s in self.run_it("40", "~/.claude")], ["own"])

    def test_a_live_claudes_session_is_running(self):
        self.session("live", line(type="ai-title", aiTitle="T"))
        self.session("gone", line(type="ai-title", aiTitle="T"))
        write(os.path.join(self.home, ".claude", "sessions", "1.json"), json.dumps({"pid": os.getpid(), "sessionId": "live"}))
        write(os.path.join(self.home, ".claude", "sessions", "2.json"), json.dumps({"pid": 999999999, "sessionId": "gone"}))
        self.assertEqual({s["id"]: s["running"] for s in self.run_it()}, {"live": True, "gone": False})

    def test_the_index_keeps_what_each_file_said_and_how_far_it_was_read(self):
        path = self.session("a", user("ABC-1"), line(type="ai-title", aiTitle="T"))
        self.run_it()
        entry = self.index()[path]
        self.assertEqual(entry["offset"], os.path.getsize(path))
        self.assertEqual(entry["info"]["first"], ["ABC-1"])

    def test_an_unchanged_file_isnt_read_again(self):
        path = self.session("a", line(type="ai-title", aiTitle="Read once"))
        self.run_it()
        cache = self.index()
        cache[path]["info"]["title"] = "From the index"
        self.save_index(cache)
        self.assertEqual(self.run_it()[0]["title"], "From the index")

    def test_a_file_that_grew_is_read_on_from_where_it_was(self):
        path = self.session("a", user("ABC-1"), line(type="ai-title", aiTitle="Read once"))
        self.run_it()
        cache = self.index()
        cache[path]["info"]["title"] = "From the index"
        self.save_index(cache)
        with open(path, "a") as f:
            f.write(user("and ABC-2") + line(type="last-prompt", lastPrompt="more"))
        [s] = self.run_it()
        self.assertEqual(s["title"], "From the index", "the lines before weren't read again")
        self.assertEqual((s["keys"], s["first"], s["prompt"]), (["ABC-1", "ABC-2"], ["ABC-1"], "more"))
        self.assertEqual(self.index()[path]["offset"], os.path.getsize(path))

    def test_a_line_still_being_written_is_read_again_once_whole(self):
        path = self.session("a", line(type="ai-title", aiTitle="T"))
        whole = os.path.getsize(path)
        with open(path, "a") as f:
            f.write('{"type":"custom-title","customTi')
        self.run_it()
        self.assertEqual(self.index()[path]["offset"], whole)
        with open(path, "a") as f:
            f.write('tle":"Named"}\n')
        self.assertEqual(self.run_it()[0]["title"], "Named")

    def test_a_replaced_or_shorter_file_is_read_from_the_start(self):
        path = self.session("a", user("ABC-1"), line(type="ai-title", aiTitle="Old"))
        self.run_it()
        cache = self.index()
        cache[path]["info"]["title"] = "From the index"
        self.save_index(cache)
        tmp = path + ".new"
        write(tmp, line(type="system", cwd=self.folder) + user("ABC-9") + line(type="ai-title", aiTitle="New file, longer than the old one was"))
        os.replace(tmp, path)
        [s] = self.run_it()
        self.assertEqual((s["title"], s["first"]), ("New file, longer than the old one was", ["ABC-9"]))
        with open(path, "w") as f:  # the same file, shortened
            f.write(line(type="system", cwd=self.folder) + line(type="ai-title", aiTitle="Short"))
        self.assertEqual(self.run_it()[0]["title"], "Short")

    def test_a_deleted_files_entry_leaves_the_index_other_folders_entries_stay(self):
        gone = self.session("a", line(type="ai-title", aiTitle="T"))
        other = os.path.join(self.home, "code", "other")
        os.makedirs(other)
        kept = self.session("b", line(type="ai-title", aiTitle="T"), folder=other)
        self.run_it()
        self.run_it(folder=other)
        self.assertEqual(set(self.index()), {gone, kept})
        os.remove(gone)
        self.assertEqual(self.run_it(), [])
        self.assertEqual(set(self.index()), {kept})


if __name__ == "__main__":
    unittest.main()
