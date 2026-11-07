import { describe, expect, it } from "vitest";
import { Config } from "../src/config";
import { createGameState, AIM, SIM_LIVE } from "../src/game";
import { sightLine, sightVisible } from "../src/laser_sight";
import { ITEMS, SLOT_LASER_SIGHT as SIGHT, DOS_NUM_ITEMS } from "../src/weapons";
import { apply, load, save, serialize, type SaveGameState } from "../src/savegame";
import { ShopScreen } from "../src/screens";

function game(mode = "SEQUENTIAL") {
  const cfg = new Config();
  Object.assign(cfg, { PLAY_MODE: mode, SOUND: "OFF", TALKING_TANKS: "OFF", INITIAL_CASH: 0,
    MAX_WIND: 0, FALLING_TANKS: "OFF" });
  const gs = createGameState(cfg, 320, 240, 17);
  gs.add_player("A", 0, 0, 0); gs.add_player("B", 0, 0, 1); gs.new_game();
  gs.terrain.grid.fill(0);
  gs.tanks.forEach((t, i) => { t.x = 40 + i * 220; t.y = 200; t.alive = true; });
  gs.phase = AIM; gs.current_shooter = gs.tanks[0];
  gs.tanks[0].inventory[SIGHT] = 10;
  return gs;
}

describe("Laser Sight browser equipment", () => {
  it("buys ten charges in Miscellaneous, respects cash and inventory cap", () => {
    const gs = game(), t = gs.tanks[0]; t.inventory[SIGHT] = 0; t.cash = 2500;
    const shop = Object.assign(Object.create(ShopScreen.prototype), {
      econ: gs.economy, tank: t, category: 1, sel_row: 0, scroll: 0, rows_visible: 8,
    }) as ShopScreen;
    shop._refresh_items(); expect(shop.items).toContain(SIGHT);
    expect(gs.economy.buy(t, SIGHT)).toBe(true);
    expect([t.cash, t.inventory[SIGHT]]).toEqual([0, 10]);
    expect(gs.economy.buy(t, SIGHT)).toBe(false);
    t.cash = 10000; t.inventory[SIGHT] = 95;
    gs.economy.buy(t, SIGHT); expect(t.inventory[SIGHT]).toBe(99);
    expect(gs.economy.buy(t, SIGHT)).toBe(false);
    shop.category = 0; shop._refresh_items(); expect(shop.items).not.toContain(SIGHT);
    expect(ITEMS[SIGHT].offensive).toBe(false);
  });

  it.each([0, 6, 7, 31, 32])("spends one charge for weapon %s, never goes negative", (slot) => {
    const gs = game(), t = gs.tanks[0];
    t.inventory[SIGHT] = 1; t.selected_weapon = slot; t.inventory[slot] = 2;
    gs.fire(); expect(t.inventory[SIGHT]).toBe(0);
    gs.fire(t); expect(t.inventory[SIGHT]).toBe(0);
  });

  it("does not spend a charge while selecting a plasma charge", () => {
    const gs = game(), t = gs.tanks[0]; t.inventory[31] = 1; t.inventory[39] = 2; t.selected_weapon = 31;
    expect(gs.fire()).toEqual([]); expect(t.inventory[SIGHT]).toBe(10);
  });

  it("synchronous locking waits until the volley to spend a charge", () => {
    const gs = game("SYNCHRONOUS"), t = gs.tanks[0];
    gs.fire(); expect(t.inventory[SIGHT]).toBe(10);
    gs._sync_launch_volley(); expect(t.inventory[SIGHT]).toBe(9);
  });

  it("simultaneous fire hides the sight and rejects a second shot in flight", () => {
    const gs = game("SIMULTANEOUS"), t = gs.tanks[0]; gs.phase = SIM_LIVE;
    expect(sightVisible(gs, t)).toBe(true);
    gs.sim_fire(t); expect(t.inventory[SIGHT]).toBe(9);
    expect(sightVisible(gs, t)).toBe(false);
    gs.sim_fire(t); expect(t.inventory[SIGHT]).toBe(9);
    gs.projectiles = []; expect(sightVisible(gs, t)).toBe(true);
  });

  it("only shows for a living human aiming with charges", () => {
    const gs = game(), t = gs.tanks[0];
    expect(sightVisible(gs, t)).toBe(true);
    gs.current_shooter = gs.tanks[1]; expect(sightVisible(gs, t)).toBe(false);
    gs.current_shooter = t;
    t.inventory[SIGHT] = 0; expect(sightVisible(gs, t)).toBe(false);
    t.inventory[SIGHT] = 1; t.alive = false; expect(sightVisible(gs, t)).toBe(false);
    t.alive = true; t.ai_class = 1; expect(sightVisible(gs, t)).toBe(false);
  });

  it.each([0, 17, 45, 90, 135, 163, 180])("extends the barrel 100 pixels at %s degrees", (angle) => {
    const line = sightLine({ x: 50, y: 80, tank_icon: 3, angle });
    const dx = Math.cos(angle * Math.PI / 180), dy = -Math.sin(angle * Math.PI / 180);
    expect(line.x1).toBeCloseTo(48.5 + Math.round(dx * 8));
    expect(line.y1).toBeCloseTo(75.5 - Math.round(-dy * 8));
    expect(line.x2 - line.x1).toBeCloseTo(dx * 100);
    expect(line.y2 - line.y1).toBeCloseTo(dy * 100);
  });

  it("preserves charges through saving and later rounds, migrates original saves", () => {
    const gs = game();
    const host = { ...gs, terrain: { grid: { w: gs.w, h: gs.h, data: gs.terrain.grid } } } as unknown as SaveGameState;
    const saved = load(save(host)); gs.tanks[0].inventory[SIGHT] = 0; apply(saved, host);
    expect(gs.tanks[0].inventory[SIGHT]).toBe(10);
    gs.start_round(); expect(gs.tanks[0].inventory[SIGHT]).toBe(10);
    const old = serialize(host);
    old.tanks.forEach((t) => { t.inventory = t.inventory.slice(0, DOS_NUM_ITEMS); });
    for (const key of ["price", "demand_tally", "nobuy", "demand_ema", "ratio_ema", "available"] as const) {
      old.economy[key].length = DOS_NUM_ITEMS;
    }
    apply(old, host);
    expect(gs.tanks[0].inventory[SIGHT]).toBe(0);
    expect(gs.economy.price[SIGHT]).toBe(2500);
    gs.tanks[0].cash = 2500;
    expect(gs.economy.buy(gs.tanks[0], SIGHT)).toBe(true);
    expect(gs.tanks[0].inventory[SIGHT]).toBe(10);
  });
});
