import type { ControllerView } from "../shared/online";
import { hudAngle } from "./angles";
import { TANK_DEFAULT_HEALTH } from "./constants";
import { el } from "./html/components";
import { TEAM_RGB } from "./palette";
import { Surface, SRCALPHA } from "./pygame";
import { draw_tank, get_sprite, WEAPON_ICON_BASE, weapon_icon_palette } from "./sprites";
import { ITEMS } from "./weapons";

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
    update(amount: number, text: string, left = 0, width = amount / max * 100, display = text): void {
      node.setAttribute("aria-valuenow", String(Math.max(0, Math.min(max, amount))));
      node.setAttribute("aria-valuetext", text);
      value.textContent = display;
      fill.style.left = `${left}%`;
      fill.style.width = `${Math.max(0, Math.min(100, width))}%`;
    },
  };
}

/** Presentation only: inputs and action availability still belong to the remote adapter. */
export class BattleControls {
  readonly element = el("section", "", "lan-battle");
  private keyTargets = new Map<string, HTMLElement>();
  readonly fire = el("div", "", "lan-battle-fire");
  readonly panel = el("div", "", "lan-battle-panel lan-controls");
  readonly more = el("details", "", "lan-battle-more");
  readonly extra = el("div", "", "lan-controls");
  readonly escape = el("div", "", "lan-battle-escape");
  private name = el("h2", "", "lan-battle-name");
  private cash = el("div");
  private weapon = el("div", "", "lan-battle-weapon");
  private weaponIcon = el("span", "", "lan-battle-weapon-icon");
  private weaponName = "";
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
    info.append(this.name, this.cash, this.round);
    overview.append(preview, info);
    const weapons = el("div", "", "lan-battle-weapons");
    weapons.setAttribute("role", "group");
    weapons.setAttribute("aria-label", "Weapon selection");
    const previous = el("div"), next = el("div");
    const equipped = el("div", "", "lan-battle-equipped");
    const weaponLine = el("div", "", "lan-battle-weapon-line");
    this.weaponIcon.setAttribute("aria-hidden", "true");
    this.weaponIcon.hidden = true;
    weaponLine.append(this.weaponIcon, this.weapon);
    equipped.append(el("div", "Weapon", "lan-battle-label"), weaponLine);
    weapons.append(previous, equipped, next);
    this.keyTargets.set("BracketLeft", previous);
    this.keyTargets.set("Tab", next);
    const aim = el("div", "", "lan-battle-aim");
    for (const [label, readout] of [
      ["Angle", this.angle.node],
      ["Power", this.power.node],
    ] as const) {
      const group = el("div", "", "lan-aim-group");
      group.append(el("div", label, "lan-battle-label"), readout);
      aim.append(group);
    }
    const directions = el("div", "", "lan-battle-directions");
    directions.setAttribute("role", "group");
    directions.setAttribute("aria-label", "Aiming controls");
    for (const [code, direction] of [
      ["ArrowUp", "up"], ["ArrowLeft", "left"], ["ArrowDown", "down"], ["ArrowRight", "right"],
    ]) {
      const slot = el("div", "", `lan-aim-${direction}`);
      this.keyTargets.set(code, slot);
      directions.append(slot);
    }
    const actions = el("div", "", "lan-battle-actions");
    const secondary = el("div", "", "lan-battle-secondary");
    this.more.append(el("summary", "More actions"), this.extra);
    secondary.append(this.panel, this.more, this.escape);
    actions.append(weapons, aim, directions, this.fire, secondary);
    this.element.append(overview, actions);
    this.keyTargets.set("Space", this.fire);
    this.keyTargets.set("Escape", this.escape);
  }

  mountKey(code: string, button: HTMLButtonElement): void {
    this.keyTargets.get(code)?.append(button);
  }

  update(tank: NonNullable<ControllerView["tank"]>, playerIndex: number, round: number): void {
    const [elevation, side] = hudAngle(tank.angle);
    this.name.textContent = tank.name;
    this.cash.textContent = `Cash $${tank.cash}`;
    this.weapon.textContent = `${tank.weapon} (${tank.ammo})`;
    if (tank.weapon !== this.weaponName) {
      this.weaponName = tank.weapon;
      // The host sends the catalogue name; resolve the same local icon used by
      // purchasing, without changing the controller protocol.
      const item = ITEMS.find((item) => item.name === tank.weapon);
      const sprite = item ? get_sprite("A", item.idx, { color: WEAPON_ICON_BASE, pal: weapon_icon_palette(), scale: 2 }) : null;
      this.weaponIcon.replaceChildren(...(sprite ? [sprite.canvas] : []));
      this.weaponIcon.hidden = !sprite;
    }
    this.round.textContent = `Round ${round}`;
    this.health.update(tank.health, `Health ${tank.health}/${TANK_DEFAULT_HEALTH}`);
    const offset = (90 - tank.angle) / 180 * 100;
    this.angle.update(tank.angle, `Angle ${elevation}${side}`, 50 + Math.min(0, offset), Math.abs(offset), `${elevation}° ${side}`);
    this.power.update(tank.power, `Power ${tank.power}`, 0, tank.power / 10, String(tank.power));
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
