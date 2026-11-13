// The base skin: the Kelpie layout as it is ("Kelpie-Plain", and any layout without a skin of its own).
// Every hook here changes nothing, so the Kelpie views draw exactly what they drew before skins
// existed. A skin starts from this object and overrides only the hooks it needs:
//
//   import base from "./base.js";
//   export default { ...base, name: "<name>", palette(t, now) { ... } };
//
// The hooks, what they get and what base does (skins/index.js calls them, with try/catch: a hook that
// throws falls back to this one):
//   palette(t, now)              colour overrides merged over theme() for every Kelpie view    base: null
//   fonts                        { [kind]: family } (ui, title, reading, label, ...)         base: all null (inherit)
//   type                         { [kind]: { scale, weight, color, caps, text } }            base: {} (as the view sets it)
//   glyph(t, o)                  the profile's square (o: { name, size })                    base: null (Kelpie's own)
//   statusMark(t, state, o)      the mark for a state (o: { where, size, color, agent })     base: null (Kelpie's own)
//   blockDecor(t, el, o)         a Kelpie block's root (o: { role, now, story, state, working }) base: el
//   rowDecor(t, el, o)           a sidebar story row (o: { selected, state, story, now })     base: el
//   groupDecor(t, el, o)         a list's group heading (o: { label, count, trail(), aside() })  base: el
//   tabDecor(t, el, o)           a tab-bar tab (o: { tab, active, state, agentTab, now })     base: el
//   controlDecor(t, el, o)       a button or chip (o: { kind, id, label, on })               base: el
//   sidebarFoot(t, o)            a scene above the footer's lines (o: { now })              base: null
//   footerExtras(t, o)           something just before the footer's clock (o: { now })        base: null
//   meter(t, o)                  a figure as a meter (o: { kind, label, value, scale, ... })  base: null (Kelpie's text)
//   tick                         { [role]: ms }: redraw that role's copy this often          base: {}
// See skins/index.js for the details of each.

export default {
  name: "base",
  palette: () => null,
  fonts: { ui: null, title: null, reading: null, label: null, numbers: null, mono: null },
  type: {},
  glyph: () => null,
  statusMark: () => null,
  blockDecor: (_t, el) => el,
  rowDecor: (_t, el) => el,
  groupDecor: (_t, el) => el,
  tabDecor: (_t, el) => el,
  controlDecor: (_t, el) => el,
  sidebarFoot: () => null,
  footerExtras: () => null,
  meter: () => null,
  tick: {},
};
