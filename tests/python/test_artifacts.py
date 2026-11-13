"""artifacts.py: the Claude Artifacts some sessions published, read from fake ~/.claude*/projects JSONL
logs in a temp HOME (never the person's own), and the private index that keeps it cheap."""
import json
import os
import stat
import unittest

from kelpie_test import run_script, temp_dir, write

SID = "0f1e2d3c-aaaa-bbbb-cccc-000000000001"
OTHER = "0f1e2d3c-aaaa-bbbb-cccc-000000000002"
LINK = "https://claude.ai/artifact/Ab3_x-9"


def line(**rec):
    # Claude Code writes compact JSON, and artifacts.py looks for its exact bytes ("name":"Artifact").
    return json.dumps(rec, separators=(",", ":")) + "\n"


def call(cid, **given):
    """Claude's Artifact tool call."""
    return line(type="assistant", timestamp="2026-11-10T09:00:00.000Z",
                message={"role": "assistant", "content": [{"type": "tool_use", "id": cid, "name": "Artifact", "input": given}]})


def answer(cid, at="2026-11-10T09:00:05.000Z", error=False, **result):
    """The tool's answer: its words in the message, what it returned as toolUseResult."""
    return line(type="user", timestamp=at, toolUseResult=result if not error else "Error: no",
                message={"role": "user", "content": [{"type": "tool_result", "tool_use_id": cid, "content": "Published", **({"is_error": True} if error else {})}]})


def published(cid, url=LINK, at="2026-11-10T09:00:05.000Z", title="Trip report", **given):
    return call(cid, file_path="/tmp/x/report.html", **given) + answer(cid, at=at, url=url, title=title, path="/tmp/x/report.html", seq=1)


class Artifacts(unittest.TestCase):
    def setUp(self):
        self.home = temp_dir(self)

    def log(self, sid, *lines, account=".claude", project="-code-work"):
        path = os.path.join(self.home, account, "projects", project, sid + ".jsonl")
        write(path, "".join(lines))
        return path

    def run_it(self, *ids):
        r = run_script("artifacts", list(ids), self.home)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def index_path(self):
        return os.path.join(self.home, ".cache", "kelpie", "artifacts.json")

    def test_a_publish_gives_its_link_title_description_source_and_time(self):
        self.log(SID, published("c1", description="What the trip costs, day by day."))
        [a] = self.run_it(SID)
        self.assertEqual(a["url"], LINK)
        self.assertEqual((a["title"], a["description"], a["path"]), ("Trip report", "What the trip costs, day by day.", "/tmp/x/report.html"))
        self.assertEqual((a["count"], a["session"], a["config"]), (1, SID, None))
        self.assertEqual(a["first"], a["last"])
        self.assertEqual(a["last"], 1794301205000)

    def test_each_artifact_once_counted_with_its_latest_title_and_session(self):
        self.log(SID, published("c1", title="Draft", description="first"),
                 call("c2", edits=[{"old_str": "a", "new_str": "b"}], file_path="/tmp/x/report.html")
                 + answer("c2", at="2026-11-10T10:00:00.000Z", url=LINK, title="Trip report", path="/tmp/x/report.html"))
        self.log(OTHER, published("c3", at="2026-11-10T11:00:00.000Z", title="Trip report v3"),
                 published("c4", url="https://claude.ai/code/artifact/other-1", at="2026-11-10T08:00:00.000Z", title="Older"))
        out = self.run_it(SID, OTHER)
        self.assertEqual([a["url"] for a in out], [LINK, "https://claude.ai/code/artifact/other-1"], "newest first")
        self.assertEqual((out[0]["count"], out[0]["title"], out[0]["session"]), (3, "Trip report v3", OTHER))
        # An update sent as edits gives no description: the one given before stays.
        self.assertEqual(out[0]["description"], "first")
        self.assertLess(out[0]["first"], out[0]["last"])

    def test_only_publishes_of_a_page_that_answered_an_artifact_link_count(self):
        self.log(SID,
                 call("r", action="read", url=LINK) + answer("r", url=LINK, title="read"),
                 call("o", action="open", url=LINK) + answer("o", url=LINK, title="opened"),
                 call("u", url=LINK, asset=True, file_path="/tmp/x/a.png") + answer("u", url=LINK, title="asset"),
                 call("e", file_path="/tmp/x/a.html") + answer("e", error=True),
                 call("w", file_path="/tmp/x/a.html") + answer("w", url="https://evil.example/artifact/x", title="elsewhere"),
                 call("s", file_path="/tmp/x/a.html") + answer("s", url=LINK + "/../../x", title="not just an id"),
                 # Another tool's answer with a link is no Artifact.
                 line(type="user", toolUseResult={"url": LINK}, message={"role": "user", "content": [{"type": "tool_result", "tool_use_id": "zzz"}]}))
        self.assertEqual(self.run_it(SID), [])

    def test_titles_and_descriptions_are_one_short_line(self):
        self.log(SID, published("c1", title="Trip\x1b]0;evil\x07 report\n" + "x" * 400, description="line\r\none"))
        [a] = self.run_it(SID)
        self.assertNotRegex(a["title"], r"[\x00-\x1f\x7f]")
        self.assertLessEqual(len(a["title"]), 300)
        self.assertEqual(a["description"], "line one")

    def test_the_account_it_was_made_on(self):
        self.log(SID, published("c1"), account=".claude-work")
        [a] = self.run_it(SID)
        self.assertEqual(a["config"], os.path.join(self.home, ".claude-work"))

    def test_only_session_ids_are_looked_for(self):
        self.log(SID, published("c1"))
        self.assertEqual(self.run_it("*", "../" + SID, "-rf"), [])
        self.assertFalse(os.path.exists(self.index_path()), "nothing read, nothing written")

    def test_a_call_whose_answer_comes_in_a_later_run_still_counts(self):
        path = self.log(SID, call("c1", file_path="/tmp/x/report.html"))
        self.assertEqual(self.run_it(SID), [])
        with open(path, "a") as f:
            f.write(answer("c1", url=LINK, title="Trip report"))
        [a] = self.run_it(SID)
        self.assertEqual(a["title"], "Trip report")

    def test_a_line_still_being_written_is_read_once_whole(self):
        whole = published("c1")
        path = self.log(SID, whole[:-40])
        self.assertEqual(self.run_it(SID), [])
        with open(path, "w") as f:
            f.write(whole)
        self.assertEqual(len(self.run_it(SID)), 1)

    def test_the_index_is_private_and_an_unchanged_log_is_not_read_again(self):
        path = self.log(SID, published("c1"))
        self.run_it(SID)
        mode = stat.S_IMODE(os.stat(self.index_path()).st_mode)
        self.assertEqual(mode, 0o600, oct(mode))
        # Unreadable now: the index answers, as the file's size and time are the same.
        os.chmod(path, 0)
        self.addCleanup(os.chmod, path, 0o600)
        self.assertEqual(len(self.run_it(SID)), 1)

    def test_a_link_in_the_index_place_is_replaced_not_written_through(self):
        os.makedirs(os.path.dirname(self.index_path()))
        target = os.path.join(self.home, "owned.txt")
        write(target, "the person's file")
        os.symlink(target, self.index_path())
        self.log(SID, published("c1"))
        self.run_it(SID)
        with open(target) as f:
            self.assertEqual(f.read(), "the person's file")
        self.assertFalse(os.path.islink(self.index_path()))


if __name__ == "__main__":
    unittest.main()
