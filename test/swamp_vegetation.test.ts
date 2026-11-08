import { describe, expect, it } from "vitest";
import { CaveLayers } from "../src/cave_layers";
import { ModernWorld } from "../src/modern";
import { SWAMP_SCENERY, swampScenery } from "../src/swamp_vegetation";

const cave = (seed = 71, w = 1024, h = 768) => ModernWorld.generate(w, h, seed,
  { TERRAIN_BIOME: "SWAMP", TERRAIN_LAYOUT: "CAVE" });

describe("painted swamp scenery", () => {
  it.each([1, 19, 71, 313])("keeps a few varied clumps and embedded rock clusters for seed %i", seed => {
    const world = cave(seed), before = world.cells.slice();
    const scenery = swampScenery(world);
    const plants = scenery.filter(p => p.kind === "plant"), roots = scenery.filter(p => p.kind === "root");
    const rock = scenery.filter(p => p.kind === "stalactite"), moss = scenery.filter(p => p.kind === "moss");
    expect(plants.length).toBeLessThanOrEqual(8);
    expect(roots.length).toBeLessThanOrEqual(3);
    expect(rock.length).toBeLessThanOrEqual(5);
    // Mountain slopes reject some slots so plants remain on supported banks.
    expect(plants.length).toBeGreaterThanOrEqual(4);
    expect(roots.length).toBeGreaterThan(0);
    expect(rock.length).toBeGreaterThanOrEqual(4);
    expect(new Set(plants.map(p => p.variant)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(rock.map(p => p.variant)).size).toBe(4);
    expect(new Set(plants.map(p => Math.round(p.h))).size).toBeGreaterThan(3);
    const large = plants.filter(p => p.h >= 80);
    expect(large.length).toBeGreaterThanOrEqual(1);
    expect(large.length).toBeLessThanOrEqual(2);
    expect(Math.max(...plants.map(p => p.h)) / Math.min(...plants.map(p => p.h))).toBeGreaterThan(2);
    expect(rock.every(p => p.w >= 84 && p.h >= 113)).toBe(true);
    expect(moss.length).toBe(3);
    expect(new Set(moss.map(p => p.variant)).size).toBe(3);
    expect(moss.every(p => p.ceilingLayer && p.y < world.h * .25)).toBe(true);
    expect(new Set(rock.map(p => p.ceilingLayer))).toEqual(new Set(["front", "middle"]));
    for (const p of scenery) {
      expect(SWAMP_SCENERY).toContain(p.name);
      expect(p.x - p.w / 2).toBeGreaterThan(0);
      expect(p.x + p.w / 2).toBeLessThan(world.w);
      expect(p.w).toBeGreaterThan(0); expect(p.h).toBeGreaterThan(0);
    }
    for (let i = 1; i < plants.length; i++) expect(plants[i].x - plants[i - 1].x).toBeGreaterThan(55);
    expect(world.cells.every((value, index) => value === before[index])).toBe(true);
    expect(swampScenery(world)).toEqual(scenery);
  });

  it("reconstructs identical positions, variants and sizes from a damaged saved mask", () => {
    const world = cave();
    world.circle(500, 560, 25);
    const restored = ModernWorld.restore(world.serialize(), world.w, world.h);
    expect(swampScenery(restored)).toEqual(swampScenery(world));
    expect(swampScenery(cave(19))).not.toEqual(swampScenery(cave(71)));
  });

  it("removes uprooted plants and roots without planting replacements on the crater floor", () => {
    for (const kind of ["plant", "root"] as const) {
      const world = cave(), before = swampScenery(world);
      const p = before.find(p => p.kind === kind)!;
      world.circle(p.x, p.y + 4, 14);
      const after = swampScenery(world);
      expect(after.some(q => q.kind === kind && q.x === p.x)).toBe(false);
      expect(after.every(q => before.some(p => p.kind === q.kind && p.x === q.x && p.y === q.y))).toBe(true);
      expect(swampScenery(ModernWorld.restore(world.serialize(), world.w, world.h))).toEqual(after);
    }
  });

  it.each(["stalactite", "moss"] as const)("removes %s when its embedded ceiling support is excavated", kind => {
    const world = cave(), layers = new CaveLayers(world.w, world.h, world.seed);
    const before = swampScenery(world, layers), p = before.find(p => p.kind === kind)!;
    world.circle(p.x, p.y - 2, 14);
    const after = swampScenery(world, layers);
    expect(after.some(q => q.kind === kind && q.x === p.x)).toBe(false);
    expect(after.filter(q => q.kind === kind).length).toBeLessThan(before.filter(q => q.kind === kind).length);
  });

  it("leaves room around existing scenery props", () => {
    const world = cave(), p = swampScenery(world).find(p => p.kind === "plant")!;
    world.props.push({ id: 16, kind: "house", x: p.x, y: p.y, w: 60, h: 50, variant: .5 });
    expect(swampScenery(world).some(q => q.kind === "plant" && q.x === p.x)).toBe(false);
  });


  it("retains one or two large specimens around saved scenery without promoting replacements after a cut", () => {
    for (const seed of [1, 19, 71, 313]) {
      const world = cave(seed);
      world.placeProps([]);
      const before = swampScenery(world), large = before.filter(p => p.kind === "plant" && p.h >= 80);
      expect(large.length).toBeGreaterThanOrEqual(1);
      expect(large.length).toBeLessThanOrEqual(2);
      const target = large[0];
      world.circle(target.x, target.y + 4, 14);
      const after = swampScenery(world);
      expect(after.some(p => p.kind === "plant" && p.x === target.x)).toBe(false);
      for (const p of after) expect(before.find(q => q.kind === p.kind && q.x === p.x)).toEqual(p);
      expect(swampScenery(ModernWorld.restore(world.serialize(), world.w, world.h))).toEqual(after);
    }
  });

  it("scales counts down on small maps and limits ceiling ornaments to caves", () => {
    const small = swampScenery(cave(71, 320, 240));
    expect(small.length).toBeLessThanOrEqual(6);
    const mountain = ModernWorld.generate(320, 240, 71,
      { TERRAIN_BIOME: "SWAMP", TERRAIN_LAYOUT: "MOUNTAINS" });
    expect(swampScenery(mountain).every(p => p.kind !== "stalactite" && p.kind !== "moss")).toBe(true);
    for (const [biome, layout] of [["GRASS", "CAVE"], ["DESERT", "MOUNTAINS"], ["SWAMP", "CITY"]]) {
      const world = ModernWorld.generate(320, 240, 71, { TERRAIN_BIOME: biome, TERRAIN_LAYOUT: layout });
      expect(swampScenery(world)).toEqual([]);
    }
  });
});
