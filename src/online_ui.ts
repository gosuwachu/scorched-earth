import * as pg from "./pygame";
import { draw_tank_icon_cell } from "./sprites";
import { TEAM_RGB } from "./palette";
import type { Player } from "../shared/online";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

export function button(label: string, action: () => void): HTMLButtonElement {
  const b = el("button", label);
  b.type = "button";
  b.onclick = action;
  return b;
}

export function tankIcon(icon: number, index = 0): HTMLCanvasElement {
  const surface = new pg.Surface([64, 54]);
  surface.fill([15, 19, 27]);
  draw_tank_icon_cell(surface, new pg.Rect(0, 0, 64, 54), TEAM_RGB[index % TEAM_RGB.length], { design_index: icon, scale: 2 });
  surface.canvas.setAttribute("aria-label", `Tank design ${icon + 1}`);
  return surface.canvas;
}

export function rosterList(players: Player[], remove?: (p: Player) => void): HTMLElement {
  const list = el("ul", "", "lan-roster");
  players.forEach((p, index) => {
    const row = el("li");
    row.append(tankIcon(p.icon, index), el("span", p.name), el("small", p.ai ? "Computer" :
      !p.connected ? "Disconnected" : p.ready ? "Ready" : "Choosing tank…"));
    if (remove) row.append(button(`Remove ${p.name}`, () => remove(p)));
    list.append(row);
  });
  return list;
}

export function overlay(): HTMLElement {
  const box = el("section", "", "lan-overlay");
  box.setAttribute("aria-label", "Online game");
  document.body.append(box);
  return box;
}
