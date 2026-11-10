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
import base64, collections, fcntl, os, pty, re, select, signal, struct, sys, tempfile, termios, time, tty, zlib

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
CELL_ASK = b'\x1b[16t'
CELL_FILE = os.path.expanduser('~/.cache/kelpie/kittyfix-cell')  # the cell size Herdr last gave
CUP = re.compile(rb'\x1b\[(\d+);(\d+)H$')
if args[:1] == ['--']:
    args = args[1:]
if not args:
    sys.exit('usage: kittyfix.py [--log FILE] [--anchor row|origin|cell] -- command ...')

CUR_FOR = 2.0          # seconds an unfinished chunked image may take before it's dropped
HOLD_MAX = 1 << 20     # bytes of an unterminated graphics command held before it's passed on
# Sent first: a browser killed mid-frame leaves the terminal inside a chunked image, where a plain
# delete is taken as its last chunk (the half image stayed on screen after a restart). So: end any
# open command, end any open chunked image (q=2: no error reply into the browser's input), then
# delete every image.
RESET = b'\x1b\\\x1b_Gq=2,m=0;\x1b\\\x1b_Ga=d,d=A,q=2\x1b\\'
NUDGE_FOR = 0.3       # seconds the one-column resize lasts before the real size is put back
FRESH = 2000000000    # first image id the proxy sends under (the browser's and the probes' are lower)
RETIRE_FOR = 0.25     # seconds a replaced image stays (under its successor) when no next frame comes
OUT_MAX = 8 << 20      # bytes waiting for the terminal before the program's output is left unread
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
            # latin-1 decodes any byte: a stray one must not stop the proxy (and the browser with it)
            k, v = kv.split(b'=', 1); out[k.decode('latin-1')] = v.decode('latin-1')
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

def send(f, q):
    """Write what the descriptor takes now from the queue, without waiting."""
    while q:
        try:
            n = os.write(f, q[:1 << 16])
        except (BlockingIOError, InterruptedError):
            return
        except OSError:
            q.clear(); return
        del q[:n]

def child_size(sz, cell=None, narrow=0):
    """The program's window size from the terminal's: `narrow` columns fewer and, when the terminal
    reports no pixel size (Herdr doesn't) and the cell size is known, its pixels filled in."""
    rows, cols, xpix, ypix = struct.unpack('HHHH', sz)
    cols = max(1, cols - narrow)
    if cell and not (xpix and ypix):
        xpix, ypix = cols * cell[0], rows * cell[1]
    return struct.pack('HHHH', rows, cols, xpix, ypix)

PROBE = 1000000000     # first image id of the frame probes (the browser's ids are far below)
PROBE_REPLY = re.compile(rb'\x1b_Gi=(1\d{9});[^\x1b]*\x1b\\')

class Probes:
    """While logging: after each frame, a kitty query with the frame's number. The terminal answers
    once it has worked through everything before it, so the delay is how far behind it is on that
    frame (old frames showed during video). Its answers are dropped: the program never asked."""

    def __init__(self):
        self.n, self.sent, self.last_end = 0, {}, None

    def mark(self, items, now, queued, began=None):
        self.n += 1
        imgs = [it for it in items if it[0] == 'img' and it[1].get('a') == 'T']
        size = sum(len(it[2]) for it in imgs)
        # how long the program took to write the frame, and how long it paused before it
        took = now - began if began else 0.0
        pause = began - self.last_end if began and self.last_end else 0.0
        self.last_end = now
        self.sent[PROBE + self.n] = (now, len(imgs), size, queued, took, pause)
        if len(self.sent) > 10000:  # a terminal that never answers mustn't grow it for ever
            self.sent.pop(next(iter(self.sent)))
        return b'\x1b_Gi=%d,a=q,t=d,f=24,s=1,v=1;AAAA\x1b\\' % (PROBE + self.n)

    def answer(self, data, now):
        """The terminal's input without the probes' answers, and a log line for each."""
        lines = []
        for m in PROBE_REPLY.finditer(data):
            got = self.sent.pop(int(m.group(1)), None)
            if got:
                t, imgs, size, queued, took, pause = got
                lines.append('frame %d: %d images, %d KB, written over %.3f s after a pause of %.3f s, '
                             '%d KB queued before it, answered after %.3f s'
                             % (int(m.group(1)) - PROBE, imgs, size // 1024, took, pause, queued // 1024, now - t))
        return PROBE_REPLY.sub(b'', data), lines

class Cells:
    """The terminal's cell size, answered to the program at once from the last one seen.

    terminal-browser asks it at start and waits only briefly; after a restart Herdr answered ~15 s
    late, still working through the old browser's frames, and the browser drew 16x34 px cells in
    10x26 ones (a page wider than the panel). So a remembered size answers right away; the question
    still goes to the terminal, whose answer is dropped when it's the same (the program has it) and
    passed on, as a change, when it isn't. Also times the terminal's answers (how far behind it is)."""

    def __init__(self, path=CELL_FILE):
        self.path, self.cell, self.owed, self.asked = path, None, 0, collections.deque()
        try:
            w, h = map(int, open(path).read().split())
            if 0 < w < 1000 and 0 < h < 1000:
                self.cell = [w, h]
        except (OSError, ValueError):
            pass

    def ask(self, data, now):
        """The program's output went to the terminal: what to answer it ourselves."""
        n = data.count(CELL_ASK)
        self.asked.extend([now] * n)
        if not n or not self.cell:
            return b''
        self.owed += n
        return (b'\x1b[6;%d;%dt' % (self.cell[1], self.cell[0])) * n

    def answer(self, data, now):
        """The terminal's input: (what to pass on, the new cell size or None, answer delays)."""
        out, pos, changed, delays = bytearray(), 0, None, []
        for m in CELL_REPLY.finditer(data):
            cell = [int(m.group(2)), int(m.group(1))]
            if self.asked:
                delays.append(now - self.asked.popleft())
            out += data[pos:m.start()]; pos = m.end()
            same = cell == self.cell
            if self.owed:
                self.owed -= 1
            elif same:
                out += m.group(0)
            if not same:
                out += m.group(0); self.cell = changed = cell; self.save()
        out += data[pos:]
        return bytes(out), changed, delays

    def save(self):
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            f, tmp = tempfile.mkstemp(dir=os.path.dirname(self.path))
            with os.fdopen(f, 'w') as fh:
                fh.write('%d %d\n' % tuple(self.cell))
            os.replace(tmp, self.path)
        except OSError:
            pass

class Rewriter:
    def __init__(self):
        self.buf = b''        # unparsed input
        self.items = []       # parsed, not yet emitted: ('raw', b) | ('img', dict, payload)
        self.cur = None       # chunked transmission being assembled [dict, [payloads]]
        self.cur_t = 0        # when it began: one never finished is dropped (CUR_FOR)
        self.sync = False
        self.sync_t = 0
        self.mark = None      # called with each finished frame's items: bytes to send after it
        self.began = collections.deque()  # when each frame not yet marked began (for the probes)
        # Every image goes out under a fresh id: an id sent again with a new picture showed its old
        # picture for a moment, on top (old video frames flicking in). The one it replaces goes a
        # frame later, when the new one is drawn, so nothing blinks in between.
        self.ids = {}         # the program's image id -> the id it was sent under
        self.next_id = FRESH
        self.retired = []     # (when, id) of replaced images, deleted at the next frame's end

    def feed(self, data):
        # Inside a held graphics command, a read with no ESC can't finish it: keep it without
        # rescanning the whole command each time (an image chunk comes in several reads).
        held = len(self.buf)
        self.buf += data
        if held > 3 and self.buf.startswith(b'\x1b_G') and len(self.buf) <= HOLD_MAX \
                and self.buf.find(b'\x1b', held - 1) < 0:
            return self.flush()
        pos = 0
        for m in TOKEN.finditer(self.buf):
            if m.start() > pos:
                self.raw(self.buf[pos:m.start()])
            pos = m.end()
            if m.group(3) is not None:
                on = m.group(3) == b'h'
                if on:
                    self.raw(m.group(0)); self.sync = True; self.sync_t = time.time()
                    self.began.append(self.sync_t)
                else:
                    self.sync = False; self.raw(m.group(0), end_block=True)
                continue
            self.apc(parse_ctrl(m.group(1)), m.group(2) or b'')
        tail = self.buf[pos:]
        # Hold from an unfinished graphics command's start, not from the last ESC: a read can end
        # between the ESC and the backslash of a chunk's terminator, and taking that ESC for a new
        # sequence passed the chunk on unparsed, which broke the image and froze the picture.
        # One with another ESC inside is broken (a payload has none): don't wait for it.
        hold = tail.find(b'\x1b_G')
        esc = tail.find(b'\x1b', hold + 1) if hold >= 0 else -1
        if hold < 0 or 0 <= esc < len(tail) - 1:
            hold = tail.rfind(b'\x1b')
        rest = tail[hold:] if hold >= 0 else b''
        if len(rest) > HOLD_MAX:
            # A graphics command that never ends: pass it on as it is rather than hold it (and
            # rescan it) forever.
            hold = -1
        if hold >= 0 and (rest.startswith(b'\x1b_G') or b'\x1b_G'.startswith(rest)
                          or b'\x1b[?2026'.startswith(rest) or (rest.startswith(b'\x1b[?2026') and len(rest) < 8)):
            self.raw(tail[:hold]); self.buf = rest
        else:
            self.raw(tail); self.buf = b''
        return self.flush()

    def raw(self, b, end_block=False):
        if b:
            # Text split across reads is joined: an image's position is found in the cursor move
            # just before it, which a read can cut (the patch then stayed in place and drifted).
            if self.items and self.items[-1][0] == 'raw':
                self.items[-1] = ('raw', self.items[-1][1] + b)
            else:
                self.items.append(('raw', b))
        if end_block:
            self.items.append(('end',))

    def apc(self, d, payload):
        if self.cur is not None and 'a' not in d and 'i' not in d and set(d) <= {'m', 'q'}:
            self.cur[1].append(payload)
            if d.get('m', '0') == '0':
                self.items.append(('img', self.cur[0], b''.join(self.cur[1]))); self.cur = None
            return
        if self.cur is not None:
            # Anything but the next chunk means the image being sent was given up (a resize starts
            # over, say): drop it. Kept, it would hold back all later output, and the browser froze.
            log('dropped an unfinished image %r' % self.cur[0]); self.cur = None
        if d.get('m') == '1':
            self.cur = [d, [payload]]; self.cur_t = time.time(); return
        self.items.append(('img', d, payload))

    def flush(self, force=False):
        # Emit everything up to the last block end; inside a block, wait for its end.
        if self.cur is not None and force and time.time() - self.cur_t > CUR_FOR:
            log('dropped an image never finished %r' % self.cur[0]); self.cur = None
        if self.cur is not None:
            return b''
        if self.sync and not (force and time.time() - self.sync_t > 0.25):
            # keep buffering until the block closes (bounded: terminal-browser closes every frame)
            return b''
        out = []
        block = []
        for it in self.items:
            if it[0] == 'end':
                out.append(self.process(block, ended=True))
                if self.mark:
                    out.append(self.mark(block, self.began.popleft() if self.began else None))
                else:
                    self.began.clear()
                block = []
            else:
                block.append(it)
        out.append(self.process(block))
        self.items = []
        if force and self.retired and time.time() - self.retired[0][0] > RETIRE_FOR:
            out.append(self.retire())
        return b''.join(out)

    def fresh(self, pid):
        """A new id for the program's image `pid`; the one it had is retired."""
        nid = str(self.next_id)
        self.next_id = self.next_id + 1 if self.next_id < 4294000000 else FRESH
        old = self.ids.get(pid)
        if old:
            self.retired.append((time.time(), old))
        self.ids[pid] = nid
        return nid

    def retire(self, upto=None):
        """Delete the retired images (those retired before `upto`, when given)."""
        go = [r for r in self.retired if upto is None or r[0] < upto]
        self.retired = self.retired[len(go):]
        return b''.join(b'\x1b_Ga=d,d=I,i=%s,q=2\x1b\\' % r[1].encode() for r in go)

    def process(self, items, ended=False):
        if not items:
            return b''
        stats['blocks'] += 1
        start = time.time()
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
                sent = self.ids.pop(d['i'], None)
                if sent:  # goes a frame later too: gone now, it uncovered older pictures under it
                    self.retired.append((time.time(), sent)); continue
                deferred.append(emit_image(d, b'')); continue
            if d.get('a') == 'd' and d.get('d') in ('a', 'A'):
                self.ids.clear(); self.retired = []
            elif 'i' in d and d.get('a') in ('T', 't') and payload:
                d = dict(d); d['i'] = self.fresh(d['i'])
            elif 'i' in d and d.get('a') in ('p', 'f', 'a', 'c') and d['i'] in self.ids:
                d = dict(d); d['i'] = self.ids[d['i']]
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
        if ended:  # what earlier frames replaced: their successors are drawn by now
            deferred.append(self.retire(upto=start))
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

    def winch(*_, narrow=0):
        try:
            sz = fcntl.ioctl(0, termios.TIOCGWINSZ, b'\0' * 8)
            # setting a new size signals the program itself (one more signal redrew it twice)
            fcntl.ioctl(fd, termios.TIOCSWINSZ, child_size(sz, cells.cell, narrow))
        except Exception:
            pass
    cells = Cells()
    if cells.cell:
        CELL[:] = cells.cell
    signal.signal(signal.SIGWINCH, winch); winch()
    nudge_at = None
    # pkill ends it with SIGTERM: exit through `finally`, so the terminal gets its modes back,
    # without waiting for the browser (the pty closing ends it)
    killed = []
    def term(*_):
        killed.append(1); sys.exit(143)
    signal.signal(signal.SIGTERM, term)
    old = None
    if os.isatty(0):
        old = termios.tcgetattr(0); tty.setraw(0)
    # Nothing may block: a blocking write to Herdr while Herdr wasn't taking output (it was
    # waiting to hand us input) stopped both sides, and the picture froze until the browser was
    # killed. Writes go through queues; Herdr's input is always read; when Herdr is slow, the
    # browser's output waits in its own pipe (OUT_MAX) instead.
    flags = {f: fcntl.fcntl(f, fcntl.F_GETFL) for f in (0, 1, fd)}
    for f, fl in flags.items():
        fcntl.fcntl(f, fcntl.F_SETFL, fl | os.O_NONBLOCK)
    rw = Rewriter()
    last = time.time()
    toterm, toprog = bytearray(RESET), bytearray()
    # while logging, each frame is timed through the terminal (Probes)
    probes = Probes() if logf else None
    if probes:
        rw.mark = lambda items, began: probes.mark(items, time.time(), len(toterm), began)
    stalled = None
    try:
        while True:
            rl = [0] + ([fd] if len(toterm) < OUT_MAX else [])
            wl = ([1] if toterm else []) + ([fd] if toprog else [])
            r, w, _ = select.select(rl, wl, [], 0.1)
            out = rw.flush(force=True)
            toterm += out
            if 1 in w:
                send(1, toterm)
            if fd in w:
                send(fd, toprog)
            if toterm and logf:
                if stalled is None:
                    stalled = time.time()
                elif time.time() - stalled > 1:
                    log('terminal not taking output: %d bytes waiting' % len(toterm)); stalled = time.time()
            else:
                stalled = None
            if fd in r:
                try:
                    b = os.read(fd, 1 << 20)
                except BlockingIOError:
                    b = None
                except OSError:
                    break
                if b == b'':
                    break
                if b:
                    try:
                        out = rw.feed(b)
                    except Exception as e:
                        log('feed failed, passing through: %r' % e)
                        out = b; rw.buf = b''; rw.items = []; rw.cur = None; rw.sync = False
                    toterm += out
                    send(1, toterm)
                    toprog += cells.ask(b, time.time())
            if 0 in r:
                try:
                    b = os.read(0, 65536)
                except BlockingIOError:
                    b = None
                if b == b'':
                    break
                if b:
                    if probes:
                        b, lines = probes.answer(b, time.time())
                        for line in lines:
                            log(line)
                    b, changed, delays = cells.answer(b, time.time())
                    for t in delays:
                        log('terminal answered after %.2f s, %d bytes queued for it' % (t, len(toterm)))
                    if changed:
                        # A new size (none remembered, or Herdr zoomed): the browser takes it only on
                        # a resize, so give it the pixels and a one-column resize, put back just after.
                        CELL[:] = changed; log('cell %r' % CELL)
                        winch(narrow=1); nudge_at = time.time() + NUDGE_FOR
                    toprog += b
                    send(fd, toprog)
            if nudge_at and time.time() >= nudge_at:
                winch(); nudge_at = None
            if logf and time.time() - last > 5:
                log('stats %r' % stats); last = time.time()
    finally:
        # what the program said last still goes out, unless the terminal stays stuck
        toterm += rw.flush(force=True)
        end = time.time() + 2
        while toterm and not killed and time.time() < end:
            if select.select([], [1], [], 0.1)[1]:
                send(1, toterm)
        for f, fl in flags.items():
            try:
                fcntl.fcntl(f, fcntl.F_SETFL, fl)
            except OSError:
                pass
        if old:
            # at once: TCSAFLUSH waits for the terminal to take all output, forever when it's stuck
            termios.tcsetattr(0, termios.TCSANOW, old)
        log('exit stats %r' % stats)
        if not killed:
            try:
                _, st = os.waitpid(pid, 0)
                sys.exit(os.waitstatus_to_exitcode(st))
            except ChildProcessError:
                pass

if __name__ == '__main__':
    main()
