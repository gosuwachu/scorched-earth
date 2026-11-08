/** Browser-only terrain. Half-world-unit cells are authoritative; the legacy
 * palette plane is a conservative contact/weapon compatibility view. No DOS claim. */
import * as C from "./constants";
import masks from "./modern_masks.json";
import { desertProfile } from "./desert";
import { landmarkMasks } from "./landmark_masks";
import { PAINTED_ART, buildingMasks, buildingAspect, paintedMasks, paintedAspect, paintedContains } from "./painted_sprites";
import { PARK_PROPS, isParkProp, parkContains, type ParkProp } from "./city_parks";
import { rockContains } from "./modern_rocks";
import { placeAlpineRocks } from "./alpine_rocks";
import { CITY_BUILDINGS, CITY_LANDMARKS, cityContains, isCityBuilding, type CityBuilding } from "./city_shapes";
export { CITY_BUILDINGS, isCityBuilding, type CityBuilding } from "./city_shapes";

export type Biome = "GRASS" | "SNOW" | "DESERT" | "SWAMP";
export type Layout = "MOUNTAINS" | "CAVE" | "CITY";
// Car/animal IDs remain readable in existing saved masks, but are never placed.
export type PropKind = "pine" | "tree" | "cactus" | "house" | "tower" | "car" | "animal" | "rock" | CityBuilding | ParkProp;
export interface Prop { id: number; kind: PropKind; x: number; y: number; w: number; h: number; variant: number; art?: "illustrated-v1" | typeof PAINTED_ART }
export interface ModernData { version: 1; seed: number; biome: Biome; layout: Layout; w: number; h: number; runs: number[]; props: Prop[] }
export interface ModernOptions { TERRAIN_BIOME?: string; TERRAIN_LAYOUT?: string }
const DIRT = C.DIRT_SHADE_LO + 8;
export const BIOMES: Biome[] = ["GRASS", "SNOW", "DESERT", "SWAMP"];
export const LAYOUTS: Layout[] = ["MOUNTAINS", "CAVE", "CITY"];
export function hash(x: number, y = 0, seed = 0): number {
  let v = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ seed;
  v = Math.imul(v ^ v >>> 13, 1274126177); return ((v ^ v >>> 16) >>> 0) / 4294967296;
}
function noise(x: number, seed: number): number {
  const a = Math.floor(x), t = x - a, s = t * t * (3 - 2 * t);
  return hash(a, 0, seed) * (1 - s) + hash(a + 1, 0, seed) * s;
}

/** Keep the large fractal ridges, but soften fine teeth along their slopes.
 * Normalize after smoothing so tall summits and deep valleys retain their
 * full relief without flat clipped bands. */
function mountainProfile(width: number, seed: number): Float64Array {
  const heights = new Float64Array(width);
  heights[0] = hash(0, 101, seed) * .4;
  heights[width - 1] = hash(width, 101, seed) * .4;
  const divide = (left: number, right: number, amplitude: number): void => {
    if (right - left < 2) return;
    const mid = (left + right) >> 1;
    heights[mid] = (heights[left] + heights[right]) / 2 + (hash(left, right, seed) - .5) * amplitude;
    divide(left, mid, amplitude * .58);
    divide(mid, right, amplitude * .58);
  };
  divide(0, width - 1, 1);
  // A small triangular filter removes needle-like peaks at roughly tree-width
  // scales. Scale with map width so the silhouette feels consistent at each
  // resolution. Apply only during generation; crater edges stay precise.
  const radius = Math.max(4, Math.round(width * .012));
  const smooth = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let sum = 0, weight = 0;
    for (let dx = -radius; dx <= radius; dx++) {
      const k = radius + 1 - Math.abs(dx);
      sum += heights[Math.max(0, Math.min(width - 1, x + dx))] * k;
      weight += k;
    }
    smooth[x] = sum / weight;
  }
  let lo = Infinity, hi = -Infinity;
  for (const value of smooth) { lo = Math.min(lo, value); hi = Math.max(hi, value); }
  const range = Math.max(1e-9, hi - lo);
  for (let x = 0; x < width; x++) heights[x] = (smooth[x] - lo) / range;
  return heights;
}

/** Compress two broad downhill slopes into cliff faces, retaining the ridge's
 * endpoints and relief. The shoulders remain wide enough for tank seats. */
function terrainCliffs(heights: Float64Array, seed: number, weathered: boolean): void {
  const source = heights.slice(), width = heights.length;
  const span = Math.floor(width * .10);
  for (let region = 0; region < 2; region++) {
    let left = 0, drop = 0;
    for (let x = Math.floor(width * (region * .5 + .06)); x < width * (region * .5 + .40) - span; x++) {
      const d = Math.abs(source[x + span] - source[x]);
      if (d > drop) { drop = d; left = x; }
    }
    for (let x = left; x <= left + span; x++) {
      const u = (x - left) / span;
      const t = Math.max(0, Math.min(1, (u - .44) / .12));
      let cliff = .08 * u + .92 * t * t * (3 - 2 * t);
      if (weathered) {
        const smooth = (a: number, b: number): number => {
          const v = Math.max(0, Math.min(1, (u - a) / (b - a)));
          return v * v * (3 - 2 * v);
        };
        const center = .43 + hash(region, 351, seed) * .14;
        const face = .18 + hash(region, 352, seed) * .09;
        // Unequal rock faces interrupt the main drop; sloping shoulders and
        // a broad talus foot ease it back into the original hillside.
        cliff = .12 * smooth(0, center) + .58 * smooth(center - face / 2, center + face / 2) +
          .16 * smooth(center + face * .15, center + face * 1.1) + .14 * smooth(center, 1);
        const envelope = Math.sin(Math.PI * u) ** 2;
        const fractures = (noise(u * 8, seed + 353 + region) - .5) * .055;
        const original = source[x] - (source[left] + (source[left + span] - source[left]) * u);
        heights[x] = source[left] + (source[left + span] - source[left]) * (cliff + fractures * envelope) +
          original * .22 * envelope;
      } else {
        heights[x] = source[left] + (source[left + span] - source[left]) * cliff;
      }
    }
  }
}

export class ModernWorld {
  readonly scale = 2;
  readonly fw: number;
  readonly fh: number;
  readonly cells: Uint8Array;
  readonly grid: Uint8Array;
  readonly surface: Float32Array;
  props: Prop[] = [];
  version = 0;
  dirty = true;
  // Tiles are tracked in fine-grid coordinates; consumers own their cache version.
  readonly tileVersions: Uint32Array;
  readonly tilesX: number;
  readonly tilesY: number;
  constructor(readonly w: number, readonly h: number, readonly seed: number,
    readonly biome: Biome, readonly layout: Layout) {
    this.fw = w * 2; this.fh = h * 2;
    this.cells = new Uint8Array(this.fw * this.fh);
    this.grid = new Uint8Array(w * h);
    this.surface = new Float32Array(this.fw);
    this.tilesX = Math.ceil(this.fw / 128); this.tilesY = Math.ceil(this.fh / 128);
    this.tileVersions = new Uint32Array(this.tilesX * this.tilesY);
  }
  static generate(w: number, h: number, seed: number, options: ModernOptions): ModernWorld {
    const biome = BIOMES.includes(options.TERRAIN_BIOME as Biome) ? options.TERRAIN_BIOME as Biome : BIOMES[Math.floor(hash(seed, 1) * 4)];
    const layouts: Layout[] = ["MOUNTAINS", "MOUNTAINS", "MOUNTAINS", "CAVE", "CITY"];
    const layout = LAYOUTS.includes(options.TERRAIN_LAYOUT as Layout) ? options.TERRAIN_LAYOUT as Layout : layouts[Math.floor(hash(seed, 2) * layouts.length)];
    const m = new ModernWorld(w, h, seed, biome, layout);
    const desert = biome === "DESERT" && layout === "MOUNTAINS";
    const ridges = layout === "CITY" ? null : desert ? desertProfile(m.fw, seed) : mountainProfile(m.fw, seed);
    const cliffs = layout === "CAVE" || (layout === "MOUNTAINS" && !desert);
    if (cliffs) terrainCliffs(ridges!, seed, biome === "SWAMP" || layout === "CAVE");
    for (let x = 0; x < m.fw; x++) {
      const u = x / m.fw;
      let height = 0.16 + (ridges?.[x] ?? 0) * 0.75;
      if (layout === "CITY") height = 0.68 + noise(u * 5, seed) * 0.17 + (noise(u * 13, seed + 1) - .5) * .035;
      // Taller cave ridges trade some headroom for deep gullies and cliffs.
      else if (layout === "CAVE") height = 0.38 + ridges![x] * 0.53;
      const top = Math.floor(height * m.fh);
      m.surface[x] = top / 2;
      for (let y = top; y < m.fh; y++) m.cells[x * m.fh + y] = y - top > h * (desert ? 0.035 : 0.16) ? 2 : 1;
      if (layout === "CAVE") {
        const roof = Math.floor((0.12 + noise(u * 13, seed + 4) * 0.065 + Math.pow(noise(u * 39, seed + 5), 9) * 0.12) * m.fh);
        m.cells.fill(2, x * m.fh, x * m.fh + roof);
      }
    }
    if (layout === "MOUNTAINS" && (biome === "GRASS" || biome === "SNOW")) {
      m.carveAlpineCaves();
    }
    if (cliffs) {
      m.addCliffOverhangs();
      // Eroded lips can release small fragments; settle these before play.
      m.settle();
    }
    m.publish(0, 0, m.fw, m.fh);
    return m;
  }
  /** Cut chambers into downhill faces, leaving a grounded rock cantilever.
   * The original ridge profile remains the reference for surface vegetation. */
  private carveAlpineCaves(): void {
    const count = hash(this.seed, 301) < .3 ? 1 : 2;
    for (let region = 0; region < count; region++) {
      const span = Math.max(24, Math.floor(this.fw * (.075 + hash(region, 302, this.seed) * .045)));
      const radius = Math.max(40, this.fh * (.052 + hash(region, 303, this.seed) * .035));
      let mouth = 0, direction = 1, best = -Infinity;
      const start = Math.floor(this.fw * (region / count + .045));
      const end = Math.floor(this.fw * ((region + 1) / count - .045));
      for (let x = start; x < end; x++) for (const d of [-1, 1]) {
        const inner = x - d * span;
        if (inner < this.fw * region / count + 8 || inner >= this.fw * (region + 1) / count - 8) continue;
        const drop = (this.surface[x] - this.surface[inner]) * 2;
        const score = drop + hash(x, region + 310, this.seed) * radius * .15;
        if (score > best) { best = score; mouth = x; direction = d; }
      }
      if (best < radius * 1.5) continue;
      const cy = Math.min(this.fh - radius - 12, this.surface[mouth] * 2 - radius * .3);
      const center = mouth - direction * span * .64;
      const rx = span * .85;
      const left = Math.max(Math.floor(this.fw * region / count) + 1, Math.floor(center - rx));
      const right = Math.min(Math.floor(this.fw * (region + 1) / count) - 2, Math.ceil(center + rx));
      const bounds = (x: number): [number, number] => {
        const u = (x - center) / rx;
        const arch = Math.sqrt(Math.max(0, 1 - u * u));
        const rough = (noise(x / 18, this.seed + region + 320) - .5) * radius * .16;
        return [Math.floor(cy - radius * arch + rough), Math.ceil(cy + radius * .65 * arch + rough)];
      };
      // A cutter crossing a valley would create another cave in the next ridge.
      // Keep only its longest underground stretch, including its open mouth.
      let run = left, first = left, last = left - 1;
      for (let x = left; x <= right + 1; x++) {
        if (x <= right && bounds(x)[1] > this.surface[x] * 2 + 12) continue;
        if (x - run > last - first + 1) { first = run; last = x - 1; }
        run = x + 1;
      }
      for (let x = first; x <= last; x++) {
        const [roof, floor] = bounds(x);
        const surface = Math.floor(this.surface[x] * 2);
        // Rock carries the roof sideways into the mountain; a thin turf cap
        // remains on top. Both materials still use the normal weapon mask.
        for (let y = surface + (roof - surface > 12 ? 6 : 0); y < Math.min(this.fh, floor + 12); y++) {
          if (this.cells[x * this.fh + y]) this.cells[x * this.fh + y] = 2;
        }
        for (let y = Math.max(0, roof); y < floor; y++) this.cells[x * this.fh + y] = 0;
      }
    }
  }
  /** Weathered rock shoulders project from cliffs. Broad roots and rounded,
   * chipped noses blend into the face instead of forming thin straight shelves. */
  private addCliffOverhangs(): void {
    const span = Math.max(4, Math.floor(this.fw * .012));
    for (let region = 0; region < 2; region++) {
      let edge = 0, best = 0;
      for (let x = Math.floor(this.fw * (region * .5 + .06)); x < this.fw * (region * .5 + .40) - span; x++) {
        const drop = Math.abs(this.surface[x + span] - this.surface[x]);
        if (drop > best) { best = drop; edge = x; }
      }
      if (best < this.h * .06) continue;
      const direction = this.surface[edge] < this.surface[edge + span] ? 1 : -1;
      const root = direction === 1 ? edge : edge + span;
      // Sloped swamp/cavern faces need deeper shoulders to expose the undercut.
      const reach = this.biome === "SWAMP" || this.layout === "CAVE" ? .040 : .022;
      const length = Math.max(8, Math.floor(this.fw * (reach + hash(region, 341, this.seed) * .017)));
      const depth = Math.max(8, Math.min(this.fh * (.044 + hash(region, 342, this.seed) * .026), best * 1.2));
      const top = this.surface[root] * 2 + this.fh * .003;
      const embed = Math.max(6, Math.floor(length * .4));
      for (let step = -embed; step < length; step++) {
        const x = root + direction * step;
        if (x < 0 || x >= this.fw) continue;
        const u = Math.max(0, step / length);
        const round = Math.sqrt(Math.max(0, 1 - u * u));
        const envelope = Math.sin(Math.PI * u);
        // Broad fractures plus smaller chips avoid a regular sawtooth edge.
        const upperChip = (noise(u * 5, this.seed + 343 + region) - .5) * depth * .10 * envelope;
        const lowerChip = ((noise(u * 7, this.seed + 345 + region) - .5) * .14 +
          (noise(u * 19, this.seed + 347 + region) - .5) * .045) * depth * envelope;
        const shoulder = step < 0 ? this.surface[x] * 2 : top + depth * (.13 * u + .37 * (1 - round));
        const roof = Math.floor(shoulder + upperChip);
        const bottom = Math.ceil(top + depth * (.5 + .75 * round) + lowerChip);
        for (let y = roof; y < Math.min(this.fh, bottom); y++) this.cells[x * this.fh + y] = 2;
        // Convert the buried root to rock without filling existing cave air.
        if (step <= 0) for (let y = bottom; y < this.fh; y++) {
          const i = x * this.fh + y;
          if (this.cells[i] !== 1) break;
          this.cells[i] = 2;
        }
      }
    }
  }
  /** Find a clear cave floor below a genuine roof. Return null when a tank's
   * neighbourhood has no chamber large enough; surface placement is the fallback. */
  caveSeatNear(x: number, halfWidth: number, minX: number, maxX: number): [number, number] | null {
    if (this.layout !== "MOUNTAINS" || (this.biome !== "GRASS" && this.biome !== "SNOW")) return null;
    let best: [number, number] | null = null, score = Infinity;
    for (let cx = Math.max(halfWidth + 2, Math.ceil(minX)); cx <= Math.min(this.w - halfWidth - 3, Math.floor(maxX)); cx++) {
      if (Math.abs(cx - x) >= score) continue;
      let roof = false, gap = 0;
      for (let y = 1; y < this.h - 18; y++) {
        if (!this.solid(cx, y)) { if (roof) gap++; continue; }
        if (roof && gap >= 38 && y > 65 && y > this.surface[cx * 2] + 24) {
          const seat = y - 1;
          let safe = true;
          for (let dx = -halfWidth - 2; dx <= halfWidth + 2 && safe; dx++) {
            for (let yy = seat - 32; yy <= seat; yy++) {
              if (this.solid(cx + dx, yy)) { safe = false; break; }
            }
            if (!this.solid(cx + dx, seat + 12)) safe = false;
          }
          if (safe) { best = [cx, seat]; score = Math.abs(cx - x); break; }
        }
        roof = true; gap = 0;
      }
    }
    return best;
  }
  /** Exact fine-cell contact. World-pixel callers use the conservative grid. */
  solid(x: number, y: number): boolean {
    const ix = Math.floor(x * 2), iy = Math.floor(y * 2);
    return ix >= 0 && iy >= 0 && ix < this.fw && iy < this.fh && this.cells[ix * this.fh + iy] !== 0;
  }
  /** Fine raster sweep; at most half a world unit between samples. */
  *sweep(x0: number, y0: number, x1: number, y1: number): Generator<[number, number]> {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2));
    for (let i = 0; i <= steps; i++) yield [x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps];
  }
  publish(x0: number, y0: number, x1: number, y1: number): void {
    x0 = Math.max(0, Math.floor(x0 / 2)); y0 = Math.max(0, Math.floor(y0 / 2));
    x1 = Math.min(this.w, Math.ceil(x1 / 2)); y1 = Math.min(this.h, Math.ceil(y1 / 2));
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) {
      const i = x * 2 * this.fh + y * 2;
      this.grid[x * this.h + y] = this.cells[i] || this.cells[i + 1] || this.cells[i + this.fh] || this.cells[i + this.fh + 1] ? DIRT : C.COL_SKY;
    }
    this.version++; this.dirty = true;
    for (let tx = Math.floor(x0 * 2 / 128); tx < Math.ceil(x1 * 2 / 128); tx++)
      for (let ty = Math.floor(y0 * 2 / 128); ty < Math.ceil(y1 * 2 / 128); ty++) this.tileVersions[tx * this.tilesY + ty] = this.version;
  }
  write(x: number, y: number, color: number): void {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = x * 2 * this.fh + y * 2, material = C.is_dirt(color) ? 3 : 0;
    for (const off of [0, 1, this.fh, this.fh + 1]) {
      // Preserve the material when weapons repaint existing dirt (napalm).
      this.cells[i + off] = material ? this.cells[i + off] || material : 0;
    }
    this.publish(x * 2, y * 2, x * 2 + 2, y * 2 + 2);
    this.grid[x * this.h + y] = color;
  }
  circle(cx: number, cy: number, r: number, deposit = false, halfAngle?: number, aim = 90): void {
    const x0 = Math.max(0, Math.floor((cx - r) * 2)), x1 = Math.min(this.fw, Math.ceil((cx + r) * 2 + 1));
    const y0 = Math.max(0, Math.floor((cy - r) * 2)), y1 = Math.min(this.fh, Math.ceil((cy + r) * 2 + 1));
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) {
      const dx = (x + 0.5) / 2 - cx, dy = (y + 0.5) / 2 - cy;
      if (dx * dx + dy * dy > r * r) continue;
      if (halfAngle !== undefined) {
        const angle = Math.atan2(-dy, dx) * 180 / Math.PI;
        if (Math.abs(((angle - aim + 540) % 360) - 180) > halfAngle) continue;
      }
      const i = x * this.fh + y;
      this.cells[i] = deposit ? this.cells[i] || 3 : 0;
    }
    this.publish(x0, y0, x1, y1);
  }
  level(cx: number, y: number, halfWidth: number): void {
    for (let x = Math.max(0, cx - halfWidth); x <= Math.min(this.w - 1, cx + halfWidth); x++) {
      for (let yy = Math.max(0, y - 16); yy <= y; yy++) this.write(x, yy, C.COL_SKY);
      for (let yy = y + 1; yy < Math.min(this.h, y + 18) && !this.solid(x, yy); yy++) this.write(x, yy, DIRT);
    }
  }
  placeProps(tanks: ReadonlyArray<{x: number; y: number; half_width: number}>): void {
    if (this.layout === "CITY") { this.placeCity(); return; }
    const spacing = 63;
    for (let n = 0, x = 45; x < this.w - 40 && n < 180; n++, x += spacing) {
      const rnd = hash(n, 19, this.seed);
      const px = Math.round(x + rnd * 15);
      let kind: PropKind = this.biome === "DESERT" ? "cactus" : this.biome === "SWAMP" ? "tree" : "pine";
      if (n % 7 === 3) kind = "house";
      const aspect = paintedAspect(kind);
      const h = kind === "house" ? 45 / (aspect ?? (45 / 38)) : 40 + rnd * 40;
      const w = aspect ? h * aspect : kind === "house" ? 45 : 26 + rnd * 14;
      if (tanks.some(t => Math.abs(t.x - px) < w / 2 + t.half_width + 18)) continue;
      let y = this.h;
      let start = 0;
      if (this.layout === "CAVE") while (start < this.h && this.solid(px, start)) start++;
      for (let yy = start; yy < this.h; yy++) if (this.solid(px, yy)) { y = yy; break; }
      if (y >= this.h || y - h < (this.layout === "CAVE" ? this.h * 0.32 : 40)) continue;
      // Avoid steep sites, then seat the whole silhouette above the uphill edge.
      const edge = Math.floor(w / 2);
      if (Math.abs(this.surface[Math.min(this.fw - 1, (px + edge) * 2)] - this.surface[Math.max(0, (px - edge) * 2)]) > 17) continue;
      const x0 = Math.max(0, Math.floor((px - w / 2) * 2)), x1 = Math.min(this.fw, Math.ceil((px + w / 2) * 2));
      for (let xx = x0; xx < x1; xx++) y = Math.min(y, Math.floor(this.surface[xx]));
      if (y - h < (this.layout === "CAVE" ? this.h * .32 : 40)) continue;
      const prop: Prop = { id: this.props.length + 16, kind, x: px, y, w, h, variant: rnd };
      if (paintedMasks[kind]) prop.art = PAINTED_ART;
      if (this.stampSupportedProp(prop, 17)) this.props.push(prop);
    }
    if (this.biome === "DESERT" && this.layout === "MOUNTAINS") this.placeRocks(tanks);
    if ((this.biome === "GRASS" || this.biome === "SNOW") && this.layout === "MOUNTAINS") placeAlpineRocks(this, tanks);
  }
  /** Boulders with smaller fallen fragments. Reject cliff faces and occupied
   * ground; bury the bases slightly so the rocks sit into the sand. */
  private placeRocks(tanks: ReadonlyArray<{x: number; half_width: number}>): void {
    // Reserve space for larger stones before filling gaps with small rubble.
    for (let piece = 0; piece < 4; piece++) {
      for (let n = 0, anchor = 16; anchor < this.w - 12 && this.props.length < 180; n++, anchor += piece === 0 ? 12 : 24) {
        const center = anchor + hash(n, 501, this.seed) * 20;
        const boulderWidth = 16 + hash(n, 502, this.seed) * 24;
        const rnd = hash(n, 502 + piece, this.seed);
        const w = piece === 0 ? boulderWidth : 3 + rnd * 9;
        const h = w * (.45 + hash(n, 510 + piece, this.seed) * .25);
        const offset = piece === 0 ? 0 : (piece === 1 ? -1 : 1) * (boulderWidth / 2 + 5 + rnd * 6 + (piece === 3 ? 13 : 0));
        const px = Math.round(center + offset);
        if (px - w / 2 < 1 || px + w / 2 >= this.w - 1 ||
          tanks.some(t => Math.abs(t.x - px) < w / 2 + t.half_width + 18) ||
          this.props.some(p => Math.abs(p.x - px) < (p.w + w) / 2 + 2)) continue;
        const x0 = Math.floor((px - w / 2) * 2), x1 = Math.ceil((px + w / 2) * 2);
        let high = this.h, low = 0;
        for (let x = x0; x < x1; x++) {
          high = Math.min(high, this.surface[x]); low = Math.max(low, this.surface[x]);
        }
        if (low - high > h * .65 || high - h < 40) continue;
        const y = Math.min(this.h - 1, low + .5);
        const p: Prop = { id: this.props.length + 16, kind: "rock", x: px, y, w, h, variant: rnd };
        const y0 = Math.floor((y - h) * 2), y1 = Math.ceil(y * 2);
        let stamped = false;
        for (let x = x0; x < x1; x++) for (let yy = y0; yy < y1; yy++) {
          const i = x * this.fh + yy;
          // Stamp after the ground, replacing sand within the whole silhouette.
          // Keeping only air cells would let the sand strip cover the rock face.
          if (this.cells[i] < 4 && rockContains(((x + .5) / 2 - px) / w, (y - (yy + .5) / 2) / h, rnd)) {
            this.cells[i] = p.id; stamped = true;
          }
        }
        if (stamped) { this.props.push(p); this.publish(x0, y0, x1, y1); }
      }
    }
  }
  /** Suburban clusters flank a tall centre, separated by generous public space.
   * A crossing sometimes replaces one park; the other stays open ground. */
  private placeCity(): void {
    const scale = Math.min(1, this.w / 640);
    const centre = this.w * (.5 + (hash(this.seed, 40) - .5) * .08);
    const downtownLeft = Math.floor(centre - this.w * .18);
    const downtownRight = Math.floor(centre + this.w * .18);
    const parkWidth = Math.floor(this.w * .16);
    const landmark = CITY_LANDMARKS[Math.floor(hash(this.seed, 41) * CITY_LANDMARKS.length)];
    const districts = [[12, downtownLeft - parkWidth, false], [downtownLeft, downtownRight, true],
      [downtownRight + parkWidth, this.w - 12, false]] as const;
    for (let district = 0; district < districts.length; district++) {
      const [start, end, downtown] = districts[district];
      for (let n = 0, left = start; left < end - 25 * scale; n++) {
        const rnd = hash(n, 42 + district, this.seed);
        const homes: CityBuilding[] = ["detached", "semi", "townhouse", "shop", "apartment"];
        const kind: PropKind = downtown ? n === 1 ? landmark : n % 2 ? "tower" : "office" :
          homes[(n + Math.floor(hash(district, 49, this.seed) * homes.length)) % homes.length];
        const broad = ["st_pauls", "bloomberg", "london_eye"].includes(kind);
        const width = Math.floor((broad ? (kind === "st_pauls" ? 180 : kind === "bloomberg" ? 164 : 118) + rnd * 18 : kind === "semi" ? 72 : 48 + rnd * 23) * scale);
        const aspect = buildingAspect(kind);
        const fraction = kind === "office" || kind === "tower" || kind === "gherkin" ? .48 + rnd * .2 :
          kind === "big_ben" ? .48 : kind === "st_pauls" ? .26 : kind === "london_eye" ? width / this.h * 1.12 :
          kind === "lighthouse" ? .26 : kind === "bloomberg" ? .16 : kind === "apartment" ? .15 :
          kind === "townhouse" ? .13 : .075 + rnd * .035;
        const tall = ["office", "tower", "gherkin", "big_ben", "lighthouse"].includes(kind);
        // A taller silhouette needs a proportionally wider plot. Constrained
        // plots fit the whole sprite; no independent width/height variation.
        // Do not squeeze a home into a leftover sliver: its whole painted
        // silhouette would shrink, making doors and windows smaller than tanks.
        const minimumWidth = downtown ? 30 * scale : Math.max(60, 40 * (aspect ?? 1)) * scale;
        const requestedWidth = tall && aspect ? this.h * fraction * aspect : Math.max(width, minimumWidth);
        const w = Math.min(requestedWidth, end - left);
        if (w < minimumWidth) break;
        this.stampCityProp(kind, left, w, aspect ? w / aspect : this.h * fraction);
        left += w + Math.floor((downtown ? 7 + rnd * 8 : 16 + rnd * 14) * scale);
      }
    }
    const crossing = this.w >= 480 && hash(this.seed, 47) > .3;
    if (crossing) {
      const left = downtownRight + 6, w = parkWidth - 12;
      const kind = hash(this.seed, 48) > .5 ? "golden_gate" : "bridge";
      const bank = Math.floor(Math.min(this.surface[left * 2], this.surface[(left + w - 1) * 2]));
      const h = w / buildingAspect(kind)!;
      const depth = h * buildingMasks[kind]!.deck!;
      // Cut a real valley beneath the crossing. Only abutments and piers will
      // receive foundations; the arch/span remains empty collision space.
      for (let xx = left * 2; xx < (left + w) * 2; xx++) {
        const u = (xx / 2 - left) / w;
        const ground = Math.min(this.h - 8, bank + Math.sin(u * Math.PI) * (depth + 14));
        this.surface[xx] = ground;
        for (let yy = bank * 2; yy < ground * 2; yy++) this.cells[xx * this.fh + yy] = 0;
      }
      this.stampCityProp(kind, left, w, h, bank + depth);
    }
    this.placePark(downtownLeft - parkWidth + 3, parkWidth - 6, false);
    if (!crossing) this.placePark(downtownRight + 3, parkWidth - 6, true);
    this.publish(0, 0, this.fw, this.fh);
  }
  /** Plant public lawns, with low equipment and clear ground between trees. */
  private placePark(left: number, width: number, sports: boolean): void {
    const x0 = Math.ceil(left * 2), x1 = Math.floor((left + width) * 2);
    let ground = this.h;
    for (let x = x0; x < x1; x++) ground = Math.min(ground, this.surface[x]);
    ground = Math.floor(ground);
    // Follow the existing terrain so the park edges do not create tall walls
    // beside neighbouring tank seats. The lawn descriptor preserves its extent.
    this.props.push({ id: this.props.length + 16, kind: "lawn", x: left + width / 2,
      y: ground + 4, w: width, h: 4, variant: 0 });
    const treeWidth = width * .23;
    for (const x of [left, left + width * .1]) {
      this.stampCityProp("tree", x, treeWidth, treeWidth / paintedAspect("tree")!);
    }
    if (sports) {
      this.stampCityProp("stadium", left + width * .35, width * .6, width * .2);
    } else {
      this.stampCityProp("swings", left + width * .32, width * .15, width * .17);
      this.stampCityProp("playground", left + width * .49, width * .16, width * .18);
    }
  }
  /** Stamp a collision silhouette and support only its actual feet. */
  stampCityProp(kind: PropKind, left: number, w: number, height: number, baseY?: number): Prop {
    let x0 = Math.max(0, Math.floor(left * 2)), x1 = Math.min(this.fw, Math.ceil((left + w) * 2));
    let y = baseY ?? this.h;
    if (baseY === undefined) for (let x = x0; x < x1; x++) y = Math.min(y, this.surface[x]);
    y = Math.floor(y);
    const aspect = paintedAspect(kind), centre = left + w / 2;
    const h = Math.max(.5, Math.floor(Math.min(height, y - 65, aspect ? w / aspect : Infinity) * 2) / 2);
    if (aspect) {
      w = h * aspect;
      left = centre - w / 2;
      x0 = Math.max(0, Math.floor(left * 2)); x1 = Math.min(this.fw, Math.ceil((left + w) * 2));
    }
    const p: Prop = { id: this.props.length + 16, kind, x: left + w / 2, y, w, h, variant: hash(left, 51, this.seed) };
    if (paintedMasks[kind]) p.art = PAINTED_ART;
    this.props.push(p);
    this.stampSupportedProp(p);
    return p;
  }
  /** Seat the actual lower silhouette, including uneven painted base stones.
   * Plants get a continuous flat soil patch; structures get rock down to the
   * existing terrain. Elevated bridge spans must remain open. */
  private stampSupportedProp(p: Prop, maxFoundation = Infinity): boolean {
    const plant = p.kind === "tree" || p.kind === "pine" || p.kind === "cactus";
    const x0 = Math.max(0, Math.floor((p.x - p.w / 2) * 2));
    const x1 = Math.min(this.fw, Math.ceil((p.x + p.w / 2) * 2));
    const y0 = Math.max(0, Math.floor((p.y - p.h) * 2));
    const y1 = Math.min(this.fh, Math.ceil(p.y * 2));
    const feet: Array<[number, number]> = [];
    for (let x = x0; x < x1; x++) {
      let foot = -1;
      for (let y = y0; y < y1; y++) {
        if (propContains(p.kind, (x / 2 - p.x) / p.w, (p.y - y / 2) / p.h)) foot = y;
      }
      if (foot >= (p.y - Math.max(.5, p.h * .05)) * 2) feet.push([x, foot]);
    }
    let left = x0, right = x1;
    if (plant && feet.length) {
      left = Math.max(0, feet[0][0] - 2);
      right = Math.min(this.fw, feet[feet.length - 1][0] + 3);
    }
    // The ridge profile predates caves and settling, and endpoint slope checks
    // miss gullies. Validate every foundation against the live mask before
    // writing anything, so rejected countryside sites leave no dirt pillars.
    const rootTop = Math.min(...feet.map(([, foot]) => foot + 1));
    const supports: Array<[number, number]> = plant && feet.length
      ? Array.from({ length: right - left }, (_, i) => [left + i, rootTop])
      : feet.map(([x, foot]) => [x, foot + 1]);
    if (Number.isFinite(maxFoundation)) for (const [x, top] of supports) {
      let y = top;
      while (y < this.fh && !this.cells[x * this.fh + y] && y - top <= maxFoundation * 2) y++;
      if (y === this.fh || y - top > maxFoundation * 2) return false;
    }
    if (plant && feet.length) {
      // Level just the root footprint, not the full canopy. A little soil at
      // either edge keeps the painted roots visibly embedded in the ground.
      left = Math.max(0, feet[0][0] - 2);
      right = Math.min(this.fw, feet[feet.length - 1][0] + 3);
      const top = Math.min(...feet.map(([, foot]) => foot + 1));
      for (let x = left; x < right; x++) {
        for (let y = top; y < this.fh && !this.cells[x * this.fh + y]; y++) this.cells[x * this.fh + y] = 1;
        this.surface[x] = Math.min(this.surface[x], top / 2);
      }
    } else {
      for (const [x, foot] of feet) {
        for (let y = foot + 1; y < this.fh && !this.cells[x * this.fh + y]; y++) this.cells[x * this.fh + y] = 2;
      }
    }
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) {
      if (propContains(p.kind, (x / 2 - p.x) / p.w, (p.y - y / 2) / p.h)) {
        this.cells[x * this.fh + y] = p.kind === "lawn" ? 1 : p.id;
      }
    }
    this.publish(Math.min(left, x0), y0, Math.max(right, x1), this.fh);
    return true;
  }

  /** Mix ground and roof preferences, without pulling every tank out of
   * its neighbourhood. Open parks and streets remain valid starting positions. */
  citySeatNear(x: number, halfWidth: number, minX: number, maxX: number, preferGround: boolean): number {
    let best = Math.max(Math.ceil(minX), Math.min(Math.floor(maxX), x)), score = Infinity;
    for (let candidate = Math.ceil(minX); candidate <= Math.floor(maxX); candidate++) {
      const ground = this.props.every(p => p.kind === "lawn" || Math.abs(candidate - p.x) > p.w / 2 + halfWidth + 4);
      let top = 0;
      while (top < this.h && !this.solid(candidate, top)) top++;
      if (top < 65 || top >= this.h - 2) continue;
      if (ground && Array.from({ length: halfWidth * 2 + 1 }, (_, i) => candidate - halfWidth + i)
        .some(xx => this.solid(xx, top - 6))) continue;
      if (!ground) {
        const material = this.cells[candidate * 2 * this.fh + top * 2];
        const prop = this.props[material - 16];
        if (!prop || !isCityBuilding(prop.kind)) continue;
        // Require a flat, full-width roof/deck, clear above the entire hull.
        let safe = true;
        for (let dx = -halfWidth - 1; dx <= halfWidth + 1; dx++) {
          if (!this.solid(candidate + dx, top) || this.solid(candidate + dx, top - 1) || this.solid(candidate + dx, top - 18)) { safe = false; break; }
        }
        if (!safe) continue;
      }
      const value = Math.abs(candidate - x) + (ground === preferGround ? 0 : this.w);
      if (value < score) { best = candidate; score = value; }
    }
    return best;
  }
  /** Soil needs support below; only rock/structures transmit sideways or
   * hanging support. Detached cells become loose rubble and fall. */
  settle(): void {
    if (!this.dirty) return;
    const {cells, fw, fh} = this;
    const visited = new Uint8Array(cells.length), queue = new Int32Array(cells.length);
    let head = 0, tail = 0;
    const rigid = (i: number) => cells[i] === 2 || cells[i] >= 16;
    const add = (i: number) => { if (!visited[i] && cells[i]) { visited[i] = 1; queue[tail++] = i; } };
    for (let x = 0; x < fw; x++) {
      add(x * fh + fh - 1);
      if (this.layout === "CAVE" && rigid(x * fh)) add(x * fh);
    }
    while (head < tail) {
      const i = queue[head++], y = i % fh;
      // Every grounded material can carry the cell directly above it, including
      // deposited dirt/rubble. Loose soil cannot hold an overhang or a roof.
      if (y > 0) add(i - 1);
      if (rigid(i)) {
        if (i >= fh && rigid(i - fh)) add(i - fh);
        if (i + fh < cells.length && rigid(i + fh)) add(i + fh);
        if (y + 1 < fh && rigid(i + 1)) add(i + 1);
      }
    }
    let changed = false, minX = fw, minY = fh, maxX = 0, maxY = 0;
    const mark = (x: number, y: number, dest: number) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x + 1); minY = Math.min(minY, y); maxY = Math.max(maxY, dest + 1); changed = true; };
    for (let x = 0; x < fw; x++) {
      let landing = fh - 1;
      for (let y = fh - 1; y >= 0; y--) {
        const i = x * fh + y;
        if (visited[i]) { landing = y - 1; continue; }
        if (!cells[i]) continue;
        // Hollow structures/vegetation break into a bounded rubble volume;
        // their facade mask does not represent a solid building full of soil.
        if (cells[i] >= 16 && this.props[cells[i] - 16]?.kind !== "rock" && i % 8 !== 0) { cells[i] = 0; mark(x, y, y); continue; }
        if (landing !== y || cells[i] >= 16) { cells[i] = 0; cells[x * fh + landing] = 3; mark(x, y, landing); }
        landing--;
      }
    }
    if (changed) this.publish(minX, minY, maxX, maxY);
    this.dirty = false;
  }
  serialize(): ModernData {
    const runs: number[] = [];
    for (let i = 0; i < this.cells.length;) {
      const value = this.cells[i]; let end = i + 1;
      while (end < this.cells.length && this.cells[end] === value) end++;
      runs.push(end - i, value); i = end;
    }
    return { version: 1, seed: this.seed, biome: this.biome, layout: this.layout, w: this.w, h: this.h, runs, props: this.props.map(p => ({...p})) };
  }
  static restore(data: ModernData, w: number, h: number): ModernWorld {
    if (data.version !== 1 || data.w !== w || data.h !== h || !Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > 4194304 ||
      !Number.isInteger(data.seed) || !BIOMES.includes(data.biome) || !LAYOUTS.includes(data.layout) ||
      !Array.isArray(data.runs) || data.runs.length % 2 || data.runs.length > w * h * 8 ||
      !Array.isArray(data.props) || data.props.length > 180) throw new Error("Invalid or unsupported Modern terrain save");
    const m = new ModernWorld(w, h, data.seed, data.biome, data.layout);
    m.props = data.props.map((p, i) => {
      if (p.id !== i + 16 || !["pine", "tree", "cactus", "house", "tower", "car", "animal", "rock", ...CITY_BUILDINGS, ...PARK_PROPS].includes(p.kind) ||
        ![p.x,p.y,p.w,p.h,p.variant].every(Number.isFinite) || p.x < 0 || p.x >= w || p.y < 0 || p.y > h || p.w <= 0 || p.w > w || p.h <= 0 || p.h > h ||
        p.art !== undefined && p.art !== "illustrated-v1" && p.art !== PAINTED_ART) throw new Error("Invalid Modern prop");
      return {...p};
    });
    let at = 0;
    for (let n = 0; n < data.runs.length; n += 2) {
      const length = data.runs[n], value = data.runs[n + 1];
      if (!Number.isInteger(length) || length < 1 || at + length > m.cells.length || !Number.isInteger(value) ||
        !(value >= 0 && value <= 3 || value >= 16 && value < 16 + m.props.length)) throw new Error("Invalid Modern terrain mask");
      m.cells.fill(value, at, at + length); at += length;
    }
    if (at !== m.cells.length) throw new Error("Truncated Modern terrain mask");
    m.publish(0, 0, m.fw, m.fh); return m;
  }
}
export function propContains(kind: PropKind, x: number, y: number, variant = .5): boolean {
  if (paintedMasks[kind]) return paintedContains(kind, x, y);
  const landmark = landmarkMasks[kind];
  if (landmark) {
    const size = landmark.rows.length;
    const ix = Math.floor((x + .5) * size), iy = Math.floor((1 - y) * size);
    return ix >= 0 && ix < size && iy >= 0 && iy < size && landmark.rows[iy][ix] === "1";
  }
  if (isParkProp(kind)) return parkContains(kind, x, y);
  if (kind === "rock") return rockContains(x, y, variant);
  if (isCityBuilding(kind)) return cityContains(kind, x, y);
  const ix = Math.floor((x + 0.5) * 128), iy = Math.floor((1 - y) * 128);
  if (ix < 0 || ix >= 128 || iy < 0 || iy >= 128) return false;
  return masks[kind].rows[iy][ix] === "1";
}
