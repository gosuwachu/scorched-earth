import type { ControllerView } from "../shared/online";
import { hudAngle } from "./angles";
import { TANK_DEFAULT_HEALTH } from "./constants";
import { el } from "./html/components";
import { TEAM_RGB } from "./palette";
import { Surface, SRCALPHA } from "./pygame";
import { draw_tank } from "./sprites";

function meter(label: string, max: number, className: string) {
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
    update(amount: number, text: string, left = 0, width = amount / max * 100): void {
      node.setAttribute("aria-valuenow", String(Math.max(0, Math.min(max, amount))));
      node.setAttribute("aria-valuetext", text);
      value.textContent = text;
      fill.style.left = `${left}%`;
      fill.style.width = `${Math.max(0, Math.min(100, width))}%`;
    },
  };
}

/** Presentation only: inputs and action availability still belong to the remote adapter. */
export class BattleControls {
  readonly element = el("section", "", "lan-battle");
  readonly keys = el("div", "", "lan-battle-keys");
  readonly fire = el("div", "", "lan-battle-fire");
  readonly panel = el("div", "", "lan-battle-panel lan-controls");
  readonly more = el("details", "", "lan-battle-more");
  readonly extra = el("div", "", "lan-controls");
  readonly escape = el("div", "", "lan-battle-escape");
  private name = el("h2", "", "lan-battle-name");
  private cash = el("div");
  private weapon = el("div", "", "lan-battle-weapon");
  private round = el("div", "", "lan-battle-round");
  private health = meter("Health", TANK_DEFAULT_HEALTH, "lan-health");
  private angle = meter("Angle", 180, "lan-angle");
  private power = meter("Power", 1000, "lan-power");
  private surface = new Surface([48, 36], SRCALPHA);
  private spriteKey = "";

  constructor() {
    this.element.setAttribute("aria-label", "Tank battle controls");
    this.element.hidden = true;
    const overview = el("div", "", "lan-battle-overview");
    const preview = el("div", "", "lan-tank-preview");
    this.surface.canvas.setAttribute("role", "img");
    preview.append(this.health.node, this.surface.canvas);
    const info = el("div", "", "lan-battle-info");
    info.append(this.name, this.cash, this.weapon, this.round);
    overview.append(preview, info);
    const aim = el("div", "", "lan-battle-aim");
    aim.append(this.angle.node, this.power.node);
    const actions = el("div", "", "lan-battle-actions");
    this.more.append(el("summary", "More actions"), this.extra);
    actions.append(aim, this.keys, this.fire, this.panel, this.more, this.escape);
    this.element.append(overview, actions);
  }

  update(tank: NonNullable<ControllerView["tank"]>, playerIndex: number, round: number): void {
    const [elevation, side] = hudAngle(tank.angle);
    this.name.textContent = tank.name;
    this.cash.textContent = `Cash $${tank.cash}`;
    this.weapon.textContent = `${tank.weapon} (${tank.ammo})`;
    this.round.textContent = `Round ${round}`;
    this.health.update(tank.health, `Health ${tank.health}/${TANK_DEFAULT_HEALTH}`);
    const offset = (90 - tank.angle) / 180 * 100;
    this.angle.update(tank.angle, `Angle ${elevation}${side}`, 50 + Math.min(0, offset), Math.abs(offset));
    this.power.update(tank.power, `Power ${tank.power}`);
    const color = TEAM_RGB[Math.max(0, playerIndex) % TEAM_RGB.length];
    const spriteKey = `${tank.icon}:${tank.angle}:${color}`;
    if (spriteKey !== this.spriteKey) {
      this.spriteKey = spriteKey;
      this.surface.fill([0, 0, 0, 0]);
      draw_tank(this.surface, 24, 32, tank.icon, color, tank.angle, { scale: 2 });
    }
    this.surface.canvas.setAttribute("aria-label", `${tank.name}, tank design ${tank.icon + 1}, aiming ${elevation}${side}`);
  }
}
