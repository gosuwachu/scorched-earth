/** Presentation-only relief. All coordinates are world anchored; no simulation
 * random draws or original surface profile are needed, including after reload. */
import { hash } from "./modern";

export const DEPTH_REACH = 32;
const FAR = DEPTH_REACH + 1;

/** A low resolution, non-collidable rear-wall shade below natural overhangs.
 * It fades away from the roof and toward open mouths. Buildings do not turn
 * the sky into cave walls. Rebuilt from live cells so excavation opens it up. */
export function caveShade(cells: Uint8Array, fw: number, fh: number): Uint8ClampedArray {
  const w = Math.ceil(fw / 4), h = Math.ceil(fh / 4);
  const alpha = new Uint8ClampedArray(w * h);
  const floors = new Int32Array(h);
  for (let x = 0; x < w; x++) {
    let floor = h + 1000;
    for (let y = h - 1; y >= 0; y--) {
      const material = cells[Math.min(fw - 1, x * 4) * fh + Math.min(fh - 1, y * 4)];
      if (material > 0 && material < 16) floor = y;
      floors[y] = floor;
    }
    let roof = -1000;
    for (let y = 0; y < h; y++) {
      const material = cells[Math.min(fw - 1, x * 4) * fh + Math.min(fh - 1, y * 4)];
      if (material > 0 && material < 16) roof = y;
      else if (!material && floors[y] - roof < 80) {
        alpha[y * w + x] = Math.max(0, 1 - (y - roof) / 48) * 205;
      }
    }
  }
  // Feather the edge at cave mouths; no hard vertical curtain below a lip.
  const result = new Uint8ClampedArray(alpha.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let dx = -4; dx <= 4; dx++) sum += alpha[y * w + Math.max(0, Math.min(w - 1, x + dx))];
    result[y * w + x] = sum / 9;
  }
  return result;
}

/** Bounded cardinal distances to air, with a halo around the dirty tile.
 * Treat off-map space as solid so map borders do not acquire false bevels.
 * Props participate in occlusion but keep their own painted lighting. */
export class TerrainDepth {
  readonly top = new Uint8Array(128 * 128);
  readonly bottom = new Uint8Array(128 * 128);
  readonly left = new Uint8Array(128 * 128);
  readonly right = new Uint8Array(128 * 128);

  update(cells: Uint8Array, fw: number, fh: number, x0: number, y0: number): void {
    const width = Math.min(128, fw - x0), height = Math.min(128, fh - y0);
    for (let xx = 0; xx < width; xx++) {
      const x = x0 + xx;
      let distance = FAR;
      for (let y = Math.max(0, y0 - DEPTH_REACH); y < y0 + height; y++) {
        distance = cells[x * fh + y] ? Math.min(FAR, distance + 1) : 0;
        if (y >= y0) this.top[(y - y0) * 128 + xx] = distance;
      }
      distance = FAR;
      for (let y = Math.min(fh - 1, y0 + height + DEPTH_REACH - 1); y >= y0; y--) {
        distance = cells[x * fh + y] ? Math.min(FAR, distance + 1) : 0;
        if (y < y0 + height) this.bottom[(y - y0) * 128 + xx] = distance;
      }
    }
    for (let yy = 0; yy < height; yy++) {
      const y = y0 + yy;
      let distance = FAR;
      for (let x = Math.max(0, x0 - DEPTH_REACH); x < x0 + width; x++) {
        distance = cells[x * fh + y] ? Math.min(FAR, distance + 1) : 0;
        if (x >= x0) this.left[yy * 128 + x - x0] = distance;
      }
      distance = FAR;
      for (let x = Math.min(fw - 1, x0 + width + DEPTH_REACH - 1); x >= x0; x--) {
        distance = cells[x * fh + y] ? Math.min(FAR, distance + 1) : 0;
        if (x < x0 + width) this.right[yy * 128 + x - x0] = distance;
      }
    }
  }

  light(i: number): number {
    const falloff = (d: number) => Math.max(0, 1 - d / FAR) ** 2;
    return 25 * falloff(this.top[i]) + 15 * falloff(this.left[i]) -
      34 * falloff(this.bottom[i]) - 22 * falloff(this.right[i]);
  }
}

/** Broad angular stone planes with staggered joints. The smoothly warped bed
 * coordinate keeps strata continuous through tile boundaries and blast cuts. */
export type RockRelief = { light: number; bed: number };

/** Geology is static even when terrain is removed. Cache at one world pixel;
 * fine-grid edges and texture still render at half-unit resolution. */
export class RockReliefCache {
  private readonly lights: Float32Array;
  private readonly beds: Int16Array;
  private readonly ready: Uint8Array;
  constructor(private width: number, height: number, private seed: number) {
    this.lights = new Float32Array(width * height);
    this.beds = new Int16Array(width * height);
    this.ready = new Uint8Array(width * height);
  }

  sample(x: number, y: number): RockRelief {
    x = Math.floor(x); y = Math.floor(y);
    const i = y * this.width + x;
    if (!this.ready[i]) {
      const relief = rockRelief(x, y, this.seed);
      this.lights[i] = relief.light; this.beds[i] = relief.bed; this.ready[i] = 1;
    }
    return { light: this.lights[i], bed: this.beds[i] };
  }
}

export function rockRelief(x: number, y: number, seed: number): RockRelief {
  const warp = Math.sin(x * .013 + seed) * 13 + Math.sin(x * .037 + y * .011) * 4 + Math.sin(x * .13 + y * .07) * 1.1;
  const warpedY = y + warp + Math.sin(y * .024) * 12;
  const v = warpedY / 39;
  const bed = Math.floor(v), f = v - bed;
  // Irregular cellular slabs: use unequal, jittered sites rather than repeating
  // rectangular blocks. The anisotropic coordinates stretch them along bedding.
  const u = (x + Math.sin(y * .031) * 11 + Math.sin(y * .23 + x * .08) * 1.5) / 68;
  const cx = Math.floor(u), cy = Math.floor(v);
  let nearest = Infinity, second = Infinity, px = 0, py = 0, variation = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const sx = cx + dx, sy = cy + dy;
    const a = hash(sx, sy, seed + 813), b = hash(sx, sy, seed + 814);
    const rx = u - sx - .15 - a * .70, ry = v - sy - .15 - b * .70;
    const distance = rx * rx + ry * ry;
    if (distance < nearest) {
      second = nearest; nearest = distance; px = rx; py = ry; variation = a;
    } else second = Math.min(second, distance);
  }
  const edge = Math.min(1, (second - nearest) * 15);
  const face = px * .7 + py;
  let light = (variation - .5) * 18 - px * 15 - py * 12;
  // A shallow lip casts a stronger shadow on the lower/right sides of a slab.
  light += (1 - edge) * (face < 0 ? 15 : -25);
  if (face > .28 + variation * .2) light -= 14;
  if (f < .045) light -= 14 * (1 - f / .045);
  else if (f < .11) light += 9 * (1 - (f - .045) / .065);
  return { light, bed };
}
