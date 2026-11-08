import { expect, it } from "vitest";
import { ModernWorld } from "../src/modern";
import { desertMesas } from "../src/desert";

it("gives each desert a visibly different skyline and asymmetric cliff slopes", () => {
  for (const seed of [1, 2, 19, 71, 313, 1024]) {
    const m = ModernWorld.generate(640, 480, seed, { TERRAIN_BIOME: "DESERT", TERRAIN_LAYOUT: "MOUNTAINS" });
    const mesas = desertMesas(seed);
    const caps = mesas.map(p => m.surface[Math.floor(p.center * m.fw)]);
    expect(Math.max(...caps) - Math.min(...caps)).toBeGreaterThan(m.h * .30);
    const slopes = mesas.map(p => {
      const center = Math.floor(p.center * m.fw);
      let left = 0, right = 0;
      for (let x = Math.max(0, Math.floor((p.center - p.radius) * m.fw));
        x < Math.min(m.fw - 8, (p.center + p.radius) * m.fw); x++) {
        const slope = Math.abs(m.surface[x + 8] - m.surface[x]);
        if (x < center) left = Math.max(left, slope);
        else right = Math.max(right, slope);
      }
      return Math.max(left, right) / Math.max(1, Math.min(left, right));
    });
    expect(Math.max(...slopes)).toBeGreaterThan(1.25);
  }
});
