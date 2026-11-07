import { drawModernTank } from "./modern_art";
import { el, button } from "./html/components";
export { el, button, dialog, installTheme as installOnlineTheme } from "./html/components";
export type { Dialog as OnlineDialog } from "./html/components";
import * as pg from "./pygame";
import { TEAM_RGB } from "./palette";
import type { Player } from "../shared/online";

export function tankIcon(icon: number, index = 0): HTMLCanvasElement {
  const surface = new pg.Surface([192, 162], pg.SRCALPHA);
  drawModernTank(surface.ctx, 87, 126, 118, TEAM_RGB[index % TEAM_RGB.length], 30, icon);
  surface.canvas.style.width = "64px"; surface.canvas.style.height = "54px"; surface.canvas.style.imageRendering = "auto";
  surface.canvas.setAttribute("aria-label", `Tank design ${icon + 1}`);
  return surface.canvas;
}

/** Keep the region and unchanged rows mounted so network updates cannot jump scroll or focus. */
export class Roster {
  readonly element = el("div", "", "lan-roster-scroll");
  private list = el("ul", "", "lan-roster");
  private rows = new Map<string, {
    row: HTMLLIElement; name: HTMLElement; status: HTMLElement; icon: HTMLCanvasElement;
    iconKey: string; remove?: HTMLButtonElement;
  }>();

  constructor(private remove?: (id: string) => void) {
    this.element.setAttribute("role", "region");
    this.element.setAttribute("aria-label", "Connected players");
    this.element.tabIndex = 0;
    this.element.append(this.list);
  }

  update(players: Player[]): void {
    const scroll = this.element.scrollTop;
    const ids = new Set(players.map((p) => p.id));
    for (const [id, entry] of this.rows) {
      if (!ids.has(id)) {
        if (entry.row.contains(document.activeElement)) this.element.focus({ preventScroll: true });
        entry.row.remove();
        this.rows.delete(id);
      }
    }
    players.forEach((p, index) => {
      const iconKey = `${p.icon}:${p.colorIndex}`;
      let entry = this.rows.get(p.id);
      if (!entry) {
        const row = el("li");
        row.dataset.playerId = p.id;
        const name = el("span", "", "lan-player-name");
        const status = el("small");
        const icon = tankIcon(p.icon, p.colorIndex);
        const details = el("div", "", "lan-player-details");
        details.append(name, status);
        row.append(icon, details);
        const remove = this.remove ? button("Remove", () => this.remove!(p.id)) : undefined;
        if (remove) row.append(remove);
        entry = { row, name, status, icon, iconKey, remove };
        this.rows.set(p.id, entry);
      }
      if (entry.iconKey !== iconKey) {
        const icon = tankIcon(p.icon, p.colorIndex);
        entry.icon.replaceWith(icon);
        entry.icon = icon;
        entry.iconKey = iconKey;
      }
      entry.name.textContent = p.name;
      entry.status.textContent = p.ai ? "Computer" : !p.connected ? "Disconnected" : p.ready ? "Ready" : "Choosing tank…";
      entry.remove?.setAttribute("aria-label", `Remove ${p.name}`);
      if (this.list.children[index] !== entry.row) this.list.insertBefore(entry.row, this.list.children[index] ?? null);
    });
    this.element.scrollTop = scroll;
  }
}
