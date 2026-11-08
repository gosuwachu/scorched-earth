import { expect, it } from "vitest";
import { TerrainDepth, DEPTH_REACH, caveShade } from "../src/terrain_depth";

it("lights upper/left cut edges and shades undersides without inventing map edges", () => {
  const cells = new Uint8Array(256 * 256).fill(2), depth = new TerrainDepth();
  depth.update(cells, 256, 256, 0, 0);
  expect(depth.light(0)).toBe(0);
  cells[64 * 256 + 32] = 0;
  depth.update(cells, 256, 256, 0, 0);
  expect(depth.light(33 * 128 + 64)).toBeGreaterThan(0);
  expect(depth.light(32 * 128 + 65)).toBeGreaterThan(0);
  expect(depth.light(31 * 128 + 64)).toBeLessThan(0);
  expect(depth.light(32 * 128 + 63)).toBeLessThan(0);
  expect(depth.light((33 + DEPTH_REACH) * 128 + 64)).toBe(0);
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

it("keeps roof contact dark at every coarse-grid alignment, including sloped roofs", () => {
  const fw = 160, fh = 240, w = fw / 4;
  for (const slope of [0, .25, -.25]) for (let offset = 0; offset < 4; offset++) {
    const cells = new Uint8Array(fw * fh);
    for (let x = 0; x < fw; x++) {
      const roofEnd = 52 + offset + Math.floor((x - 80) * slope);
      cells.fill(2, x * fh + 8, x * fh + roofEnd);
      cells.fill(2, x * fh + 160, x * fh + 180);
    }
    const before = cells.slice(), shade = caveShade(cells, fw, fh);
    for (const x of [48, 80, 112]) {
      const roofEnd = 52 + offset + Math.floor((x - 80) * slope);
      const firstAir = Math.ceil(roofEnd / 4), column = x / 4;
      // The backdrop under the last roof sample must continue the air's
      // shadow, rather than blending it toward transparent at the boundary.
      expect(shade[(firstAir - 1) * w + column]).toBeGreaterThanOrEqual(shade[firstAir * w + column]);
      expect(shade[firstAir * w + column]).toBeGreaterThan(180);
      expect(shade[(firstAir + 8) * w + column]).toBeLessThan(shade[firstAir * w + column]);
    }
    expect(cells).toEqual(before);
  }
});
