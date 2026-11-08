import { describe, expect, it } from "vitest";
import { CaveLayers, type CaveColumn } from "../src/cave_layers";
import { caveMaterial } from "../src/cave_material";
import { ModernWorld } from "../src/modern";
import type { MaterialPixels } from "../src/terrain_material";

const solid = (r: number, g: number, b: number): MaterialPixels => {
  const width = 32, height = 32, data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([r, g, b, 255], i);
  return { width, height, data };
};
// Distinct hues identify the chosen material independently of its shading.
const materials = [solid(30, 40, 180), solid(180, 80, 30), solid(40, 180, 40), solid(110, 110, 110)];

describe("swamp cave layers", () => {
  it.each([1, 19, 71, 313, 999])("keeps a broad chamber and substantial earth above one buried stone bed for seed %i", seed => {
    const width = 1024, height = 768, layers = new CaveLayers(width, height, seed);
    expect(layers.columns).toHaveLength(width * 2);
    expect(layers.columns.every(c => Object.values(c).every(Number.isFinite))).toBe(true);
    expect(Math.min(...layers.columns.map(c => c.surface - c.roof))).toBeGreaterThan(height * .24);
    expect(Math.min(...layers.columns.map(c => c.stoneTop - c.surface))).toBeGreaterThan(height * .12);
    expect(layers.columns.every(c => c.surface < c.earthShelf && c.earthShelf < c.stoneTop &&
      c.stoneTop < c.stoneBottom && c.stoneBottom < height)).toBe(true);
    expect(layers.columns.every(c => c.frontRoof > 0 && c.middleRoof > 0 &&
      c.roof >= c.frontRoof && c.roof >= c.middleRoof)).toBe(true);
    // Individual stalactites may occlude the next sheet, but most of the
    // ceiling must show all three distinct overlapping layers.
    const threeShelves = layers.columns.filter(c => c.frontRoof < c.middleRoof && c.middleRoof < c.roof);
    expect(threeShelves.length / layers.columns.length).toBeGreaterThan(.9);
  });

  it.each([1, 71, 313])("renders exactly one continuous limestone band instead of repeating stripes for seed %i", seed => {
    const height = 768, layers = new CaveLayers(1024, height, seed);
    for (const x of [0, 81, 257, 512, 777, 1023.5]) {
      const column = layers.column(x);
      let runs = 0, wasStone = false, firstStone = -1, lastStone = -1;
      for (let y = Math.ceil(column.surface * 2) / 2; y < height; y += .5) {
        const color = caveMaterial(materials, x * 2, y * 2, column.roof * 2,
          column.surface * 2, height * 2, 2, true, column);
        const stone = color[1] > color[0];
        if (stone) {
          if (!wasStone) { runs++; firstStone = y; }
          lastStone = y;
        }
        wasStone = stone;
      }
      expect(runs, `x=${x}`).toBe(1);
      expect(firstStone - column.surface).toBeGreaterThan(height * .12);
      expect(lastStone - firstStone).toBeGreaterThan(height * .035);
      expect(wasStone).toBe(false);
      // Deposited rubble stays earth-coloured even inside the stone horizon.
      const rubble = caveMaterial(materials, x * 2, (firstStone + 1) * 2,
        column.roof * 2, column.surface * 2, height * 2, 3, true, column);
      expect(rubble[0]).toBeGreaterThan(rubble[1]);
    }
  });

  it("preserves contact shadows beneath ceiling shelves", () => {
    const column: CaveColumn = {
      frontRoof: 60, middleRoof: 100, roof: 140,
      surface: 400, earthShelf: 470, stoneTop: 560, stoneBottom: 600,
    };
    const white = Array.from({ length: 4 }, () => solid(200, 200, 200));
    const brightness = (y: number) => caveMaterial(white, 100, y * 2,
      column.roof * 2, column.surface * 2, 1536, 2, true, column)[0];
    for (const edge of [column.frontRoof, column.middleRoof]) {
      const contact = brightness(edge + .5), farther = brightness(edge + 8);
      expect(contact, `contact at ${edge}`).toBeLessThan(farther - 10);
      expect(contact).toBeGreaterThan(0);
      expect(farther).toBeLessThan(200);
    }
  });

  it("keeps ground illumination continuous across beds without shadow bands or highlighted rims", () => {
    const column: CaveColumn = {
      frontRoof: 60, middleRoof: 100, roof: 140,
      surface: 400, earthShelf: 470, stoneTop: 560, stoneBottom: 600,
    };
    const white = Array.from({ length: 4 }, () => solid(200, 200, 200));
    const color = (y: number) => caveMaterial(white, 100, y * 2,
      column.roof * 2, column.surface * 2, 1536, 2, true, column);
    const openEarth = color(column.surface + 20);
    for (const edge of [column.earthShelf, column.stoneTop, column.stoneBottom]) {
      for (const offset of [-8, -1, -.5, 0, .5, 1, 8, 16]) {
        expect(color(edge + offset), `ground illumination at ${edge} ${offset >= 0 ? "+" : ""}${offset}`)
          .toEqual(openEarth);
      }
    }
    expect(openEarth.every(value => value > 0 && value <= 200)).toBe(true);
  });

  it("reconstructs identical anchors and material samples after a damaged world is saved and restored", () => {
    const world = ModernWorld.generate(320, 240, 71, { TERRAIN_BIOME: "SWAMP", TERRAIN_LAYOUT: "CAVE" });
    const layers = new CaveLayers(world.w, world.h, world.seed);
    world.circle(160, layers.column(160).earthShelf, 13);
    const restored = ModernWorld.restore(world.serialize(), world.w, world.h);
    const replay = new CaveLayers(restored.w, restored.h, restored.seed);
    expect(restored.cells).toEqual(world.cells);
    expect(replay.columns).toEqual(layers.columns);
    const cells = world.cells.slice(), pixels = materials.map(image => image.data.slice());
    const sample = (stack: CaveLayers, x: number, y: number) => {
      const c = stack.column(x), ix = Math.floor(x * 2), iy = Math.floor(y * 2);
      return caveMaterial(materials, x * 2, y * 2, c.roof * 2, c.surface * 2,
        world.fh, world.cells[ix * world.fh + iy], true, c);
    };
    for (const x of [12, 80, 160, 244, 319]) {
      const c = layers.column(x);
      for (const y of [c.frontRoof - 2, c.middleRoof + 2, c.earthShelf - 3, c.stoneTop + 2, c.stoneBottom + 3]) {
        expect(sample(replay, x, y)).toEqual(sample(layers, x, y));
      }
    }
    expect(world.cells).toEqual(cells);
    materials.forEach((image, i) => expect(image.data).toEqual(pixels[i]));
    expect(new CaveLayers(320, 240, 19).columns).not.toEqual(layers.columns);
  });

  it("keeps the surviving ground's texture fixed when excavation changes live column tops", () => {
    const layers = new CaveLayers(1024, 768, 71), x = 512, column = layers.column(x);
    const y = column.earthShelf + 20;
    const textured = materials.map(image => {
      const data = image.data.slice();
      for (let sy = 0; sy < image.height; sy++) for (let sx = 0; sx < image.width; sx++) {
        const at = (sy * image.width + sx) * 4;
        data[at] += sy; data[at + 1] += sx;
      }
      return { ...image, data };
    });
    const before = caveMaterial(textured, x * 2, y * 2, column.roof * 2,
      column.surface * 2, 1536, 1, true, column);
    const after = caveMaterial(textured, x * 2, y * 2, (column.roof - 12) * 2,
      (column.surface + 30) * 2, 1536, 1, true, column);
    expect(after).toEqual(before);
  });

  it("retains limestone on surviving ceiling below an excavated air pocket and on deeper saved roofs", () => {
    const column: CaveColumn = {
      frontRoof: 60, middleRoof: 100, roof: 140,
      surface: 400, earthShelf: 470, stoneTop: 560, stoneBottom: 600,
    };
    const before = caveMaterial(materials, 100, 80 * 2, 140 * 2, 400 * 2, 1536, 2, true, column);
    // A hole beginning at logical y=40 changes the live column's roof endpoint,
    // but the intact limestone sampled at y=80 must retain its material.
    const excavated = caveMaterial(materials, 100, 80 * 2, 40 * 2, 400 * 2, 1536, 2, true, column);
    expect(excavated).toEqual(before);
    expect(excavated[0]).toBe(excavated[1]);
    // Older saves can have rock extending below the newly generated roof.
    // Those surviving cells are also limestone, not the brown ground material.
    const oldRoof = caveMaterial(materials, 100, 160 * 2, 180 * 2, 400 * 2, 1536, 2, true, column);
    expect(oldRoof[0]).toBe(oldRoof[1]);
    expect(oldRoof[0]).toBeGreaterThan(0);
  });
});
