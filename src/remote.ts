/** Host-side controller adapter. Reuses the real screens and widget operations. */
import { clampPower } from "./power";
import type { App } from "./main";
import type { GameState } from "./game";
import type { Tank } from "./objects";
import type { Player, ControllerView, Control, Input } from "../shared/online";
import * as pg from "./pygame";
import * as W from "./widgets";
import * as ingame from "./ingame";
import * as weapons from "./weapons";
import * as movement from "./movement";
import { TANK_DEFAULT_HEALTH } from "./constants";
import * as targeting from "./targeting";
import { ShopScreen, InventoryScreen, SellScreen } from "./screens";
import { RemoteAimRepeat, RemoteTargetRepeat } from "./remote_aim";
import { sfx } from "./sound";

const keyCodes: Record<string, number> = {
  ArrowLeft: pg.K_LEFT, ArrowRight: pg.K_RIGHT, ArrowUp: pg.K_UP, ArrowDown: pg.K_DOWN,
  Space: pg.K_SPACE, Enter: pg.K_RETURN, Tab: pg.K_TAB, BracketLeft: pg.K_LEFTBRACKET,
  Escape: pg.K_ESCAPE, KeyI: pg.K_i, KeyT: pg.K_t, KeyF: pg.K_f, KeyR: pg.K_r,
  KeyP: pg.K_p, KeyB: pg.K_b, Minus: pg.K_MINUS,
};
for (let n = 0; n <= 9; n++) keyCodes[`Digit${n}`] = pg.K_0 + n;

/** Expiring held keys are separate from the host's keyboard and mouse. */
export class RemoteHold {
  keys: Record<number, boolean> = {};
  private until = 0;
  private aim = new RemoteAimRepeat();
  private target = new RemoteTargetRepeat();
  clear(): void { this.keys = {}; this.until = 0; this.aim.clear(); this.target.clear(); }
  set(names: string[], now: number): void {
    this.get(now);
    this.keys = {};
    for (const name of names) if (keyCodes[name]) this.keys[keyCodes[name]] = true;
    this.aim.set(Number(!!this.keys[pg.K_LEFT]) - Number(!!this.keys[pg.K_RIGHT]),
      Number(!!this.keys[pg.K_UP]) - Number(!!this.keys[pg.K_DOWN]), now);
    this.target.set(Number(!!this.keys[pg.K_RIGHT]) - Number(!!this.keys[pg.K_LEFT]),
      Number(!!this.keys[pg.K_DOWN]) - Number(!!this.keys[pg.K_UP]), now);
    this.until = now + 500;
  }
  get(now: number): Record<number, boolean> {
    if (now >= this.until) this.clear();
    return this.keys;
  }
  repeat(now: number): { angle: number; power: number } {
    this.get(now);
    return this.aim.take(now);
  }
  repeatTarget(now: number): { x: number; y: number } {
    this.get(now);
    return this.target.take(now);
  }
}

interface SimController {
  gs: GameState;
  tank: Tank;
  context: number;
  identity: unknown[];
  enabled: boolean;
  hold: RemoteHold;
  names: Set<string>;
  lastSeq: number;
}

const simKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "Enter", "Tab", "BracketLeft"];

export class RemoteAdapter {
  readonly hold = new RemoteHold();
  private context = 0;
  private identity: unknown[] = [];
  private controls: Control[] = [];
  private actions = new Map<string, (value?: number | boolean) => void>();
  private owner: string | undefined;
  private enabled = false;
  private lastSeq = new Map<string, number>();
  private names = new Set<string>();
  private simultaneous = new Map<string, SimController>();
  private menuPaused = false;
  private movementTank?: Tank;

  constructor(private app: App, private roster: Player[]) {}

  release(player?: string, preserveCharge = this.app.onlineMenuOpen): void {
    if (!player || player === this.owner) { this.hold.clear(); this.names.clear(); }
    if (player) this.lastSeq.delete(player);
    for (const [id, controller] of this.simultaneous) {
      if (player && id !== player) continue;
      controller.hold.clear(); controller.names.clear(); controller.lastSeq = -1;
      controller.context = ++this.context;
      if (!preserveCharge) controller.gs.sim_release(controller.tank);
    }
  }

  updateAim(now: number): void {
    this.refresh();
    for (const c of this.simultaneous.values()) {
      const keys = c.hold.get(now);
      if (!Object.keys(keys).length) c.names.clear();
      if (!c.enabled) continue;
      const delta = c.hold.repeat(now);
      c.gs.sim_adjust(c.tank, delta.angle, delta.power);
    }
    const gs = this.app.gs as unknown as GameState | null;
    if (!this.enabled || this.app.onlineScreen !== "battle" || gs?.phase !== "aim" ||
        gs.plasma_charge || !gs.current_shooter) return;
    this.keys(now);
    if (gs.pendingTarget) {
      const delta = this.hold.repeatTarget(now);
      this.moveTarget(gs, delta.x, delta.y);
      return;
    }
    const delta = this.hold.repeat(now);
    const tank = gs.current_shooter;
    const beforeAngle = tank.angle, beforePower = tank.power;
    tank.angle = Math.max(0, Math.min(180, tank.angle + (gs.move_mode ? 0 : delta.angle)));
    tank.power = clampPower(tank.health, tank.power + delta.power);
    sfx.adjustment("angle", beforeAngle, tank.angle, gs.cfg.is_on("SOUND"));
    sfx.adjustment("power", beforePower, tank.power, gs.cfg.is_on("SOUND"));
  }

  private refreshSimultaneous(gs: GameState): void {
    this.roster.forEach((p, i) => {
      if (p.ai !== 0) return;
      const tank = gs.tanks[i];
      if (!tank) return;
      let c = this.simultaneous.get(p.id);
      if (!c || c.gs !== gs || c.tank !== tank) {
        c?.gs.sim_release(c.tank);
        c = { gs, tank, context: 0, identity: [], enabled: false, hold: new RemoteHold(), names: new Set(), lastSeq: -1 };
        this.simultaneous.set(p.id, c);
      }
      c.enabled = p.connected && tank.alive && tank.ai_class === 0 && !this.app.transitioning;
      if (!p.connected || !tank.alive || tank.ai_class !== 0) gs.sim_release(tank);
      const identity = [gs, this.app.top, gs.round_index, c.enabled, gs.sim_charges.get(tank)];
      if (identity.some((v, j) => v !== c.identity[j])) {
        c.identity = identity;
        c.context = ++this.context;
        c.hold.clear(); c.names.clear();
      }
    });
  }

  private receiveSimultaneous(c: SimController, context: number, seq: number, input: Input, now: number): void {
    if (!c.enabled || context !== c.context || seq <= c.lastSeq) return;
    c.lastSeq = seq;
    if (!Object.keys(c.hold.get(now)).length) c.names.clear();
    const { gs, tank } = c;
    const charge = gs.sim_charges.get(tank);
    if (charge) {
      if (input.kind === "control") {
        if (input.id === "plasma-charge" && typeof input.value === "number") gs.sim_set_plasma_charge(tank, input.value);
        else if (input.id === "plasma-fire") gs.sim_confirm_plasma_charge(tank);
        else if (input.id === "plasma-cancel") gs.sim_release(tank);
      } else if (input.kind === "key" && input.down) {
        if (input.key === "Escape") gs.sim_release(tank);
        else if (input.key === "Space" || input.key === "Enter") gs.sim_confirm_plasma_charge(tank);
      }
    } else if (input.kind === "hold") {
      c.names = new Set(input.keys.filter((key) => c.names.has(key)));
      c.hold.set([...c.names], now);
    } else if (input.kind === "key" && simKeys.includes(input.key)) {
      if (input.down) {
        if (c.names.has(input.key)) return;
        c.names.add(input.key);
      } else c.names.delete(input.key);
      c.hold.set([...c.names], now);
      if (input.down) {
        if (input.key === "Space" || input.key === "Enter") gs.sim_fire(tank);
        else if (input.key === "Tab") gs.sim_cycle_weapon(tank, 1);
        else if (input.key === "BracketLeft") gs.sim_cycle_weapon(tank, -1);
        else gs.sim_adjust(tank, Number(input.key === "ArrowLeft") - Number(input.key === "ArrowRight"),
          Number(input.key === "ArrowUp") - Number(input.key === "ArrowDown"));
      }
    }
    this.refresh();
  }

  keys(now: number): Record<number, boolean> {
    const keys = this.hold.get(now);
    if (Object.keys(keys).length === 0) this.names.clear();
    return keys;
  }

  private moveTarget(gs: GameState, dx: number, dy: number): void {
    const pending = gs.pendingTarget;
    if (!pending || (!dx && !dy)) return;
    const [x, y] = pending.point ?? [Math.floor(gs.w / 2), Math.floor(gs.h / 2)];
    const nextX = Math.max(0, Math.min(gs.w - 1, x + dx));
    const nextY = Math.max(0, Math.min(gs.h - 2, y + dy));
    // A blocked nudge must not detach a selected tank at the field edge.
    if (!pending.point || x !== nextX || y !== nextY) targeting.setPoint(gs, nextX, nextY);
  }

  private key(name: string, down: boolean): void {
    const code = keyCodes[name];
    if (!code) return;
    const gs = this.app.gs as unknown as GameState;
    if (gs?.plasma_charge) {
      this.app.handleRemote({ type: down ? pg.KEYDOWN : pg.KEYUP, key: code, mod: 0 });
      return;
    }
    // Remote Escape must never open the host's system menu.
    if (this.app.onlineScreen === "battle" && name === "Escape") {
      if (down) {
        this.app._act(ingame.handle_game_event(gs as never, { type: pg.KEYDOWN, key: code }));
      }
      return;
    }
    if (gs?.pendingTarget) {
      if (down && name.startsWith("Digit")) {
        const n = name === "Digit0" ? 10 : Number(name.slice(5));
        const t = targeting.tanks(gs)[n - 1];
        if (t) { this.release(); targeting.selectTank(gs, t); }
      } else if (down) {
        this.moveTarget(gs, Number(name === "ArrowRight") - Number(name === "ArrowLeft"),
          Number(name === "ArrowDown") - Number(name === "ArrowUp"));
      }
      return;
    }
    this.app.handleRemote({ type: down ? pg.KEYDOWN : pg.KEYUP, key: code, mod: 0 });
  }

  receive(player: string, context: number, seq: number, input: Input, now = performance.now()): void {
    this.keys(now);
    this.refresh();
    if (this.menuPaused) return;
    const controller = this.simultaneous.get(player);
    if (controller) {
      this.receiveSimultaneous(controller, context, seq, input, now);
      return;
    }
    if (!this.enabled || player !== this.owner || context !== this.context || seq <= (this.lastSeq.get(player) ?? -1)) return;
    this.lastSeq.set(player, seq);
    if (input.kind === "hold") {
      // Heartbeats renew existing presses; they never synthesize new keydowns.
      this.names = new Set(input.keys.filter((key) => this.names.has(key)));
      this.hold.set([...this.names], now);
    } else if (input.kind === "key") {
      if (input.down) {
        if (this.names.has(input.key)) return;
        this.names.add(input.key);
      } else this.names.delete(input.key);
      this.hold.set([...this.names], now);
      this.key(input.key, input.down);
    } else {
      this.actions.get(input.id)?.(input.value);
    }
    this.refresh();
  }

  private add(control: Control, action?: (value?: number | boolean) => void): void {
    this.controls.push(control);
    if (action && !control.disabled) this.actions.set(control.id, action);
  }

  private panelControls(panel: W.Panel, tankControls?: ingame.ControlPanelScreen): void {
    panel.widgets.forEach((widget, i) => {
      const id = `widget-${i}`;
      const label = W.plain(widget.label) || (widget instanceof W.Spinner ? W.plain(panel.widgets[i - 1]?.label ?? "Amount") : "");
      const section = tankControls?.controlSections.get(widget);
      if (section === "Power and energy") return;
      const footer = widget instanceof W.Button && !section;
      const base = { id, label, disabled: !widget.enabled,
        presentation: { section, footer, primary: footer && widget instanceof W.Button && widget.default } };
      if (widget instanceof W.Label) {
        this.add({ ...base, kind: "label" });
      } else if (widget instanceof W.Button) {
        if (tankControls && widget.action === "discharge") {
          const tank = tankControls.tank;
          this.add({ ...base, kind: "button",
            label: `Discharge battery (+10 health) · ${tank.inventory[weapons.SLOT_BATTERY]} left`,
            disabled: base.disabled || tank.inventory[weapons.SLOT_BATTERY] <= 0 || tank.health >= TANK_DEFAULT_HEALTH,
          }, () => this.app.dispatchAction("discharge_one"));
        } else this.add({ ...base, kind: "button" }, () => this.app.dispatchAction(widget.action));
      } else if (widget instanceof W.Spinner) {
        this.add({ ...base, kind: "number", value: widget.get(), min: widget.lo, max: widget.hi, step: widget.step }, (v) => {
          if (typeof v === "number") widget.set(widget._clamp(Math.round(v / widget.step) * widget.step));
        });
      } else if (widget instanceof W.Selector) {
        this.add({ ...base, kind: "select", value: widget.get_idx(), options: widget.options,
          optionSlots: tankControls?.selectorSlots(widget) }, (v) => {
          if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < widget.options.length) widget.set_idx(v);
        });
      } else if (widget instanceof W.Toggle) {
        this.add({ ...base, kind: "toggle", value: widget.get() }, (v) => { if (typeof v === "boolean") widget.set(v); });
      }
    });
  }

  refresh(): void {
    const menuPaused = !!this.app.onlineMenuOpen;
    if (menuPaused !== this.menuPaused) {
      this.menuPaused = menuPaused;
      this.context++;
      this.release(undefined, true);
      this.identity = [];
      for (const c of this.simultaneous.values()) c.identity = [];
    }
    if (menuPaused) {
      this.enabled = false;
      for (const c of this.simultaneous.values()) c.enabled = false;
      return;
    }
    const gs = this.app.gs as unknown as GameState | null;
    const top = this.app.top;
    const kind = this.app.onlineScreen;
    if (gs?.phase === "sim_live" && kind === "battle") {
      this.hold.clear(); this.names.clear();
      this.enabled = false; this.owner = undefined;
      this.refreshSimultaneous(gs);
      return;
    }
    if (this.simultaneous.size) {
      for (const c of this.simultaneous.values()) c.gs.sim_release(c.tank);
      this.simultaneous.clear();
    }
    const panel = top instanceof ingame.ControlPanelScreen ? (top.discharge_modal?.panel ?? top.panel) :
      top instanceof ingame.RetreatScreen ? top.confirm.panel : top.panel as W.Panel | undefined;
    const tank = top instanceof ShopScreen || top instanceof InventoryScreen || top instanceof SellScreen ||
      top instanceof ingame.ControlPanelScreen ? top.tank : gs?.current_shooter;
    const index = gs && tank ? gs.tanks.indexOf(tank as never) : -1;
    const owner = this.roster[index];
    this.owner = owner?.ai === 0 ? owner.id : undefined;
    this.enabled = !!this.owner && !!owner?.connected && !this.app.transitioning &&
      (kind === "player" || (kind === "battle" && gs?.phase === "aim"));
    // A move strip belongs to one shooter; never let it leak into another turn.
    if (gs && this.movementTank && (this.movementTank !== gs.current_shooter || gs.phase !== "aim")) gs.move_mode = false;
    this.movementTank = gs?.move_mode ? gs.current_shooter ?? undefined : undefined;
    const identity = [gs?.move_mode, top, panel, gs?.pendingTarget, gs?.plasma_charge, gs?.phase, gs?.current_shooter, this.owner, this.enabled];
    if (identity.some((v, i) => v !== this.identity[i])) {
      this.identity = identity;
      this.context++;
      this.release();
    }
    this.controls = [];
    this.actions.clear();
    if (!gs || !this.enabled) return;
    if (kind === "battle") {
      if (gs.plasma_charge) {
        const charge = gs.plasma_charge;
        this.add({ id: "plasma-charge", label: "Batteries for Plasma", kind: "number", value: charge.value,
          min: 0, max: charge.max, step: 1 }, (v) => { if (typeof v === "number") gs.set_plasma_charge(v); });
        this.add({ id: "plasma-fire", label: "Fire Plasma", kind: "button", presentation: { footer: true, primary: true } }, () => gs.confirm_plasma_charge());
        this.add({ id: "plasma-cancel", label: "Cancel", kind: "button", presentation: { footer: true } }, () => gs.cancel_plasma_charge());
        return;
      }
      if (gs.pendingTarget) {
        const p = gs.pendingTarget;
        this.add({ id: "target-instructions", kind: "label", label: "Choose a tank or use the arrows to position the target. Confirm to fire." });
        for (const [i, tank] of targeting.tanks(gs).entries()) {
          this.add({ id: `target-tank-${tank.player_index}`, kind: "button", label: `${i + 1}: ${tank.name}` },
            () => { this.release(); targeting.selectTank(gs, tank); });
        }
        for (const [axis, label, max, value] of [[0, "Target X", gs.w - 1, p.point?.[0] ?? Math.floor(gs.w / 2)],
          [1, "Target Y", gs.h - 2, p.point?.[1] ?? Math.floor(gs.h / 2)]] as const) {
          this.add({ id: `target-${axis}`, kind: "readout", label, min: 0, max, value });
        }
        this.add({ id: "target-fire", kind: "button", label: "Fire at target", presentation: { footer: true, primary: true }, disabled: !p.point }, () => targeting.confirm(gs));
        this.add({ id: "target-cancel", kind: "button", label: "Cancel targeting", presentation: { footer: true } }, () => targeting.cancel(gs));
        return;
      }
      for (const [id, label, key] of [
        ["inventory", "Inventory", "KeyI"], ["tank", "Tank controls", "KeyT"],
        ["retreat", "Retreat", "KeyR"],
      ]) this.add({ id, label, kind: "button" }, () => this.key(key, true));
      this.add({ id: "move", label: gs.move_mode ? "Finish moving" : "Move", kind: "button",
        disabled: !gs.move_mode && !movement.can_move(gs.current_shooter!) }, () => this.key("KeyF", true));
      return;
    }
    if (panel && !(top instanceof ShopScreen)) this.panelControls(panel,
      top instanceof ingame.ControlPanelScreen && !top.discharge_modal ? top : undefined);
    if (top instanceof ShopScreen) {
      this.add({ id: "inventory", label: "Inventory", kind: "button" }, () => this.app.dispatchAction("inventory"));
      this.add({ id: "done", label: "Done", kind: "button" }, () => this.app.dispatchAction("pop"));
      this.add({ id: "category", label: "Category", kind: "select", value: top.category, options: ["Weapons", "Miscellaneous"] }, (v) => {
        if (v === 0 || v === 1) top._category_click(v);
      });
      // Slot IDs are stable when purchasing removes unaffordable rows.
      for (const slot of top.items) {
        const item = weapons.ITEMS[slot];
        this.add({ id: `buy-${slot}`, kind: "button", disabled: !top._affordable(slot),
          label: `${slot === top._selected_slot() ? "▶ " : ""}${item.name} · $${top.econ.price[slot]} / ${item.bundle} · Owned ${top.tank.inventory[slot]}`,
          purchase: { slot, name: item.name, owned: top.tank.inventory[slot], price: top.econ.price[slot],
            bundle: item.bundle, selected: slot === top._selected_slot() },
        }, () => { top.sel_row = top.items.indexOf(slot); top._buy_selected(); });
      }
    } else if (top instanceof InventoryScreen) {
      this.add({ id: "weapon", label: "Weapon", kind: "select", presentation: { section: "Loadout" }, value: top.weapon_slots.indexOf(top.tank.selected_weapon ?? -1),
        options: top.weapon_slots.map((slot) => `${weapons.ITEMS[slot].name} (${top._count_str(slot)})`),
      }, (v) => { if (typeof v === "number" && top.weapon_slots[v] !== undefined) top._select_weapon(top.weapon_slots[v]); });
      const guidance = [null, ...top.guidance_slots];
      this.add({ id: "guidance", label: "Guidance", kind: "select", presentation: { section: "Loadout" }, value: guidance.indexOf(top.tank.selected_guidance ?? null),
        options: guidance.map((slot) => slot === null ? "None" : weapons.ITEMS[slot].name),
      }, (v) => { if (typeof v === "number" && v >= 0 && v < guidance.length && Number.isInteger(v)) top._select_guidance(guidance[v]); });
      for (let slot = 0; slot < weapons.ITEMS.length; slot++) {
        if (top.tank.inventory[slot] > 0) this.add({ id: `owned-${slot}`, kind: "label", presentation: { section: "Owned equipment" }, label: `${weapons.ITEMS[slot].name}: ${top._count_str(slot)}` });
      }
    }
  }

  states(roster: Player[]): Record<string, ControllerView> {
    this.roster = roster;
    this.refresh();
    const gs = this.app.gs as unknown as GameState | null;
    const screen = this.app.onlineScreen;
    const top = this.app.top;
    const title = top instanceof ShopScreen ? "Purchasing" : top instanceof InventoryScreen ? "Inventory" :
      top instanceof ingame.ControlPanelScreen ? "Tank controls" : top instanceof ingame.RetreatScreen ? "Retreat" :
      screen === "battle" ? (gs?.pendingTarget ? "Choose Target" : "Battle") : screen === "rankings" ? "Round results" : screen === "finished" ? "Final results" : "Host setup";
    const active = roster.find((p) => p.id === this.owner);
    const result: Record<string, ControllerView> = {};
    roster.forEach((p, i) => {
      if (p.ai !== 0) return;
      const t = gs?.tanks[i];
      const sim = this.simultaneous.get(p.id);
      if (sim) {
        const charge = gs!.sim_charges.get(sim.tank);
        result[p.id] = {
          movement: { fuel: movement.fuel_units(sim.tank), active: false, available: false, reason: "Unavailable in simultaneous play" },
          context: sim.context, enabled: sim.enabled, screen: "Battle", round: gs!.round_index + 1,
          message: !sim.tank.alive ? "Your tank was destroyed. Watching the battle." :
            charge ? "Choose batteries for Plasma. The battle continues." : "Simultaneous battle — control your tank",
          keys: charge ? ["Space", "Enter", "Escape"] : simKeys,
          tank: { name: sim.tank.name, icon: sim.tank.tank_icon, health: sim.tank.health, cash: sim.tank.cash,
            shield: sim.tank.shield_hp > 0 ? { name: weapons.ITEMS[sim.tank.shield_item].name, percent: ingame._shield_pct(sim.tank) } : undefined,
            angle: sim.tank.angle, power: sim.tank.power, weapon: weapons.ITEMS[sim.tank.selected_weapon]?.name ?? "",
            ammo: sim.tank.inventory[sim.tank.selected_weapon] },
          controls: sim.enabled && charge ? [
            { id: "plasma-charge", label: "Batteries for Plasma", kind: "number", value: charge.value, min: 0, max: charge.max, step: 1 },
            { id: "plasma-fire", label: "Fire Plasma", kind: "button", presentation: { footer: true, primary: true } },
            { id: "plasma-cancel", label: "Cancel", kind: "button", presentation: { footer: true } },
          ] : [],
        };
        return;
      }
      const enabled = this.enabled && p.id === this.owner;
      const message = screen === "rankings" ? "Round complete. Waiting for the host to continue." :
        screen === "finished" ? "Match complete." : screen === "admin" ? "Waiting for the host." :
        enabled ? (gs?.pendingTarget ? `Choose Target — ${weapons.ITEMS[gs.pendingTarget.guidance].name}` : title === "Purchasing" ? "Your shopping turn" : "Your turn") :
        active && !active.connected ? `Waiting for ${active.name} to reconnect.` :
        gs?.phase === "aim" || title === "Purchasing" ? `Waiting for ${active?.name ?? gs?.current_shooter?.name ?? "the host"}.` : "Shot in progress…";
      result[p.id] = {
        batteryPrompt: top instanceof ingame.ControlPanelScreen && !!top.discharge_modal,
        movement: t ? { fuel: movement.fuel_units(t), active: enabled && !!gs?.move_mode && gs.current_shooter === t,
          available: enabled && t.alive && movement.can_move(t),
          reason: !enabled ? "Waiting turn" : !t.mobile ? "Immobile tank" : !movement.can_move(t) ? "No fuel" : undefined } : undefined,
        context: this.context, enabled, targeting: !!gs?.pendingTarget, screen: title, message, round: (gs?.round_index ?? 0) + 1,
        tank: t ? { name: t.name, icon: t.tank_icon, health: t.health, cash: t.cash,
          shield: t.shield_hp > 0 ? { name: weapons.ITEMS[t.shield_item].name, percent: ingame._shield_pct(t) } : undefined,
          angle: t.angle, power: t.power, weapon: weapons.ITEMS[t.selected_weapon]?.name ?? "",
          ammo: t.inventory[t.selected_weapon] } : undefined,
        controls: enabled ? this.controls : [],
      };
    });
    if (this.menuPaused) for (const state of Object.values(result)) {
      state.enabled = false;
      state.message = "Paused by host.";
      state.controls = [];
      state.keys = [];
    }
    return result;
  }
}
