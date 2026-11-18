---
covers:
  - mods/kelpie/skins/*.js
  - mods/kelpie/skins/copy-art.sh
  - mods/kelpie/skins/quiet-pages/build.py
  - themes/*.json
---

# Skins

How a Kelpie layout gets its own look, the skin hooks, art and fonts.

## Skins

Skins: more Kelpie layouts can share the `kelpie` mod, each with its own look; Quiet Pages is the one shipped, as the layout `Kelpie` (the plain look is `Kelpie-Plain`). Layout and theme names are Pascal-Kebab (`Kelpie-<Name>.json`), as Herdr's layout picker shows a file name as it is and takes no space in one (its own "Herdr 98" is a name it keeps for its own layouts); a new skin's layout is a copy of `Kelpie-Plain.json` with the same block ids and its own `theme`, with a `layout:Kelpie-<Name>` keys section, the same as `layout:Kelpie-Plain`; `~/.config/herdr-app` links each file like the others). `skins/index.js` picks the skin by `shared("layout")` (`quiet-pages.js` for `Kelpie`; anything else, `Kelpie-Plain` too, gets `base.js`, which changes nothing) and documents the hooks: `palette(t, now)` (colours over `theme()`, via `skinTheme()` in every Kelpie view; the footer's `syncSkin()` redraws all copies when it changes), `fonts` (`ui`, `title`, `reading`, `label`, `numbers`, `mono`, and finer kinds falling back to them: `meta`, `key`, `count`, `clock`, `profile`, `fresh`, `tab`, `heading`, `lead`, `footer`), `type` (per kind `{scale, weight, color, caps, text}`: views pass sizes through `skinFont(el, kind, size)`, after their own weight and colour so the skin's win, and strings through `skinText(s, kind)`, as gpui has no text-transform or letter spacing), `glyph(t, {name, size})` (the profile square), `statusMark(t, state, {where, size, color, agent})`, the element decorators `blockDecor` (each Kelpie block's root, by `role`), `rowDecor`, `groupDecor`, `tabDecor`, `controlDecor`, then `sidebarFoot`, `footerExtras`, `meter` (cpu, mem, five, week, subtasks) and `tick` (`{role: ms}`: that copy redraws on a timer, for image frames; prefer native `.loop`/`.frames`).

A hook that throws falls back to base's (logged once); a syntax error in any skin still breaks the mod. `skins/common.js` holds shared helpers (`hourPhase`, `byHour`, `mix`/`alpha`, `breathing`, `breathingDot`, `pulseRing`, `ring`, `bands`, `segments`, `frameAt`, `artImage`). A theme's `surface` must be opaque (the Kelpie themes use their `popover` colour): Herdr draws every `.tooltip()` on it, and a transparent one left tooltips unreadable over text. Mods can't paint gradients (`.bg` takes only a colour): use `bands`, art, or the layout file's `background`. Art: sources in `skins/<name>/art/` (png, svg), copied at start by the footer to `~/.config/herdr-app/art/kelpie/skins/<name>/` (Herdr draws no image through symlinks; it caches by path, so a changed image needs a new name); fonts in `skins/<name>/fonts/` go to `~/.config/herdr-app/fonts/`, loaded on Herdr's next start.

A skin agent touches only `skins/<name>.js`, `skins/<name>/`, `layouts/Kelpie-<Name>.json` and `themes/Kelpie-<Name>.json`; a new shared hook goes in `index.js` (documented there), a no-op in base. Many hot reloads run Herdr's mod engine out of memory (`herdr-app status` errors "out of memory"); only a Herdr restart clears it
