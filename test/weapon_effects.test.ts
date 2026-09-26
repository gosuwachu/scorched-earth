import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Config } from "../src/config";
import { createGameState, FIRING, SETTLE, SIM_LIVE, SYNC_VOLLEY } from "../src/game";
import { Projectile } from "../src/objects";
import { ITEMS } from "../src/weapons";
import { Rng } from "../src/rng";
import * as C from "../src/constants";
import * as wb from "../src/weapon_behaviors";
import {
  FUNKY_RGB, TUNNEL_DIRECTIONS, funkyArc, nextArcPoint,
  startSandhog, stepWeaponEffect, stepSandhogTick, type SandhogEffect, type FunkyEffect,
} from "../src/weapon_effects";

const reference = JSON.parse(readFileSync(new URL("./fixtures/dos_weapons.json", import.meta.url), "utf8"));

function game(seed = 1, scale = 1) {
  const cfg = new Config();
  cfg.SOUND = "OFF";
  cfg.TALKING_TANKS = "OFF";
  cfg.INITIAL_CASH = 0;
  cfg.MAX_WIND = 0;
  cfg.FALLING_TANKS = "OFF";
  const gs = createGameState(cfg, 320, 240, seed);
  gs.add_player("Owner", 0, 0, 0);
  gs.add_player("Target", 0, 0, 1);
  gs.new_game();
  gs.terrain.grid.fill(C.COL_SKY);
  for (let x = 0; x < 320; x++) for (let y = 120; y < 239; y++) gs.terrain.write(x, y, C.COL_DIRT);
  gs.tanks.forEach((t, i) => { t.x = i ? 290 : 30; t.y = 119; t.health = 100; t.alive = true; });
  gs.current_shooter = gs.tanks[0];
  gs.explosion_scale = scale;
  gs.phase = FIRING;
  return gs;
}
function shot(gs: ReturnType<typeof game>, idx: number, x = 160, y = 120) {
  const p = new Projectile(gs.tanks[0], ITEMS[idx], x, y, 0, -1);
  gs.projectiles.push(p);
  gs._resolve_hit(p, ["terrain", null, x, y]);
  return gs.projectiles.find((p) => p.active && p.weaponEffect)!;
}
function state(gs: ReturnType<typeof game>) { return gs as unknown as wb.BState; }
function projectile(p: Projectile) { return p as unknown as wb.BProjectile; }

describe("DOS weapon reference (independent of the historical Python oracle)", () => {
  it("uses the recovered table values, directions, and five color ramps", () => {
    expect(reference.items.map((i: { handler: string }) => i.handler)).toEqual(["2dce:0000", "251b:000a", "251b:000a", "251b:000a"]);
    for (const row of reference.items) {
      expect(ITEMS[row.idx].blast).toBe(row.value);
      if (row.idx !== 5) expect(ITEMS[row.idx].warheads).toBe(row.value);
    }
    expect(TUNNEL_DIRECTIONS).toEqual(reference.directions);
    expect(FUNKY_RGB).toEqual(reference.colors.map((c: number[]) => c.map((v) => v * 4)));
    expect(reference.charge_radius).toBe(10);
    expect(reference.charge_falloff).toBe(100);
  });
  for (const [i, curve] of reference.curves.entries()) {
    it(`matches every integer pixel of DOS fixed-point curve ${i}`, () => {
      const [x, y, target, floor, top] = curve.input;
      const arc = funkyArc(x, y, target, floor, top);
      const points = [];
      for (let p = nextArcPoint(arc); p; p = nextArcPoint(arc)) points.push(p);
      expect(points).toEqual(curve.points);
    });
  }
});

describe("Funky Bomb lifecycle", () => {
  it("starts a live colored burst and emits 5..10 curved trails over time", () => {
    const gs = game();
    const p = shot(gs, 5);
    const effect = p.weaponEffect as FunkyEffect;
    expect(effect.targets.length).toBeGreaterThanOrEqual(5);
    expect(effect.targets.length).toBeLessThanOrEqual(10);
    expect(effect.bursts).toEqual([{ x: 160, y: 120, radius: 20, grown: 0, color: 0 }]);
    expect(gs.explosions).toHaveLength(0);
    gs.update(1 / 60);
    expect(gs.phase).toBe(FIRING);
    expect(effect.bursts[0].grown).toBe(3); // independent of 32 ballistic substeps
    for (let i = 0; i < 1200 && p.active; i++) gs.update(1 / 60);
    expect(p.active).toBe(false);
    expect(effect.trails).toHaveLength(effect.targets.length);
    expect(effect.trails.some((t) => t.some(([, y]) => y < 110))).toBe(true);
    expect(effect.bursts).toHaveLength(effect.targets.length + 1);
    expect(effect.bursts.slice(1).every((b) => b.radius >= 15 && b.radius <= 24)).toBe(true);
    expect(gs.explosions.some((e) => e.maxr === 40)).toBe(true);
  });
  it("clamps scatter destinations at either edge", () => {
    for (const x of [1, 318]) {
      const gs = game();
      const e = shot(gs, 5, x).weaponEffect as FunkyEffect;
      expect(e.targets.every((x) => x >= 1 && x <= 318)).toBe(true);
    }
  });
  it("applies each colored burst once, when growth completes", () => {
    const gs = game();
    gs.tanks[1].x = 170; gs.tanks[1].y = 120;
    const p = shot(gs, 5);
    for (let i = 0; i < 6; i++) stepWeaponEffect(state(gs), projectile(p));
    expect(gs.tanks[1].health).toBe(100);
    stepWeaponEffect(state(gs), projectile(p));
    expect(gs.tanks[1].health).toBe(50);
    stepWeaponEffect(state(gs), projectile(p));
    expect(gs.tanks[1].health).toBe(50);
  });
});

describe("Sandhog dirt search and charges", () => {
  it("branches every eight steps and persists along available directions", () => {
    const gs = game();
    gs.rng = { pick: () => 0 } as unknown as Rng;
    const p = shot(gs, 24, 160, 160);
    const e = p.weaponEffect as SandhogEffect;
    for (let i = 0; i < 7; i++) stepSandhogTick(state(gs), projectile(p), e);
    expect(e.spawned).toBe(1);
    stepSandhogTick(state(gs), projectile(p), e);
    expect(e.spawned).toBe(2);
    expect(e.remaining).toBe(33);
    expect(e.tunnels.map((t) => [t.x, t.y, t.direction, t.next])).toEqual([
      [160, 152, 0, [160, 151]], [160, 152, 1, [161, 151]],
    ]);
    expect(gs.terrain.read(160, 155)).toBe(C.COL_SKY);
    expect(gs.terrain.read(159, 155)).toBe(C.COL_DIRT); // no invented five-pixel bore
  });
  it("follows dirt availability, independent of enemy position and array order", () => {
    const run = (reverse: boolean) => {
      const gs = game(5);
      if (reverse) { gs.tanks.reverse(); gs.tanks[0].x = 250; }
      const p = shot(gs, 23, 160, 180);
      for (let i = 0; i < 12; i++) stepWeaponEffect(state(gs), projectile(p));
      return [p.weaponEffect, gs.terrain.grid];
    };
    expect(run(false)).toEqual(run(true));
  });
  it("detonates when a tunnel runs out of adjacent dirt, with DOS charge damage", () => {
    const gs = game();
    gs.terrain.grid.fill(C.COL_SKY);
    gs.terrain.write(160, 120, C.COL_DIRT);
    gs.terrain.write(160, 121, C.COL_DIRT);
    gs.tanks[1].x = 160; gs.tanks[1].y = 120;
    gs.tanks[1].shield_hp = 500;
    const p = shot(gs, 22);
    for (let i = 0; i < 20 && p.active; i++) stepWeaponEffect(state(gs), projectile(p));
    expect(gs.tanks[1].alive).toBe(false);
    expect(gs.tanks[1].shield_hp).toBe(0);
    expect(p.active).toBe(false);
    expect((p.weaponEffect as SandhogEffect).spawned).toBe(1);
    expect(gs.tanks[1].hits_career[0]).toBe(1);
  });
  it("can damage its owner and restores shooter attribution after a volley step", () => {
    const gs = game();
    gs.terrain.grid.fill(C.COL_SKY);
    gs.terrain.write(160, 120, C.COL_DIRT);
    gs.tanks[0].x = 160; gs.tanks[0].y = 120;
    const p = shot(gs, 22);
    gs.current_shooter = gs.tanks[1];
    stepWeaponEffect(state(gs), projectile(p));
    expect(gs.tanks[0].alive).toBe(false);
    expect(gs.tanks[0].hits_career[0]).toBe(1);
    expect(gs.current_shooter).toBe(gs.tanks[1]);
  });
  it("wraps tunnels only with the wrap wall setting", () => {
    const run = (elastic: number) => {
      const gs = game();
      gs.cfg.live_elastic = elastic;
      gs.terrain.grid.fill(C.COL_SKY);
      gs.terrain.write(1, 120, C.COL_DIRT);
      gs.terrain.write(318, 120, C.COL_DIRT);
      const p = new Projectile(gs.tanks[0], ITEMS[22], 1, 120, 0, 0);
      startSandhog(state(gs), projectile(p), 1, 120);
      return (p.weaponEffect as SandhogEffect).tunnels[0].next;
    };
    expect(run(1)).toEqual([318, 120]);
    expect(run(5)).toBeNull();
  });
  for (const idx of [22, 23, 24]) for (const scale of [1, 1.5, 2]) {
    it(`terminates and respects the active/total budget for item ${idx}, scale ${scale}`, () => {
      const gs = game(42, scale);
      const p = shot(gs, idx, 160, 180);
      const e = p.weaponEffect as SandhogEffect;
      let maxActive = 0;
      let frames = 0;
      while (p.active && frames++ < 10000) {
        stepWeaponEffect(state(gs), projectile(p));
        maxActive = Math.max(maxActive, e.tunnels.length);
      }
      expect(p.active).toBe(false);
      expect(maxActive).toBeLessThanOrEqual(20);
      expect(e.spawned).toBeGreaterThan(1);
      expect(e.spawned).toBeLessThanOrEqual(ITEMS[idx].warheads);
      expect(e.remaining + e.spawned).toBe(ITEMS[idx].warheads);
      expect(e.tunnels).toHaveLength(0);
    });
  }
});

describe("game integration", () => {
  for (const idx of [22, 23, 24]) {
    it(`collapses every tunnel layer after item ${idx} finishes`, () => {
      const gs = game(42);
      gs.cfg.SUSPEND_DIRT = 0;
      shot(gs, idx, 160, 180);
      for (let i = 0; i < 10000 && gs.phase === FIRING; i++) gs.update(1 / 60);
      expect(gs.phase).toBe(SETTLE);
      const before = gs.terrain.grid.slice();
      const dirt = (grid: Uint8Array, x: number) =>
        Array.from(grid.slice(x * gs.h, (x + 1) * gs.h)).filter(C.is_dirt);
      // Sandhog creates several gaps in a single column before settling.
      expect(Array.from({ length: gs.w }, (_, x) =>
        Array.from(before.slice(x * gs.h, (x + 1) * gs.h)).filter((c, y, col) =>
          y > 0 && !C.is_dirt(c) && C.is_dirt(col[y - 1])).length).some((n) => n > 2)).toBe(true);
      gs.update(1 / 60);
      expect(gs.terrain.grid).not.toEqual(before);
      for (let x = 0; x < gs.w; x++) {
        const column = dirt(before, x);
        expect(dirt(gs.terrain.grid, x)).toEqual(column);
        expect(gs.terrain.column_top(x)).toBe(gs.h - column.length);
        for (let y = gs.terrain.column_top(x); y < gs.h; y++) {
          expect(gs.terrain.is_dirt(x, y)).toBe(true);
        }
      }
      expect(gs.tanks.every((t) => t.y === gs.terrain.column_top(t.x) - 1)).toBe(true);
    });
  }
  for (const idx of [5, 22, 23, 24]) {
    it(`keeps item ${idx} active until its effects finish, then clears all controllers`, () => {
      const gs = game(2);
      shot(gs, idx);
      let frames = 0;
      while (gs.phase === FIRING && frames++ < 10000) gs.update(1 / 60);
      expect(frames).toBeLessThan(10000);
      expect(gs.projectiles).toHaveLength(0);
      expect(gs.phase).not.toBe(FIRING);
    });
    it(`is deterministic for item ${idx}`, () => {
      const run = () => {
        const gs = game(17); shot(gs, idx);
        for (let i = 0; i < 100; i++) gs.update(1 / 60);
        return [gs.terrain.grid, gs.projectiles.map((p) => p.weaponEffect), gs.tanks.map((t) => [t.health, t.shield_hp])];
      };
      expect(run()).toEqual(run());
    });
  }
  for (const idx of [22, 23, 24]) for (const shield of [0, 5, 100]) {
    it(`item ${idx} chips direct contact instead of killing, shield=${shield}`, () => {
      const gs = game();
      const target = gs.tanks[1]; target.shield_hp = shield;
      const p = new Projectile(gs.tanks[0], ITEMS[idx], target.x, target.y, 0, -1);
      gs.projectiles.push(p);
      gs._resolve_hit(p, ["tank", target, target.x, target.y]);
      expect(target.health).toBe(shield ? 100 : 90);
      expect(target.shield_hp).toBe(Math.max(0, shield - 10));
      expect(p.active).toBe(false);
      expect(p.weaponEffect).toBeUndefined();
    });
  }
  it("Funky Bomb fizzles against a shield with a 10-HP chip", () => {
    const gs = game();
    const target = gs.tanks[1]; target.shield_hp = 100;
    const p = new Projectile(gs.tanks[0], ITEMS[5], target.x, target.y, 0, -1);
    gs.projectiles.push(p);
    gs._resolve_hit(p, ["tank", target, target.x, target.y]);
    expect(target.shield_hp).toBe(90);
    expect(p.active).toBe(false);
    expect(gs.projectiles.some((p) => p.weaponEffect)).toBe(false);
  });
  it("a contact-triggered Sandhog resolves at the surface", () => {
    const gs = game();
    const p = new Projectile(gs.tanks[0], ITEMS[23], 160, 120, 0, -1);
    p.contact = true;
    gs.projectiles.push(p);
    gs._resolve_hit(p, ["terrain", null, 160, 120]);
    expect(p.active).toBe(false);
    expect(p.weaponEffect).toBeUndefined();
    expect(gs.explosions.length).toBeGreaterThan(0);
  });
  it("a Funky Bomb resolving at the floor retains its secondary effect", () => {
    const gs = game();
    const p = new Projectile(gs.tanks[0], ITEMS[5], 160, 240, 0, -1);
    gs.projectiles.push(p);
    gs._resolve_off_field(p);
    expect(p.active).toBe(false);
    expect(gs.projectiles.some((p) => p.active && p.weaponEffect?.kind === "funky")).toBe(true);
  });
  for (const phase of [SYNC_VOLLEY, SIM_LIVE]) {
    it(`advances overlapping effects in ${phase} without settling early`, () => {
      const gs = game();
      const p = shot(gs, 5);
      const q = shot(gs, 24, 220, 150);
      gs.phase = phase;
      const before = gs.tanks.map((t) => t.y);
      gs.update(1 / 60);
      expect((p.weaponEffect as FunkyEffect).age).toBe(1);
      expect(q.active).toBe(true);
      expect(gs.tanks.map((t) => t.y)).toEqual(before);
      expect(gs.phase).toBe(phase);
    });
  }
});
