import type { App } from "../main";
import type { GameState } from "../game";
import * as targeting from "../targeting";
import { ITEMS } from "../weapons";
import { button, el } from "./components";

/** Nonmodal: instructions own their buttons, while the battlefield owns clicks. */
export class TargetView {
  readonly element = el("div", "", "ui-target-layer se-ui");
  private banner = el("section", "", "ui-target-banner");
  private title = el("strong");
  private help = el("p");
  private cancel = button("Cancel targeting", () => {
    const gs = this.app.gs as unknown as GameState;
    if (!this.app.online && gs?.pendingTarget) targeting.cancel(gs);
  });
  private labels = new Map<number, HTMLElement>();
  private marker = el("div", "+", "ui-target-marker");
  private request: targeting.TargetRequest | null = null;
  constructor(private app: App, private canvas: HTMLCanvasElement, private releaseInput: () => void) {
    this.element.dataset.targeting = "true";
    this.banner.setAttribute("role", "status"); this.banner.setAttribute("aria-live", "polite");
    this.banner.append(this.title, this.help, this.cancel);
    this.banner.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.app.online) {
        event.preventDefault();
        targeting.cancel(this.app.gs as unknown as GameState);
      }
    });
    this.marker.setAttribute("aria-hidden", "true");
    this.element.append(this.banner, this.marker);
    this.element.hidden = true;
    document.body.append(this.element);
  }
  update(): void {
    const gs = this.app.gs as unknown as GameState | null;
    const p = this.app.onlineScreen === "battle" ? gs?.pendingTarget ?? null : null;
    if (p !== this.request) {
      this.request = p; this.releaseInput();
      if (!p && this.element.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    }
    this.element.hidden = !p;
    this.canvas.classList.toggle("is-targeting", !!p && !this.app.online);
    if (!p || !gs) return;
    const r = this.canvas.getBoundingClientRect();
    Object.assign(this.element.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const title = `Choose Target — ${ITEMS[p.guidance].name}`;
    if (this.title.textContent !== title) this.title.textContent = title;
    const help = this.app.online ? `${p.shooter.name} is choosing a target on their controller.` :
      "Click a point to fire. Right-click a tank or press its number (0 = 10). Esc cancels.";
    if (this.help.textContent !== help) this.help.textContent = help;
    this.cancel.hidden = !!this.app.online;
    const alive = targeting.tanks(gs), ids = new Set(alive.map((t) => t.player_index));
    for (const [id, label] of this.labels) if (!ids.has(id)) { label.remove(); this.labels.delete(id); }
    alive.forEach((tank, i) => {
      let label = this.labels.get(tank.player_index);
      if (!label) { label = el("span", "", "ui-target-tank"); this.labels.set(tank.player_index, label); this.element.append(label); }
      label.textContent = `${i + 1}: ${tank.name}`;
      Object.assign(label.style, { left: `${tank.x / gs.w * 100}%`, top: `${(tank.y - 26) / gs.h * 100}%` });
    });
    this.marker.hidden = !p.point;
    if (p.point) Object.assign(this.marker.style, { left: `${p.point[0] / gs.w * 100}%`, top: `${p.point[1] / gs.h * 100}%` });
  }
  dispose(): void { this.canvas.classList.remove("is-targeting"); this.element.remove(); }
}
