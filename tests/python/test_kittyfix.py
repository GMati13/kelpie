"""kittyfix.py's Rewriter: bad or unfinished input never freezes or kills the browser's output."""
import unittest

from kelpie_test import load

kf = load("kittyfix", ["--", "true"])

ST = b"\x1b\\"


def apc(ctrl, payload=b""):
    return b"\x1b_G" + ctrl + (b";" + payload if payload else b"") + ST


class Chunks(unittest.TestCase):
    def test_a_chunked_image_still_assembles(self):
        rw = kf.Rewriter()
        self.assertEqual(rw.feed(apc(b"a=T,f=100,i=1,m=1", b"AAAA")), b"")
        out = rw.feed(apc(b"m=0", b"BBBB"))
        self.assertIn(apc(b"a=T,f=100,i=1,m=0", b"AAAABBBB"), out)
        self.assertIsNone(rw.cur)

    def test_an_abandoned_chunked_image_doesnt_hold_later_output(self):
        rw = kf.Rewriter()
        rw.feed(apc(b"a=T,f=100,i=1,m=1", b"AAAA"))
        rw.feed(b"hello")
        out = rw.feed(apc(b"a=T,f=100,i=2", b"CCCC"))
        self.assertIn(b"hello", out)
        self.assertIn(apc(b"a=T,f=100,i=2,m=0", b"CCCC"), out)
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


if __name__ == "__main__":
    unittest.main()
