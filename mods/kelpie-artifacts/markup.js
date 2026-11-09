// Marks on an image: pure logic and the save script. Marks are stored as shares of the image
// (0 to 1), so they stay put whatever the zoom, and scale exactly when burned into a copy.

// Apple's system colours, with white and black for any background.
export const INKS = ["#ff453a", "#ff9f0a", "#ffd60a", "#32d74b", "#0a84ff", "#bf5af2", "#ffffff", "#000000"];
export const INK = INKS[0];

// A stroke that reads at any screenshot size, in image pixels.
export const strokeFor = (imageWidth) => Math.max(3, Math.round(imageWidth / 450));

// The head of an arrow from a to b, in image pixels: [tip, left, right].
export function arrowHead(ax, ay, bx, by, stroke) {
  const length = stroke * 5;
  const angle = Math.atan2(by - ay, bx - ax);
  const wing = (turn) => [bx - length * Math.cos(angle + turn), by - length * Math.sin(angle + turn)];
  return [[bx, by], wing(0.45), wing(-0.45)];
}

// Text scales with the image, like strokes. Same font on screen and in the saved copy.
export const TEXT_FONT = "Arial";
const TEXT_FONT_FILE = "/System/Library/Fonts/Supplemental/Arial.ttf";
export const textSizeFor = (imageWidth) => Math.max(14, Math.round(imageWidth / 75));

// ImageMagick treats these specially in text: % and \\ are escapes, a leading @ reads a file.
export const escapeText = (text) => text.replace(/\\/g, "\\\\").replace(/%/g, "%%").replace(/^@/, "\\@");

// A mark too small to mean anything: a stray click.
export function isTiny(mark, width, height) {
  const xs = mark.points.map((p) => p[0] * width);
  const ys = mark.points.map((p) => p[1] * height);
  return Math.max(...xs) - Math.min(...xs) < 4 && Math.max(...ys) - Math.min(...ys) < 4;
}

const n = (v) => Math.round(v * 10) / 10;

// ImageMagick's arguments for the marks.
export function drawArgs(marks, width, height) {
  const stroke = strokeFor(width);
  const out = ["-fill", "none", "-strokewidth", String(stroke)];
  const round = "stroke-linecap round stroke-linejoin round";
  const at = ([x, y]) => [n(x * width), n(y * height)];
  for (const mark of marks) {
    const points = mark.points.map(at);
    const ink = mark.color ?? INK;
    out.push("-stroke", ink);
    if (mark.tool === "text") {
      const [x, y] = points[0];
      out.push("-font", TEXT_FONT_FILE, "-pointsize", String(textSizeFor(width)), "-fill", ink, "-stroke", "none", "-gravity", "NorthWest",
        "-annotate", `+${x}+${y}`, escapeText(mark.text), "-fill", "none");
    } else if (mark.tool === "box") {
      out.push("-draw", `${round} rectangle ${points[0].join(",")} ${points.at(-1).join(",")}`);
    } else if (mark.tool === "pen") {
      out.push("-draw", `${round} polyline ${points.map((p) => p.join(",")).join(" ")}`);
    } else {
      const a = points[0];
      const b = points.at(-1);
      const head = arrowHead(a[0], a[1], b[0], b[1], stroke).map((p) => p.map(n).join(",")).join(" ");
      out.push("-draw", `${round} line ${a.join(",")} ${b.join(",")}`, "-fill", ink, "-draw", `${round} polygon ${head}`, "-fill", "none");
    }
  }
  return out;
}

// History: undoing moves a mark aside, redoing brings it back, and a new mark clears what was undone.
export const undo = (m) => { if (m.marks.length) m.undone.push(m.marks.pop()); };
export const redo = (m) => { if (m.undone.length) m.marks.push(m.undone.pop()); };
export const addMark = (m, mark) => { m.marks.push(mark); m.undone = []; };

// An edit of an edit is still named after the original.
export function editBase(name) {
  return name.replace(/\.[^.]+$/, "").replace(/-edit-\d+$/, "").replace(/[^A-Za-z0-9._-]/g, "_");
}

// Saves a new copy and prints its path. Never touches the source. Run as:
//   sh -c SAVE_SCRIPT sh <source> <folder> <base> <draw args...>
export const SAVE_SCRIPT = `
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
src="$1"; dir="$2"; base="$3"; shift 3
n=1
while [ -e "$dir/$base-edit-$n.png" ]; do n=$((n + 1)); done
out="$dir/$base-edit-$n.png"
magick "$src" "$@" "$out" && printf '%s' "$out"`;

// Flattens the marks for attaching, away from the session's images so nothing shows in the gallery
// or piles up: Claude reads the file when it's attached, and anything over a day old is removed.
// Run as: sh -c FLATTEN_SCRIPT sh <source> <draw args...>
export const FLATTEN_SCRIPT = `
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
src="$1"; shift
dir="\${TMPDIR:-/tmp}/herdr-markup"
mkdir -p "$dir" && find "$dir" -type f -mmin +1440 -delete
out="$(mktemp "$dir/edit.XXXXXX")" || exit 1
rm -f "$out"
out="$out.png"
magick "$src" "$@" "$out" && printf '%s' "$out"`;
