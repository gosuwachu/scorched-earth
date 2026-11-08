import { expect, it } from "vitest";
import { paintedMaterial } from "../src/terrain_material";

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
