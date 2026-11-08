import { expect, it } from "vitest";
import { TerrainDepth, DEPTH_REACH, caveShade } from "../src/terrain_depth";

it("lights upper/left cut edges and shades undersides without inventing map edges", () => {
  const cells = new Uint8Array(256 * 256).fill(2), depth = new TerrainDepth();
  depth.update(cells, 256, 256, 0, 0);
  expect(depth.light(0)).toBe(0);
  cells[64 * 256 + 64] = 0;
  depth.update(cells, 256, 256, 0, 0);
  expect(depth.light(65 * 128 + 64)).toBeGreaterThan(0);
  expect(depth.light(64 * 128 + 65)).toBeGreaterThan(0);
  expect(depth.light(63 * 128 + 64)).toBeLessThan(0);
  expect(depth.light(64 * 128 + 63)).toBeLessThan(0);
  expect(depth.light((65 + DEPTH_REACH) * 128 + 64)).toBe(0);
});

it("sees excavation in a neighboring tile and stops at the bounded halo", () => {
  const cells = new Uint8Array(300 * 270).fill(2), depth = new TerrainDepth();
  cells[127 * 270 + 150] = 0;
  const before = cells.slice();
  depth.update(cells, 300, 270, 128, 128);
  expect(depth.left[22 * 128]).toBe(1);
  expect(depth.light(22 * 128)).toBeGreaterThan(0);
  expect(depth.left[22 * 128 + DEPTH_REACH]).toBe(DEPTH_REACH + 1);
  depth.update(cells, 300, 270, 256, 256);
  expect(depth.light(13 * 128 + 43)).toBe(0);
  expect(cells).toEqual(before);
});

it("removes the rear-wall shade when a cave roof is destroyed and excludes props", () => {
  const fw = 160, fh = 240, cells = new Uint8Array(fw * fh);
  for (let x = 0; x < fw; x++) cells.fill(2, x * fh + 40, x * fh + 48);
  // An open overhang has no rear wall; a chamber needs a floor as well.
  expect(caveShade(cells, fw, fh).every(a => a === 0)).toBe(true);
  for (let x = 0; x < fw; x++) cells.fill(2, x * fh + 160, x * fh + 180);
  const shade = caveShade(cells, fw, fh);
  expect(shade[13 * 40 + 20]).toBeGreaterThan(150);
  expect(shade[0]).toBe(0);
  cells.fill(0);
  expect(caveShade(cells, fw, fh).every(a => a === 0)).toBe(true);
  for (let x = 0; x < fw; x++) cells.fill(16, x * fh + 40, x * fh + 48);
  expect(caveShade(cells, fw, fh).every(a => a === 0)).toBe(true);
});
