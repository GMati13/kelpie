#!/usr/bin/env python3
"""PTY proxy that rewrites a program's kitty graphics so Herdr draws it right.

    kittyfix.py [--log FILE] -- terminal-browser ...

Herdr (libghostty-vt core + GPUI viewer) has two problems with terminal-browser's
kitty output:

1. It ignores the X=/Y= pixel offsets of a placement and draws the image at
   the cell's top-left corner. Patches and tiles land up to one cell up/left
   of where they belong, leaving slivers of older frames ("stale tiles").
   Fix: pad such images on the left/top with transparent pixels and drop X/Y.
   Its real column pitch is also fractional (10.083px at zoom 1.2) while it
   reports 10px cells, so images placed at column N drift right by N*0.083px.
   Fix (--anchor row, default): move every image to column 1 of its row and
   pad by (N-1)*cell width too. --anchor origin also moves it to row 1.

2. A frame swap is "delete placement, then transmit the new image" (Full
   presenter, and the full frames the Patched presenter sends now and then).
   The delete applies at once, the new image only after its last chunk, so
   Herdr shows a gap (blink). Fix: inside a synchronized-output block, drop a
   delete when the same image id is transmitted again later in the block (the
   transmit replaces it in place), and move the other deletes to the end of
   the block so the old pixels stay until the new ones are there.
"""
import base64, fcntl, os, pty, re, select, signal, struct, sys, termios, time, tty, zlib

args = sys.argv[1:]
logf = None
ANCHOR = 'row'   # row: move images to column 1 of their row; origin: to row 1, column 1; cell: keep the cell
while args[:1] in (['--log'], ['--anchor']):
    if args[0] == '--log':
        logf = open(args[1], 'a')
    else:
        ANCHOR = args[1]
    args = args[2:]
CELL = [10, 20]  # reported cell width, height in px; updated from the terminal's CSI 16t reply
CELL_REPLY = re.compile(rb'\x1b\[6;(\d+);(\d+)t')
CUP = re.compile(rb'\x1b\[(\d+);(\d+)H$')
if args[:1] == ['--']:
    args = args[1:]
if not args:
    sys.exit('usage: kittyfix.py [--log FILE] [--anchor row|origin|cell] -- command ...')

stats = {'padded': 0, 'dropped_deletes': 0, 'deferred_deletes': 0, 'blocks': 0}

def log(msg):
    if logf:
        logf.write('%.3f %s\n' % (time.time(), msg)); logf.flush()

TOKEN = re.compile(rb'\x1b_G([^;\x1b]*)(?:;([^\x1b]*))?\x1b\\|\x1b\[\?2026([hl])')
SYNC_ON, SYNC_OFF = b'\x1b[?2026h', b'\x1b[?2026l'

def parse_ctrl(ctrl):
    out = {}
    for kv in ctrl.split(b','):
        if b'=' in kv:
            k, v = kv.split(b'=', 1); out[k.decode()] = v.decode()
    return out

def build_ctrl(d):
    return ','.join('%s=%s' % kv for kv in d.items()).encode()

def emit_image(d, payload):
    """Serialize one transmission, chunked at 4096 base64 bytes."""
    if not payload:
        return b'\x1b_G' + build_ctrl(d) + b'\x1b\\'
    out = []
    chunks = [payload[k:k + 4096] for k in range(0, len(payload), 4096)]
    for n, c in enumerate(chunks):
        m = '1' if n < len(chunks) - 1 else '0'
        if n == 0:
            dd = dict(d); dd.pop('m', None); dd['m'] = m
            out.append(b'\x1b_G' + build_ctrl(dd) + b';' + c + b'\x1b\\')
        else:
            out.append(b'\x1b_Gm=' + m.encode() + b';' + c + b'\x1b\\')
    return b''.join(out)

def pad_offsets(d, payload, ex=0, ey=0):
    """Fold X/Y pixel offsets (plus ex/ey px of moved cells) into the image as transparent padding."""
    X, Y = int(d.get('X', 0)) + ex, int(d.get('Y', 0)) + ey
    if not (X or Y) or d.get('t', 'd') != 'd' or d.get('f', '32') not in ('24', '32'):
        return d, payload
    if 'c' in d or 'r' in d:
        return d, payload
    w, h = int(d['s']), int(d['v'])
    raw = base64.b64decode(payload)
    if d.get('o') == 'z':
        raw = zlib.decompress(raw)
    if d.get('f') == '24':
        rgba = bytearray(w * h * 4)
        rgba[0::4], rgba[1::4], rgba[2::4] = raw[0::3], raw[1::3], raw[2::3]
        rgba[3::4] = b'\xff' * (w * h); raw = bytes(rgba)
    nw, row = w + X, w * 4
    left = b'\0' * (X * 4)
    rows = [b'\0' * (nw * 4 * Y)] + [left + raw[r * row:(r + 1) * row] for r in range(h)]
    d = dict(d)
    d.pop('X', None); d.pop('Y', None)
    d['f'], d['o'], d['s'], d['v'] = '32', 'z', str(nw), str(h + Y)
    stats['padded'] += 1
    return d, base64.b64encode(zlib.compress(b''.join(rows), 1))

class Rewriter:
    def __init__(self):
        self.buf = b''        # unparsed input
        self.items = []       # parsed, not yet emitted: ('raw', b) | ('img', dict, payload)
        self.cur = None       # chunked transmission being assembled [dict, [payloads]]
        self.sync = False
        self.sync_t = 0

    def feed(self, data):
        self.buf += data
        pos = 0
        for m in TOKEN.finditer(self.buf):
            if m.start() > pos:
                self.raw(self.buf[pos:m.start()])
            pos = m.end()
            if m.group(3) is not None:
                on = m.group(3) == b'h'
                if on:
                    self.raw(m.group(0)); self.sync = True; self.sync_t = time.time()
                else:
                    self.sync = False; self.raw(m.group(0), end_block=True)
                continue
            self.apc(parse_ctrl(m.group(1)), m.group(2) or b'')
        tail = self.buf[pos:]
        hold = tail.rfind(b'\x1b')
        rest = tail[hold:] if hold >= 0 else b''
        if hold >= 0 and (rest.startswith(b'\x1b_G') or b'\x1b_G'.startswith(rest)
                          or b'\x1b[?2026'.startswith(rest) or (rest.startswith(b'\x1b[?2026') and len(rest) < 8)):
            self.raw(tail[:hold]); self.buf = rest
        else:
            self.raw(tail); self.buf = b''
        return self.flush()

    def raw(self, b, end_block=False):
        if b:
            self.items.append(('raw', b))
        if end_block:
            self.items.append(('end',))

    def apc(self, d, payload):
        if self.cur is not None and 'a' not in d and 'i' not in d and set(d) <= {'m', 'q'}:
            self.cur[1].append(payload)
            if d.get('m', '0') == '0':
                self.items.append(('img', self.cur[0], b''.join(self.cur[1]))); self.cur = None
            return
        if d.get('m') == '1':
            self.cur = [d, [payload]]; return
        self.items.append(('img', d, payload))

    def flush(self, force=False):
        # Emit everything up to the last block end; inside a block, wait for its end.
        if self.cur is not None:
            return b''
        if self.sync and not (force and time.time() - self.sync_t > 0.25):
            # keep buffering until the block closes (bounded: terminal-browser closes every frame)
            return b''
        out = []
        block = []
        for it in self.items:
            if it[0] == 'end':
                out.append(self.process(block)); block = []
            else:
                block.append(it)
        out.append(self.process(block))
        self.items = []
        return b''.join(out)

    def process(self, items):
        if not items:
            return b''
        stats['blocks'] += 1
        # ids transmitted at or after each position
        later = [set() for _ in range(len(items) + 1)]
        for k in range(len(items) - 1, -1, -1):
            later[k] = set(later[k + 1])
            it = items[k]
            if it[0] == 'img' and it[1].get('a') in ('T', 't') and 'i' in it[1]:
                later[k].add(it[1]['i'])
        out, deferred = [], []
        for k, it in enumerate(items):
            if it[0] == 'raw':
                out.append(it[1]); continue
            d, payload = it[1], it[2]
            if d.get('a') == 'd' and d.get('d') in ('i', 'I') and 'i' in d:
                if d['i'] in later[k + 1]:
                    stats['dropped_deletes'] += 1; continue
                stats['deferred_deletes'] += 1
                deferred.append(emit_image(d, b'')); continue
            if d.get('a') in ('T', 't', None) and payload:
                ex = ey = 0; m = None
                if d.get('a') == 'T' and ANCHOR != 'cell' and out:
                    m = CUP.search(out[-1])
                    if m:
                        r, c = int(m.group(1)), int(m.group(2))
                        nr = 1 if ANCHOR == 'origin' else r
                        ex, ey = (c - 1) * CELL[0], (r - nr) * CELL[1]
                try:
                    nd, np_ = pad_offsets(d, payload, ex, ey)
                    if m and (ex or ey) and nd is not d:
                        out[-1] = out[-1][:m.start()] + b'\x1b[%d;1H' % nr
                    d, payload = nd, np_
                except Exception as e:
                    log('pad failed: %r %r' % (e, d))
            out.append(emit_image(d, payload))
        # deferred deletes go before the block's closing ?2026l
        if deferred:
            if out and out[-1].endswith(SYNC_OFF):
                last = out.pop()
                out.append(last[:-len(SYNC_OFF)]); out.extend(deferred); out.append(SYNC_OFF)
            else:
                out.extend(deferred)
        return b''.join(out)

def main():
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(args[0], args)

    def winch(*_):
        try:
            sz = fcntl.ioctl(0, termios.TIOCGWINSZ, b'\0' * 8)
            fcntl.ioctl(fd, termios.TIOCSWINSZ, sz)
            os.kill(pid, signal.SIGWINCH)
        except Exception:
            pass
    signal.signal(signal.SIGWINCH, winch); winch()
    old = None
    if os.isatty(0):
        old = termios.tcgetattr(0); tty.setraw(0)
    rw = Rewriter()
    last = time.time()
    try:
        while True:
            r, _, _ = select.select([0, fd], [], [], 0.1)
            out = rw.flush(force=True)
            while out:
                n = os.write(1, out); out = out[n:]
            if fd in r:
                try:
                    b = os.read(fd, 1 << 20)
                except OSError:
                    break
                if not b:
                    break
                out = rw.feed(b)
                while out:
                    n = os.write(1, out); out = out[n:]
            if 0 in r:
                b = os.read(0, 65536)
                if not b:
                    break
                for m in CELL_REPLY.finditer(b):
                    CELL[1], CELL[0] = int(m.group(1)), int(m.group(2)); log('cell %r' % CELL)
                os.write(fd, b)
            if logf and time.time() - last > 5:
                log('stats %r' % stats); last = time.time()
    finally:
        if old:
            termios.tcsetattr(0, termios.TCSAFLUSH, old)
        log('exit stats %r' % stats)
        try:
            _, st = os.waitpid(pid, 0)
            sys.exit(os.waitstatus_to_exitcode(st))
        except ChildProcessError:
            pass

if __name__ == '__main__':
    main()
