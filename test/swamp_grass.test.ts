import { describe, expect, it } from "vitest";
import { swampGrassDepth } from "../src/cave_layers";

describe("swamp turf thickness", () => {
  it.each([1, 19, 71, 313, 999])("alternates substantial cushions with thin readable earth for seed %i", seed => {
    const depths = Array.from({ length: 2048 }, (_, x) => swampGrassDepth(x / 2, 768, seed));
    expect(depths.every(Number.isFinite)).toBe(true);
    expect(Math.min(...depths)).toBeGreaterThanOrEqual(4.5);
    expect(Math.min(...depths)).toBeLessThan(6.3);
    expect(Math.max(...depths)).toBeGreaterThan(26);
    expect(Math.max(...depths)).toBeLessThanOrEqual(33.3);
    const thin = depths.filter(depth => depth < 7).length / depths.length;
    const thick = depths.filter(depth => depth > 20).length / depths.length;
    expect(thin).toBeGreaterThan(.3);
    expect(thick).toBeGreaterThan(.1);
    expect(thick).toBeLessThan(.4);
    // No step or cusp when crossing a seeded patch region or fine-noise cell.
    for (let x = 1; x < depths.length; x++) expect(Math.abs(depths[x] - depths[x - 1])).toBeLessThan(.55);
  });

  it("scales patch locations and thickness together at different game resolutions", () => {
    for (const height of [240, 480, 768, 1080]) for (const x of [-500, -192, -1, 0, 93, 192, 535, 1023]) {
      const scale = height / 768;
      expect(swampGrassDepth(x * scale, height, 71)).toBeCloseTo(swampGrassDepth(x, 768, 71) * scale, 10);
    }
  });

  it("reconstructs the same sheet regardless of traversal order, with different seed-specific patches", () => {
    const forward = Array.from({ length: 1024 }, (_, x) => swampGrassDepth(x, 768, 71));
    const backward = Array.from({ length: 1024 }, (_, x) => swampGrassDepth(1023 - x, 768, 71)).reverse();
    expect(backward).toEqual(forward);
    const another = Array.from({ length: 1024 }, (_, x) => swampGrassDepth(x, 768, 19));
    expect(another).not.toEqual(forward);
  });
});
