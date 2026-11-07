/** Browser feature tests; these intentional extensions are not DOS fixtures. */
import { describe, expect, it } from "vitest";
import { ModernWorld, BIOMES, LAYOUTS, type ModernData } from "../src/modern";
import { Terrain } from "../src/terrain";
import { Config } from "../src/config";
import { Rng } from "../src/rng";
import { createGameState } from "../src/game";
import { save, load, apply, type SaveGameState } from "../src/savegame";
import * as C from "../src/constants";

const config = () => Object.assign(new Config(), { TERRAIN_STYLE: "MODERN", TERRAIN_BIOME: "GRASS", TERRAIN_LAYOUT: "MOUNTAINS", INITIAL_CASH: 0, SOUND: "OFF", MAX_WIND: 0 });
const count = (m: ModernWorld) => m.cells.reduce((n, c) => n + (c > 0 ? 1 : 0), 0);
function view(gs: ReturnType<typeof createGameState>): SaveGameState {
  return { ...gs, terrain: { modern: gs.terrain.modern, grid: { w: gs.w, h: gs.h, data: gs.terrain.grid } } } as unknown as SaveGameState;
}
describe("Modern terrain", () => {
  it("generates reproducibly at twice the world resolution with fractional boundaries", () => {
    const a = ModernWorld.generate(320, 240, 71, config());
    const b = ModernWorld.generate(320, 240, 71, config());
    expect(a.cells).toEqual(b.cells);
    expect(a.cells.length).toBe(320 * 240 * 4);
    expect(a.surface.some(y => y % 1 !== 0)).toBe(true);
    const before = count(a); a.circle(100.25, 170.25, 12.75);
    expect(count(a)).toBeLessThan(before);
    // Exact cell-center circle contract, including the subpixel rim.
    for (let x = 180; x < 220; x++) for (let y = 320; y < 360; y++) {
      if (((x + 0.5) / 2 - 100.25) ** 2 + ((y + 0.5) / 2 - 170.25) ** 2 <= 12.75 ** 2) expect(a.cells[x * a.fh + y]).toBe(0);
    }
  });
  for (const biome of BIOMES) for (const layout of LAYOUTS) it(`${biome}/${layout}: safe spawns across seeds and supported player counts`, () => {
    for (const seed of [1, 2, 19]) for (const players of [2, 10]) {
      const cfg = Object.assign(config(), { TERRAIN_BIOME: biome, TERRAIN_LAYOUT: layout });
      const gs = createGameState(cfg, 640, 480, seed);
      for (let i = 0; i < players; i++) gs.add_player(`Tank${i}`, 0, 0, i);
      gs.new_game();
      for (const tank of gs.tanks) {
        expect(gs.terrain.is_supported(tank.x, tank.y, tank.half_width)).toBe(true);
        expect(gs.terrain.is_dirt(tank.x, tank.y - 6)).toBe(false);
        expect(tank.y).toBeGreaterThan(160);
        expect(tank.y).toBeLessThan(460);
        expect(gs.terrain.modern!.props.every(p => Math.abs(p.x - tank.x) >= p.w / 2 + tank.half_width + 18)).toBe(true);
      }
    }
  });
  it("preserves connected cave roofs, drops detached rubble and reaches a fixed point", () => {
    const m = ModernWorld.generate(200, 160, 5, { TERRAIN_LAYOUT: "CAVE", TERRAIN_BIOME: "SWAMP" });
    const ceiling = m.cells.slice(0, 25);
    m.circle(100, 115, 20); m.settle();
    expect(m.cells.slice(0, 25)).toEqual(ceiling);
    m.circle(50, 70, 8, true); const n = count(m); m.settle();
    expect(m.solid(50, 70)).toBe(false); expect(count(m)).toBe(n);
    const before = m.cells.slice(); m.settle(); expect(m.cells).toEqual(before);
  });
  it("destroys props through the terrain API, including loss of foundation", () => {
    const t = new Terrain(640, 480); const cfg = Object.assign(config(), { TERRAIN_LAYOUT: "CITY" });
    t.generate(cfg, new Rng(19)); t.modern!.placeProps([]);
    const m = t.modern!, p = m.props.find(p => p.kind === "tower")!;
    expect(p).toBeDefined(); expect(m.cells.includes(p.id)).toBe(true);
    // Clear the entire sloped foundation, including the uphill side contact.
    for (let x = Math.floor(p.x - p.w); x < p.x + p.w; x++) for (let y = p.y - 20; y < p.y + 20; y++) t.write(x, y, C.COL_SKY);
    t.settle(cfg, new Rng(5));
    expect(m.cells.includes(p.id)).toBe(false);
    expect(t.is_dirt(Math.round(p.x), Math.round(p.y - p.h / 2))).toBe(false);
  });
  it("sweeps thin half-unit obstacles without jumping over them", () => {
    const m = new ModernWorld(100, 100, 1, "GRASS", "MOUNTAINS");
    m.cells[81 * m.fh + 100] = 2;
    const hit = [...m.sweep(30, 50.2, 60, 50.2)].find(([x, y]) => m.solid(x, y));
    expect(hit?.[0]).toBe(40.5);
  });
  it("lets a missile clear the larger hull without striking its owner", () => {
    const gs = createGameState(config(), 1024, 768, 71);
    gs.add_player("One", 0, 0, 0); gs.add_player("Two", 0, 0, 1); gs.new_game(); gs.update(1 / 60);
    const tank = gs.current_shooter!; tank.angle = tank.x < 512 ? 35 : 145; tank.power = 330;
    gs.fire();
    for (let i = 0; i < 3; i++) gs.update(1 / 60);
    expect(tank.health).toBe(100);
    expect(gs.projectiles.some(p => !p.weaponEffect && Math.abs(p.px - tank.x) > tank.half_width)).toBe(true);
  });
  it("roundtrips damaged masks and fractional prop geometry through actual save bytes", () => {
    const gs = createGameState(Object.assign(config(), { TERRAIN_LAYOUT: "CITY" }), 320, 240, 9);
    gs.add_player("One", 0, 0, 0); gs.add_player("Two", 0, 0, 1); gs.new_game();
    gs.terrain.carve_circle(110, 185, 22.5);
    const source = view(gs), data = load(save(source), "modern.sav");
    const target = view(gs); apply(data, target);
    expect(target.terrain.modern!.cells).toEqual(gs.terrain.modern!.cells);
    expect(target.terrain.modern!.props).toEqual(gs.terrain.modern!.props);
    expect(target.terrain.grid.data).toEqual(gs.terrain.grid);
    const legacy = { ...data }; delete legacy.modernTerrain; legacy.cfg = {...data.cfg, TERRAIN_STYLE: "CLASSIC"};
    apply(legacy, target); expect(target.terrain.modern).toBeNull();
  });
  for (const slot of [0, 3, 8, 15, 20, 23, 25, 28, 29, 30, 32]) it(`weapon ${slot} completes on a Modern city`, () => {
    const gs = createGameState(Object.assign(config(), { TERRAIN_LAYOUT: "CITY", ELASTIC: "NONE" }), 640, 480, 7);
    gs.add_player("One", 0, 0, 0); gs.add_player("Two", 0, 0, 1); gs.new_game();
    gs.update(1 / 60);
    const t = gs.current_shooter!; t.selected_weapon = slot; t.inventory[slot] = 2;
    t.angle = t.x < gs.w / 2 ? 20 : 160; t.power = 280;
    gs.fire();
    let steps = 0;
    for (; steps < 3600; steps++) { gs.update(1 / 60); if (!gs.projectiles.length && !gs.explosions.length && steps > 10) break; }
    expect(steps).toBeLessThan(3600);
    expect(t.inventory[slot]).toBe(1);
    const m = gs.terrain.modern!;
    // Palette compatibility plane must not retain solid dirt where all fine cells are air.
    for (let x = 0; x < gs.w; x++) for (let y = 0; y < gs.h; y++) {
      const i = x * 2 * m.fh + y * 2;
      if (C.is_dirt(gs.terrain.grid[x * gs.h + y])) expect(!!(m.cells[i] || m.cells[i+1] || m.cells[i+m.fh] || m.cells[i+m.fh+1])).toBe(true);
    }
  });
  it("rejects invalid versions, dimensions, oversized runs and nonfinite props", () => {
    const m = ModernWorld.generate(120, 100, 1, config()); m.placeProps([]);
    for (const patch of [{version: 2}, {w: 999}, {runs: [48001, 1]}, {runs: [48000, 255]}, {seed: NaN}])
      expect(() => ModernWorld.restore({...m.serialize(), ...patch} as ModernData, 120, 100)).toThrow();
  });
});
