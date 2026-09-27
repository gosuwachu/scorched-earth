import { describe, expect, it } from "vitest";
import reference from "./fixtures/dos_tunneling.json";
import { Config } from "../src/config";
import { createGameState, _bresenham, FIRING } from "../src/game";
import { Projectile } from "../src/objects";
import { ITEMS } from "../src/weapons";
import * as physics from "../src/physics";
import { PHYSICS_DT } from "../src/constants";

function game(mode = "SEQUENTIAL") {
  const cfg = new Config();
  Object.assign(cfg, { SOUND: "OFF", FLY_SOUND: "OFF", TALKING_TANKS: "OFF", MAX_WIND: 0,
    INITIAL_CASH: 0, FALLING_TANKS: "OFF", GRAVITY: 0, PLAY_MODE: mode });
  const gs = createGameState(cfg, 320, 240, 42);
  gs.add_player("A", 0, 0, 0); gs.add_player("B", 0, 0, 1); gs.new_game();
  gs.terrain.grid.fill(0);
  gs.tanks.forEach((t, i) => { t.x = i ? 290 : 10; t.y = 220; });
  gs.current_shooter = gs.tanks[0]; gs.phase = FIRING;
  return gs;
}
type Game = ReturnType<typeof game>;
function shot(gs: Game, vx = 1000, vy = 0, item = 0) {
  const p = new Projectile(gs.tanks[0], ITEMS[item], 50, 100, vx, vy);
  gs.projectiles.push(p);
  return p;
}
function dirt(gs: Game, from: number, to: number) {
  for (let x = from; x <= to; x++) gs.terrain.write(x, 100, 96);
}

describe("DOS terrain penetration (static executable transcriptions)", () => {
  for (const f of reference.eligibility) it(`item ${f.item} has DOS spawn eligibility`, () => {
    expect(new Projectile(null, ITEMS[f.item], 0, 0, 0, 0).mode).toBe(f.mode);
  });
  it("matches the DOS raster in every octant, including ties and zero movement", () => {
    for (const f of reference.rasters)
      expect(_bresenham(f.start[0], f.start[1], f.end[0], f.end[1])).toEqual(f.pixels);
  });
  for (const [i, f] of reference.penetration.entries()) it(`attenuation/threshold case ${i}`, () => {
    const gs = game(), p = shot(gs, f.incoming[0], f.incoming[1]);
    dirt(gs, 51, 50 + f.pixels);
    p.px = p.sx = 50 + f.pixels;
    const hit = gs._check_collision(p);
    expect([p.vx, p.vy]).toEqual(f.velocity);
    expect(p.mode).toBe(1);
    expect(hit ? [hit[2], hit[3]] : null).toEqual(f.detonated ? [51 + f.cleared, 100] : null);
    for (let x = 51; x <= 50 + f.pixels; x++)
      expect(gs.terrain.is_dirt(x, 100)).toBe(x > 50 + f.cleared);
  });
  it("does not tunnel when disabled, contact-triggered, or ineligible", () => {
    for (const kind of ["off", "trigger", "roller", "tracer", "dirt charge"]) {
      const gs = game(), p = shot(gs, 1000, 0, kind === "roller" ? 12 : kind === "tracer" ? 10 : kind === "dirt charge" ? 29 : 0);
      if (kind === "off") gs.cfg.TUNNELLING = "OFF";
      if (kind === "trigger") p.contact = true;
      dirt(gs, 51, 55); p.px = p.sx = 55;
      expect(gs._check_collision(p)).toMatchObject({ 0: "terrain", 2: 51 });
      expect(p.vx).toBe(1000); expect(gs.terrain.is_dirt(51, 100)).toBe(true);
    }
  });
  it("uses incoming velocity, replaces air forces, then resumes them after exit", () => {
    const gs = game(), p = shot(gs, 600, 0);
    p.px = p.prev_px = 50.4;
    gs.cfg.GRAVITY = 0.2; gs.cfg.AIR_VISCOSITY = 20; gs.cfg.wind = 100;
    dirt(gs, 51, 51);
    gs._step_flight();
    expect([p.vx, p.vy, p.mode]).toEqual([450, 0, 1]);
    gs._step_flight();
    expect([p.vx, p.vy, p.mode]).toEqual([450, 0, -1]);
    gs._step_flight();
    expect(p.vy).toBeLessThan(0); expect(p.vx).not.toBe(450);
  });
  it("clears single pixels once, including subpixel and stationary revisits", () => {
    const gs = game(), p = shot(gs, 100, 0);
    dirt(gs, 50, 50);
    expect(gs._check_collision(p)).toBeNull();
    expect([p.vx, p.mode]).toEqual([75, 1]);
    gs._check_collision(p);
    expect([p.vx, p.mode]).toEqual([75, 1]);
    p.px += 0.1;
    gs._check_collision(p);
    expect([p.vx, p.mode]).toEqual([75, -1]);
    expect(gs.terrain.is_dirt(50, 99)).toBe(false);
  });
  it("starts at the previous rounded pixel rather than a truncated coordinate", () => {
    const gs = game(), p = shot(gs);
    p.prev_px = p.px = 50.75; p.sx = 51;
    dirt(gs, 50, 50);
    expect(gs._check_collision(p)).toBeNull();
    expect(p.vx).toBe(1000);
    expect(gs.terrain.is_dirt(50, 100)).toBe(true);
  });
  it("exits a thin ridge, re-enters dirt, and does not widen the tunnel", () => {
    const gs = game(), p = shot(gs);
    for (let x = 51; x <= 53; x++) for (let y = 99; y <= 101; y++) gs.terrain.write(x, y, 96);
    dirt(gs, 60, 60);
    for (let i = 0; i < 100 && p.px < 61; i++) gs._step_flight();
    expect(p.active).toBe(true); expect(p.vx).toBe(1000 * 0.75 ** 4);
    for (let x = 51; x <= 53; x++) {
      expect(gs.terrain.is_dirt(x, 100)).toBe(false);
      expect(gs.terrain.is_dirt(x, 99)).toBe(true);
      expect(gs.terrain.is_dirt(x, 101)).toBe(true);
    }
  });
  it("detonates inside thick dirt and dispatches Digger/Sandhog effects there", () => {
    for (const item of [0, 19, 22]) {
      const gs = game(), p = shot(gs, 1000, 0, item);
      dirt(gs, 51, 100);
      for (let i = 0; i < 500 && p.active && !p.weaponEffect; i++) gs._step_flight();
      expect(gs.last_landing).toEqual([61, 100]);
      expect(gs.projectiles.some((q) => q.weaponEffect?.kind === (item === 0 ? "blast" : "sandhog"))).toBe(true);
      expect(gs.terrain.is_dirt(60, 100)).toBe(false);
    }
  });
  it("stops at tanks, shields and the floor without continuing to carve", () => {
    for (const shield of [0, 41, 42]) {
      const gs = game(), p = shot(gs), target = gs.tanks[1];
      target.x = 90; target.y = 104;
      if (shield) { target.inventory[shield] = 1; gs._arm_best_shield(target, false); }
      dirt(gs, 51, 51); dirt(gs, 110, 110); p.px = p.sx = 120;
      const hit = gs._check_collision(p)!;
      expect(hit[0]).toBe(shield ? "shield" : "tank");
      expect(p.saved_vx).toBe(750);
      gs._resolve_hit(p, hit);
      if (shield === 42) expect(p.vx).toBeLessThan(0);
      expect(gs.terrain.is_dirt(110, 100)).toBe(true);
    }
    const gs = game(), p = shot(gs); p.py = p.sy = gs.h;
    expect(gs._check_collision(p)).toMatchObject({ 0: "terrain", 3: gs.h - 2 });
  });
  it("OFF and Contact Triggers start special effects at the first dirt pixel", () => {
    for (const item of [12, 19, 22]) for (const trigger of [false, true]) {
      const gs = game(), p = shot(gs, 1000, 0, item);
      gs.cfg.TUNNELLING = trigger ? "ON" : "OFF"; p.contact = trigger;
      dirt(gs, 51, 100);
      for (let i = 0; i < 5 && gs.last_landing === null; i++) gs._step_flight();
      expect(gs.last_landing).toEqual([51, 100]);
      expect(p.active).toBe(true);
      if (item === 12) expect(p.state.rolling).toBe(true);
      else expect(p.weaponEffect?.kind).toBe("sandhog");
    }
  });
  it("retains contact overrides for guidance, MIRV children and LeapFrog hops", () => {
    for (const slot of [33, 34, 35, 36, 37]) {
      const gs = game(), t = gs.tanks[0]; t.inventory[slot] = 2; t.selected_guidance = slot;
      const p = physics.launch(t, gs.cfg, ITEMS[0]);
      expect(p.contact).toBe(slot !== 34);
      expect(t.inventory[slot]).toBe(2);
      expect(t.contact_trigger).toBe(false);
    }
    const gs = game(); gs.cfg.GRAVITY = 0.2;
    const p = shot(gs, 100, 0.01, 6); p.contact = true;
    gs._step_flight();
    expect(gs.projectiles).toHaveLength(5);
    expect(gs.projectiles.every((q) => q.contact)).toBe(true);
    const frog = shot(gs, 100, -100, 4); frog.contact = true;
    gs._leapfrog_hop(frog, 80, 90);
    expect(gs.projectiles.at(-1)!.contact).toBe(true);
  });
  it("is deterministic across play modes and subdivided straight-line steps", () => {
    const runs = [];
    for (const mode of ["SEQUENTIAL", "SYNCHRONOUS", "SIMULTANEOUS"]) for (const dt of [PHYSICS_DT, PHYSICS_DT / 4]) {
      const gs = game(mode), p = shot(gs);
      dirt(gs, 51, 100);
      for (let i = 0; i < 4000; i++) {
        physics.step(p, gs.cfg, dt);
        const hit = gs._check_collision(p);
        if (hit) { runs.push([hit[2], hit[3], p.vx, p.vy, [...gs.terrain.grid]]); break; }
      }
    }
    expect(runs).toHaveLength(6);
    for (const r of runs) expect(r).toEqual(runs[0]);
  });
});

describe("tunneling configuration", () => {
  it("defaults ON and preserves explicit saved OFF values", () => {
    expect(new Config().TUNNELLING).toBe("ON");
    expect(Config.load("").TUNNELLING).toBe("ON");
    for (const value of ["ON", "OFF"]) {
      const cfg = Config.load(`TUNNELLING=${value}\n`);
      expect(cfg.TUNNELLING).toBe(value);
      expect(Config.load(cfg.save()).TUNNELLING).toBe(value);
    }
  });
});
