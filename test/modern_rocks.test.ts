import { describe, expect, it } from "vitest";
import { ModernWorld, propContains, type Prop } from "../src/modern";

describe("Desert ground rocks", () => {
  it("scatters repeatable boulders and rubble clear of tanks, with stable supported masks", () => {
    for (const seed of [1, 19, 71, 313]) {
      const make = () => {
        const m = ModernWorld.generate(1024, 768, seed, { TERRAIN_BIOME: "DESERT", TERRAIN_LAYOUT: "MOUNTAINS" });
        m.placeProps([{ x: 240, y: 300, half_width: 14 }, { x: 750, y: 300, half_width: 14 }]);
        return m;
      };
      const m = make(), repeated = make();
      const rocks = m.props.filter(p => p.kind === "rock");
      // Homesteads and planted scenery reserve the level shelves first;
      // some seeds now have room only for small collision rubble.
      expect(rocks.length).toBeGreaterThan(0);
      expect(rocks.some(p => p.w < 12)).toBe(true);
      expect(rocks.every(p => [240, 750].every(x => Math.abs(x - p.x) >= p.w / 2 + 32))).toBe(true);
      expect(Buffer.from(m.cells).equals(Buffer.from(repeated.cells))).toBe(true);
      m.settle();
      let embeddedStone = 0;
      for (const p of rocks) {
        expect(m.cells.includes(p.id)).toBe(true);
        // Surface sand must not cut across the boulder's complete face, even
        // where the silhouette overlaps the original sloping ground.
        for (let x = Math.floor((p.x - p.w / 2) * 2); x < Math.ceil((p.x + p.w / 2) * 2); x++) {
          for (let y = Math.floor((p.y - p.h) * 2); y < Math.ceil(p.y * 2); y++) {
            if (!propContains("rock", ((x + .5) / 2 - p.x) / p.w, (p.y - (y + .5) / 2) / p.h, p.variant)) continue;
            expect(m.cells[x * m.fh + y]).toBe(p.id);
            if (y / 2 >= m.surface[x]) embeddedStone++;
          }
        }
      }
      expect(embeddedStone).toBeGreaterThan(0);
      const restored = ModernWorld.restore(m.serialize(), m.w, m.h);
      expect(Buffer.from(m.cells).equals(Buffer.from(restored.cells))).toBe(true);
      expect(restored.props).toEqual(m.props);
      const p = rocks[0];
      m.circle(p.x, p.y - p.h / 2, p.w);
      expect(m.cells.includes(p.id)).toBe(false);
    }
  });

  it("keeps the full stone volume when an unsupported boulder falls into rubble", () => {
    const m = new ModernWorld(80, 80, 1, "DESERT", "MOUNTAINS");
    const p: Prop = { id: 16, kind: "rock", x: 40, y: 50, w: 30, h: 20, variant: .4 };
    m.props.push(p);
    for (let x = 0; x < m.fw; x++) for (let y = 0; y < m.fh; y++) {
      if (y >= 100) m.cells[x * m.fh + y] = 2;
      else if (propContains("rock", ((x + .5) / 2 - p.x) / p.w, (p.y - (y + .5) / 2) / p.h, p.variant)) m.cells[x * m.fh + y] = 16;
    }
    m.publish(0, 0, m.fw, m.fh); m.settle();
    expect(m.cells.includes(16)).toBe(true);
    for (let x = 0; x < m.fw; x++) m.cells.fill(0, x * m.fh + 100, x * m.fh + 112);
    const count = () => m.cells.reduce((sum, v) => sum + (v ? 1 : 0), 0);
    const before = count();
    m.publish(0, 0, m.fw, m.fh); m.settle();
    expect(m.cells.includes(16)).toBe(false);
    expect(m.cells.includes(3)).toBe(true);
    expect(count()).toBe(before);
  });
});
