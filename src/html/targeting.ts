import type { App } from "../main";
import type { GameState } from "../game";
import * as targeting from "../targeting";
import { Renderer } from "../render";
import { ITEMS } from "../weapons";
import { button, el } from "./components";

/** A compact HUD row; only Cancel owns pointer input over the battlefield. */
export class TargetView {
  readonly element = el("div", "", "ui-target-layer se-ui");
  private row = el("section", "", "ui-target-hud");
  private player = el("span", "", "ui-target-player");
  private title = el("span", "Choose target", "ui-target-action");
  private guidance = el("span", "", "ui-target-guidance");
  private cancel = button("Cancel", () => {
    const gs = this.app.gs as unknown as GameState;
    if (!this.app.online && gs?.pendingTarget) targeting.cancel(gs);
  });
  private labels = new Map<number, HTMLElement>();
  private marker = el("div", "+", "ui-target-marker");
  private request: targeting.TargetRequest | null = null;
  constructor(private app: App, private canvas: HTMLCanvasElement, private releaseInput: () => void) {
    this.element.dataset.targeting = "true";
    this.row.setAttribute("role", "status"); this.row.setAttribute("aria-live", "polite");
    this.cancel.setAttribute("aria-label", "Cancel targeting");
    this.row.append(this.player, this.title, this.guidance, this.cancel);
    this.row.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.app.online) {
        event.preventDefault();
        targeting.cancel(this.app.gs as unknown as GameState);
      }
    });
    this.marker.setAttribute("aria-hidden", "true");
    this.element.append(this.row, this.marker);
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
    this.app.renderer.targetHud = null;
    if (!p || !gs) return;
    const r = this.canvas.getBoundingClientRect();
    Object.assign(this.element.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    if (this.player.textContent !== p.shooter.name) this.player.textContent = p.shooter.name;
    const color = gs.lut.table[p.shooter.color];
    this.player.style.color = `rgb(${color.join(",")})`;
    const guidance = `· ${ITEMS[p.guidance].name}`;
    if (this.guidance.textContent !== guidance) this.guidance.textContent = guidance;
    this.guidance.title = ITEMS[p.guidance].name;
    this.cancel.hidden = !!this.app.online;
    const scale = r.width / gs.w;
    if (scale <= 0) return;
    const showHud = gs.cfg.is_on("ICON_BAR");
    const gap = 8 * scale, inset = showHud ? 22 * scale : 0;
    const fontSize = Math.max(12, 14 * scale), height = Math.max(Renderer.BAR_H * scale, fontSize + 6);
    Object.assign(this.row.style, { fontSize: `${fontSize}px`, height: `${height}px`, gap: `${gap}px`, paddingLeft: `${inset}px` });
    // scrollWidth preserves natural text width after truncation, but rounds to
    // integer pixels. Reserve one extra pixel per child for fractional glyphs.
    const children = [this.player, this.title, this.guidance, ...(!this.app.online ? [this.cancel] : [])];
    const width = children.reduce((sum, node) => sum + node.scrollWidth + 1, 0) + gap * (children.length - 1) + inset;
    const layout = this.app.renderer.layoutTargetHud(p.shooter, showHud, width / scale, height / scale);
    this.app.renderer.targetHud = layout;
    Object.assign(this.row.style, { left: `${layout.left * scale}px`, width: `${layout.width * scale}px` });
    const alive = targeting.tanks(gs), ids = new Set(alive.map((t) => t.player_index));
    for (const [id, label] of this.labels) if (!ids.has(id)) { label.remove(); this.labels.delete(id); }
    alive.forEach((tank, i) => {
      let label = this.labels.get(tank.player_index);
      if (!label) {
        label = el("span", "", "ui-target-tank"); label.dataset.targetTank = String(tank.player_index);
        this.labels.set(tank.player_index, label); this.element.append(label);
      }
      const text = `${i + 1}: ${tank.name}`;
      if (label.textContent !== text) label.textContent = text;
      const bounds = label.getBoundingClientRect();
      let bottom = (tank.y - 26) * scale;
      // A label above a high tank can land in the HUD, especially when scaled
      // down. Put it below that tank instead, keeping both the tank and HUD clear.
      if (bottom - bounds.height < height + 2) bottom = Math.max(tank.y * scale + 6, height + 2) + bounds.height;
      const x = Math.max(bounds.width / 2 + 2, Math.min(tank.x * scale, r.width - bounds.width / 2 - 2));
      Object.assign(label.style, { left: `${x}px`, top: `${bottom}px` });
    });
    this.marker.hidden = !p.point;
    if (p.point) Object.assign(this.marker.style, { left: `${p.point[0] / gs.w * 100}%`, top: `${p.point[1] / gs.h * 100}%` });
  }
  dispose(): void {
    this.app.renderer.targetHud = null;
    this.canvas.classList.remove("is-targeting"); this.element.remove();
  }
}
