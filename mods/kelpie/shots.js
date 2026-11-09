// How many screenshots Claude sessions saved, for the Screenshots view's count: each session's temp
// folder is <Claude Code's temp folder>/<project>/<session id> (ui.js CLAUDE_TMP), and its images sit in scratchpad/ (one
// level of subfolders, so cloned repos stay out). The view itself is the Artifacts panel's
// (mods/kelpie-artifacts, which this follows and which shows the newest NEWEST; mods can't import
// across folders). These paths are Claude Code internals: if they change, nothing is found.

import { exec } from "herdr";
import { CLAUDE_TMP } from "./ui.js";

const NEWEST = 60;

export async function countShots(ids, on = null) {
  const clean = ids.filter((id) => /^[0-9a-f-]+$/.test(id ?? ""));
  if (!clean.length) return 0;
  const script = `
    ${CLAUDE_TMP}
    [ -n "$root" ] || exit 0
    for id in "$@"; do
      for d in $(find "$root" -maxdepth 2 -type d -name "$id" 2>/dev/null); do
        [ -d "$d/scratchpad" ] && find "$d/scratchpad" -maxdepth 2 -type f \\( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.gif' -o -iname '*.webp' \\)
      done
    done; true`;
  const out = await exec("sh", ["-c", script, "sh", ...clean], on ? { on } : {});
  return Math.min(NEWEST, out.stdout.split("\n").filter(Boolean).length);
}
