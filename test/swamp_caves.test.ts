/** Intentional browser terrain geometry, not DOS fidelity evidence. */
import { expect, it } from "vitest";
import { ModernWorld } from "../src/modern";

it("gives swamp mountains cliff shelves and caverns broad stable earth banks with headroom", () => {
  for (const [w, h] of [[320, 240], [640, 480], [1024, 768]]) {
    for (const seed of [1, 19, 71, 313]) for (const layout of ["MOUNTAINS", "CAVE"]) {
      const options = { TERRAIN_BIOME: "SWAMP", TERRAIN_LAYOUT: layout };
      const m = ModernWorld.generate(w, h, seed, options);
      const span = Math.round(m.fw * .02);
      if (layout === "MOUNTAINS") expect(m.surface.some((y, x) => x + span < m.fw && Math.abs(y - m.surface[x + span]) > h * .08)).toBe(true);
      let shelves = 0;
      for (let x = 0; x < m.fw; x++) {
        let ceiling = 0;
        if (layout === "CAVE") while (ceiling < m.fh && m.cells[x * m.fh + ceiling]) ceiling++;
        if (layout === "CAVE") expect(m.surface[x] - ceiling / 2).toBeGreaterThan(h * .1);
        for (let y = ceiling + 1; y < m.surface[x] * 2 - 4; y++) {
          if (m.cells[x * m.fh + y] === 2 && !m.cells[x * m.fh + y + 1]) shelves++;
        }
      }
      if (layout === "MOUNTAINS") expect(shelves, `${w}/${layout}/${seed}`).toBeGreaterThan(w * .06);
      else {
        // The concept calls for broad earth banks beneath an open chamber,
        // rather than the previous mountain peaks inside a cave ceiling.
        const relief = Math.max(...m.surface) - Math.min(...m.surface);
        expect(relief).toBeGreaterThan(h * .1);
        expect(relief).toBeLessThan(h * .25);
        for (const x of [0, Math.floor(m.fw / 2), m.fw - 1]) {
          const top = Math.ceil(m.surface[x] * 2);
          let bottom = top;
          while (bottom < m.fh && m.cells[x * m.fh + bottom] === 1) bottom++;
          expect((bottom - top) / 2).toBeGreaterThan(h * .1);
        }
      }
      const before = m.cells.slice();
      m.dirty = true;
      m.settle();
      expect(m.cells.every((v, i) => v === before[i])).toBe(true);
      expect(ModernWorld.generate(w, h, seed, options).cells.every((v, i) => v === before[i])).toBe(true);
      expect(ModernWorld.restore(m.serialize(), w, h).cells.every((v, i) => v === before[i])).toBe(true);
    }
  }
});
