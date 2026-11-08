import { expect, it } from "vitest";
import { caveColumns, caveMaterial, caveStrip } from "../src/cave_material";
import { CaveLayers, type CaveColumn } from "../src/cave_layers";
import type { MaterialPixels } from "../src/terrain_material";

it("derives separate roof and soil anchors from the saved mask without modifying it", () => {
  const cells = new Uint8Array(80);
  cells.fill(2, 0, 8); cells.fill(1, 20, 28); cells.fill(2, 28, 40);
  cells.fill(1, 55, 65); cells.fill(2, 65, 80);
  const before = cells.slice();
  expect([...caveColumns(cells, 2, 40).roof]).toEqual([8, 0]);
  expect([...caveColumns(cells, 2, 40).soil]).toEqual([20, 15]);
  expect(cells).toEqual(before);
  expect(caveColumns(cells.slice(), 2, 40)).toEqual(caveColumns(cells, 2, 40));
});

it("keeps cropped samples inside the reference and repeats at negative coordinates", () => {
  const data = new Uint8ClampedArray(64 * 64 * 4).fill(255);
  for (let y = 8; y < 40; y++) for (let x = 12; x < 52; x++) data.fill(70, (y * 64 + x) * 4, (y * 64 + x) * 4 + 3);
  const source = { width: 64, height: 64, data };
  for (const x of [-1000, -1, 0, 5, 31, 32, 1000]) for (const v of [-1, 0, .5, 1, 2])
    expect(caveStrip(source, x, v, [12, 8, 40, 32])).toEqual([70, 70, 70]);
});

it("provides distinct earth and limestone fallbacks while assets load", () => {
  expect(caveMaterial([], 10, 5, 20, 50, 100, 2, true)).toEqual([157, 151, 131]);
  expect(caveMaterial([], 10, 60, 20, 50, 100, 1, true)).toEqual([95, 69, 43]);
  expect(caveMaterial([], 10, 90, 20, 50, 100, 2, true)).toEqual([77, 69, 53]);
});

const groundPainting = (): MaterialPixels => ({
  width: 4,
  height: 3,
  data: new Uint8ClampedArray([
    10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
    130, 10, 20, 255, 140, 30, 40, 255, 150, 50, 60, 255, 160, 70, 80, 255,
    20, 130, 40, 255, 50, 160, 70, 255, 80, 190, 100, 255, 110, 220, 130, 255,
  ]),
});
const material = (r: number, g: number, b: number): MaterialPixels => ({
  width: 1, height: 1, data: new Uint8ClampedArray([r, g, b, 255]),
});
const paintedGroundLayers: CaveColumn = {
  frontRoof: 10, middleRoof: 15, roof: 20,
  surface: 30, earthShelf: 40, stoneTop: 45, stoneBottom: 50,
};

it("maps the complete ground painting once across explicit world dimensions, including all edges", () => {
  const images = [undefined, undefined, undefined, undefined, groundPainting()];
  const sample = (x: number, y: number) => caveMaterial(images, x, y, 40, 60, 120, 1,
    false, paintedGroundLayers, 200);
  // These are the known painted pixels under uniform .9 ground illumination.
  // A non-4:3 world width also guards against silently using the default width.
  expect(sample(0, 0)).toEqual([9, 18, 27]);
  expect(sample(49, 39)).toEqual([9, 18, 27]);
  expect(sample(50, 40)).toEqual([126, 27, 36]);
  expect(sample(100, 80)).toEqual([72, 171, 90]);
  expect(sample(199, 119)).toEqual([99, 198, 117]);
  expect(sample(200, 120)).toEqual([99, 198, 117]);
  expect(sample(-1, -1)).toEqual([9, 18, 27]);
  expect(sample(200, 0)).toEqual([90, 99, 108]);
  expect(sample(0, 120)).toEqual([18, 117, 36]);
});

it("does not tile the painting or shift it with seeded layer shapes and live column anchors", () => {
  const images = [undefined, undefined, undefined, undefined, groundPainting()];
  for (const seed of [1, 19, 71, 313]) {
    const column = new CaveLayers(100, 60, seed).column(50);
    const sample = (x: number, roof: number, soil: number) =>
      caveMaterial(images, x, 60, roof, soil, 120, 1, true, column, 200);
    const row = [sample(10, 40, 60), sample(60, 40, 60), sample(110, 40, 60), sample(160, 40, 60)];
    expect(row).toEqual([[117, 9, 18], [126, 27, 36], [135, 45, 54], [144, 63, 72]]);
    expect(sample(110, 12, 95)).toEqual([135, 45, 54]);
  }
});

it("uses the new painting instead of the old topsoil and limestone band while preserving ceiling materials", () => {
  const images = [material(220, 0, 0), material(200, 100, 20),
    material(100, 140, 180), material(50, 60, 70), groundPainting()];
  const before = images.map(image => image.data.slice());
  for (const soilType of [1, 2, 3]) {
    const sample = (y: number) => caveMaterial(images, 75, y, 40, 60, 120,
      soilType, true, paintedGroundLayers, 200);
    expect(sample(70)).toEqual([126, 27, 36]); // old topsoil zone
    expect(sample(94)).toEqual([45, 144, 63]); // old limestone zone
    expect(sample(110)).toEqual([45, 144, 63]); // below old limestone
  }
  expect(caveMaterial(images, 75, 2, 40, 60, 120, 2, true, paintedGroundLayers, 200))
    .toEqual([95, 133, 171]);
  images.forEach((image, i) => expect(image.data).toEqual(before[i]));
});
