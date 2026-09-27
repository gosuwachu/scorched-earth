import { describe, expect, it } from "vitest";
import reference from "./fixtures/dos_combat.json";
import { Config } from "../src/config";
import { createGameState, AIM, FIRING, SETTLE, SIM_LIVE, SYNC_VOLLEY } from "../src/game";
import { Projectile } from "../src/objects";
import { ITEMS } from "../src/weapons";
import { Terrain } from "../src/terrain";
import { Rng } from "../src/rng";
import * as C from "../src/constants";
import * as wb from "../src/weapon_behaviors";
import { blastTexture, blastPixel, flameColor, plasmaRadius, startBlast, type BlastEffect } from "../src/combat_effects";
import { stepWeaponEffect, type SandhogEffect } from "../src/weapon_effects";
import { handleCharge } from "../src/energy_controls";
import * as pg from "../src/pygame";
import { stormBolt } from "../src/storm";
import type { State as HazardState } from "../src/hazard";
import * as damage from "../src/damage";
import type { DeathEffect } from "../src/death_effects";
import { compositeTerrainRgb } from "../src/render";
import { LiveLUT } from "../src/palette";

function game(seed = 42) {
  const cfg = new Config();
  Object.assign(cfg, { SOUND: "OFF", TALKING_TANKS: "OFF", SKY: "PLAIN", INITIAL_CASH: 0, FALLING_TANKS: "OFF", MAX_WIND: 0 });
  const gs = createGameState(cfg, 320, 240, seed);
  gs.add_player("A", 0, 0, 0); gs.add_player("B", 0, 0, 1); gs.new_game();
  gs.terrain.grid.fill(0);
  for (let x = 0; x < gs.w; x++) for (let y = 160; y < gs.h; y++) gs.terrain.write(x, y, C.COL_DIRT);
  gs.tanks.forEach((t, i) => { t.x = i ? 290 : 30; t.y = 159; t.alive = true; t.health = 100; });
  gs.current_shooter = gs.tanks[0]; gs.phase = FIRING; gs.explosion_scale = 1;
  return gs;
}
function step(gs: ReturnType<typeof game>) {
  for (const p of gs.projectiles.slice()) if (p.weaponEffect)
    stepWeaponEffect(gs as unknown as wb.BState, p as unknown as wb.BProjectile);
  gs.projectiles = gs.projectiles.filter((p) => p.active);
}
function detonate(gs: ReturnType<typeof game>, idx: number, x = 160, y = 160) {
  const shot = new Projectile(gs.tanks[0], ITEMS[idx], x, y, 0, 1);
  shot.split_done = true;
  wb.detonate(gs as unknown as wb.BState, shot as unknown as wb.BProjectile, x, y);
  return gs.projectiles[gs.projectiles.length - 1];
}
function finish(gs: ReturnType<typeof game>) {
  for (let n = 0; n < 4000 && gs.projectiles.length; n++) step(gs);
  expect(gs.projectiles).toHaveLength(0);
}

describe("independent DOS combat fixtures", () => {
  it("uses the original flame ramps and keeps scorched soil visible", () => {
    expect([179, 189, 199].map((i) => flameColor(i))).toEqual([[244, 76, 76], [244, 112, 76], [244, 244, 76]]);
    expect(flameColor(199, 1)).toEqual([172, 40, 40]);
    expect(flameColor(179, 30)).toEqual(flameColor(179));
    const grid = new Uint8Array([81, 82, 83, 84, 85]);
    const lut = new LiveLUT();
    const rgb = compositeTerrainRgb(grid, 1, 5, lut, { rgb: new Uint8Array(15).fill(255) });
    expect(Array.from(rgb).every((v) => v < 255)).toBe(true);
    for (let i = 3; i < 15; i++) expect(rgb[i]).toBeGreaterThanOrEqual(rgb[i - 3]);
  });
  it("accounts for all 33 original dispatch entries", () => {
    expect(reference.items).toHaveLength(33);
    expect(reference.items[28]).toEqual({ idx: 28, handler: "36e6:01a0", value: -20 });
    expect(reference.items[31].handler).toBe("3770:0009");
    for (const { idx, value } of reference.items) {
      if ([4, 6, 7, 11, 15, 16, 29, 31].includes(idx)) continue; // handler selectors
      expect(ITEMS[idx].blast).toBe(value);
    }
    expect(reference.mirv).toEqual([20, 35, 5, 9, 50, 20]);
    expect(reference.leap_radii).toEqual([20, 25, 30]);
    expect(reference.leap_divisor).toBe(1.5);
  });
  for (const fixture of reference.texture) it(`reproduces every texture pixel at ${fixture.w}x${fixture.h}`, () => {
    let seed = 123456789;
    const rng = { pick(n: number) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return n ? seed % n : 0; } };
    expect(Array.from(blastTexture(fixture.w, fixture.h, rng))).toEqual(fixture.pixels);
  });
  for (const f of reference.plasma) it(`interpolates all Plasma charges at scale ${f.scale}`, () => {
    expect(Array.from({ length: 11 }, (_, n) => plasmaRadius(f.scale, n))).toEqual(f.radii);
  });
  for (const f of reference.damage) it(`applies standard damage item ${f.idx} at distance ${f.distance}`, () => {
    const gs = game();
    const t = gs.tanks[1]; t.x = 160 + f.distance; t.y = 160; t.shield_hp = 1000;
    detonate(gs, f.idx);
    expect(t.shield_hp).toBe(1000);
    finish(gs);
    expect(t.shield_hp).toBe(1000 - f.amount);
    expect(t.hits_career[0]).toBe(1);
  });
});

describe("blast and energy semantics", () => {
  it("grows textured nukes, cycles without changing texture, dissolves, then damages", () => {
    const gs = game(); const p = detonate(gs, 3); const e = p.weaponEffect as BlastEffect;
    expect(e.textured).toBe(true); expect(e.radius).toBe(75);
    const pixels = e.pixels.slice();
    for (let n = 0; n < 38; n++) step(gs);
    expect(e.phase).toBe("hold"); expect(e.grown).toBe(75);
    const before = blastPixel(e, 0, 0); step(gs);
    expect(blastPixel(e, 0, 0)).not.toEqual(before); expect(e.pixels).toEqual(pixels);
    for (let n = 0; n < 99; n++) step(gs);
    expect(e.phase).toBe("erase"); expect(gs.terrain.is_dirt(160, 160)).toBe(false);
    finish(gs);
  });
  it("Plasma excludes terrain and the owner, includes enemies, and damages once", () => {
    const gs = game(); const owner = gs.tanks[0]; owner.x = 150; owner.y = 159;
    gs.tanks[1].x = 165; gs.tanks[1].y = 159; gs.tanks[1].shield_hp = 200;
    const original = gs.terrain.grid.slice();
    const p = detonate(gs, 31, owner.x, owner.y); const e = p.weaponEffect as BlastEffect;
    e.grown = e.radius;
    expect(blastPixel(e, 0, 0)).toBeNull(); expect(blastPixel(e, 0, 2)).toBeNull();
    finish(gs);
    expect(owner.health).toBe(100); expect(gs.terrain.grid).toEqual(original);
    expect(gs.tanks[1].shield_hp).toBe(90); expect(gs.tanks[1].hits_career[0]).toBe(1);
  });
  for (const mode of ["SEQUENTIAL", "SYNCHRONOUS", "SIMULTANEOUS"]) it(`charges/cancels/consumes Plasma in ${mode}`, () => {
    const gs = game(); gs.cfg.PLAY_MODE = mode; gs.phase = mode === "SIMULTANEOUS" ? SIM_LIVE : AIM;
    const t = gs.tanks[0]; t.selected_weapon = 31; t.inventory[31] = 2; t.inventory[39] = 12;
    gs.fire(); expect(gs.plasma_charge?.max).toBe(10); expect(t.inventory[31]).toBe(2);
    handleCharge(gs, { type: pg.KEYDOWN, key: pg.K_ESCAPE }); expect(gs.plasma_charge).toBeNull();
    gs.fire(); gs.set_plasma_charge(100); expect(gs.plasma_charge?.value).toBe(10);
    gs.confirm_plasma_charge();
    if (mode === "SYNCHRONOUS") gs._sync_launch_volley();
    expect(t.inventory[39]).toBe(2); expect(t.inventory[31]).toBe(1);
    expect(gs.projectiles[0].weaponEffect).toMatchObject({ kind: "blast", plasma: true, radius: 75 });
  });
  it("fires without a charge dialog when no Batteries are owned", () => {
    const gs = game(); gs.phase = AIM; gs.tanks[0].selected_weapon = 31; gs.tanks[0].inventory[31] = 1;
    gs.fire(); expect(gs.plasma_charge).toBeNull();
    expect(gs.projectiles[0].weaponEffect).toMatchObject({ radius: 20, plasma: true });
  });
  it("Laser stops at a tank, uses ten-point pulses and recharges Super Mag", () => {
    for (const superMag of [false, true]) {
      const gs = game(); gs.terrain.grid.fill(0);
      const target = gs.tanks[1]; target.x = 100; target.y = 100; target.shield_hp = superMag ? 100 : 500;
      target.shield_laserproof = superMag;
      const p = new Projectile(gs.tanks[0], ITEMS[32], 90, 96, 1, 0); p.state.energy = 1000;
      wb.fire_laser(gs as unknown as wb.BState, p as unknown as wb.BProjectile);
      expect(p.trail[p.trail.length - 1]).toEqual([93, 96]);
      expect(target.shield_hp).toBe(superMag ? 108 : 460);
      expect(gs.beams).toHaveLength(1);
    }
  });
});

describe("dirt, fluid, cluster and tunnel families", () => {
  it("fires Dirt Charge as a projectile before spraying at its impact", () => {
    const gs = game(); gs.phase = AIM;
    const t = gs.tanks[0]; t.inventory[29] = 2; t.selected_weapon = 29;
    gs.fire();
    expect(gs.projectiles).toHaveLength(1);
    expect(gs.projectiles[0].weaponEffect).toBeUndefined();
    expect(gs.projectiles[0].vx !== 0 || gs.projectiles[0].vy !== 0).toBe(true);
    gs._resolve_hit(gs.projectiles[0], ["terrain", null, 160, 160]);
    expect(gs.projectiles.at(-1)?.weaponEffect).toMatchObject({ kind: "soil", mode: "spray", x: 160 });
  });
  for (const contact of [false, true]) it(`finishes LeapFrog blasts before relaunching, contact=${contact}`, () => {
    const gs = game();
    let p = new Projectile(gs.tanks[0], ITEMS[4], 160, 160, 90, -120);
    p.contact = contact;
    p.state.launchVx = 90; p.state.launchVy = -120;
    for (const [i, radius] of [30, 25, 20].entries()) {
      gs.projectiles = [p];
      gs._resolve_hit(p, ["terrain", null, 160, 160]);
      gs.projectiles = gs.projectiles.filter((p) => p.active);
      expect(gs.projectiles[0].weaponEffect).toMatchObject({ radius });
      for (let frame = 0; frame < 200 && gs.projectiles.some((p) => p.weaponEffect); frame++) step(gs);
      if (i < 2) {
        expect(gs.projectiles).toHaveLength(1); p = gs.projectiles[0];
        expect(p.weaponEffect).toBeUndefined(); expect(p.vx).toBeCloseTo(90 / 1.5 ** (i + 1));
        expect(p.vy).toBeCloseTo(-120 / 1.5 ** (i + 1));
        expect(p.contact).toBe(contact);
      } else expect(gs.projectiles).toHaveLength(0);
    }
  });
  it("rolls down cliffs one pixel at a time and bursts at an uphill wall", () => {
    const gs = game(); gs.terrain.grid.fill(0);
    for (let x = 0; x < 320; x++) for (let y = x < 100 ? 120 : 150; y < 240; y++) gs.terrain.write(x, y, 80);
    const p = new Projectile(gs.tanks[0], ITEMS[13], 98, 120, 5, 0);
    wb.start_roller(gs as unknown as wb.BState, p as unknown as wb.BProjectile, 98, 120);
    wb.step_roller(gs as unknown as wb.BState, p as unknown as wb.BProjectile);
    wb.step_roller(gs as unknown as wb.BState, p as unknown as wb.BProjectile);
    expect([p.px, p.py]).toEqual([100, 119]);
    wb.step_roller(gs as unknown as wb.BState, p as unknown as wb.BProjectile);
    expect([p.px, p.py]).toEqual([100, 120]);
    p.py = 149; gs.terrain.write(101, 149, 80);
    expect(wb.step_roller(gs as unknown as wb.BState, p as unknown as wb.BProjectile)).toBe(false);
    expect(gs.projectiles[0].weaponEffect).toMatchObject({ kind: "blast", radius: 20 });
  });
  it("only Smoke Tracer leaves a trail with TRACE disabled", () => {
    const gs = game(); gs.cfg.TRACE = "OFF";
    for (const idx of [10, 11]) {
      const p = new Projectile(gs.tanks[0], ITEMS[idx], 100, 100, 1, 1);
      p.prev_px = 99; p.prev_py = 101; gs._collect_trace(p); gs._flush_trace(p);
      expect(gs.trace_marks.length > 0).toBe(idx === 11);
    }
  });
  it("lightning stops at dirt, and only directly hit tanks take hostile damage", () => {
    for (const hostile of [false, true]) {
      const gs = game(); gs.cfg.HOSTILE_ENVIRONMENT = hostile ? "ON" : "OFF";
      // Straight vertical line: midpoint endpoint, no random bend/branch.
      gs.rng = { pick: (n: number) => n === 10 || n === 50 ? 0 : Math.floor((n - 1) / 2) } as Rng;
      gs.tanks[1].x = 160; gs.tanks[1].y = 140;
      const lines = stormBolt(gs as unknown as HazardState, 160);
      expect(lines.flat().slice(-1)[0]).toEqual([160, 130]);
      expect(gs.tanks[1].health).toBe(hostile ? 90 : 100);
      expect(gs.tanks[0].health).toBe(100);
      gs.tanks[1].x = 250;
      const ground = stormBolt(gs as unknown as HazardState, 160);
      expect(ground.flat().slice(-1)[0]).toEqual([160, 160]);
      expect(gs.terrain.is_dirt(160, 160)).toBe(true);
    }
  });
  it("bounds lightning even if every random bend repeats the same pixel", () => {
    const gs = game(); gs.rng = { pick: () => 2 } as unknown as Rng;
    expect(() => stormBolt(gs as unknown as HazardState, 160)).not.toThrow();
    expect(gs.tanks.map((t) => t.health)).toEqual([100, 100]);
  });
  for (const idx of [25, 26, 27]) it(`grows item ${idx} without scaling and leaves a buried tank in place`, () => {
    const gs = game(); gs.explosion_scale = 3; gs.tanks[1].x = 160;
    const original = gs.terrain.grid.slice(); const p = detonate(gs, idx);
    expect(gs.terrain.grid).toEqual(original);
    expect(p.weaponEffect).toMatchObject({ radius: ITEMS[idx].blast });
    step(gs); expect(gs.terrain.grid).not.toEqual(original);
    finish(gs); gs._do_settle();
    expect(gs.tanks[1].y).toBe(159); expect(gs.terrain.is_dirt(160, 153)).toBe(true);
  });
  it("Liquid Dirt flows downhill and Napalm scorches without a circular crater", () => {
    for (const idx of [8, 9, 28]) {
      const gs = game(); const p = detonate(gs, idx, 160, 150);
      const e = p.weaponEffect; expect(e?.kind).toBe("fluid");
      finish(gs);
      if (e?.kind !== "fluid") throw new Error("wrong handler");
      expect(e.points.length).toBeGreaterThan(20);
      expect(e.points.some(([, y]) => y === 159)).toBe(true);
      if (idx === 28) expect(e.points.every(([x, y]) => gs.terrain.is_dirt(x, y))).toBe(true);
      else { expect(e.flames.length).toBeGreaterThan(0); expect(gs.terrain.is_dirt(160, 165)).toBe(true); }
    }
  });
  it("Earth Disrupter forces animated collapse under 100% suspension", () => {
    const gs = game(); gs.cfg.SUSPEND_DIRT = 100;
    gs.terrain.carve_circle(160, 185, 15); const old = gs.terrain.grid.slice();
    detonate(gs, 30); finish(gs); expect(gs.terrain.grid).toEqual(old);
    for (let i = 0; i < 300 && !gs._advance_settle(); i++) { /* animate */ }
    expect(gs.terrain.grid).not.toEqual(old);
    expect(gs.terrain.is_dirt(160, 239)).toBe(true);
  });
  for (const idx of [6, 7]) it(`keeps the central warhead and waits for the entire item ${idx} cluster`, () => {
    const gs = game(); const p = new Projectile(gs.tanks[0], ITEMS[idx], 160, 50, 0, 0); gs.projectiles.push(p);
    wb.on_apogee(gs as unknown as wb.BState, p as unknown as wb.BProjectile);
    expect(gs.projectiles).toHaveLength(idx === 6 ? 5 : 9); expect(p.active).toBe(true);
    const group = gs.projectiles.slice();
    gs._resolve_hit(p, ["terrain", null, 160, 160]); gs.projectiles = gs.projectiles.filter((p) => p.active);
    const e = gs.projectiles.find((p) => p.weaponEffect)?.weaponEffect as BlastEffect;
    for (let n = 0; n < 200; n++) step(gs);
    expect(e.phase).toBe("hold"); expect(gs.terrain.is_dirt(160, 160)).toBe(true);
    for (const child of group.slice(1)) gs._resolve_hit(child, ["terrain", null, 180, 160]);
    gs.projectiles = gs.projectiles.filter((p) => p.active); finish(gs);
    expect(gs.terrain.is_dirt(160, 160)).toBe(false);
  });
  for (const idx of [19, 20, 21]) it(`digger ${idx} branches with twice its base budget and no terminal explosions`, () => {
    const gs = game(); const p = new Projectile(gs.tanks[0], ITEMS[idx], 160, 180, 0, 0); gs.projectiles.push(p);
    wb.start_digger(gs as unknown as wb.BState, p as unknown as wb.BProjectile, 160, 180);
    const e = p.weaponEffect as SandhogEffect;
    expect(e.remaining).toBe(Math.abs(ITEMS[idx].blast) * 2 - 1); finish(gs);
    expect(e.charges).toHaveLength(0); expect(gs.explosions).toHaveLength(0);
  });
  it("animated settling preserves every dirt color and a connected cavern ceiling", () => {
    const t = new Terrain(2, 16); const cfg = new Config(); const rng = new Rng(42);
    for (const y of [0, 1, 5, 6, 9]) t.write(0, y, 80 + y);
    t.begin_settle(cfg, rng, false, true);
    expect(t.step_settle()).toBe(false);
    for (let i = 0; i < 30 && !t.step_settle(); i++) { /* animate */ }
    expect(Array.from(t.grid.slice(0, 16)).filter(C.is_dirt)).toEqual([80, 81, 85, 86, 89]);
    expect(t.read(0, 0)).toBe(80); expect(t.read(0, 1)).toBe(81);
    expect(t.read(0, 15)).toBe(89);
  });
});

describe("death chains", () => {
  it("scatters the actual hull pixels through sky and stops them at terrain", () => {
    const gs = game(); const t = gs.tanks[0]; t.x = 160;
    gs.combat_throe("debris", t.x, t.y, t);
    const e = gs.projectiles[0].weaponEffect as DeathEffect;
    expect(e.pieces.length).toBeGreaterThan(14);
    for (let n = 0; n < 5; n++) step(gs);
    expect(e.pieces.some((p) => p.y < t.y - 15)).toBe(true);
    finish(gs);
    expect(e.pieces).toHaveLength(0);
    expect(gs.terrain.is_dirt(160, 160)).toBe(true);
  });
  it("keeps the killing player when another volley projectile becomes current", () => {
    const gs = game(); const [killer, victim] = gs.tanks;
    gs.cfg.SCORING = "BASIC";
    damage.apply_tank_damage(gs as unknown as damage.State, victim, 110);
    gs.current_shooter = victim;
    gs._step_death_queue();
    expect(killer.score).toBe(C.SCORE_KILL_BASIC);
    expect(victim.score).toBe(0);
    expect(gs.current_shooter).toBe(victim);
  });
  it("spark death deals twenty points once, leaves sparse holes, and excludes its center", () => {
    const gs = game(); const [center, nearby] = gs.tanks;
    center.x = 160; center.y = 160; nearby.x = 180; nearby.y = 160;
    gs.combat_throe("spiral", 160, 160);
    const e = gs.projectiles[0].weaponEffect as DeathEffect;
    const r = e.radius;
    expect(r).toBeGreaterThanOrEqual(45); expect(r).toBeLessThan(105);
    finish(gs);
    expect(center.health).toBe(100); expect(nearby.health).toBe(80);
    expect(e.points.size).toBeGreaterThan(100);
    expect(Array.from(e.points.keys()).some((key) => Math.floor(key / gs.w) >= 160)).toBe(true);
    expect(gs.terrain.is_dirt(160 + r, 160)).toBe(true);
  });
  for (let roll = 0; roll < 11; roll++) it(`drains death case ${roll} and returns control`, () => {
    const gs = game(123); const victim = gs.tanks[1];
    damage.apply_tank_damage(gs as unknown as damage.State, victim, 110);
    gs.death_queue[0].roll = roll; gs.death_queue[0].stage = "body";
    for (let frame = 0; frame < 5000 && (gs.death_queue.length || gs.projectiles.length || gs.throe_fx.length); frame++) gs._animate_effects();
    expect(gs.death_queue).toHaveLength(0); expect(gs.projectiles).toHaveLength(0); expect(gs.throe_fx).toHaveLength(0);
  });
});

describe("all original weapons complete in every play mode", () => {
  for (const phase of [FIRING, SYNC_VOLLEY, SIM_LIVE]) for (let idx = 0; idx < 33; idx++) {
    it(`${ITEMS[idx].name}, ${phase}`, () => {
      const gs = game(); gs.phase = phase;
      gs.cfg.PLAY_MODE = phase === FIRING ? "SEQUENTIAL" : phase === SYNC_VOLLEY ? "SYNCHRONOUS" : "SIMULTANEOUS";
      const p = new Projectile(gs.tanks[0], ITEMS[idx], 160, 160, 0, 1);
      p.split_done = true; gs.projectiles.push(p);
      if (idx === 32) { p.state.energy = 1000; wb.fire_laser(gs as unknown as wb.BState, p as unknown as wb.BProjectile); }
      else gs._resolve_hit(p, ["terrain", null, 160, 160]);
      for (let frame = 0; frame < 5000; frame++) {
        gs.update(1 / 60);
        if (!gs.projectiles.length && !gs.death_queue.length && !gs.explosions.length && gs.phase !== SETTLE) break;
      }
      expect(gs.projectiles).toHaveLength(0); expect(gs.death_queue).toHaveLength(0);
      expect(gs.explosions).toHaveLength(0); expect(gs.phase).not.toBe(SETTLE);
      expect(gs.tanks.every((t) => Number.isFinite(t.health) && t.health >= 0)).toBe(true);
    });
  }
});
