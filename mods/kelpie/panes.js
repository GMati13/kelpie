// A split tab's pane headers (role "pane-head", the Kelpie layouts' `pane.header`): Herdr draws one
// copy per pane, only while the tab is split (`lone: false`), with props { pane, terminal }.
// What runs there (an agent's session name, else the terminal's title), its status, and where
// (folder, branch); the focused pane's header is lit, the others sit back. Split right, split down,
// zoom and close show on the focused pane and on hover. Dragging panes is Herdr's own top-edge grip.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { home, panes, props, run } from "herdr";
import { SMALL, chrome, icon, iconButton, programIcon, sessionTitle, status } from "./ui.js";
import { decor, skinFont, skinText, skinTheme } from "./skins/index.js";

// Herdr's own pane icons (its shipped `pane` mod, a real folder, so they draw).
const paneIcon = (name) => `mods/pane/${name}.svg`;

const folder = (cwd) => {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
};

// An agent by its session's name (else the program); a shell by its title, which is often the folder.
function nameOf(p) {
  if (p.mod) return p.title || p.mod;
  if (p.program?.agent) return sessionTitle(p.title) ?? p.program.name ?? "agent";
  // A shell that set no title yet is titled with its terminal's id ("t63"), which says nothing.
  const title = (p.title ?? "").trim();
  return (title && title !== p.terminal ? title : "") || p.program?.name || "shell";
}

export class PaneHead {
  init() { this.hovered = false; }

  render(cx) {
    const t = skinTheme();
    const p = panes().find((x) => x.pane === props()?.pane);
    if (!p) return div();
    const pane = p.pane;
    const name = nameOf(p);
    const where = folder(p.cwd);
    // A shell's title is often its folder already.
    const place = where && !name.includes(where) && !/^[~/]/.test(name) ? where : "";
    const lit = p.focused;
    const pic = programIcon(p.program, lit ? t.foreground : t.dim);
    const mark = status(t, p.status);
    const tools = lit || this.hovered;
    return decor("blockDecor", t, h_flex().id(`pane-head-${pane}`).size_full().pl(10).pr(2).gap(8).items_center()
      .bg(t.background).border_b(1).border_color(lit ? t.accent : t.border).text_size(SMALL)
      .cursor_pointer()
      .on_hover((h) => { this.hovered = h; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(skinFont(div().flex_none().max_w(360).truncate().font_medium().text_color(lit ? t.foreground : t.muted), "tab").tooltip(p.title || name).child(skinText(name, "tab")))
      .when(Boolean(mark), (el) => el.child(mark))
      .child(h_flex().flex_1().min_w(0).gap(8).items_center().text_color(t.dim)
        .when(Boolean(place), (el) => el.child(div().min_w(0).truncate().child(place)))
        .when(Boolean(p.branch), (el) => el.child(h_flex().flex_none().gap(4).items_center()
          .child(icon(chrome("git-branch"), 12)).child(div().max_w(220).truncate().child(p.branch)))))
      .when(tools, (el) => el.child(h_flex().flex_none().items_center()
        .child(iconButton(t, `ph-right-${pane}`, paneIcon("split-right"), () => run("pane.split", { direction: "right", pane }), "Split right (⌘D)"))
        .child(iconButton(t, `ph-down-${pane}`, paneIcon("split-down"), () => run("pane.split", { direction: "down", pane }), "Split down (⇧⌘D)"))
        .child(iconButton(t, `ph-zoom-${pane}`, paneIcon(p.zoomed ? "unzoom" : "zoom"), () => run("pane.zoom", { pane }), p.zoomed ? "Show all panes (⇧⌘↩)" : "Zoom (⇧⌘↩)", { on: p.zoomed }))
        .child(iconButton(t, `ph-close-${pane}`, chrome("x"), () => run("pane.close", { pane }), "Close pane (⇧⌘W)")))), { role: "pane-head", now: new Date() });
  }
}
