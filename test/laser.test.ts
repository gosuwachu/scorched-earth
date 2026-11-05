import { describe, expect, it } from "vitest";
import { Config } from "../src/config";
import { AIM, createGameState } from "../src/game";
import { Projectile } from "../src/objects";
import { ITEMS } from "../src/weapons";
import { COL_DIRT } from "../src/constants";
import * as wb from "../src/weapon_behaviors";

function game(w = 1024) {
  const cfg = new Config();
  Object.assign(cfg, { SOUND: "OFF", TALKING_TANKS: "OFF", INITIAL_CASH: 0,
    MAX_WIND: 0, FALLING_TANKS: "OFF", ELASTIC: "NONE" });
  cfg.live_elastic = cfg.elastic;
  const gs = createGameState(cfg, w, 240, 42);
  gs.add_player("A", 0, 0, 0); gs.add_player("B", 0, 0, 1); gs.new_game();
  gs.terrain.grid.fill(0);
  gs.tanks.forEach((t, i) => {
    t.x = i ? w - 74 : 30; t.y = 160; t.health = 100; t.alive = true;
    t.inventory.fill(0); t.shield_hp = 0; t.shield_laserproof = false;
  });
  gs.current_shooter = gs.tanks[0]; gs.phase = AIM;
  return gs;
}

function beam(gs: ReturnType<typeof game>, energy = 2000, x = 100, vx = 1) {
  const p = new Projectile(gs.tanks[0], ITEMS[32], x, 100, vx, 0);
  p.state.energy = energy;
  wb.fire_laser(gs as unknown as wb.BState, p as unknown as wb.BProjectile);
  return p;
}

// Intentional browser balance expectations, not DOS runtime fixtures.
describe("Laser extended range", () => {
  it.each([[100, 134], [200, 134], [500, 334], [1000, 667]])(
    "fires at power %i with %i open-air beam samples", (power, samples) => {
      const gs = game(1280), t = gs.tanks[0];
      t.angle = 0; t.power = power; t.selected_weapon = 32; t.inventory[32] = 2;
      const [p] = gs.fire(t);
      const trail = p.trail as Array<[number, number]>;
      expect(trail).toHaveLength(samples);
      expect(trail.at(-1)![0] - trail[0][0]).toBe(samples - 1);
      expect(p.active).toBe(false);
      expect(t.inventory[32]).toBe(1);
      expect(t.batteries).toBe(0);
      expect(t.health).toBe(100);
    },
  );

  it("charges 15 extra energy for dirt while retaining the radius-three cut", () => {
    const gs = game();
    gs.terrain.write(100, 100, COL_DIRT);
    gs.terrain.write(100, 102, COL_DIRT);
    gs.terrain.write(100, 104, COL_DIRT);
    const p = beam(gs);
    // 2000 - 15 leaves 1985: 133 travel samples, compared with 134 in air.
    expect(p.trail).toHaveLength(133);
    expect(gs.terrain.is_dirt(100, 100)).toBe(false);
    expect(gs.terrain.is_dirt(100, 102)).toBe(false);
    expect(gs.terrain.is_dirt(100, 104)).toBe(true);
  });

  it("uses the reduced travel and cutting costs throughout a continuous dirt tunnel", () => {
    const gs = game();
    gs.terrain.grid.fill(COL_DIRT);
    const p = beam(gs);
    // Radius-three cuts encounter fresh dirt every fourth pixel. Each four-step
    // group costs 75 (60 travel + 15 dirt). 2000 funds 26 groups plus three
    // samples; the last cut at x=204 also clears dirt through x=207.
    expect(p.trail).toHaveLength(107);
    expect(p.trail.at(-1)).toEqual([206, 100]);
    expect(gs.terrain.is_dirt(207, 100)).toBe(false);
    expect(gs.terrain.is_dirt(208, 100)).toBe(true);
  });

  it.each([false, true])("reaches distant tanks and stops (Super Mag: %s)", (superMag) => {
    const gs = game(), target = gs.tanks[1];
    target.x = 607; target.y = 104;
    target.shield_hp = superMag ? 100 : 500;
    target.shield_laserproof = superMag;
    const p = beam(gs, 10000);
    // Contact at x=600: 500 travel steps leave 2500 energy. DOS range was 250.
    expect(p.trail.at(-1)).toEqual([600, 100]);
    expect(target.shield_hp).toBe(superMag ? 125 : 400);
    expect(target.health).toBe(100);
    expect(p.active).toBe(false);
  });

  it("stops at a field boundary", () => {
    const p = beam(game(), 2000, 1000);
    expect(p.trail).toHaveLength(24);
    expect(p.trail.at(-1)).toEqual([1023, 100]);
  });

  // The 134 samples span 133 steps; wrapping translates x by width - 2 = 1022.
  it.each([[1000, 1, 111], [23, -1, 912]])(
    "wraps from x=%i and still exhausts its energy", (x, vx, end) => {
      const gs = game(); gs.cfg.live_elastic = 1;
      const p = beam(gs, 2000, x, vx);
      expect(p.trail).toHaveLength(134);
      expect(p.trail.at(-1)).toEqual([end, 100]);
      expect(p.active).toBe(false);
    },
  );
});
