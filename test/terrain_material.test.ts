import { expect, it } from "vitest";
import { fullFrameMaterial, paintedMaterial } from "../src/terrain_material";

it("wraps both axes including negative coordinates without a hard painting seam", () => {
  const width = 64, height = 48, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    data[i] = x * 3; data[i + 1] = y * 4; data[i + 2] = 80; data[i + 3] = 255;
  }
  const image = { width, height, data }, overlap = 6;
  const a = paintedMaterial(image, -1, -1, 0), b = paintedMaterial(image, 0, 0, 0);
  expect(Math.abs(a[0] - b[0])).toBeLessThan(5);
  expect(Math.abs(a[1] - b[1])).toBeLessThan(5);
  for (const [x, y] of [[0, 0], [-103, 70], [123, 99]]) {
    expect(paintedMaterial(image, x, y, 71)).toEqual(paintedMaterial(image, x + width - overlap, y + height - overlap, 71));
    expect(paintedMaterial(image, x, y, 71).every(Number.isFinite)).toBe(true);
  }
});

function gradientImage() {
  const width = 8, height = 6, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    data[i] = x * 30; data[i + 1] = y * 40; data[i + 2] = x + y; data[i + 3] = 255;
  }
  return { width, height, data };
}

it("maps a full-frame painting once across both axes and clamps its outer edges", () => {
  const image = gradientImage();
  // Fine-grid frame dimensions are twice the source dimensions. Crossing the
  // source width/height must advance through the sheet rather than repeat it.
  expect(fullFrameMaterial(image, 0, 0, 16, 12)).toEqual([0, 0, 0]);
  expect(fullFrameMaterial(image, 7, 5, 16, 12)).toEqual([90, 80, 5]);
  expect(fullFrameMaterial(image, 8, 6, 16, 12)).toEqual([120, 120, 7]);
  expect(fullFrameMaterial(image, 15, 11, 16, 12)).toEqual([210, 200, 12]);
  expect(fullFrameMaterial(image, -1, -1, 16, 12)).toEqual([0, 0, 0]);
  expect(fullFrameMaterial(image, 16, 12, 16, 12)).toEqual([210, 200, 12]);
  expect(fullFrameMaterial(image, 160, 120, 16, 12)).toEqual([210, 200, 12]);
});

it("preserves the full-frame pattern when world raster dimensions double", () => {
  const image = gradientImage();
  for (const [x, y] of [[0, 0], [3, 2], [7, 5], [12, 8], [15, 11]]) {
    expect(fullFrameMaterial(image, x * 2, y * 2, 32, 24))
      .toEqual(fullFrameMaterial(image, x, y, 16, 12));
  }
});
