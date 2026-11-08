import { expect, it } from "vitest";
import { LandformLight } from "../src/landform_light";

function rectangle(cells: Uint8Array, fh: number, left: number, top: number, right: number, bottom: number, material: number): void {
  for (let x = left; x < right; x++) cells.fill(material, x * fh + top, x * fh + bottom);
}

it("lights a broad left shoulder and shades the right face without changing terrain", () => {
  const fw = 768, fh = 256, cells = new Uint8Array(fw * fh);
  rectangle(cells, fh, 80, 24, 680, 240, 2);
  const original = cells.slice(), light = new LandformLight(fw, fh, 19);
  light.update(cells);
  expect(light.sample(160, 128)).toBeGreaterThan(0);
  expect(light.sample(570, 128)).toBeLessThan(-15);
  expect(cells).toEqual(original);
  const repeated = new LandformLight(fw, fh, 19);
  repeated.update(cells);
  for (let x = 0; x < fw; x += 7) for (let y = 0; y < fh; y += 11) {
    expect(light.sample(x, y)).toBe(repeated.sample(x, y));
  }
  light.update(cells);
  expect(light.changedTiles.every(v => v === 0)).toBe(true);
});

it("keeps full-width ground gently varied and excludes painted scenery", () => {
  const fw = 259, fh = 133, cells = new Uint8Array(fw * fh).fill(2);
  const light = new LandformLight(fw, fh, 71);
  light.update(cells);
  for (let x = 0; x < fw; x += 5) for (let y = 0; y < fh; y += 9) {
    expect(Math.abs(light.sample(x, y))).toBeLessThan(4);
  }
  cells.fill(0);
  light.update(cells);
  const empty = Array.from({ length: fw }, (_, x) => light.sample(x, 64));
  rectangle(cells, fh, 28, 20, 224, 120, 16);
  light.update(cells);
  expect(Array.from({ length: fw }, (_, x) => light.sample(x, 64))).toEqual(empty);
  expect(light.changedTiles.every(v => v === 0)).toBe(true);
});

it("invalidates every affected tile when a cut changes lighting far from the cut", () => {
  const fw = 768, fh = 260, cells = new Uint8Array(fw * fh);
  rectangle(cells, fh, 32, 16, 736, 252, 2);
  const light = new LandformLight(fw, fh, 313);
  light.update(cells);
  const before = new Float32Array(fw * fh);
  for (let x = 0; x < fw; x++) for (let y = 0; y < fh; y++) before[x * fh + y] = light.sample(x, y);
  rectangle(cells, fh, 380, 64, 388, 196, 0);
  light.update(cells);
  const tilesY = Math.ceil(fh / 128);
  let changed = 0, distant = 0;
  for (let x = 0; x < fw; x++) for (let y = 0; y < fh; y++) {
    if (Math.fround(light.sample(x, y)) === before[x * fh + y]) continue;
    changed++;
    if (Math.abs(x - 384) > 200) distant++;
    expect(light.changedTiles[Math.floor(x / 128) * tilesY + Math.floor(y / 128)]).toBe(1);
  }
  expect(changed).toBeGreaterThan(10000);
  expect(distant).toBeGreaterThan(1000);
  const rebuilt = new LandformLight(fw, fh, 313);
  rebuilt.update(cells);
  for (let x = 0; x < fw; x += 5) for (let y = 0; y < fh; y += 7) {
    expect(light.sample(x, y)).toBe(rebuilt.sample(x, y));
  }
});

it("matches full rebuilds through versioned cuts, deposits, props and partial edge tiles", () => {
  const fw = 517, fh = 269, cells = new Uint8Array(fw * fh).fill(2);
  const tilesY = Math.ceil(fh / 128), versions = new Uint32Array(Math.ceil(fw / 128) * tilesY);
  const light = new LandformLight(fw, fh, 17);
  light.update(cells, versions);
  for (const [x0, y0, x1, y1, material] of [
    [124, 124, 133, 134, 0], [380, 0, 389, 269, 0],
    [0, 260, 517, 269, 0], [510, 263, 517, 269, 3],
    [124, 124, 133, 134, 16], [380, 0, 389, 269, 1],
  ]) {
    const before = Float64Array.from({ length: fw * fh }, (_, i) => light.sample(Math.floor(i / fh), i % fh));
    rectangle(cells, fh, x0, y0, x1, y1, material);
    for (let tx = Math.floor(x0 / 128); tx < Math.ceil(x1 / 128); tx++)
      for (let ty = Math.floor(y0 / 128); ty < Math.ceil(y1 / 128); ty++) versions[tx * tilesY + ty]++;
    light.update(cells, versions);
    const full = new LandformLight(fw, fh, 17);
    full.update(cells);
    for (let x = 0; x < fw; x++) for (let y = 0; y < fh; y++) {
      const actual = light.sample(x, y);
      if (actual !== full.sample(x, y)) throw new Error(`stale light at ${x},${y}`);
      if (actual !== before[x * fh + y])
        expect(light.changedTiles[Math.floor(x / 128) * tilesY + Math.floor(y / 128)]).toBe(1);
    }
    light.update(cells, versions);
    expect(light.changedTiles.every(v => v === 0)).toBe(true);
  }
});
