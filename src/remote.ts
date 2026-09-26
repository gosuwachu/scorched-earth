/** Host-side controller adapter. Reuses the real screens and widget operations. */
import type { App } from "./main";
import type { GameState } from "./game";
import type { Player, ControllerView, Control, Input } from "../shared/online";
import * as pg from "./pygame";
import * as W from "./widgets";
import * as ingame from "./ingame";
import * as weapons from "./weapons";
import { HumanController } from "./ui";
import { ShopScreen, InventoryScreen, SellScreen } from "./screens";

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
  clear(): void { this.keys = {}; this.until = 0; }
  set(names: string[], now: number): void {
    this.keys = {};
    for (const name of names) if (keyCodes[name]) this.keys[keyCodes[name]] = true;
    this.until = now + 500;
  }
  get(now: number): Record<number, boolean> {
    if (now >= this.until) this.clear();
    return this.keys;
  }
}

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

  constructor(private app: App, private roster: Player[]) {}

  release(player?: string): void {
    if (!player || player === this.owner) { this.hold.clear(); this.names.clear(); }
    if (player) this.lastSeq.delete(player);
  }

  keys(now: number): Record<number, boolean> {
    const keys = this.hold.get(now);
    if (Object.keys(keys).length === 0) this.names.clear();
    return keys;
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
    // The phone's explicit target selector completes targeting. The canvas
    // keyboard router otherwise intercepts every key while guidance is armed,
    // even after a target is chosen; resume normal aim/fire keys on the phone.
    if (down && this.app.onlineScreen === "battle" && gs.current_shooter?.guidance_target &&
      !ingame.in_target_mode(gs as never) && !ingame.in_move_mode(gs as never) &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "Enter", "Tab", "BracketLeft", "KeyP", "KeyB", "Minus"].includes(name)) {
      HumanController.handle(gs as never, { type: pg.KEYDOWN, key: code });
      return;
    }
    this.app.handleRemote({ type: down ? pg.KEYDOWN : pg.KEYUP, key: code, mod: 0 });
  }

  receive(player: string, context: number, seq: number, input: Input, now = performance.now()): void {
    this.keys(now);
    this.refresh();
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

  private panelControls(panel: W.Panel): void {
    panel.widgets.forEach((widget, i) => {
      const id = `widget-${i}`;
      const label = W.plain(widget.label) || (widget instanceof W.Spinner ? W.plain(panel.widgets[i - 1]?.label ?? "Amount") : "");
      const base = { id, label, disabled: !widget.enabled };
      if (widget instanceof W.Label) {
        this.add({ ...base, kind: "label" });
      } else if (widget instanceof W.Button) {
        this.add({ ...base, kind: "button" }, () => this.app.handleRemote({
          type: pg.MOUSEBUTTONDOWN, pos: widget.rect.center, button: 1,
        }));
      } else if (widget instanceof W.Spinner) {
        this.add({ ...base, kind: "number", value: widget.get(), min: widget.lo, max: widget.hi, step: widget.step }, (v) => {
          if (typeof v === "number") widget.set(widget._clamp(Math.round(v / widget.step) * widget.step));
        });
      } else if (widget instanceof W.Selector) {
        this.add({ ...base, kind: "select", value: widget.get_idx(), options: widget.options }, (v) => {
          if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < widget.options.length) widget.set_idx(v);
        });
      } else if (widget instanceof W.Toggle) {
        this.add({ ...base, kind: "toggle", value: widget.get() }, (v) => { if (typeof v === "boolean") widget.set(v); });
      }
    });
  }

  refresh(): void {
    const gs = this.app.gs as unknown as GameState | null;
    const top = this.app.top;
    const kind = this.app.onlineScreen;
    const panel = top instanceof ingame.ControlPanelScreen ? (top.discharge_modal?.panel ?? top.panel) :
      top instanceof ingame.RetreatScreen ? top.confirm.panel : top.panel as W.Panel | undefined;
    const tank = top instanceof ShopScreen || top instanceof InventoryScreen || top instanceof SellScreen ||
      top instanceof ingame.ControlPanelScreen ? top.tank : gs?.current_shooter;
    const index = gs && tank ? gs.tanks.indexOf(tank as never) : -1;
    const owner = this.roster[index];
    this.owner = owner?.ai === 0 ? owner.id : undefined;
    this.enabled = !!this.owner && !!owner?.connected && !this.app.transitioning &&
      (kind === "player" || (kind === "battle" && gs?.phase === "aim"));
    const identity = [top, panel, gs?.plasma_charge, gs?.phase, gs?.current_shooter, this.owner, this.enabled];
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
        this.add({ id: "plasma-fire", label: "Fire Plasma", kind: "button" }, () => gs.confirm_plasma_charge());
        this.add({ id: "plasma-cancel", label: "Cancel", kind: "button" }, () => gs.cancel_plasma_charge());
        return;
      }
      for (const [id, label, key] of [
        ["inventory", "Inventory", "KeyI"], ["tank", "Tank controls", "KeyT"],
        ["move", "Move / stop moving", "KeyF"], ["retreat", "Retreat", "KeyR"],
      ]) this.add({ id, label, kind: "button" }, () => this.key(key, true));
      if (ingame.weapon_needs_target(gs as never) || ingame.in_target_mode(gs as never)) {
        this.add({ id: "target", label: "Choose target", kind: "select", value: gs.current_shooter?.guidance_target ?
          gs.tanks.findIndex((t) => t === gs.current_shooter?.guidance_target) : -1,
          options: gs.tanks.map((t) => t.name) }, (v) => {
          if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < gs.tanks.length) {
            ingame.enter_target_mode(gs as never);
            ingame.target_by_number(gs as never, v + 1);
          }
        });
      }
      return;
    }
    if (panel) this.panelControls(panel);
    if (top instanceof ShopScreen) {
      this.add({ id: "category", label: "Category", kind: "select", value: top.category, options: ["Weapons", "Miscellaneous"] }, (v) => {
        if (v === 0 || v === 1) top._category_click(v);
      });
      // Slot IDs are stable when purchasing removes unaffordable rows.
      for (const slot of top.items) {
        const item = weapons.ITEMS[slot];
        this.add({ id: `buy-${slot}`, kind: "button", disabled: !top._affordable(slot),
          label: `${slot === top._selected_slot() ? "▶ " : ""}${item.name} · $${top.econ.price[slot]} / ${item.bundle} · Owned ${top.tank.inventory[slot]}`,
        }, () => { top.sel_row = top.items.indexOf(slot); top._buy_selected(); });
      }
    } else if (top instanceof InventoryScreen) {
      this.add({ id: "weapon", label: "Weapon", kind: "select", value: top.weapon_slots.indexOf(top.tank.selected_weapon ?? -1),
        options: top.weapon_slots.map((slot) => `${weapons.ITEMS[slot].name} (${top._count_str(slot)})`),
      }, (v) => { if (typeof v === "number" && top.weapon_slots[v] !== undefined) top._select_weapon(top.weapon_slots[v]); });
      const guidance = [null, ...top.guidance_slots];
      this.add({ id: "guidance", label: "Guidance", kind: "select", value: guidance.indexOf(top.tank.selected_guidance ?? null),
        options: guidance.map((slot) => slot === null ? "None" : weapons.ITEMS[slot].name),
      }, (v) => { if (typeof v === "number" && v >= 0 && v < guidance.length && Number.isInteger(v)) top._select_guidance(guidance[v]); });
      for (let slot = 0; slot < weapons.ITEMS.length; slot++) {
        if (top.tank.inventory[slot] > 0) this.add({ id: `owned-${slot}`, kind: "label", label: `${weapons.ITEMS[slot].name}: ${top._count_str(slot)}` });
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
      screen === "battle" ? "Battle" : screen === "rankings" ? "Round results" : screen === "finished" ? "Final results" : "Host setup";
    const active = roster.find((p) => p.id === this.owner);
    const result: Record<string, ControllerView> = {};
    roster.forEach((p, i) => {
      if (p.ai !== 0) return;
      const t = gs?.tanks[i];
      const enabled = this.enabled && p.id === this.owner;
      const message = screen === "rankings" ? "Round complete. Waiting for the host to continue." :
        screen === "finished" ? "Match complete." : screen === "admin" ? "Waiting for the host." :
        enabled ? (title === "Purchasing" ? "Your shopping turn" : "Your turn") :
        active && !active.connected ? `Waiting for ${active.name} to reconnect.` :
        gs?.phase === "aim" || title === "Purchasing" ? `Waiting for ${active?.name ?? gs?.current_shooter?.name ?? "the host"}.` : "Shot in progress…";
      result[p.id] = {
        context: this.context, enabled, screen: title, message, round: (gs?.round_index ?? 0) + 1,
        tank: t ? { name: t.name, icon: t.tank_icon, health: t.health, cash: t.cash,
          angle: t.angle, power: t.power, weapon: weapons.ITEMS[t.selected_weapon]?.name ?? "",
          ammo: t.inventory[t.selected_weapon] } : undefined,
        controls: enabled ? this.controls : [],
      };
    });
    return result;
  }
}
