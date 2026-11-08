/** Intentional browser terrain geometry, not DOS fidelity evidence. */
import { expect, it } from "vitest";
import { ModernWorld } from "../src/modern";

it("gives swamp ridges and cavern floors stable cliff shelves with usable headroom", () => {
  for (const [w, h] of [[320, 240], [640, 480], [1024, 768]]) {
    for (const seed of [1, 19, 71, 313]) for (const layout of ["MOUNTAINS", "CAVE"]) {
      const options = { TERRAIN_BIOME: "SWAMP", TERRAIN_LAYOUT: layout };
      const m = ModernWorld.generate(w, h, seed, options);
      const span = Math.round(m.fw * .02);
      expect(m.surface.some((y, x) => x + span < m.fw && Math.abs(y - m.surface[x + span]) > h * .08)).toBe(true);
      let shelves = 0;
      for (let x = 0; x < m.fw; x++) {
        let ceiling = 0;
        if (layout === "CAVE") while (ceiling < m.fh && m.cells[x * m.fh + ceiling]) ceiling++;
        if (layout === "CAVE") expect(m.surface[x] - ceiling / 2).toBeGreaterThan(h * .1);
        for (let y = ceiling + 1; y < m.surface[x] * 2 - 4; y++) {
          if (m.cells[x * m.fh + y] === 2 && !m.cells[x * m.fh + y + 1]) shelves++;
        }
      }
      expect(shelves, `${w}/${layout}/${seed}`).toBeGreaterThan(w * .06);
      if (layout === "CAVE") expect(Math.max(...m.surface) - Math.min(...m.surface)).toBeGreaterThan(h * .49);
      const before = m.cells.slice();
      m.dirty = true;
      m.settle();
      expect(m.cells.every((v, i) => v === before[i])).toBe(true);
      expect(ModernWorld.generate(w, h, seed, options).cells.every((v, i) => v === before[i])).toBe(true);
      expect(ModernWorld.restore(m.serialize(), w, h).cells.every((v, i) => v === before[i])).toBe(true);
    }
  }
});
