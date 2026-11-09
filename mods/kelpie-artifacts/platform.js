// What differs per system: opening, revealing, the account's name, Claude Code's temp folder. One file
// shared by the Quiet mods: this is the original, copied as is into mods/kelpie-artifacts (mods can't
// import across folders), so edit it here and copy it over.
//
// Commands run on this machine follow the system Herdr reports (window().platform). Scripts that may
// run on an agent's other machine (`on`) can't know it from here, so they ask `uname` themselves.

import { exec, notify, window } from "herdr";

// "macos", "linux" or "windows": the system this window runs on.
export const platform = () => window()?.platform ?? "macos";

const quietly = (title, body) => notify({ title, body, level: "warning", timeout: 6000 });
const short = (s) => (s.length > 60 ? `…${s.slice(-59)}` : s);

// Runs an opener; when it isn't there or fails, a toast says so instead of nothing happening.
async function launch(what, command, args) {
  const r = await exec(command, args).catch(() => null);
  // explorer.exe answers 1 even when it worked.
  if (!r) quietly(`Couldn't open ${short(what)}`, `${command} isn't available on this system.`);
  else if (r.code !== 0 && platform() !== "windows") quietly(`Couldn't open ${short(what)}`, (r.stderr || `${command} answered ${r.code}.`).trim().slice(0, 200));
}

// A web address or a file, in the system's default app (open, xdg-open, explorer).
export function openExternal(target) {
  const p = platform();
  launch(target, p === "macos" ? "open" : p === "windows" ? "explorer.exe" : "xdg-open", [target]);
}

// A file in the system's file manager: selected on macOS and Windows; Linux has no common way to
// select one, so its folder opens. The button's words say which (revealLabel).
export const revealLabel = () => ({ macos: "Show in Finder", windows: "Show in Explorer" })[platform()] ?? "Open folder";
export function reveal(path) {
  const p = platform();
  if (p === "macos") return launch(path, "open", ["-R", path]);
  if (p === "windows") return launch(path, "explorer.exe", [`/select,${path}`]);
  return launch(path, "xdg-open", [path.slice(0, path.lastIndexOf("/")) || "/"]);
}

// The account's full name ("" when unknown): macOS `id -F`, elsewhere the passwd entry's comment.
const FULL_NAME = 'if [ "$(uname)" = Darwin ]; then id -F; else getent passwd "$(id -un)" | cut -d: -f5 | cut -d, -f1; fi 2>/dev/null; true';
export const fullName = async () => (await exec("sh", ["-c", FULL_NAME]).catch(() => ({ stdout: "" }))).stdout.trim();

// Shell lines that set $root to Claude Code's temp folder on the machine they run on, where each
// session keeps <project>/<session id>/scratchpad: /private/tmp/claude-<uid> on macOS (what /tmp
// resolves to), /tmp/claude-<uid> on Linux. Empty when there's none. Paths are Claude Code internals.
export const CLAUDE_TMP = 'u=$(id -u); root=""; for r in "/private/tmp/claude-$u" "/tmp/claude-$u"; do [ -d "$r" ] && { root=$r; break; }; done';

// A shell line that sets $statflag and $statfmt so `stat "$statflag" "$statfmt" FILE…` prints
// "<mtime> <path>" per file, with BSD (macOS) or GNU (Linux) stat.
export const STAT_MTIME = 'if [ "$(uname)" = Darwin ]; then statflag=-f; statfmt="%Fm %N"; else statflag=-c; statfmt="%Y %n"; fi';
