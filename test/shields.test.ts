import { describe, expect, it } from "vitest";
import reference from "./fixtures/dos_shields.json";
import { Config } from "../src/config";
import { createGameState, FIRING, SIM_LIVE, SYNC_VOLLEY } from "../src/game";
import { Projectile } from "../src/objects";
import { ITEMS } from "../src/weapons";
import * as damage from "../src/damage";
import * as wb from "../src/weapon_behaviors";

function game(item = 40, mode = "SEQUENTIAL") {
  const cfg = new Config();
  Object.assign(cfg, { PLAY_MODE: mode, SOUND: "OFF", FLY_SOUND: "OFF", TALKING_TANKS: "OFF",
    INITIAL_CASH: 0, MAX_WIND: 0, FALLING_TANKS: "OFF", TRACE: "ON" });
  const gs = createGameState(cfg, 320, 240, 42);
  gs.add_player("A", 0, 0, 0); gs.add_player("B", 0, 0, 1); gs.new_game();
  gs.terrain.grid.fill(0);
  gs.tanks.forEach((t, i) => { t.x = i ? 160 : 30; t.y = 159; t.health = 100; t.alive = true; });
  gs.current_shooter = gs.tanks[0];
  gs.phase = mode === "SIMULTANEOUS" ? SIM_LIVE : mode === "SYNCHRONOUS" ? SYNC_VOLLEY : FIRING;
  const target = gs.tanks[1];
  target.inventory.fill(0);
  if (item) {
    target.inventory[item] = 1;
    gs._arm_best_shield(target, false);
  }
  return gs;
}
type Game = ReturnType<typeof game>;
function shell(gs: Game, dx = -10, dy = 40, vx = 10, vy = -100, item = 0) {
  const t = gs.tanks[1];
  const p = new Projectile(gs.tanks[0], ITEMS[item], t.x + dx, t.y - dy, vx, vy);
  gs.projectiles.push(p);
  return p;
}

describe("DOS shield equipment and damage", () => {
  for (const f of reference.shields) {
    it(`equips item ${f.item} with the DOS strength and flags`, () => {
      const gs = game(f.item), t = gs.tanks[1];
      expect(t.shield_hp).toBe(f.hp);
      expect(t.shield_item).toBe(f.item);
      expect(t.shield_push).toBe(f.push);
      expect(t.shield_deflect).toBe(f.deflect);
      expect(t.shield_laserproof).toBe(f.laserproof);
      expect(t.inventory[f.item]).toBe(0);
      expect(gs._arm_best_shield(t, false)).toBeNull();
    });
    it(`item ${f.item} absorbs blast damage and passes only overflow to the hull`, () => {
      const gs = game(f.item), t = gs.tanks[1];
      damage.apply_tank_damage(gs as unknown as damage.State, t, f.hp - 5);
      expect([t.shield_hp, t.health]).toEqual([5, 100]);
      damage.apply_tank_damage(gs as unknown as damage.State, t, 10);
      expect([t.shield_hp, t.shield_item, t.health]).toEqual([0, 0, 95]);
      const p = shell(gs);
      gs._mag_deflect(p);
      expect(p.vy).toBe(-100);
    });
    it(`item ${f.item} ${f.laserproof ? "recharges from" : "absorbs damage from"} a laser`, () => {
      const gs = game(f.item), t = gs.tanks[1]; t.shield_hp = 30;
      // Start inside the target silhouette to isolate the DOS energy discharge.
      const p = shell(gs, 0, 4, 1, 0, 32); p.state.energy = 1000;
      wb.fire_laser(gs as unknown as wb.BState, p as unknown as wb.BProjectile);
      expect([t.shield_hp, t.health, p.active]).toEqual(f.laserproof ? [40, 100, false] : [0, 90, false]);
      if (f.laserproof) {
        t.shield_hp = f.hp - 1;
        const q = shell(gs, 0, 4, 1, 0, 32); q.state.energy = 1000;
        wb.fire_laser(gs as unknown as wb.BState, q as unknown as wb.BProjectile);
        expect(t.shield_hp).toBe(f.hp);
        t.shield_hp = 0;
        const r = shell(gs, 0, 4, 1, 0, 32); r.state.energy = 1000;
        wb.fire_laser(gs as unknown as wb.BState, r as unknown as wb.BProjectile);
        expect([t.shield_hp, t.health]).toEqual([0, 60]);
      }
    });
  }
  it("replaces depleted magnetic flags when a different tier is equipped", () => {
    const gs = game(44), t = gs.tanks[1];
    damage.apply_tank_damage(gs as unknown as damage.State, t, 200);
    t.inventory[42] = 1;
    gs._arm_best_shield(t, false);
    expect([t.shield_hp, t.shield_push, t.shield_deflect, t.shield_laserproof]).toEqual([100, false, true, false]);
  });
});

describe("DOS magnetic callbacks", () => {
  for (const item of [40, 44]) {
    for (const [i, f] of reference.magnetic_steps.entries()) it(`item ${item}, field boundary/guard ${i}`, () => {
      const gs = game(item), t = gs.tanks[1];
      gs.cfg.FIRE_DELAY = f.delay; t.shield_hp = f.hp; t.alive = f.alive;
      const p = shell(gs, f.dx, f.dy, f.vx);
      if (f.owner) p.owner = t;
      gs._mag_deflect(p);
      expect(p.vy).toBe(-100 + f.bump);
    });
    for (const f of reference.flights) it(`item ${item}: ${f.name} follows the independent trajectory`, () => {
      const gs = game(item); gs.cfg.FIRE_DELAY = f.delay;
      const p = shell(gs, f.dx, f.dy, f.vx, f.vy);
      for (let tick = 0; tick <= f.steps; tick++) {
        if (tick % 32 === 0) {
          const expected = f.samples[tick / 32];
          expect([p.sx, p.sy, p.active]).toEqual([expected.sx, expected.sy, true]);
          for (const [actual, wanted] of [[p.px, expected.x], [p.py, expected.y], [p.vx, expected.vx], [p.vy, expected.vy]])
            expect(actual).toBeCloseTo(wanted, 10);
        }
        if (tick < f.steps) gs._step_flight();
      }
    });
  }
  it("applies magnetic lift before deciding whether a MIRV reached apogee", () => {
    const gs = game();
    const p = shell(gs, -10, 40, 10, 0.1, 6);
    gs._step_flight();
    expect(p.vy).toBeGreaterThan(0);
    expect(p.split_done).toBe(false);
    expect(gs.projectiles).toHaveLength(1);
    gs.tanks[1].shield_hp = 0;
    for (let i = 0; i < 3; i++) gs._step_flight();
    expect(p.split_done).toBe(true);
    expect(gs.projectiles).toHaveLength(5);
  });
  for (const item of [0, 40, 44]) for (const speed of [100, 400]) {
    it(`complete flight: item ${item}, descending speed ${speed}`, () => {
      const gs = game(item), t = gs.tanks[1], p = shell(gs, -4, 40, 10, -speed);
      let lifted = false;
      for (let tick = 0; tick < 12000 && p.active; tick++) {
        gs._step_flight();
        if (p.vy > 0) lifted = true;
      }
      expect(p.active).toBe(false);
      expect(lifted).toBe(item !== 0 && speed === 100);
      if (speed === 400 && item === 44) expect([t.shield_hp, t.health]).toEqual([190, 100]);
      if (item === 0 || (speed === 400 && item === 40)) expect(t.alive).toBe(false);
    });
  }
  for (const item of [40, 44]) it(`item ${item} has identical replayed trajectories in all play modes`, () => {
    const play = (mode: string) => {
      const gs = game(item, mode), p = shell(gs);
      const result = [];
      for (let frame = 0; frame < 20; frame++) {
        gs.update(1 / 60);
        result.push([p.px, p.py, p.vx, p.vy, p.active, gs.tanks[1].shield_hp]);
      }
      expect(p.vy).toBeGreaterThan(0);
      return result;
    };
    const expected = play("SEQUENTIAL");
    for (const mode of ["SEQUENTIAL", "SYNCHRONOUS", "SIMULTANEOUS"]) expect(play(mode)).toEqual(expected);
  });
});

describe("DOS Force Shield reflection", () => {
  for (const f of reference.reflections) it(f.name, () => {
    const gs = game(42), t = gs.tanks[1]; t.shield_hp = f.hp;
    const p = shell(gs, f.normal[0], f.normal[1], f.incoming[0], f.incoming[1]);
    gs._resolve_hit(p, ["shield", t, p.sx, p.sy]);
    expect(p.vx).toBeCloseTo(f.velocity[0], 10);
    expect(p.vy).toBeCloseTo(f.velocity[1], 10);
    expect([t.shield_hp, t.health, p.active]).toEqual([f.shield_hp, f.health, true]);
    expect(gs.projectiles).toHaveLength(1);
  });
  for (const mode of ["SEQUENTIAL", "SYNCHRONOUS", "SIMULTANEOUS"]) it(`top contact reflects once during ${mode} play`, () => {
    const gs = game(42, mode), t = gs.tanks[1], p = shell(gs, 0, 16, 0, -300);
    for (let frame = 0; frame < 5; frame++) gs.update(1 / 60);
    expect(p.active).toBe(true); expect(p.vy).toBeGreaterThan(0);
    expect(p.py).toBeLessThan(t.y - 16);
    expect(t.shield_hp).toBe(97); expect(t.health).toBe(100);
  });
  it("uses incoming movement velocity, not velocity changed by gravity/drag/wind", () => {
    const gs = game(42), t = gs.tanks[1], p = shell(gs, 0, 15.1, 0, -300);
    gs.cfg.wind = 100;
    gs.cfg.AIR_VISCOSITY = 20;
    gs._step_flight();
    expect([p.px, p.py]).toEqual([160, 144]);
    expect(p.vx).toBeCloseTo(0, 10); expect(p.vy).toBeCloseTo(210, 10);
    expect(t.shield_hp).toBe(97);
  });
  it("lets an outgoing shot cross the outline without sticking or spending HP", () => {
    const gs = game(42), t = gs.tanks[1], p = shell(gs, 0, 14, 0, 300);
    for (let tick = 0; tick < 32; tick++) gs._step_flight();
    expect(p.py).toBeLessThan(t.y - 18);
    expect(t.shield_hp).toBe(100);
  });
  for (const [dx, dy, vx, vy] of [[-16, 0, 300, 0], [16, 0, -300, 0], [-10, 13, 240, -180], [10, 13, -240, -180]]) {
    it(`charges once while leaving the ${dx},${dy} contact`, () => {
      const gs = game(42), t = gs.tanks[1], p = shell(gs, dx, dy, vx, vy);
      for (let tick = 0; tick < 200; tick++) gs._step_flight();
      expect(p.active).toBe(true);
      expect(t.shield_hp).toBe(97);
      expect(Math.sign(p.vx)).toBe(Math.sign(dx));
      expect(Math.hypot(p.px - t.x, p.py - t.y)).toBeGreaterThan(25);
    });
  }
  it("reflects and charges again when a previously reflected shot returns", () => {
    const gs = game(42), t = gs.tanks[1], p = shell(gs, 0, 15.1, 0, -300);
    gs._step_flight();
    expect(t.shield_hp).toBe(97);
    // Let gravity return this same shell to the same painted top pixel.
    for (let tick = 0; tick < 2000 && t.shield_hp === 97; tick++) gs._step_flight();
    expect(p.active).toBe(true);
    expect(p.vy).toBeGreaterThan(0);
    expect(t.shield_hp).toBe(95);
  });
});
