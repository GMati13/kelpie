#!/usr/bin/env python3
"""What kittyfix.py costs: frames shaped like terminal-browser's, through a real kittyfix in a pty.

    scripts/bench-kittyfix.py [--frames N] [--kittyfix PATH] [video|patch|page ...]

terminal-browser's renderer sends each frame as `a=T,f=32,o=z` (zlib RGBA) with X/Y offsets,
chunked at 4096 bytes, inside a synchronized block. The cases:
  video  whole 800x600 frames of noise at 1;1 (barely compressible, as video)
  patch  a 400x225 noisy patch at row 6, column 21, X=3 Y=7 (padded into place by kittyfix)
  page   whole 800x600 frames of a plain page (compresses well, as scrolling text)

`cat` writes the frames into kittyfix's pty as fast as it reads them and its output goes to a
file, so this is kittyfix at full speed, not paced like the browser (about 5 frames a second).
Prints kittyfix's CPU a frame (with cat's, which is small), its peak memory, and whether every
byte came out. Everything goes in a temporary folder (HOME too: kittyfix's cell file), and
nothing touches Herdr. Wall time means little on a busy machine; CPU time is the figure.
"""
import argparse, base64, os, resource, shutil, subprocess, sys, tempfile, time, zlib

HERE = os.path.dirname(os.path.abspath(__file__))


def apc(ctrl, payload=b''):
    return b'\x1b_G' + ctrl + (b';' + payload if payload else b'') + b'\x1b\\'


def chunked(ctrl, payload):
    parts = [payload[k:k + 4096] for k in range(0, len(payload), 4096)]
    return b''.join(apc((ctrl + b',m=' if n == 0 else b'm=') + (b'1' if n < len(parts) - 1 else b'0'), c)
                    for n, c in enumerate(parts))


def frame(i, w, h, row, col, x, y, noisy):
    raw = os.urandom(w * h * 4) if noisy else bytes((k * 7 + i) & 0xff for k in range(w * 4)) * h
    pixels = base64.b64encode(zlib.compress(raw, 1))
    ctrl = b'a=T,f=32,o=z,s=%d,v=%d,X=%d,Y=%d,i=%d,q=2' % (w, h, x, y, 1 + i % 2)
    return (b'\x1b[?2026h\x1b[%d;%dH' % (row, col) + chunked(ctrl, pixels)
            + apc(b'a=d,d=i,i=%d,q=2' % (1 + (i + 1) % 2)) + b'\x1b[?2026l')


CASES = {
    'video': lambda i: frame(i, 800, 600, 1, 1, 0, 0, True),
    'patch': lambda i: frame(i, 400, 225, 6, 21, 3, 7, True),
    'page': lambda i: frame(i, 800, 600, 1, 1, 0, 0, False),
}


def run(kittyfix, kind, n, tmp):
    frames = os.path.join(tmp, kind + '.bin')
    with open(frames, 'wb') as fh:
        for i in range(n):
            fh.write(CASES[kind](i))
    size = os.path.getsize(frames)
    out = os.path.join(tmp, kind + '.out')
    rd, wr = os.pipe()  # its input: open, never readable (as Herdr with nothing typed)
    env = dict(os.environ, HOME=tmp)
    start = time.time()
    with open(out, 'wb') as fh:
        p = subprocess.Popen([sys.executable, '-I', kittyfix, '--', 'cat', frames], stdin=rd, stdout=fh, env=env)
        _, _, use = os.wait4(p.pid, 0)
    os.close(rd); os.close(wr)
    wall = time.time() - start
    peak = use.ru_maxrss / (1 << 20 if sys.platform == 'darwin' else 1 << 10)  # bytes on macOS, KB on Linux
    got = os.path.getsize(out)
    print('%-5s %3d frames of %5d KB: %6.1f ms CPU a frame (user %.1f s, system %.1f s), peak %5.1f MB, '
          '%s, %.1f s' % (kind, n, size // n // 1024, (use.ru_utime + use.ru_stime) * 1000 / n,
                          use.ru_utime, use.ru_stime, peak,
                          'all out' if got >= size else 'only %d%% out' % (got * 100 // size), wall))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('cases', nargs='*', help='video, patch or page (default: all)')
    ap.add_argument('--frames', type=int, default=50)
    ap.add_argument('--kittyfix', default=os.path.join(HERE, '..', 'mods', 'kelpie', 'kittyfix.py'))
    a = ap.parse_args()
    bad = [c for c in a.cases if c not in CASES]
    if bad:
        ap.error('unknown case: %s (video, patch or page)' % ', '.join(bad))
    a.cases = a.cases or list(CASES)
    tmp = tempfile.mkdtemp()
    try:
        for kind in a.cases:
            run(os.path.abspath(a.kittyfix), kind, a.frames, tmp)
    finally:
        shutil.rmtree(tmp)


if __name__ == '__main__':
    main()
