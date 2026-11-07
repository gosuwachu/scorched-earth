/** Browser-only alpine dressing; no DOS fidelity claim. */
import { expect, it } from "vitest";
import { ModernWorld } from "../src/modern";

it("seats alpine rocks only in caves, avoids tanks, and saves damaged rocks", () => {
  for (const biome of ["GRASS", "SNOW"]) for (const seed of [1, 19, 71, 313]) {
    const options = { TERRAIN_BIOME: biome, TERRAIN_LAYOUT: "MOUNTAINS" };
    const m = ModernWorld.generate(640, 480, seed, options);
    const tanks = [{ x: 300, y: 200, half_width: 10 }];
    m.placeProps(tanks);
    const rocks = m.props.filter(p => p.kind === "rock");
    expect(rocks.length).toBeGreaterThan(0);
    expect(rocks.some(p => p.w >= 18)).toBe(true);
    expect(rocks.some(p => p.w < 10)).toBe(true);
    const outside = rocks.filter(p => p.y - p.h < m.surface[Math.round(p.x * 2)]);
    expect(outside).toHaveLength(0);
    for (const p of rocks) {
      const x0 = Math.floor((p.x - p.w / 2) * 2), x1 = Math.ceil((p.x + p.w / 2) * 2);
      expect(m.surface.subarray(x0, x1).every(top => top < p.y - p.h)).toBe(true);
    }
    expect(rocks.every(p => Math.abs(p.x - 300) >= p.w / 2 + 28)).toBe(true);
    const copy = ModernWorld.generate(640, 480, seed, options); copy.placeProps(tanks);
    expect(Buffer.from(copy.cells).equals(Buffer.from(m.cells))).toBe(true);
    const ids = new Set(rocks.map(p => p.id));
    const count = () => m.cells.reduce((n, c) => n + Number(ids.has(c)), 0);
    const before = count(); m.settle();
    expect(count()).toBeGreaterThan(before * .98);
    const target = rocks.find(p => p.w >= 18)!;
    m.circle(target.x, target.y - target.h / 2, Math.hypot(target.w, target.h)); m.settle();
    expect(m.cells.includes(target.id)).toBe(false);
    const restored = ModernWorld.restore(m.serialize(), m.w, m.h);
    expect(Buffer.from(restored.cells).equals(Buffer.from(m.cells))).toBe(true);
    expect(restored.props).toEqual(m.props);
  }
});
