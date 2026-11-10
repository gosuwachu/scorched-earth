import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decode, parseHeader, surfaceProfile } from "../src/mtn";
import { Terrain } from "../src/terrain";
import { Rng } from "../src/rng";

const assets = new URL("../public/assets/", import.meta.url);

// Original shipped DOS assets, inspected as bottom-up nibble columns. These
// checks validate the browser silhouette, not a DOS runtime generation capture.
describe("mountain silhouettes exclude stored sky", () => {
  it.each([
    ["ROCK002.MTN", 208, 140, 192],
    ["ROCK002.MTN", 210, 140, 191],
    ["ROCK003.MTN", 108, 41, 165],
  ] as const)("%s column %i skips stored sky from row %i to %i", (name, x, storedTop, groundTop) => {
    const bytes = readFileSync(new URL(name, assets));
    const p = surfaceProfile(bytes);
    expect(p.height - p.counts[x]).toBe(storedTop);
    expect(p.surface[x]).toBe(groundTop);
  });

  it("matches the first visible ground pixel in every shipped mountain column", () => {
    for (const name of readdirSync(assets).filter(name => name.endsWith(".MTN"))) {
      const bytes = readFileSync(new URL(name, assets));
      const grid = decode(bytes);
      const hdr = parseHeader(bytes);
      const p = surfaceProfile(bytes);
      for (let x = 0; x < grid.width; x++) {
        let y = 0;
        while (y < grid.height && (grid.data[y * grid.width + x] === -1 ||
          grid.data[y * grid.width + x] === hdr.sky_index)) y++;
        expect(p.surface[x], `${name} column ${x}`).toBe(y);
      }
    }
  });

  it("handles empty, all-sky, odd-count and embedded-sky columns", () => {
    const bytes = new Uint8Array(24 + 6 + 13);
    bytes.set([0x4d, 0x54, 0xbe, 0xef, 0, 1, 4, 0, 0, 0, 4, 0, 2, 0, 0, 0, 1, 0]);
    // Nonzero sky index 1; ground index 0. Packed low nibble is bottommost.
    bytes.set([0, 0, 3, 0, 0x11, 0x01, 3, 0, 0x00, 0x01, 2, 0, 0x01], 30);
    expect(Array.from(surfaceProfile(bytes).surface)).toEqual([4, 4, 2, 2]);
  });

  it.each(["ROCK002.MTN", "ROCK003.MTN"])("generates %s repeatedly without tall one/two-column towers", name => {
    const file = { name, data: readFileSync(new URL(name, assets)) };
    const cfg = { MTN_PERCENT: 100, LAND1: 100, LAND2: 50, SUSPEND_DIRT: 0, is_on: () => true };
    for (const width of [360, 800, 1600]) {
      const terrain = new Terrain(width, 480);
      for (let seed = 0; seed < 100; seed++) {
        terrain.generate(cfg, new Rng(seed), [file]);
        const surface = Array.from({ length: width }, (_, x) => terrain.column_top(x));
        let tallest = 0;
        for (let x = 1; x < width - 2; x++) {
          for (const n of [1, 2]) {
            tallest = Math.max(tallest, Math.min(surface[x - 1], surface[x + n]) -
              Math.max(...surface.slice(x, x + n)));
          }
        }
        // Allow ordinary small rugged peaks, but reject the observed 50–124px
        // source-asset sky runs amplified by playfield normalization.
        expect(tallest, `${name} width ${width} seed ${seed}`).toBeLessThan(30);
      }
    }
  });
});
