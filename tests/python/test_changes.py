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

    def test_unpushed_commits_are_counted_only_when_asked(self):
        d = self.repo("ABC-1", "api")
        [found] = self.changes("ABC-1")
        self.assertNotIn("unpushed", found)
        [found] = self.changes("--unpushed", "ABC-1")
        self.assertEqual((found["key"], found["unpushed"]), ("ABC-1", 1), "no remote: every commit")
        remote = os.path.join(self.root, "remote.git")
        git(self.root, "init", "-q", "--bare", remote)
        git(d, "remote", "add", "origin", remote)
        git(d, "push", "-q", "origin", "HEAD:refs/heads/work")
        self.assertEqual(self.changes("--unpushed", "ABC-1")[0]["unpushed"], 0, "on a remote branch")
        write(os.path.join(d, "more.txt"), "more\n")
        git(d, "add", ".")
        git(d, "commit", "-q", "-m", "second")
        self.assertEqual(self.changes("--unpushed", "ABC-1")[0]["unpushed"], 1, "the one past it")

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

    def test_a_ticket_folder_that_is_itself_a_repo(self):
        d = self.repo("ABC-1")
        write(os.path.join(d, "README.md"), "changed\n")
        [found] = self.changes("ABC-1")
        self.assertEqual((found["path"], found["ticket"], found["repo"]), (d, d, "ABC-1"))

    def test_ticket_folders_one_or_two_levels_down_not_three(self):
        self.repo("ABC-1", "api")
        self.repo("worktrees", "ABC-1", "web")
        self.repo("a", "b", "ABC-1", "deep")
        found = self.changes("ABC-1")
        self.assertEqual(sorted((f["repo"], f["ticket"]) for f in found),
                         [("api", os.path.join(self.root, "ABC-1")), ("web", os.path.join(self.root, "worktrees", "ABC-1"))])

    def test_a_ticket_folders_repos_count_whatever_their_branch(self):
        self.repo("ABC-1", "api", branch="unrelated")
        [found] = self.changes("ABC-1")
        self.assertEqual(found["branch"], "unrelated")

    def test_a_branch_counts_at_the_root_or_right_under_it_only(self):
        self.repo(branch="ABC-1-root")
        self.repo("deeper", "web", branch="ABC-1-deep")
        [found] = self.changes("ABC-1")
        self.assertEqual((found["path"], found["ticket"]), (self.root, None))

    def test_the_whole_key_only(self):
        self.repo("web", branch="feature/ABC-12-x")
        self.repo("api", branch="XABC-1")
        self.assertEqual(self.changes("ABC-1"), [])
        self.assertEqual([f["repo"] for f in self.changes("ABC-12")], ["web"])

    def test_a_repo_is_listed_once_under_its_ticket_folder(self):
        self.repo("ABC-1", "api", branch="ABC-1-x")
        found = self.changes("ABC-1")
        self.assertEqual(len(found), 1)
        self.assertIsNotNone(found[0]["ticket"])

    def test_a_worktree_reads_its_branch_from_its_gitdir(self):
        main = self.repo("main")
        git(main, "worktree", "add", "-q", "-b", "ABC-1-wt", os.path.join(self.root, "wt"))
        found = self.changes("ABC-1")
        self.assertEqual([(f["repo"], f["branch"]) for f in found], [("wt", "ABC-1-wt")])

    def test_a_changed_files_lines_counted_and_its_patch(self):
        d = self.repo("ABC-1", "api")
        write(os.path.join(d, "README.md"), "hello\nmore\nlines\n")
        [f] = self.changes("ABC-1")[0]["files"]
        self.assertEqual((f["path"], f["status"], f["add"], f["del"]), ("README.md", "modified", 2, 0))
        self.assertTrue(f["patch"].startswith("@@ -1 +1,3 @@"), f["patch"])
        self.assertNotIn("+++", f["patch"])

    def test_a_renamed_file_is_under_its_new_path(self):
        d = self.repo("ABC-1", "api")
        write(os.path.join(d, "src", "old", "f.ts"), "a\nb\nc\nd\n")
        git(d, "add", ".")
        git(d, "commit", "-q", "-m", "more")
        git(d, "mv", "src/old", "src/new")
        git(d, "mv", "README.md", "READ.md")
        files = {f["path"]: f for f in self.changes("ABC-1")[0]["files"]}
        self.assertEqual(sorted(files), ["READ.md", "src/new/f.ts"])
        self.assertIn("rename from src/old/f.ts", files["src/new/f.ts"]["patch"])

    def test_an_untracked_file_is_an_all_added_diff(self):
        d = self.repo("ABC-1", "api")
        write(os.path.join(d, "new.txt"), "one\ntwo\n")
        with open(os.path.join(d, "blob.bin"), "wb") as f:
            f.write(b"a\0b")
        files = {f["path"]: f for f in self.changes("ABC-1")[0]["files"]}
        self.assertEqual((files["new.txt"]["status"], files["new.txt"]["add"], files["new.txt"]["del"]), ("added", 2, 0))
        self.assertEqual(files["new.txt"]["patch"], "@@ -0,0 +1,2 @@ not added to git yet\n+one\n+two")
        self.assertEqual(files["blob.bin"]["patch"], "(new binary file, not added to git yet)")

    def test_ignored_files_dont_count(self):
        d = self.repo("ABC-1", "api")
        write(os.path.join(d, ".gitignore"), "build/\n")
        git(d, "add", ".")
        git(d, "commit", "-q", "-m", "ignore")
        write(os.path.join(d, "build", "out.js"), "x\n")
        self.assertEqual(self.changes("ABC-1")[0]["files"], [])


class Sessions(unittest.TestCase):
    def test_runs_on_an_empty_home_and_keeps_its_index_there(self):
        home = temp_dir(self)
        r = run_script("sessions", [home], home)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout), [])


if __name__ == "__main__":
    unittest.main()
