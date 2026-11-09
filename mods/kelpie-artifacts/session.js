// From a Herdr terminal to its Claude session's temp folder and images. These paths are
// Claude Code internals: if they change we find nothing, never another session's images.
import * as fs from "fs/promises";
import { appHome, exec, hc } from "herdr";
import { CLAUDE_TMP, STAT_MTIME } from "./platform.js";

const FOLDERS = new Map(); // session id -> its temp folder
export const NEWEST = 60;

// Sessions live on the machine that runs the agent, so commands run there: "vps/t7" is on vps.
// The scripts ask that machine which system it is (platform.js): macOS or Linux.
export const machineOf = (address) => (String(address).includes("/") ? String(address).split("/")[0] : null);
const there = (on) => (on ? { on } : {});

export async function findSession(address) {
  const on = machineOf(address);
  const terminal = JSON.parse((await hc(["get", address])).stdout);
  const pid = Number(terminal.foreground?.pid);
  if (!pid) return null;
  // One sessions folder per Claude account.
  const found = await exec("sh", ["-c", `cat "$HOME"/.claude*/sessions/${pid}.json 2>/dev/null`], there(on));
  if (!found.stdout.trim()) return null;
  const id = JSON.parse(found.stdout).sessionId;
  const [session] = await sessionDirs([id], on);
  return session ? { ...session, on } : null;
}

// The temp folders of these sessions ([{ id, dir }], those found), looking up the unknown ones at once.
// A session with no folder yet is looked for again next time.
export async function sessionDirs(ids, on = null) {
  const clean = ids.filter((id) => /^[0-9a-f-]+$/.test(id ?? ""));
  const missing = clean.filter((id) => !FOLDERS.has(id));
  if (missing.length) {
    const script = `${CLAUDE_TMP}; [ -n "$root" ] || exit 0; for id in "$@"; do d=$(find "$root" -maxdepth 2 -type d -name "$id" 2>/dev/null | head -1); [ -n "$d" ] && echo "$id $d"; done; true`;
    const out = await exec("sh", ["-c", script, "sh", ...missing], there(on));
    for (const line of out.stdout.split("\n").filter(Boolean)) {
      const at = line.indexOf(" ");
      FOLDERS.set(line.slice(0, at), line.slice(at + 1));
    }
  }
  return clean.filter((id) => FOLDERS.has(id)).map((id) => ({ id, dir: FOLDERS.get(id) }));
}

// Newest first, from one or more session folders (each item keeps its `dir`). Claude's saved images,
// plus the ones pasted into chat when asked. One level of subfolders only, so cloned repos and
// virtualenvs in the scratchpad stay out.
export async function listImages(dirs, pasted = false, on = null) {
  const list = [dirs].flat();
  if (!list.length) return [];
  const script = `
    ${STAT_MTIME}
    for d in "$@"; do
      [ -d "$d" ] && find "$d" -maxdepth 2 -type f \\( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.gif' -o -iname '*.webp' \\) -exec stat "$statflag" "$statfmt" {} +
    done; true`;
  const roots = list.flatMap((dir) => [`${dir}/scratchpad`, ...(pasted ? [`${dir}/images`] : [])]);
  const out = await exec("sh", ["-c", script, "sh", ...roots], there(on));
  return out.stdout.split("\n").filter(Boolean).map((line) => {
    const at = line.indexOf(" ");
    const path = line.slice(at + 1);
    const dir = list.find((d) => path.startsWith(`${d}/`)) ?? list[0];
    return { path, dir, mtime: Number(line.slice(0, at)), name: path.split("/").pop(), pasted: path.startsWith(`${dir}/images/`) };
  }).sort((a, b) => b.mtime - a.mtime).slice(0, NEWEST);
}

// Herdr only draws images from its own folder, so each image gets a copy there, plus a small
// thumbnail so the grid isn't decoding full images. Sets src and thumb, relative to that folder.
export function locate(id, item) {
  const name = `${Math.floor(item.mtime)}-${item.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  item.src = `artifacts/${id}/${name}`;
  item.thumb = `artifacts/${id}/thumbs/${name}`;
}

const READY = new Set();
const FULL = new Set();
export const isReady = (item) => READY.has(item.src);
export const isFull = (item, on) => !on || FULL.has(item.src);

function bytesFrom(base64) {
  const clean = base64.replace(/\s/g, "");
  const table = {};
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("").forEach((c, i) => { table[c] = i; });
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - pad);
  let at = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (table[clean[i]] << 18) | (table[clean[i + 1]] << 12) | ((table[clean[i + 2]] ?? 0) << 6) | (table[clean[i + 3]] ?? 0);
    if (at < out.length) out[at++] = (n >> 16) & 255;
    if (at < out.length) out[at++] = (n >> 8) & 255;
    if (at < out.length) out[at++] = n & 255;
  }
  return out;
}

// Saves an image and checks it landed: reads it back, and if the size is wrong has PowerShell decode
// it instead. Binary writes came out empty on Windows, though the same code works on a Mac.
export async function saveBytes(local, base64) {
  const bytes = bytesFrom(base64);
  const size = async () => (await fs.readFile(local)).length;
  await fs.writeFile(local, bytes).catch((e) => note(`write threw ${e}`));
  const written = await size().catch(() => -1);
  if (written === bytes.length) return;
  const text = `${local}.b64`;
  await fs.writeFile(text, base64.replace(/\s/g, ""));
  const quoted = (path) => `'${path.replace(/'/g, "''")}'`;
  const out = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command",
    `[IO.File]::WriteAllBytes(${quoted(local)}, [Convert]::FromBase64String([IO.File]::ReadAllText(${quoted(text)})))`]);
  await fs.unlink(text).catch(() => {});
  const fallback = await size().catch(() => -1);
  await note(`${local}: expected ${bytes.length}, wrote ${written}, after PowerShell ${fallback}, exit ${out.code} ${out.stderr.slice(0, 200)}`);
  if (fallback !== bytes.length) throw new Error(`could not save ${local}`);
}

// A small log beside the images, for when saving goes wrong.
async function note(line) {
  const path = `${appHome()}/artifacts/save.log`;
  const before = await fs.readFile(path, "utf8").catch(() => "");
  await fs.writeFile(path, `${before}${line}\n`.slice(-8000)).catch(() => {});
}

// From another machine: the image comes across the connection as text. A thumbnail, or the
// whole image once it's opened. Over 8 MiB of output is more than exec carries, so it fails.
async function fetchImage(path, to, on, thumbnail) {
  const script = thumbnail
    ? 'b=$(mktemp "${TMPDIR:-/tmp}/herdr-thumb.XXXXXX"); t="$b.png"; sips -Z 480 "$1" --out "$t" >/dev/null 2>&1 || cp "$1" "$t"; base64 < "$t"; rm -f "$b" "$t"'
    : 'base64 < "$1"';
  const out = await exec("sh", ["-c", script, "sh", path], { on });
  if (out.code !== 0 || !out.stdout.trim()) throw new Error(`could not fetch ${path}`);
  const local = `${appHome()}/${to}`;
  await fs.mkdir(local.slice(0, local.lastIndexOf("/")), { recursive: true });
  await saveBytes(local, out.stdout);
}

export async function fetchFull(item, on) {
  if (!on || FULL.has(item.src)) return;
  await fetchImage(item.path, item.src, on, false);
  FULL.add(item.src);
}

// Prepares a few at once, in parallel. Returns false when there was nothing left to do.
export async function prepare(items, on = null, count = 8) {
  const batch = items.filter((i) => !READY.has(i.src)).slice(0, on ? 2 : count);
  if (!batch.length) return false;
  if (on) {
    for (const item of batch) {
      await fetchImage(item.path, item.thumb, on, true).catch((e) => note(`${item.name}: ${e}`));
      READY.add(item.src);
    }
    return true;
  }
  const script = `
    home="$1"; shift
    while [ $# -gt 0 ]; do
      (
        mkdir -p "$(dirname "$home/$3")"
        cp -n "$1" "$home/$2" 2>/dev/null
        [ -e "$home/$3" ] || sips -Z 480 "$1" --out "$home/$3" >/dev/null 2>&1 || cp "$1" "$home/$3"
      ) &
      shift 3
    done
    wait`;
  await exec("sh", ["-c", script, "sh", appHome(), ...batch.flatMap((i) => [i.path, i.src, i.thumb])]);
  batch.forEach((i) => READY.add(i.src));
  return true;
}

// An image's real size, for 100% zoom and for keeping it on screen while panning: from sips (macOS),
// else ImageMagick's identify; null with neither.
const SIZE = 'if command -v sips >/dev/null 2>&1; then sips -g pixelWidth -g pixelHeight "$1"; else identify -format "pixelWidth: %w\\npixelHeight: %h\\n" "$1[0]"; fi 2>/dev/null; true';
export async function pixelSize(path, on = null) {
  const out = (await exec("sh", ["-c", SIZE, "sh", path], there(on))).stdout;
  const width = Number(out.match(/pixelWidth: (\d+)/)?.[1]);
  const height = Number(out.match(/pixelHeight: (\d+)/)?.[1]);
  return width && height ? { width, height } : null;
}

// Copies are only a cache: drop those of sessions untouched for a week.
export const sweep = () => exec("sh", ["-c", 'd="$1/artifacts"; [ -d "$d" ] && find "$d" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +; true', "sh", appHome()]);
