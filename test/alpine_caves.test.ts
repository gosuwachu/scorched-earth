/** Intentional Modern terrain features, not DOS fidelity expectations. */
import { expect, it } from "vitest";
import { ModernWorld } from "../src/modern";

it("creates reachable alpine chambers with stable rock overhangs at multiple sizes", () => {
  for (const [w, h] of [[320, 240], [640, 480], [1024, 768]]) for (const seed of [1, 19, 71, 313]) {
    for (const biome of ["GRASS", "SNOW"]) {
      const m = ModernWorld.generate(w, h, seed, { TERRAIN_BIOME: biome, TERRAIN_LAYOUT: "MOUNTAINS" });
      const visited = new Uint8Array(m.cells.length), queue = new Int32Array(m.cells.length);
      let head = 0, tail = 0;
      const add = (i: number) => {
        if (!m.cells[i] && !visited[i]) { visited[i] = 1; queue[tail++] = i; }
      };
      for (let x = 0; x < m.fw; x++) add(x * m.fh);
      while (head < tail) {
        const i = queue[head++], y = i % m.fh;
        if (i >= m.fh) add(i - m.fh);
        if (i + m.fh < m.cells.length) add(i + m.fh);
        if (y > 0) add(i - 1);
        if (y + 1 < m.fh) add(i + 1);
      }
      let underground = 0, roofs = 0;
      for (let x = 0; x < m.fw; x++) for (let y = Math.ceil(m.surface[x] * 2) + 12; y < m.fh; y++) {
        const i = x * m.fh + y;
        if (!m.cells[i]) {
          underground++;
          if (m.cells[i - 1] === 2) roofs++;
          if (!visited[i]) throw new Error(`Sealed cave: ${biome}/${seed} at ${x},${y}`);
        }
      }
      expect(underground).toBeGreaterThan(w * h * .005);
      expect(roofs).toBeGreaterThan(w * .08);
      const before = m.cells.slice(); m.settle();
      expect(m.cells.reduce((n, v, i) => n + Number(v !== before[i]), 0), `${w}/${biome}/${seed}`).toBe(0);
      expect(ModernWorld.restore(m.serialize(), w, h).cells.every((v, i) => v === before[i])).toBe(true);
    }
  }
});
