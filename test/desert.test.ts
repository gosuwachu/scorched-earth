import { expect, it } from "vitest";
import { ModernWorld } from "../src/modern";
import { desertMesas, desertProfile } from "../src/desert";
import { DesertLayers } from "../src/desert_layers";
import { desertScenery } from "../src/desert_scenery";

it("gives each desert a visibly different skyline and asymmetric cliff slopes", () => {
  for (const seed of [1, 2, 19, 71, 313, 1024]) {
    const m = ModernWorld.generate(640, 480, seed, { TERRAIN_BIOME: "DESERT", TERRAIN_LAYOUT: "MOUNTAINS" });
    const mesas = desertMesas(seed);
    const caps = mesas.map(p => m.surface[Math.floor(p.center * m.fw)]);
    expect(Math.max(...caps) - Math.min(...caps)).toBeGreaterThan(m.h * .15);
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

it("keeps a continuous base with sand in front of cliffs and ordered rock layers below", () => {
  for (const seed of [1, 19, 71, 313]) {
    const world = ModernWorld.generate(640, 480, seed, { TERRAIN_BIOME: "DESERT", TERRAIN_LAYOUT: "MOUNTAINS" });
    const layers = new DesertLayers(world.w, world.h, seed);
    let cliffColumns = 0, openSandColumns = 0;
    for (let xx = 0; xx < world.fw; xx += 8) {
      const x = xx / 2, c = layers.column(x);
      expect(c.sandFront - c.sandBack).toBeGreaterThan(world.h * .05);
      expect(c.bedBottom - c.sandFront).toBeGreaterThan(world.h * .10);
      expect(world.h - c.bedBottom).toBeGreaterThan(world.h * .08);
      expect(layers.sample(x, (c.sandFront + c.bedBottom) / 2).layer).toBe(2);
      expect(layers.sample(x, (c.bedBottom + world.h) / 2).layer).toBe(3);
      // The front half of the apron remains sand even where a cliff overlaps
      // its rear edge. It must be broad enough to place objects within it.
      const sandY = c.sandFront - (c.sandFront - c.sandBack) * .25;
      expect(layers.sandContains(x, sandY)).toBe(true);
      if (c.cliffTop < c.sandBack) {
        cliffColumns++;
        expect(layers.sample(x, (c.cliffTop + c.sandBack) / 2).layer).toBe(1);
        expect(layers.sandContains(x, c.sandBack)).toBe(false);
      } else {
        openSandColumns++;
        expect(layers.sandContains(x, (c.sandBack + c.sandFront) / 2)).toBe(true);
      }
      // No sky clefts split the lower sheets into isolated mountain columns.
      for (let yy = Math.ceil(c.sandBack * 2); yy < world.fh; yy++) {
        expect(world.cells[xx * world.fh + yy]).toBeGreaterThan(0);
      }
    }
    expect(cliffColumns).toBeGreaterThan(0);
    expect(openSandColumns).toBeGreaterThan(0);
  }
});

it("places full root rectangles inside live sand without foundations and survives saves", () => {
  const world = ModernWorld.generate(640, 480, 19, { TERRAIN_BIOME: "DESERT", TERRAIN_LAYOUT: "MOUNTAINS" });
  const layers = new DesertLayers(world.w, world.h, world.seed);
  const before = world.cells.slice();
  const props = desertScenery(world);
  expect(props.length).toBeGreaterThan(0);
  for (const p of props) {
    const contact = p.w * (p.kind === "shrub" ? .12 : .48);
    expect(p.y - layers.column(p.x).sandBack).toBeGreaterThan(2);
    for (let x = Math.floor((p.x - contact) * 2); x <= Math.ceil((p.x + contact) * 2); x++) {
      for (let y = Math.floor((p.y - 1) * 2); y <= Math.ceil((p.y + 1.5) * 2); y++) {
        expect(layers.sandContains(x / 2, y / 2)).toBe(true);
        expect(world.cells[x * world.fh + y]).toBe(1);
      }
    }
  }
  expect(world.cells).toEqual(before);
  const restored = ModernWorld.restore(world.serialize(), world.w, world.h);
  expect(desertScenery(restored)).toEqual(props);
  // Removing the sand material leaves no supported decorative roots.
  for (let i = 0; i < world.cells.length; i++) if (world.cells[i]) world.cells[i] = 2;
  expect(desertScenery(world)).toEqual([]);
});

it("removes a wide object when excavation reaches only the edge of its base", () => {
  const world = ModernWorld.generate(640, 480, 71, { TERRAIN_BIOME: "DESERT", TERRAIN_LAYOUT: "MOUNTAINS" });
  const props = desertScenery(world);
  const p = props.find(p => p.kind === "adobe" || p.kind === "truck");
  expect(p).toBeDefined();
  if (!p) return;
  const edge = p.x + p.w * .48 - .5;
  world.circle(edge, p.y, 1);
  // The centre is still supported: checking only the anchor would miss this.
  expect(world.solid(p.x, p.y)).toBe(true);
  expect(desertScenery(world)).not.toContainEqual(p);
  const restored = ModernWorld.restore(world.serialize(), world.w, world.h);
  expect(desertScenery(restored)).toEqual(desertScenery(world));
});

it("reserves sand for generated scenery before placing collision rocks", () => {
  const kinds = new Set<string>();
  for (const seed of [1, 19, 71, 313]) {
    const world = ModernWorld.generate(1024, 768, seed, { TERRAIN_BIOME: "DESERT", TERRAIN_LAYOUT: "MOUNTAINS" });
    world.placeProps([]);
    const scenery = desertScenery(world);
    expect(scenery.length).toBeGreaterThan(3);
    for (const p of scenery) kinds.add(p.kind);
  }
  expect([...kinds].sort()).toEqual(["adobe", "rock", "shrub", "truck"]);
});
