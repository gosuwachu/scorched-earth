import type { ControllerView } from "../shared/online";
import { hudAngle } from "./angles";
import { TANK_DEFAULT_HEALTH } from "./constants";
import { el } from "./html/components";
import { TEAM_RGB } from "./palette";
import { Surface, SRCALPHA } from "./pygame";
import { draw_tank } from "./sprites";

export function meter(label: string, max: number, className: string) {
  const node = el("div", "", `lan-meter ${className}`);
  node.setAttribute("role", "meter");
  node.setAttribute("aria-label", label);
  node.setAttribute("aria-valuemin", "0");
  node.setAttribute("aria-valuemax", String(max));
  const fill = el("span", "", "lan-meter-fill");
  const value = el("span", "", "lan-meter-value");
  node.append(fill, value);
  return {
    node,
    update(amount: number, text: string, left = 0, width = amount / max * 100, display = text): void {
      node.setAttribute("aria-valuenow", String(Math.max(0, Math.min(max, amount))));
      node.setAttribute("aria-valuetext", text);
      value.textContent = display;
      fill.style.left = `${left}%`;
      fill.style.width = `${Math.max(0, Math.min(100, width))}%`;
    },
  };
}

/** Shared guest overview; decorative artwork is updated without replacing DOM. */
export class TankOverview {
  readonly element = el("div", "", "lan-battle-overview");
  private name = el("h2", "", "lan-battle-name");
  readonly cash = el("div");
  private round = el("div", "", "lan-battle-round");
  private power = el("div", "", "lan-overview-power");
  private shield = el("div", "", "lan-overview-shield");
  private health = meter("Health", TANK_DEFAULT_HEALTH, "lan-health");
  private surface = new Surface([48, 36], SRCALPHA);
  private spriteKey = "";

  constructor() {
    const preview = el("div", "", "lan-tank-preview");
    this.surface.canvas.setAttribute("role", "img");
    preview.append(this.health.node, this.surface.canvas);
    const info = el("div", "", "lan-battle-info");
    this.power.hidden = true;
    this.shield.hidden = true;
    info.append(this.name, this.cash, this.round, this.power, this.shield);
    this.element.append(preview, info);
  }

  update(tank: NonNullable<ControllerView["tank"]>, playerIndex: number, round: number, combat = true, showPower = false): void {
    this.name.textContent = tank.name;
    this.cash.textContent = `Cash $${tank.cash}`;
    this.round.textContent = `Round ${round}`;
    this.power.hidden = !showPower;
    this.power.textContent = `Power ${tank.power}`;
    this.shield.hidden = !tank.shield;
    this.shield.textContent = tank.shield ? `${tank.shield.name} ${tank.shield.percent}%` : "";
    this.health.node.hidden = !combat;
    this.health.update(tank.health, `Health ${tank.health}/${TANK_DEFAULT_HEALTH}`);
    const color = TEAM_RGB[Math.max(0, playerIndex) % TEAM_RGB.length];
    const spriteKey = `${tank.icon}:${tank.angle}:${color}`;
    if (spriteKey !== this.spriteKey) {
      this.spriteKey = spriteKey;
      this.surface.fill([0, 0, 0, 0]);
      draw_tank(this.surface, 24, 32, tank.icon, color, tank.angle, { scale: 2 });
    }
    const [elevation, side] = hudAngle(tank.angle);
    this.surface.canvas.setAttribute("aria-label", `${tank.name}, tank design ${tank.icon + 1}, aiming ${elevation}${side}`);
  }
}
