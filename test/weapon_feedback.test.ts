import { describe, expect, it, vi } from "vitest";
import reference from "./fixtures/dos_feedback.json";
import { Config } from "../src/config";
import { createGameState, FIRING, SIM_LIVE, SYNC_VOLLEY } from "../src/game";
import { Projectile } from "../src/objects";
import { step } from "../src/physics";
import { ITEMS } from "../src/weapons";
import { startFluid, stepCombatEffect, type FluidEffect } from "../src/combat_effects";
import { startFunky, stepWeaponEffect, type FunkyEffect } from "../src/weapon_effects";
import { shieldContains, shieldPixels } from "../src/shields";
import { sfx } from "../src/sound";
import { Rng } from "../src/rng";
import * as wb from "../src/weapon_behaviors";

function game(h = 240) {
  const cfg = new Config();
  Object.assign(cfg, { SOUND: "OFF", TALKING_TANKS: "OFF", INITIAL_CASH: 0, MAX_WIND: 0, FALLING_TANKS: "OFF" });
  const gs = createGameState(cfg, 320, h, 42);
  gs.add_player("A", 0, 0, 0); gs.add_player("B", 0, 0, 1); gs.new_game();
  gs.terrain.grid.fill(0);
  gs.tanks.forEach((t, i) => { t.x = i ? 160 : 30; t.y = 159; t.health = 100; t.alive = true; });
  gs.current_shooter = gs.tanks[0]; gs.phase = FIRING; gs.explosion_scale = 1;
  return gs;
}
type Game = ReturnType<typeof game>;
const state = (gs: Game) => gs as unknown as wb.BState;
const projectile = (p: Projectile) => p as unknown as wb.BProjectile;
function fluid(gs: Game, idx: number, x: number, y: number) {
  const p = new Projectile(gs.tanks[0], ITEMS[idx], x, y, 0, 0);
  startFluid(state(gs), projectile(p), x, y, idx === 28);
  const controller = gs.projectiles.at(-1)!;
  return { p: controller, e: controller.weaponEffect as FluidEffect };
}
function tick(gs: Game, p: Projectile, e: FluidEffect) { stepCombatEffect(state(gs), projectile(p), e); }
function sweep(gs: Game, idx = 1, y = 159, x0 = 120, x1 = 200) {
  const p = new Projectile(gs.tanks[0], ITEMS[idx], x0, y, 300, 0);
  p.px = p.sx = x1;
  return p;
}
function equip(gs: Game, item = 41, hp = 100) {
  const t = gs.tanks[1]; t.shield_item = item; t.shield_hp = hp;
  t.shield_deflect = item === 42; t.shield_push = item === 40 || item === 44;
  return t;
}

describe("DOS fluid queue and visible flame progression", () => {
  for (const f of reference.flow) it(`${f.profile}, wind ${f.wind}: matches every deposited pixel`, () => {
    const gs = game(f.h); gs.cfg.wind = f.wind;
    for (let x = 0; x < gs.w; x++) {
      const surface = f.profile === "well" ? (x >= 150 && x < 170 ? 200 : 160)
        : f.profile === "shaft" ? (x === 160 ? 450 : 50) : f.profile === "slope" ? 100 + Math.floor(x / 4) : 160;
      for (let y = surface; y < gs.h; y++) gs.terrain.write(x, y, 80);
    }
    const { p, e } = fluid(gs, 28, f.start[0], f.start[1]);
    for (let n = 0; n < 1000 && p.active; n++) tick(gs, p, e);
    expect(p.active).toBe(false);
    expect(e.points).toEqual(f.points); expect(e.samples).toEqual(f.samples);
    expect(e.points).toHaveLength(f.count);
    expect(e.points.every(([x, y]) => gs.terrain.is_dirt(x, y))).toBe(true);
  });
  for (const wrap of [false, true]) it(`handles a fluid boundary, wrap=${wrap}`, () => {
    const gs = game(); gs.cfg.live_elastic = wrap ? 5 : 0; gs.cfg.wind = -1;
    for (let x = 0; x < gs.w; x++) gs.terrain.write(x, 160, 80);
    const { p, e } = fluid(gs, 28, 1, 159); tick(gs, p, e);
    expect(e.points[1]).toEqual([wrap ? 318 : 2, 159]);
    expect(e.points.every(([x]) => x > 0 && x < 319)).toBe(true);
  });
  for (const idx of [8, 9]) it(`item ${idx} grows each emitter before applying its heat`, () => {
    const gs = game();
    const { p, e } = fluid(gs, idx, 160, 100);
    // Isolate the original emitter helper with no dirt-color RNG calls.
    e.phase = "ignite"; e.samples = [[160, 100], [250, 100]];
    gs.rng = { pick: () => 0 } as unknown as Rng;
    const target = gs.tanks[1]; target.x = 160; target.y = 100; target.shield_hp = 1000;
    let disks = 0;
    for (const [row, expected] of reference.flame_rows.entries()) {
      tick(gs, p, e);
      expect(e.flames.slice(disks)).toEqual(expected); disks += expected.length;
      expect(target.shield_hp).toBe(row === 4 ? 1000 - (idx === 9 ? 50 : 30) : 1000);
    }
    expect(e.emitter).toBe(1); expect(e.phase).toBe("ignite");
    for (let i = 0; i < 5; i++) tick(gs, p, e);
    expect(e.phase).toBe("burn");
    const shape = structuredClone(e.flames), cycle = e.cycle;
    for (let i = 0; i < 49; i++) tick(gs, p, e);
    expect(p.active).toBe(true); expect(e.phase).toBe("burn");
    expect(e.cycle).toBe(cycle + 49); expect(e.flames).toEqual(shape);
    tick(gs, p, e); expect(e.phase).toBe("cleanup");
    tick(gs, p, e); expect(p.active).toBe(false);
  });
});

describe("Funky targeting variants", () => {
  it("keeps the fired range in pixels and sends death targets across the field", () => {
    const targets = (death: boolean) => {
      const gs = game(); gs.explosion_scale = 3;
      const draws = [0, 0, 159, 80, 40, 120];
      gs.rng = { pick: () => draws.shift()! } as unknown as Rng;
      if (death) gs.combat_throe("funky", 160, 100);
      else {
        const p = new Projectile(gs.tanks[0], ITEMS[5], 160, 100, 0, 0);
        startFunky(state(gs), projectile(p), 160, 100); gs.projectiles.push(p);
      }
      return (gs.projectiles[0].weaponEffect as FunkyEffect).targets;
    };
    expect(targets(false)).toEqual([80, 239, 160, 120, 200]);
    expect(targets(true)).toEqual([1, 160, 81, 41, 121]);
  });
});

describe("shield pixels and swept contacts", () => {
  for (const f of reference.shields) it(`renders and collides with the exact item ${f.item} outline`, () => {
    const points = [...shieldPixels(f.item)].map((p) => [...p]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(points).toEqual(f.pixels);
    for (let y = -17; y <= 17; y++) for (let x = -17; x <= 17; x++)
      expect(shieldContains(f.item, x, y)).toBe(f.pixels.some(([px, py]) => px === x && py === y));
  });
  for (const item of [41, 43, 44]) for (const hp of [5, 10, 100]) it(`item ${item}, ${hp} HP intercepts once without hull overflow`, () => {
    const gs = game(), t = equip(gs, item, hp), p = sweep(gs);
    const hit = gs._check_collision(p)!;
    expect(hit[0]).toBe("shield"); expect(hit[2]).toBeLessThan(t.x - t.half_width);
    gs._resolve_hit(p, hit);
    expect(t.shield_hp).toBe(Math.max(0, hp - reference.shield_chip));
    expect(t.health).toBe(100); expect(p.active).toBe(false); expect(gs.projectiles).toHaveLength(0);
    if (hp <= 10) expect(gs._check_collision(sweep(gs))?.[0]).toBe("tank");
  });
  it("detects a tangent at the very top of the shield", () => {
    const gs = game(); equip(gs);
    expect(gs._check_collision(sweep(gs, 1, 144))?.[0]).toBe("shield");
    expect(gs._check_collision(sweep(gs, 1, 143))).toBeNull();
  });
  it("reflects at the outline and charges the original speed-based Force damage", () => {
    const gs = game(), t = equip(gs, 42), p = sweep(gs);
    gs._resolve_hit(p, gs._check_collision(p)!);
    expect(p.active).toBe(true); expect(p.vx).toBeCloseTo(-210); expect(p.vy).toBeCloseTo(0);
    expect(t.shield_hp).toBe(97); expect(t.health).toBe(100);
    step(p, gs.cfg, 1 / 20); // also save the outgoing movement velocity for the next collision scan
    expect(gs._check_collision(p)).toBeNull(); expect(t.shield_hp).toBe(97);
  });
  it("lets shells pass the Mag Deflector arcs", () => {
    const gs = game(); equip(gs, 40, 55);
    expect(gs._check_collision(sweep(gs, 1, 143))).toBeNull();
    expect(gs._check_collision(sweep(gs))?.[0]).toBe("tank");
  });
  it("ignores the owner's shield but allows a returning shell to hit its hull", () => {
    const gs = game(); const owner = gs.tanks[0]; owner.x = 160; owner.shield_item = 41; owner.shield_hp = 100;
    gs.tanks[1].x = 290;
    expect(gs._check_collision(sweep(gs, 1, 144))).toBeNull();
    const p = sweep(gs); const hit = gs._check_collision(p)!;
    expect(hit[0]).toBe("tank"); gs._resolve_hit(p, hit); expect(owner.alive).toBe(false);
  });
  it("preserves roller and napalm behavior on a shield contact", () => {
    for (const idx of [8, 13]) {
      const gs = game(), t = equip(gs), p = sweep(gs, idx);
      gs.projectiles.push(p); gs._resolve_hit(p, gs._check_collision(p)!);
      expect(t.shield_hp).toBe(100); expect(t.health).toBe(100);
      if (idx === 13) expect(p.state.rolling).toBe(true);
      else expect(gs.projectiles.at(-1)?.weaponEffect?.kind).toBe("fluid");
    }
  });
});

describe("original dud and settling behavior", () => {
  for (const idx of [6, 7]) for (const kind of ["terrain", "tank", "shield", "floor"]) it(`unsplit item ${idx} hitting ${kind} only beeps`, () => {
    const gs = game(), t = equip(gs), p = sweep(gs, idx);
    const before = gs.terrain.grid.slice();
    const play = vi.spyOn(sfx, "play"), beep = vi.spyOn(sfx, "beep");
    try {
      if (kind === "floor") { p.py = gs.h; gs._resolve_off_field(p); }
      else gs._resolve_hit(p, [kind, kind === "terrain" ? null : t, 160, 159]);
      expect(p.active).toBe(false); expect(t.shield_hp).toBe(100); expect(t.health).toBe(100);
      expect(gs.terrain.grid).toEqual(before); expect(gs.projectiles).toHaveLength(0);
      expect(play).not.toHaveBeenCalled(); expect(beep).toHaveBeenCalledWith(200, 40, false);
    } finally { play.mockRestore(); beep.mockRestore(); }
  });
  it("leaves already settled terrain unchanged after Earth Disrupter", () => {
    const gs = game(); gs.cfg.SUSPEND_DIRT = 100;
    for (let x = 0; x < gs.w; x++) for (let y = 160; y < gs.h; y++) gs.terrain.write(x, y, 80);
    const before = gs.terrain.grid.slice();
    const p = new Projectile(gs.tanks[0], ITEMS[30], 160, 160, 0, 0);
    wb.detonate(state(gs), projectile(p), 160, 160);
    for (let n = 0; n < 101; n++) gs.projectiles.forEach((p) => stepWeaponEffect(state(gs), projectile(p)));
    for (let i = 0; i < 300 && !gs._advance_settle(); i++) { /* animate */ }
    expect(gs.terrain.grid).toEqual(before);
  });
  for (const parachute of [false, true]) it(`finishes Disrupter collapse and the tank fall, parachute=${parachute}`, () => {
    const gs = game(); gs.cfg.SUSPEND_DIRT = 100; gs.cfg.FALLING_TANKS = "ON";
    for (let x = 0; x < gs.w; x++) for (let y = 210; y < gs.h; y++) gs.terrain.write(x, y, 80);
    for (let x = 145; x <= 175; x++) for (let y = 150; y < 160; y++) gs.terrain.write(x, y, 80);
    const target = gs.tanks[1]; target.y = 149; target.inventory[38] = parachute ? 1 : 0;
    target.parachute_deployed = true; gs.tanks[0].y = 209;
    const p = new Projectile(gs.tanks[0], ITEMS[30], 100, 210, 0, 0);
    wb.detonate(state(gs), projectile(p), 100, 210);
    for (let n = 0; n < 2000; n++) {
      gs.update(1 / 60);
      // Keep the death continuation bounded without introducing unrelated
      // random secondary blasts into this settling acceptance scenario.
      for (const death of gs.death_queue) { death.roll = 0; death.stage = "body"; }
      if (!["firing", "settle"].includes(gs.phase)) break;
    }
    expect(gs.projectiles).toHaveLength(0); expect(gs.death_queue).toHaveLength(0);
    expect((target as typeof target & { chute_descent?: unknown }).chute_descent).toBeFalsy();
    expect(target.y).toBe(199); expect(target.alive).toBe(parachute);
    expect(target.inventory[38]).toBe(0);
  });
  for (const mode of [FIRING, SYNC_VOLLEY, SIM_LIVE]) it(`replays overlapping corrected effects deterministically in ${mode}`, () => {
    const run = () => {
      const gs = game(); gs.phase = mode;
      const a = fluid(gs, 8, 100, 100), b = fluid(gs, 28, 200, 150);
      gs.combat_throe("funky", 160, 100);
      for (let frame = 0; frame < 900; frame++) gs._step_flight();
      return { dirt: gs.terrain.grid, tanks: gs.tanks.map((t) => [t.health, t.shield_hp]),
        a: a.e, b: b.e, pending: gs.projectiles.map((p) => p.weaponEffect), next: gs.rng.pick(10000) };
    };
    expect(run()).toEqual(run());
  });
});
