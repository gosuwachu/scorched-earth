import { describe, expect, it, vi } from "vitest";
import { Config } from "../src/config";
import { createGameState, ROUND_END, SIM_LIVE } from "../src/game";
import { Projectile } from "../src/objects";
import { ITEMS, SLOT_BATTERY, SLOT_PARACHUTE } from "../src/weapons";
import { startBlast } from "../src/combat_effects";
import * as C from "../src/constants";
import * as wb from "../src/weapon_behaviors";
import * as savegame from "../src/savegame";
import reference from "./fixtures/dos_weapons.json";

const DT = 1 / 60;

// Browser scheduling regressions. Gravity is disabled only for the long-lived
// background shot, so the tests never depend on reaching a globally idle frame.
function game() {
  const cfg = new Config();
  Object.assign(cfg, { PLAY_MODE: "SIMULTANEOUS", SOUND: "OFF", TALKING_TANKS: "OFF",
    INITIAL_CASH: 0, MAXROUNDS: 10, MAX_WIND: 0, SKY: "PLAIN", MTN_PERCENT: 0,
    FALLING_TANKS: "OFF", SUSPEND_DIRT: 0, GRAVITY: 0 });
  const gs = createGameState(cfg, 320, 240, 42);
  gs.add_player("A", C.AI_HUMAN, 0, 0);
  gs.add_player("B", C.AI_HUMAN, 0, 1);
  gs.new_game();
  gs.terrain.grid.fill(C.COL_SKY);
  for (let x = 0; x < gs.w; x++) for (let y = 160; y < gs.h; y++) gs.terrain.write(x, y, 88 + y % 5);
  gs.tanks.forEach((t, i) => { t.x = i ? 290 : 30; t.y = 159; });
  gs.current_shooter = gs.tanks[0];
  const airborne = new Projectile(gs.tanks[1], ITEMS[0], 50, 40, 5, 0);
  gs.projectiles.push(airborne);
  return { gs, airborne };
}
type Game = ReturnType<typeof game>["gs"];

function blast(gs: Game, x = 160, y = 185, radius = 20): Projectile {
  const shot = new Projectile(gs.tanks[0], ITEMS[0], x, y, 0, 0);
  startBlast(gs as unknown as wb.BState, shot as unknown as wb.BProjectile, x, y, radius);
  return gs.projectiles[gs.projectiles.length - 1];
}

function until(gs: Game, done: () => boolean, limit = 1000): void {
  for (let i = 0; i < limit && !done(); i++) gs.update(DT);
  expect(done()).toBe(true);
}

function colors(gs: Game, x: number): number[] {
  return Array.from(gs.terrain.grid.slice(x * gs.h, (x + 1) * gs.h)).filter(C.is_dirt);
}

function unsupported(gs: Game): number {
  let count = 0;
  for (let x = 0; x < gs.w; x++) {
    let gap = false;
    for (let y = gs.h - 1; y >= 0; y--) {
      const color = gs.terrain.read(x, y);
      if (C.is_dirt(color)) { if (gap) count++; }
      else gap = !C.is_solid(color);
    }
  }
  return count;
}

describe("simultaneous terrain settling", () => {
  it("finishes each crater during continuous fire and freezes then resumes other shots/effects", () => {
    const { gs, airborne } = game();
    for (let round = 0; round < 3; round++) {
      blast(gs, 100 + round * 40, 185 + round * 10);
      for (let i = 0; i < 12; i++) gs.update(DT);
      const other = blast(gs, 240, 190, 30);
      until(gs, () => gs.sim_settling);
      const flight = [airborne.px, airborne.py, airborne.vx, airborne.vy];
      const effect = JSON.stringify(other.weaponEffect);
      const shades = Array.from({ length: gs.w }, (_, x) => colors(gs, x));
      const timers = JSON.stringify(gs._sim);
      expect(unsupported(gs)).toBeGreaterThan(0);
      until(gs, () => {
        expect([airborne.px, airborne.py, airborne.vx, airborne.vy]).toEqual(flight);
        expect(JSON.stringify(other.weaponEffect)).toBe(effect);
        expect(JSON.stringify(gs._sim)).toBe(timers);
        return !gs.sim_settling;
      });
      expect(unsupported(gs)).toBe(0);
      expect(Array.from({ length: gs.w }, (_, x) => colors(gs, x))).toEqual(shades);
      gs.update(DT);
      expect(airborne.px).toBeGreaterThan(flight[0]);
      expect(JSON.stringify(other.weaponEffect)).not.toBe(effect);
      until(gs, () => !other.active && !gs.sim_settling);
      expect(gs.phase).toBe(SIM_LIVE);
      expect(gs.projectiles).toContain(airborne);
    }
  });

  for (const idx of [0, 5, 19, 24, 25, 28, 29, 30, 32]) {
    it(`requests settling after weapon ${idx} while another shot is airborne`, () => {
      const { gs, airborne } = game();
      const begin = vi.spyOn(gs.terrain, "begin_settle");
      const p = new Projectile(gs.tanks[0], ITEMS[idx], 160, 180, 1, 0);
      if (idx === 32) {
        p.state.energy = 2000;
        wb.fire_laser(gs as unknown as wb.BState, p as unknown as wb.BProjectile);
      } else {
        gs.projectiles.push(p);
        gs._resolve_hit(p, ["terrain", null, 160, 180]);
      }
      until(gs, () => begin.mock.calls.length > 0, 4000);
      expect(gs.projectiles).toContain(airborne);
    });
  }

  it("does not repeatedly reroll Suspend Dirt while a shot remains airborne", () => {
    const { gs } = game();
    gs.cfg.SUSPEND_DIRT = 40;
    const chance = vi.spyOn(gs.rng, "chance").mockReturnValue(false);
    const begin = vi.spyOn(gs.terrain, "begin_settle");
    const p = blast(gs);
    until(gs, () => !p.active);
    for (let i = 0; i < 30; i++) gs.update(DT);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(chance.mock.calls.filter(([n, d]) => n === 60 && d === 100)).toHaveLength(1);
    expect(unsupported(gs)).toBeGreaterThan(0);
  });

  it("respects full suspension and lets Earth Disrupter force the next collapse", () => {
    const { gs } = game();
    gs.cfg.SUSPEND_DIRT = 100;
    const p = blast(gs);
    until(gs, () => !p.active);
    expect(unsupported(gs)).toBeGreaterThan(0);
    const disrupt = new Projectile(gs.tanks[0], ITEMS[30], 160, 150, 0, 0);
    gs._resolve_hit(disrupt, ["terrain", null, 160, 150]);
    until(gs, () => gs.sim_settling);
    until(gs, () => !gs.sim_settling);
    expect(unsupported(gs)).toBe(0);
  });

  it("matches retained DOS resting columns and preserves connected cavern ceilings", () => {
    const { gs } = game();
    gs.live_sky = "CAVERN";
    reference.collapse.forEach((row, x) => {
      gs.terrain.grid.fill(0, (100 + x) * gs.h, (101 + x) * gs.h);
      gs.terrain.grid.set(row.input, (101 + x) * gs.h - row.input.length);
      gs.terrain.write(100 + x, 0, 88);
      gs.terrain.write(100 + x, 1, 89);
    });
    gs.request_terrain_settle();
    until(gs, () => !gs.sim_settling);
    reference.collapse.forEach((row, x) => {
      expect(Array.from(gs.terrain.grid.slice((101 + x) * gs.h - row.output.length, (101 + x) * gs.h))).toEqual(row.output);
      expect([gs.terrain.read(100 + x, 0), gs.terrain.read(100 + x, 1)]).toEqual([88, 89]);
    });
  });

  for (const chute of [false, true]) it(`finishes tank descent before resuming, parachute=${chute}`, () => {
    const { gs, airborne } = game();
    gs.cfg.FALLING_TANKS = "ON";
    const t = gs.tanks[0];
    t.inventory[SLOT_PARACHUTE] = chute ? 1 : 0;
    t.parachute_deployed = chute;
    for (let x = 15; x < 46; x++) for (let y = 160; y < 180; y++) gs.terrain.write(x, y, 0);
    gs.request_terrain_settle();
    const flight = airborne.px;
    gs.update(DT);
    expect(t.y).toBe(179);
    expect(t.health).toBe(chute ? 100 : 60);
    if (chute) {
      expect(gs.sim_settling).toBe(true);
      expect((t as typeof t & { chute_descent?: unknown }).chute_descent).toBeTruthy();
      until(gs, () => !gs.sim_settling);
      expect((t as typeof t & { chute_descent?: unknown }).chute_descent).toBeFalsy();
    }
    expect(airborne.px).toBe(flight);
    gs.update(DT);
    expect(airborne.px).toBeGreaterThan(flight);
  });

  it("resumes fall-triggered deaths and settles their craters before round end", () => {
    const { gs } = game();
    gs.cfg.FALLING_TANKS = "ON";
    const t = gs.tanks[0];
    t.inventory[SLOT_PARACHUTE] = 0;
    for (let x = 15; x < 46; x++) for (let y = 160; y < 230; y++) gs.terrain.write(x, y, 0);
    gs.request_terrain_settle();
    gs.update(DT);
    expect(t.alive).toBe(false);
    expect(gs.death_queue.length).toBeGreaterThan(0);
    expect(gs.phase).toBe(SIM_LIVE);
    gs.update(DT); // let the death entry perform its award and roulette selection
    Object.assign(gs.death_queue[0], { roll: 1, stage: "body", tick: 0 });
    until(gs, () => gs.phase === ROUND_END, 2000);
    expect(gs.death_queue).toHaveLength(0);
    expect(gs.projectiles.some((p) => p.weaponEffect)).toBe(false);
    expect(unsupported(gs)).toBe(0);
  });

  it("retains a forced request arriving during a collapse", () => {
    const { gs } = game();
    blast(gs);
    until(gs, () => gs.sim_settling);
    const begin = vi.spyOn(gs.terrain, "begin_settle");
    gs.request_terrain_settle(true);
    until(gs, () => !gs.sim_settling);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(begin.mock.calls[0][2]).toBe(true);
  });

  it("holds the AI recock timer until settling finishes", () => {
    const { gs } = game();
    const t = gs.tanks[0];
    t.ai_class = C.AI_SHOOTER;
    gs._sim[t.player_index].timer = 2;
    blast(gs);
    until(gs, () => gs.sim_settling);
    expect(gs._sim[t.player_index].timer).toBe(2);
    until(gs, () => !gs.sim_settling);
    expect(gs._sim[t.player_index].timer).toBe(2);
    gs.update(DT);
    expect(gs._sim[t.player_index].timer).toBe(2 - DT);
  });

  it("blocks local and remote launches without consuming resources, while aiming stays live", () => {
    const { gs } = game();
    const t = gs.tanks[0];
    t.inventory[1] = 3; t.selected_weapon = 1;
    gs.request_terrain_settle();
    gs.fire(); gs.fire(t); gs._sim_human_fire(t); gs.sim_fire(t);
    expect(t.inventory[1]).toBe(3);
    expect(gs.projectiles).toHaveLength(1);
    const angle = t.angle;
    gs.sim_adjust(t, -1, 0);
    expect(t.angle).toBe(angle - 1);
    gs.sim_cycle_weapon(t, -1);
    expect(t.selected_weapon).toBe(0);
    until(gs, () => !gs.sim_settling);
    expect(gs.projectiles).toHaveLength(1); // rejected presses were not queued
    t.selected_weapon = 1;
    gs.sim_fire(t);
    expect(t.inventory[1]).toBe(2);
    expect(gs.projectiles).toHaveLength(2);
  });

  for (const remote of [false, true]) it(`preserves the Plasma chooser and its charge during settling, remote=${remote}`, () => {
    const { gs } = game();
    const t = gs.tanks[0];
    t.inventory[31] = 2; t.inventory[SLOT_BATTERY] = 5; t.selected_weapon = 31;
    if (remote) { gs.sim_fire(t); gs.sim_set_plasma_charge(t, 3); }
    else { gs.fire(); gs.set_plasma_charge(3); }
    gs.request_terrain_settle();
    const confirm = () => remote ? gs.sim_confirm_plasma_charge(t) : gs.confirm_plasma_charge();
    confirm();
    expect(remote ? gs.sim_charges.get(t)?.value : gs.plasma_charge?.value).toBe(3);
    expect([t.inventory[31], t.batteries]).toEqual([2, 5]);
    until(gs, () => !gs.sim_settling);
    confirm();
    expect([t.inventory[31], t.batteries]).toEqual([1, 2]);
  });

  for (const restore of [false, true]) it(`clears an interrupted collapse on ${restore ? "restore" : "new round"}`, () => {
    const { gs } = game();
    const host = gs as unknown as savegame.SaveGameState;
    // Use the same terrain bridge as the application's save/restore screens.
    const saved = savegame.serialize({ ...host, terrain: { grid: { w: gs.w, h: gs.h, data: gs.terrain.grid } } });
    blast(gs);
    until(gs, () => gs.sim_settling);
    if (restore) {
      savegame.apply(saved, host);
      gs.terrain.grid = (gs.terrain.grid as unknown as savegame.TerrainGrid).data;
    }
    else gs.start_round();
    expect(gs.sim_settling).toBe(false);
    const grid = gs.terrain.grid.slice();
    gs.update(DT);
    expect(gs.terrain.grid).toEqual(grid);
    expect(gs.terrain.step_settle()).toBe(true);
  });

  it("replays the same overlapping effects deterministically", () => {
    const run = () => {
      const { gs, airborne } = game();
      blast(gs);
      const frames = [];
      for (let i = 0; i < 180; i++) {
        if (i === 12) blast(gs, 240, 190, 30);
        gs.update(DT);
        frames.push([gs.sim_settling, airborne.px, airborne.py, unsupported(gs)]);
      }
      return { frames, terrain: gs.terrain.grid, health: gs.tanks.map((t) => t.health) };
    };
    expect(run()).toEqual(run());
  });
});
