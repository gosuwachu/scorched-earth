import { expect, it } from "vitest";
import { ModernWorld } from "../src/modern";
import { desertMesas, desertProfile } from "../src/desert";

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

it("gives mesa walls intermediate ledges and broad lower shoulders at different sizes", () => {
  for (const width of [640, 1280, 2048]) for (const seed of [1, 2, 19, 71, 313, 1024]) {
    const profile = desertProfile(width, seed);
    for (const mesa of desertMesas(seed)) {
      const center = Math.floor(mesa.center * width), peak = profile[center];
      const extent = (fraction: number) => {
        const level = peak + (1 - peak) * fraction;
        let left = center, right = center;
        while (left > 0 && profile[left - 1] < level) left--;
        while (right < width - 1 && profile[right + 1] < level) right++;
        return right - left;
      };
      // A column with almost parallel sides cannot satisfy this: the lower
      // shoulder must be substantially wider than the upper crown.
      expect(extent(.6)).toBeGreaterThan(extent(.1) * 1.5);
      const span = Math.max(2, Math.round(width * .004));
      let ledgeWidth = 0;
      for (let x = Math.max(0, Math.floor((mesa.center - mesa.radius) * width));
        x < Math.min(width - span, (mesa.center + mesa.radius) * width); x++) {
        if (profile[x] > peak + (1 - peak) * .15 && profile[x] < peak + (1 - peak) * .8 &&
          Math.abs(profile[x + span] - profile[x]) < .006) ledgeWidth++;
      }
      // Exclude the crown and valley floor: there must be usable shallow
      // stretches partway down the cliff, rather than one uninterrupted slope.
      expect(ledgeWidth).toBeGreaterThan(width * .012);
    }
  }
});
