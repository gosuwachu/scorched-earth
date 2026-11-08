/** Intentional Modern terrain features, not DOS fidelity expectations. */
import { expect, it } from "vitest";
import { Config } from "../src/config";
import { createGameState } from "../src/game";
import { ModernWorld } from "../src/modern";

it("creates one or two varied reachable chambers with stable cliffs and overhangs", () => {
  const areas = new Set<number>();
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
      let bands = 0, inCave = false, ledgeCells = 0;
      for (let x = 0; x < m.fw; x++) {
        let cavity = false;
        for (let y = Math.ceil(m.surface[x] * 2) + 12; y < m.fh; y++) {
          if (!m.cells[x * m.fh + y]) { cavity = true; break; }
        }
        if (cavity && !inCave) bands++;
        inCave = cavity;
        for (let y = 0; y < m.surface[x] * 2 - 4; y++) {
          if (m.cells[x * m.fh + y] === 2 && !m.cells[x * m.fh + y + 1]) ledgeCells++;
        }
      }
      expect(bands, `caves ${w}/${seed}`).toBeGreaterThanOrEqual(1);
      expect(bands, `caves ${w}/${seed}`).toBeLessThanOrEqual(2);
      expect(ledgeCells, `overhang ${w}/${seed}`).toBeGreaterThan(0);
      const cliffSpan = Math.max(1, Math.round(m.fw * .02));
      expect(m.surface.some((y, x) => x + cliffSpan < m.fw && Math.abs(y - m.surface[x + cliffSpan]) > h * .08)).toBe(true);
      let underground = 0, roofs = 0;
      for (let x = 0; x < m.fw; x++) for (let y = Math.ceil(m.surface[x] * 2) + 12; y < m.fh; y++) {
        const i = x * m.fh + y;
        if (!m.cells[i]) {
          underground++;
          if (m.cells[i - 1] === 2) roofs++;
          if (!visited[i]) throw new Error(`Sealed cave: ${biome}/${seed} at ${x},${y}`);
        }
      }
      if (w === 640) areas.add(underground);
      expect(underground).toBeGreaterThan(w * h * .005);
      expect(roofs).toBeGreaterThan(w * .08);
      const before = m.cells.slice(); m.settle();
      expect(m.cells.reduce((n, v, i) => n + Number(v !== before[i]), 0), `${w}/${biome}/${seed}`).toBe(0);
      expect(ModernWorld.restore(m.serialize(), w, h).cells.every((v, i) => v === before[i])).toBe(true);
    }
  }
  expect(areas.size).toBeGreaterThanOrEqual(3);
});

it("offers safe cave spawns alongside surface starts", () => {
  for (const seed of [1, 19, 71, 313]) {
    const cfg = Object.assign(new Config(), { TERRAIN_STYLE: "MODERN", TERRAIN_BIOME: "GRASS", TERRAIN_LAYOUT: "MOUNTAINS", INITIAL_CASH: 0, SOUND: "OFF", MAX_WIND: 0, SKY: "PLAIN", ELASTIC: "NONE" });
    const gs = createGameState(cfg, 1024, 768, seed);
    for (let i = 0; i < 4; i++) gs.add_player(`Tank${i}`, 0, 0, i);
    gs.new_game();
    const m = gs.terrain.modern!;
    const underground = gs.tanks.filter(t => t.y > m.surface[t.x * 2] + 20);
    expect(underground.length, `seed ${seed}`).toBeGreaterThan(0);
    expect(underground.length).toBeLessThan(gs.tanks.length);
    for (const tank of underground) {
      expect(gs.terrain.is_supported(tank.x, tank.y, tank.half_width)).toBe(true);
      for (let dx = -tank.half_width; dx <= tank.half_width; dx++) {
        for (let dy = 1; dy <= 28; dy++) expect(m.solid(tank.x + dx, tank.y - dy)).toBe(false);
      }
    }
    for (let i = 0; i < 20; i++) gs.update(1 / 60);
    expect(gs.tanks.every(t => t.alive && t.health === 100)).toBe(true);
  }
});
