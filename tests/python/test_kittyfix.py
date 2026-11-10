"""kittyfix.py's Rewriter: bad or unfinished input never freezes or kills the browser's output."""
import os
import subprocess
import sys
import time
import unittest

from kelpie_test import MODS, clean_env, load, temp_dir

kf = load("kittyfix", ["--", "true"])

ST = b"\x1b\\"


def apc(ctrl, payload=b""):
    return b"\x1b_G" + ctrl + (b";" + payload if payload else b"") + ST


class Chunks(unittest.TestCase):
    def test_a_chunked_image_still_assembles(self):
        rw = kf.Rewriter()
        self.assertEqual(rw.feed(apc(b"a=T,f=100,i=1,m=1", b"AAAA")), b"")
        out = rw.feed(apc(b"m=0", b"BBBB"))
        self.assertIn(apc(b"a=T,f=100,i=%d,m=0" % kf.FRESH, b"AAAABBBB"), out)
        self.assertIsNone(rw.cur)

    def test_a_frame_split_across_reads_anywhere_comes_out_the_same(self):
        # A read ending between a terminator's ESC and backslash used to pass the chunk on unparsed.
        s = (b"\x1b[?2026h" + apc(b"a=T,f=100,i=1,m=1", b"A" * 40) + apc(b"m=1", b"B" * 40)
             + apc(b"m=0", b"C" * 40) + b"\x1b[?2026l")
        whole = kf.Rewriter().feed(s)
        self.assertIn(apc(b"a=T,f=100,i=%d,m=0" % kf.FRESH, b"A" * 40 + b"B" * 40 + b"C" * 40), whole)
        for i in range(1, len(s)):
            rw = kf.Rewriter()
            self.assertEqual(rw.feed(s[:i]) + rw.feed(s[i:]), whole, "split at %d" % i)

    def test_a_patch_is_moved_to_column_1_wherever_the_reads_split_it(self):
        # A read cutting the cursor move before an image left the patch where it was (it drifted).
        import base64, zlib
        pixels = base64.b64encode(zlib.compress(b"\x10\x20\x30\xff" * 8))
        s = (b"\x1b[?2026h\x1b[5;9H" + apc(b"a=T,f=32,o=z,s=4,v=2,t=d,i=3,p=1,X=2,Y=1,q=2", pixels)
             + b"\x1b[?2026l")
        whole = kf.Rewriter().feed(s)
        self.assertIn(b"\x1b[5;1H", whole)
        self.assertIn(b"s=86,v=3", whole, "padded by 8 columns of 10 px plus X=2, and Y=1")
        for i in range(1, len(s)):
            rw = kf.Rewriter()
            self.assertEqual(rw.feed(s[:i]) + rw.feed(s[i:]), whole, "split at %d" % i)

    def test_an_abandoned_chunked_image_doesnt_hold_later_output(self):
        rw = kf.Rewriter()
        rw.feed(apc(b"a=T,f=100,i=1,m=1", b"AAAA"))
        rw.feed(b"hello")
        out = rw.feed(apc(b"a=T,f=100,i=2", b"CCCC"))
        self.assertIn(b"hello", out)
        self.assertIn(apc(b"a=T,f=100,i=%d,m=0" % kf.FRESH, b"CCCC"), out)
        self.assertNotIn(b"AAAA", out)
        self.assertEqual(rw.feed(b"more"), b"more")

    def test_a_chunk_never_finished_is_dropped_after_cur_for(self):
        rw = kf.Rewriter()
        rw.feed(apc(b"a=T,f=100,i=1,m=1", b"AAAA"))
        self.assertEqual(rw.feed(b"hello"), b"")
        self.assertEqual(rw.flush(force=True), b"", "kept while it may still come")
        rw.cur_t -= kf.CUR_FOR + 0.1
        out = rw.flush(force=True)
        self.assertIn(b"hello", out)
        self.assertNotIn(b"AAAA", out)
        self.assertIsNone(rw.cur)


class BadInput(unittest.TestCase):
    def test_non_utf8_bytes_in_a_command_dont_raise(self):
        for ctrl in (b"a=T,f=100,i=1,\xff\xfe=\xc3", b"a=\xff,i=1", b"\x80\x81=1,a=T"):
            rw = kf.Rewriter()
            out = rw.feed(apc(ctrl, b"AAAA") + b"after")
            self.assertTrue(out.endswith(b"after"), ctrl)

    def test_a_broken_command_with_an_escape_inside_isnt_held(self):
        rw = kf.Rewriter()
        self.assertEqual(rw.feed(b"\x1b_Ga=T;AAAA\x1b[31mred"), b"\x1b_Ga=T;AAAA\x1b[31mred")

    def test_an_unterminated_command_past_hold_max_passes_through(self):
        rw = kf.Rewriter()
        head = b"\x1b_Ga=T,f=100;"
        self.assertEqual(rw.feed(head + b"A" * 1000), b"", "a short unfinished one is held")
        sent = head + b"A" * 1000
        out = b""
        piece = b"A" * (1 << 16)
        while len(sent) <= kf.HOLD_MAX:
            out += rw.feed(piece)
            sent += piece
        out += rw.feed(piece)
        sent += piece
        self.assertEqual(out, sent)
        self.assertEqual(rw.buf, b"")
        self.assertEqual(rw.feed(b"text"), b"text")


class PassThrough(unittest.TestCase):
    def test_osc_and_csi_sequences_pass_unchanged(self):
        for s in (b"\x1b]0;a title\x07", b"\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\", b"\x1b]52;c;aGVsbG8=\x07",
                  b"\x1b[31mred\x1b[0m plain", b"\x1b]7;file:///tmp\x1b\\", b"\x1b[?2026hframe\x1b[?2026l"):
            self.assertEqual(kf.Rewriter().feed(s), s, s)

    def test_an_osc_split_across_reads_comes_out_whole(self):
        rw = kf.Rewriter()
        s = b"\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\"
        out = b"".join(rw.feed(s[i:i + 5]) for i in range(0, len(s), 5)) + rw.flush(force=True)
        self.assertEqual(out, s)


class Size(unittest.TestCase):
    def test_pixels_are_filled_in_only_when_the_terminal_gives_none_and_the_cell_is_known(self):
        import struct
        size = lambda *v: struct.unpack("HHHH", kf.child_size(struct.pack("HHHH", 20, 80, 0, 0), *v))
        self.assertEqual(size(), (20, 80, 0, 0), "unknown cell: left as the terminal says")
        self.assertEqual(size([10, 26]), (20, 80, 800, 520))
        self.assertEqual(size([10, 26], 1), (20, 79, 790, 520))
        given = struct.unpack("HHHH", kf.child_size(struct.pack("HHHH", 20, 80, 1600, 1040), [10, 26]))
        self.assertEqual(given, (20, 80, 1600, 1040), "a terminal's own pixel size is kept")

    def test_the_cell_size_reply_resizes_the_program_by_a_column_and_back(self):
        # terminal-browser drew its first frames with 16x34 px cells in 10x26 ones until a resize.
        import fcntl, pty, struct, termios
        d = temp_dir(self)
        got = os.path.join(d, "sizes")
        master, slave = pty.openpty()
        self.addCleanup(os.close, master)
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 20, 80, 0, 0))
        prog = ("import fcntl, signal, struct, termios, time\n"
                "def note(*_):\n"
                "    s = struct.unpack('HHHH', fcntl.ioctl(0, termios.TIOCGWINSZ, b'\\0' * 8))\n"
                "    open(%r, 'a').write('%%d %%d %%d %%d\\n' %% s)\n"
                "signal.signal(signal.SIGWINCH, note)\n"
                "while True: time.sleep(0.05)\n" % got)
        p = subprocess.Popen([sys.executable, os.path.join(MODS, "kittyfix.py"), "--", sys.executable, "-c", prog],
                             stdin=slave, stdout=slave, stderr=subprocess.DEVNULL, env=clean_env(d))
        os.close(slave)
        self.addCleanup(p.wait, 5)
        self.addCleanup(p.terminate)
        os.set_blocking(master, False)

        def lines(wait):
            end = time.time() + wait
            while time.time() < end:
                try:
                    os.read(master, 1 << 16)  # take the proxy's output so it never fills up
                except BlockingIOError:
                    pass
                time.sleep(0.05)
            return open(got).read().split("\n")[:-1] if os.path.exists(got) else []

        before = lines(1)
        os.write(master, b"\x1b[6;26;10t")  # the terminal's answer to the cell size question
        after = lines(1.5)[len(before):]
        self.assertEqual(after, ["20 79 790 520", "20 80 800 520"])


class RememberedCell(unittest.TestCase):
    ASK, REPLY = b"\x1b[16t", b"\x1b[6;26;10t"

    def cells(self, saved=None):
        path = os.path.join(temp_dir(self), "cache", "cell")
        if saved:
            os.makedirs(os.path.dirname(path))
            open(path, "w").write(saved)
        return kf.Cells(path), path

    def test_with_nothing_remembered_the_terminal_answers_and_its_size_is_kept(self):
        c, path = self.cells()
        self.assertEqual(c.ask(b"x" + self.ASK, 0), b"", "nothing to answer with")
        self.assertEqual(c.answer(b"a" + self.REPLY + b"b", 1), (b"a" + self.REPLY + b"b", [10, 26], [1]))
        self.assertEqual(open(path).read(), "10 26\n")

    def test_a_remembered_size_is_answered_at_once_and_the_terminals_same_answer_dropped(self):
        # After a restart Herdr answered ~15 s late and the browser drew with the wrong cell size.
        c, _ = self.cells("10 26\n")
        self.assertEqual(c.ask(self.ASK + b"frame" + self.ASK, 0), self.REPLY * 2)
        self.assertEqual(c.answer(b"k" + self.REPLY, 15), (b"k", None, [15]))
        self.assertEqual(c.answer(self.REPLY, 16), (b"", None, [16]))
        self.assertEqual(c.answer(self.REPLY, 17), (self.REPLY, None, []), "one not owed passes on")

    def test_a_different_answer_passes_on_as_a_change_and_is_remembered(self):
        c, path = self.cells("10 26\n")
        c.ask(self.ASK, 0)
        zoomed = b"\x1b[6;31;12t"
        self.assertEqual(c.answer(zoomed, 1), (zoomed, [12, 31], [1]))
        self.assertEqual(open(path).read(), "12 31\n")

    def test_a_broken_file_is_ignored(self):
        for saved in ("junk\n", "0 26\n", "10\n", "10 26 3\n"):
            self.assertIsNone(self.cells(saved)[0].cell, saved)

    def test_the_program_gets_the_remembered_size_without_the_terminal_answering(self):
        import pty
        d = temp_dir(self)
        os.makedirs(os.path.join(d, ".cache", "kelpie"))
        open(os.path.join(d, ".cache", "kelpie", "kittyfix-cell"), "w").write("10 26\n")
        got = os.path.join(d, "got")
        prog = ("import os, sys, time, tty\ntty.setraw(0)\nos.write(1, b'\\x1b[16t')\ntime.sleep(0.5)\n"
                "open(%r, 'wb').write(os.read(0, 100))" % got)
        master, slave = pty.openpty()
        self.addCleanup(os.close, master)
        p = subprocess.Popen([sys.executable, os.path.join(MODS, "kittyfix.py"), "--", sys.executable, "-c", prog],
                             stdin=slave, stdout=slave, stderr=subprocess.DEVNULL, env=clean_env(d))
        os.close(slave)
        self.addCleanup(p.kill)
        end = time.time() + 5
        os.set_blocking(master, False)
        while time.time() < end and not os.path.exists(got):
            try:
                os.read(master, 1 << 16)
            except (BlockingIOError, OSError):
                pass
            time.sleep(0.05)
        self.assertEqual(open(got, "rb").read() if os.path.exists(got) else b"", self.REPLY)


class FreshIds(unittest.TestCase):
    # An id sent again with a new picture showed its old one for a moment (old video frames).
    def frame(self, *cmds):
        return b"\x1b[?2026h" + b"".join(cmds) + b"\x1b[?2026l"

    def test_a_picture_sent_again_goes_under_a_new_id_and_the_old_one_a_frame_later(self):
        rw = kf.Rewriter()
        img = lambda pid: apc(b"a=T,f=100,i=%d,p=1" % pid, b"AAAA")
        first = rw.feed(self.frame(img(12)))
        second = rw.feed(self.frame(apc(b"a=d,d=i,i=12,p=1,q=2"), img(12)))
        third = rw.feed(self.frame(img(7)))
        a, b = kf.FRESH, kf.FRESH + 1
        self.assertIn(b"i=%d," % a, first)
        self.assertIn(b"i=%d," % b, second)
        self.assertNotIn(b"a=d", second, "the old picture stays under the new one this frame")
        self.assertIn(b"\x1b_Ga=d,d=I,i=%d,q=2\x1b\\\x1b[?2026l" % a, third, "and goes at the next frame's end")

    def test_a_deleted_image_goes_a_frame_later_too(self):
        rw = kf.Rewriter()
        rw.feed(self.frame(apc(b"a=T,f=100,i=12,p=1", b"AAAA")))
        out = rw.feed(self.frame(apc(b"a=d,d=I,i=12,q=2"), apc(b"a=T,f=100,i=15,p=1", b"BBBB")))
        self.assertNotIn(b"a=d", out, "deleted now, it would uncover older pictures before 15 is drawn")
        self.assertIn(b"a=d,d=I,i=%d" % kf.FRESH, rw.feed(self.frame(apc(b"a=T,f=100,i=16,p=1", b"CCCC"))))

    def test_with_no_next_frame_the_old_picture_goes_after_retire_for(self):
        rw = kf.Rewriter()
        rw.feed(self.frame(apc(b"a=T,f=100,i=12,p=1", b"AAAA")))
        rw.feed(self.frame(apc(b"a=T,f=100,i=12,p=1", b"BBBB")))
        self.assertEqual(rw.flush(force=True), b"", "kept while a next frame may come")
        rw.retired = [(t - kf.RETIRE_FOR - 0.1, i) for t, i in rw.retired]
        self.assertEqual(rw.flush(force=True), b"\x1b_Ga=d,d=I,i=%d,q=2\x1b\\" % kf.FRESH)

    def test_delete_all_forgets_every_id_and_an_unknown_ids_delete_passes(self):
        rw = kf.Rewriter()
        rw.feed(self.frame(apc(b"a=T,f=100,i=12,p=1", b"AAAA")))
        rw.feed(self.frame(apc(b"a=T,f=100,i=12,p=1", b"BBBB")))
        out = rw.feed(self.frame(apc(b"a=d,d=A,q=2")))
        self.assertEqual((rw.ids, rw.retired), ({}, []))
        self.assertIn(apc(b"a=d,d=A,q=2"), out)
        self.assertIn(apc(b"a=d,d=i,i=99,q=2"), rw.feed(self.frame(apc(b"a=d,d=i,i=99,q=2"))))

    def test_queries_keep_their_own_id(self):
        q = apc(b"i=4207,a=q,t=d,f=24,s=1,v=1", b"AAAA")
        self.assertIn(q.replace(b";", b",m=0;"), kf.Rewriter().feed(q))


class FrameProbes(unittest.TestCase):
    def test_each_frame_is_followed_by_its_numbered_query(self):
        rw, probes = kf.Rewriter(), kf.Probes()
        rw.mark = lambda items, began: probes.mark(items, 1.0, 0, began)
        frame = b"\x1b[?2026h" + apc(b"a=T,f=100,i=5,p=1", b"AAAA") + b"\x1b[?2026l"
        out = rw.feed(frame + frame)
        q = lambda n: b"\x1b_Gi=%d,a=q,t=d,f=24,s=1,v=1;AAAA\x1b\\" % (kf.PROBE + n)
        self.assertTrue(out.endswith(b"\x1b[?2026l" + q(2)), out)
        self.assertEqual(out.count(q(1)), 1)
        self.assertEqual(rw.feed(b"text"), b"text", "no query without a frame")

    def test_the_terminals_answers_are_timed_and_dropped_the_programs_kept(self):
        probes = kf.Probes()
        probes.mark([("img", {"a": "T"}, b"x" * 3000)], 1.0, 4096)
        mine = b"\x1b_Gi=%d;OK\x1b\\" % (kf.PROBE + 1)
        theirs = b"\x1b_Gi=4207;OK\x1b\\"
        data, lines = probes.answer(b"k" + mine + theirs, 1.25)
        self.assertEqual(data, b"k" + theirs)
        self.assertEqual(lines, ["frame 1: 1 images, 2 KB, written over 0.000 s after a pause of 0.000 s, "
                                 "4 KB queued before it, answered after 0.250 s"])

    def test_it_says_how_long_a_frame_took_to_write_and_the_pause_before_it(self):
        probes = kf.Probes()
        probes.mark([], 1.0, 0, began=0.9)
        probes.mark([], 1.5, 0, began=1.3)
        _, lines = probes.answer(b"\x1b_Gi=%d;OK\x1b\\" % (kf.PROBE + 2), 1.6)
        self.assertIn("written over 0.200 s after a pause of 0.300 s", lines[0])


class NeverBlocks(unittest.TestCase):
    def test_it_first_ends_a_half_sent_image_then_deletes_every_image(self):
        # A browser killed mid-frame left the terminal inside a chunked image, which took the next
        # delete as its last chunk: the half image stayed on screen after a restart.
        d = temp_dir(self)
        p = subprocess.Popen([sys.executable, os.path.join(MODS, "kittyfix.py"), "--", "sh", "-c", "printf hi"],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=clean_env(d))
        self.addCleanup(p.stdin.close)
        out = p.stdout.read()
        p.wait(5)
        self.assertTrue(out.startswith(b"\x1b\\\x1b_Gq=2,m=0;\x1b\\\x1b_Ga=d,d=A,q=2\x1b\\"), out)
        self.assertTrue(out.endswith(b"hi"), out)

    def test_input_still_reaches_the_program_while_the_terminal_takes_no_output(self):
        # A blocking write to a terminal that wasn't reading stopped the proxy reading its input
        # too: Herdr and the proxy waited on each other and the browser froze.
        d = temp_dir(self)
        got = os.path.join(d, "got")
        prog = ("import sys\nsys.stdout.write('x' * 2000000); sys.stdout.flush()\n"
                "open(%r, 'w').write(sys.stdin.readline())" % got)
        p = subprocess.Popen([sys.executable, os.path.join(MODS, "kittyfix.py"), "--", sys.executable, "-c", prog],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=clean_env(d))
        self.addCleanup(p.stdout.close)
        self.addCleanup(p.wait, 5)
        self.addCleanup(p.kill)
        time.sleep(0.5)  # the program floods; nobody reads the proxy's output
        p.stdin.write(b"hello\n"); p.stdin.flush()
        end = time.time() + 5
        while time.time() < end and not (os.path.exists(got) and open(got).read()):
            time.sleep(0.05)
        self.assertEqual(open(got).read() if os.path.exists(got) else "", "hello\n")

    def test_it_ends_on_sigterm_while_its_terminal_takes_nothing(self):
        # Restoring the terminal's modes waited for all output to be taken: forever, when stuck.
        import pty
        d = temp_dir(self)
        master, slave = pty.openpty()
        self.addCleanup(os.close, master)
        p = subprocess.Popen([sys.executable, os.path.join(MODS, "kittyfix.py"), "--", sys.executable, "-c",
                              "import sys, time\nwhile True: sys.stdout.write('x' * 65536); sys.stdout.flush()"],
                             stdin=slave, stdout=slave, stderr=subprocess.DEVNULL, env=clean_env(d))
        os.close(slave)
        self.addCleanup(p.kill)
        time.sleep(0.5)  # its output fills up; nobody reads the terminal
        p.terminate()
        try:
            p.wait(3)
        except subprocess.TimeoutExpired:
            self.fail("still running 3 s after SIGTERM")


if __name__ == "__main__":
    unittest.main()
