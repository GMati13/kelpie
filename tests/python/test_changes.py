"""changes.py: which repos work on a ticket key, and their uncommitted changes (Clean up refuses a
story that has any)."""
import json
import os
import unittest

from kelpie_test import git, run_script, temp_dir, write


class Changes(unittest.TestCase):
    def setUp(self):
        self.root = temp_dir(self)

    def repo(self, *parts, branch=None):
        d = os.path.join(self.root, *parts)
        write(os.path.join(d, "README.md"), "hello\n")
        git(d, "init", "-q")
        if branch:
            git(d, "checkout", "-q", "-b", branch)
        git(d, "add", ".")
        git(d, "commit", "-q", "-m", "first")
        return d

    def changes(self, *keys):
        r = run_script("changes", [self.root, *keys], self.root)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_a_ticket_folders_repo_with_a_changed_file(self):
        d = self.repo("ABC-1", "api")
        write(os.path.join(d, "README.md"), "changed\n")
        [found] = self.changes("ABC-1")
        self.assertEqual((found["key"], found["repo"]), ("ABC-1", "api"))
        self.assertEqual([f["path"] for f in found["files"]], ["README.md"])

    def test_an_untracked_file_counts(self):
        d = self.repo("worktrees", "ABC-1", "api")
        write(os.path.join(d, "new.txt"), "new\n")
        [found] = self.changes("ABC-1")
        self.assertEqual([f["path"] for f in found["files"]], ["new.txt"])

    def test_a_clean_repo_is_listed_without_files(self):
        self.repo("ABC-1", "api")
        [found] = self.changes("ABC-1")
        self.assertEqual(found["files"], [])

    def test_a_repo_whose_branch_names_the_key(self):
        d = self.repo("web", branch="feature/ABC-1-login")
        write(os.path.join(d, "README.md"), "changed\n")
        [found] = self.changes("ABC-1")
        self.assertEqual((found["repo"], found["branch"]), ("web", "feature/ABC-1-login"))
        self.assertTrue(found["files"])

    def test_other_keys_dont_count(self):
        d = self.repo("ABC-10", "api")
        write(os.path.join(d, "README.md"), "changed\n")
        self.repo("other", branch="feature/ABC-10")
        self.assertEqual(self.changes("ABC-1"), [])


class Sessions(unittest.TestCase):
    def test_runs_on_an_empty_home_and_keeps_its_index_there(self):
        home = temp_dir(self)
        r = run_script("sessions", [home], home)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout), [])


if __name__ == "__main__":
    unittest.main()
