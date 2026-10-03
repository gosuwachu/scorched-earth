import type { ControllerView } from "../shared/online";
import { hudAngle } from "./angles";
import { button, el } from "./html/components";
import { meter, TankOverview } from "./controller_frame";
import { get_sprite, WEAPON_ICON_BASE, weapon_icon_palette } from "./sprites";
import { ITEMS } from "./weapons";

/** Presentation only: inputs and action availability still belong to the remote adapter. */
export class BattleControls {
  readonly element = el("section", "", "lan-battle");
  private keyTargets = new Map<string, HTMLElement>();
  readonly fire = el("div", "", "lan-battle-fire");
  readonly panel = el("div", "", "lan-battle-panel lan-controls");
  readonly more = el("details", "", "lan-battle-more");
  readonly extra = el("div", "", "lan-controls");
  readonly escape = el("div", "", "lan-battle-escape");
  readonly actions = el("div", "", "lan-battle-actions");
  private overview = new TankOverview();
  readonly move: HTMLButtonElement;
  private fuel = el("div", "", "lan-movement-status");
  private weapon = el("div", "", "lan-battle-weapon");
  private weaponIcon = el("span", "", "lan-battle-weapon-icon");
  private weaponName = "";
  private angle = meter("Angle", 180, "lan-angle");
  private power = meter("Power", 1000, "lan-power");

  constructor(toggleMovement: () => void) {
    this.element.setAttribute("aria-label", "Tank battle controls");
    this.element.hidden = true;
    this.move = button("Move", toggleMovement);
    this.move.setAttribute("aria-pressed", "false");
    this.move.setAttribute("aria-describedby", "lan-movement-status");
    this.fuel.id = "lan-movement-status";
    const movement = el("div", "", "lan-battle-movement");
    movement.append(this.move, this.fuel);
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
    const actions = this.actions;
    const secondary = el("div", "", "lan-battle-secondary");
    this.more.append(el("summary", "More actions"), this.extra);
    secondary.append(this.panel, this.more, this.escape);
    directions.append(movement);
    actions.append(weapons, aim, directions, this.fire, secondary);
    this.element.append(this.overview.element, actions);
    this.keyTargets.set("Space", this.fire);
    this.keyTargets.set("Escape", this.escape);
  }

  mountKey(code: string, button: HTMLButtonElement): void {
    this.keyTargets.get(code)?.append(button);
  }

  update(tank: NonNullable<ControllerView["tank"]>, playerIndex: number, round: number): void {
    const [elevation, side] = hudAngle(tank.angle);
    this.overview.update(tank, playerIndex, round);
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
    const offset = (90 - tank.angle) / 180 * 100;
    this.angle.update(tank.angle, `Angle ${elevation}${side}`, 50 + Math.min(0, offset), Math.abs(offset), `${elevation}° ${side}`);
    this.power.update(tank.power, `Power ${tank.power}`, 0, tank.power / 10, String(tank.power));
  }

  updateMovement(view: ControllerView, enabled: boolean): void {
    const movement = view.movement;
    this.move.textContent = movement?.active ? "Finish moving" : "Move";
    this.move.setAttribute("aria-pressed", String(!!movement?.active));
    this.move.disabled = !enabled || !movement || (!movement.active && !movement.available);
    const reason = !enabled ? "Waiting turn" : movement?.reason;
    this.fuel.textContent = movement ? `Fuel ${movement.fuel}${reason ? ` · ${reason}` : movement.active ? " · Movement mode" : ""}` : "Movement unavailable";
    this.element.classList.toggle("lan-moving", !!movement?.active);
  }
}
