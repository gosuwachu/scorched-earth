import { describe, expect, it } from "vitest";
import reference from "./fixtures/dos_shields.json";
import magnet from "./fixtures/dos_magnet.json";
import { MAG_REFERENCE_CALIBRATION, PHYSICS_DT } from "../src/constants";
import { Config } from "../src/config";
import { createGameState, FIRING, SIM_LIVE, SYNC_VOLLEY } from "../src/game";
import { Projectile } from "../src/objects";
import { ITEMS } from "../src/weapons";
import * as damage from "../src/damage";
import * as wb from "../src/weapon_behaviors";
import * as physics from "../src/physics";
import { startBlast } from "../src/combat_effects";
import { magneticLift, shieldColor } from "../src/shields";

function game(item = 40, mode = "SEQUENTIAL", w = 320, h = 240) {
  const cfg = new Config();
  Object.assign(cfg, { PLAY_MODE: mode, SOUND: "OFF", FLY_SOUND: "OFF", TALKING_TANKS: "OFF",
    INITIAL_CASH: 0, MAX_WIND: 0, FALLING_TANKS: "OFF", TRACE: "ON" });
  const gs = createGameState(cfg, w, h, 42);
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

describe("DOS shield palette and lifecycle", () => {
  for (const f of reference.shields) {
    it(`item ${f.item} quantizes strength and both fades in VGA DAC space`, () => {
      for (const sample of f.colors) expect(shieldColor(f.item, sample.hp)).toEqual(sample.rgb);
      expect(shieldColor(f.item, f.hp + 100)).toEqual(f.colors.at(-1)!.rgb);
      const fade = { item: f.item, hp: f.hp, x: 160, y: 159, dir: 1, frame: 0 };
      for (let frame = 0; frame < 51; frame++) {
        expect(shieldColor(f.item, f.hp, { ...fade, frame })).toEqual(f.activation[frame]);
        expect(shieldColor(f.item, 0, { ...fade, dir: -1, frame })).toEqual(f.collapse[frame]);
      }
    });
    it(`item ${f.item} dims on damage and captures its outline before collapse`, () => {
      const gs = game(f.item), t = gs.tanks[1];
      expect(gs.shield_fades[1]).toMatchObject({ item: f.item, dir: 1, frame: 0 });
      damage.apply_tank_damage(gs, t, 1);
      expect(gs.shield_fades[1]).toBeUndefined();
      expect(shieldColor(t.shield_item, t.shield_hp)).toEqual(f.colors.at(-2)!.rgb);
      damage.apply_tank_damage(gs, t, t.shield_hp);
      expect([t.shield_item, t.shield_hp, t.health]).toEqual([0, 0, 100]);
      expect(gs.shield_fades[1]).toMatchObject({ item: f.item, dir: -1, frame: 0, x: 160, y: 159 });
      t.x += 30; t.y += 10;
      for (let i = 0; i < 50; i++) gs._tick_shield_fades();
      expect(gs.shield_fades[1]).toMatchObject({ frame: 50, x: 160, y: 159 });
      gs._tick_shield_fades();
      expect(gs.shield_fades[1]).toBeUndefined();
    });
  }
  it("replaces a collapse with new equipment and clears fades on round reset", () => {
    const gs = game(40), t = gs.tanks[1];
    damage.apply_tank_damage(gs, t, t.shield_hp);
    t.inventory[42] = 1; gs._arm_best_shield(t, false);
    expect(gs.shield_fades[1]).toMatchObject({ item: 42, dir: 1, frame: 0 });
    gs.start_round();
    expect(gs.shield_fades).toEqual({});
  });
  it("laser recharge interrupts deployment and immediately shows current strength", () => {
    const gs = game(44), t = gs.tanks[1]; t.shield_hp = 100;
    const p = shell(gs, 0, 4, 1, 0, 32); p.state.energy = 1000;
    wb.fire_laser(gs as unknown as wb.BState, p as unknown as wb.BProjectile);
    expect(t.shield_hp).toBe(110);
    expect(gs.shield_fades[1]).toBeUndefined();
    expect(shieldColor(44, t.shield_hp)).toEqual([136, 116, 72]);
  });
  it("a collapsing outline provides no collision or magnetic protection", () => {
    const gs = game(44), t = gs.tanks[1];
    damage.apply_tank_damage(gs, t, t.shield_hp);
    const p = shell(gs, -4, 40, 10, -100);
    gs._mag_deflect(p);
    expect(p.vy).toBe(-100);
    for (let i = 0; i < 2000 && p.active; i++) gs._step_flight();
    expect(t.alive).toBe(false);
    expect(gs.shield_fades[1].dir).toBe(-1);
  });
});

describe("magnetic shields against normally launched enemy shots", () => {
  for (const mode of ["SEQUENTIAL", "SYNCHRONOUS", "SIMULTANEOUS"]) {
    for (const item of [0, 40, 44]) for (const speed of ["slow", "medium", "fast"]) {
      it(`${mode}: item ${item}, ${speed} shot`, () => {
        const gs = game(item, mode, 1024, 768), [a, b] = gs.tanks;
        a.x = 100; b.x = speed === "slow" ? 160 : speed === "medium" ? 430 : 790; a.y = b.y = 499;
        for (let x = 0; x < gs.w; x++) for (let y = 500; y < gs.h; y++) gs.terrain.write(x, y, 96);
        a.angle = speed === "slow" ? 60 : speed === "medium" ? 70 : 80; a.power = speed === "slow" ? 180 : speed === "medium" ? 499 : 1000;
        a.selected_weapon = 0;
        const [p] = gs.fire(a);
        let descending = false, lifted = false;
        for (let frame = 0; frame < 300 && p.active; frame++) {
          gs.update(1 / 60);
          if (p.vy < 0) descending = true;
          if (descending && p.vy > 0) lifted = true;
        }
        expect(p.active).toBe(false);
        expect(lifted).toBe(item !== 0 && speed !== "fast");
        expect(b.health).toBe(item === 0 || (item === 40 && speed === "fast") ? 0 : 100);
        if (item === 44) expect(b.shield_hp).toBe(speed !== "fast" ? 200 : 190);
      });
    }
  }
});

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
  for (const f of magnet.flights) it(`matches recorded DOS ${f.name} motion within two pixels`, () => {
    const gs = game(f.item, "SEQUENTIAL", 360, 480);
    Object.assign(gs.tanks[1], f.target);
    const initial = f.samples[0];
    const p = shell(gs, initial.x - f.target.x, f.target.y - initial.y, initial.vx, initial.vy);
    let tick = 0;
    for (const sample of f.samples) {
      const until = Math.round(sample.time / PHYSICS_DT);
      while (tick < until) { gs._step_flight(); tick++; }
      expect(p.active).toBe(true);
      expect(Math.abs(p.px - sample.x)).toBeLessThan(2);
      expect(Math.abs(p.py - sample.y)).toBeLessThan(2);
    }
  });
  it("uses the median of five fresh DOS boot measurements", () => {
    const measurements = magnet.calibrations.map((r) => r.calibration).sort((a, b) => a - b);
    expect(MAG_REFERENCE_CALIBRATION).toBe(measurements[2]);
    for (const r of magnet.calibrations) expect(r.dt).toBeCloseTo(2 * r.n / (r.calibration * r.delay), 14);
  });
  it("matches DOS timestep changes as a MIRV splits and its children are removed", () => {
    expect(magnet.splitTiming.map((r) => r.n)).toEqual([1, 5, 4, 3, 2]);
    for (const r of magnet.splitTiming) {
      expect(r.dt).toBeCloseTo(2 * r.n / (r.calibration * r.delay), 14);
      expect(magneticLift(r.delay, r.n, r.dt)).toBeCloseTo(50 / r.delay, 12);
    }
  });
  for (const n of [1, 2, 5]) it(`preserves integrated DOS lift with ${n} live projectiles`, () => {
    for (const delay of [1, 50, 100, 200, 1000]) {
      for (const dt of [1 / 960, PHYSICS_DT, 1 / 3840]) {
        expect(magneticLift(delay, n, dt) / dt).toBeCloseTo(5050 / n, 10);
      }
    }
    expect(magneticLift(0, n, 0.02)).toBe(50);
  });
  it("produces identical flights at all positive Fire Delay settings", () => {
    const flight = (delay: number) => {
      const gs = game(); gs.cfg.FIRE_DELAY = delay;
      const p = shell(gs);
      for (let tick = 0; tick < 640; tick++) gs._step_flight();
      return [p.px, p.py, p.vx, p.vy, p.active];
    };
    const expected = flight(100);
    for (const delay of [1, 50, 200, 1000]) expect(flight(delay)).toEqual(expected);
  });
  it("keeps trajectories within a pixel when the integration step is halved or doubled", () => {
    const flight = (dt: number) => {
      const gs = game(), p = shell(gs);
      for (let tick = 0; tick < Math.round(0.3 / dt); tick++) {
        physics.step(p, gs.cfg as unknown as physics.PhysicsCfg, dt);
        gs._mag_deflect(p, dt);
      }
      return p;
    };
    const expected = flight(PHYSICS_DT);
    for (const dt of [PHYSICS_DT / 2, PHYSICS_DT * 2]) {
      const p = flight(dt);
      expect(Math.abs(p.px - expected.px)).toBeLessThan(1);
      expect(Math.abs(p.py - expected.py)).toBeLessThan(1);
    }
  });
  it("counts rollers/tunnelers, ignores inactive shots and explosion controllers, and updates on removal", () => {
    const gs = game(), p = shell(gs);
    const roller = shell(gs, 80); roller.state.rolling = true;
    const tunneler = shell(gs, 90); tunneler.state.tunneling = true;
    const removed = shell(gs, 100); removed.active = false;
    startBlast(gs as unknown as wb.BState, removed as unknown as wb.BProjectile, 250, 200, 10);
    expect(gs.projectiles.some((p) => p.weaponEffect)).toBe(true);
    gs._mag_deflect(p);
    expect(p.vy).toBeCloseTo(-100 + 5050 / (3 * 1920), 12);
    roller.active = false; tunneler.active = false;
    p.vy = -100; gs._mag_deflect(p);
    expect(p.vy).toBeCloseTo(-100 + 5050 / 1920, 12);
  });
  it("uses the new live count after an earlier projectile splits during the same step", () => {
    const gs = game();
    shell(gs, 50, 40, 10, 0.1, 6); // outside the field: splits into five MIRV children
    const p = shell(gs);
    gs._step_flight();
    expect(gs.projectiles).toHaveLength(6);
    expect(p.vy).toBeCloseTo(-100 - 500 / 1920 + 5050 / (6 * 1920), 12);
  });
  for (const item of [40, 44]) {
    for (const [i, f] of reference.magnetic_steps.entries()) it(`item ${item}, field boundary/guard ${i}`, () => {
      const gs = game(item), t = gs.tanks[1];
      gs.cfg.FIRE_DELAY = f.delay; t.shield_hp = f.hp; t.alive = f.alive;
      const p = shell(gs, f.dx, f.dy, f.vx);
      if (f.owner) p.owner = t;
      const dosDt = f.delay === 0 ? 0.02 : 2 / (MAG_REFERENCE_CALIBRATION * f.delay);
      gs._mag_deflect(p, dosDt);
      expect(p.vy).toBeCloseTo(-100 + f.bump, 12);
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
    for (let i = 0; i < 12; i++) gs._step_flight();
    expect(p.split_done).toBe(true);
    expect(gs.projectiles).toHaveLength(5);
  });
  for (const item of [0, 40, 44]) for (const speed of [100, 800]) {
    it(`complete flight: item ${item}, descending speed ${speed}`, () => {
      const gs = game(item), t = gs.tanks[1], p = shell(gs, -4, 40, 10, -speed);
      let lifted = false;
      for (let tick = 0; tick < 12000 && p.active; tick++) {
        gs._step_flight();
        if (p.vy > 0) lifted = true;
      }
      expect(p.active).toBe(false);
      expect(lifted).toBe(item !== 0 && speed === 100);
      if (speed === 800 && item === 44) expect([t.shield_hp, t.health]).toEqual([190, 100]);
      if (item === 0 || (speed === 800 && item === 40)) expect(t.alive).toBe(false);
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
