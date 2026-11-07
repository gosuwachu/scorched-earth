/** Browser-only terrain. Half-world-unit cells are authoritative; the legacy
 * palette plane is a conservative contact/weapon compatibility view. No DOS claim. */
import * as C from "./constants";
import masks from "./modern_masks.json";

export type Biome = "GRASS" | "SNOW" | "DESERT" | "SWAMP";
export type Layout = "MOUNTAINS" | "CAVE" | "CITY";
export type PropKind = "pine" | "tree" | "cactus" | "house" | "tower" | "car" | "animal";
export interface Prop { id: number; kind: PropKind; x: number; y: number; w: number; h: number; variant: number }
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
    for (let x = 0; x < m.fw; x++) {
      const u = x / m.fw;
      let height = 0.66 + (noise(u * 5, seed) - 0.5) * 0.29 + (noise(u * 15, seed + 1) - 0.5) * 0.06 + (noise(u * 65, seed + 2) - 0.5) * 0.009;
      if (layout === "CITY") height = 0.76 + Math.floor(noise(u * 4, seed) * 4) * 0.008;
      else if (layout === "CAVE" || biome === "SWAMP") height = 0.73 + (noise(u * 7, seed) - 0.5) * 0.14;
      else if (biome === "DESERT") height = Math.round(height * 22) / 22 * 0.65 + height * 0.35;
      const top = Math.floor(height * m.fh);
      m.surface[x] = top / 2;
      for (let y = top; y < m.fh; y++) m.cells[x * m.fh + y] = y - top > h * 0.16 ? 2 : 1;
      if (layout === "CAVE") {
        const roof = Math.floor((0.12 + noise(u * 13, seed + 4) * 0.065 + Math.pow(noise(u * 39, seed + 5), 9) * 0.12) * m.fh);
        m.cells.fill(2, x * m.fh, x * m.fh + roof);
      }
    }
    m.publish(0, 0, m.fw, m.fh);
    return m;
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
    const spacing = this.layout === "CITY" ? 105 : 63;
    for (let n = 0, x = 45; x < this.w - 40 && n < 180; n++, x += spacing) {
      const rnd = hash(n, 19, this.seed);
      const px = Math.round(x + rnd * 15);
      let kind: PropKind = this.biome === "DESERT" ? "cactus" : this.biome === "SWAMP" ? "tree" : "pine";
      if (this.layout === "CITY") kind = n % 3 === 0 ? "tower" : n % 3 === 1 ? "house" : "car";
      else if (n % 7 === 3) kind = "house";
      else if (n % 9 === 5) kind = "car";
      else if (n % 11 === 7) kind = "animal";
      const w = kind === "tower" ? 56 + rnd * 24 : kind === "house" ? 45 : kind === "car" ? 28 : kind === "animal" ? 18 : 26 + rnd * 14;
      const h = kind === "tower" ? this.h * (0.17 + rnd * 0.23) : kind === "house" ? 38 : kind === "car" ? 12 : kind === "animal" ? 19 : 40 + rnd * 40;
      if (tanks.some(t => Math.abs(t.x - px) < w / 2 + t.half_width + 18)) continue;
      let y = this.h;
      for (let yy = this.layout === "CAVE" ? Math.floor(this.h * 0.45) : 0; yy < this.h; yy++) if (this.solid(px, yy)) { y = yy; break; }
      if (y >= this.h || y - h < (this.layout === "CAVE" ? this.h * 0.32 : 40)) continue;
      // Structures seat on a short foundation; plants require a gentle local slope.
      const edge = Math.floor(w / 2);
      if (Math.abs(this.surface[Math.min(this.fw - 1, (px + edge) * 2)] - this.surface[Math.max(0, (px - edge) * 2)]) > (kind === "tower" ? 12 : 17)) continue;
      const prop: Prop = { id: this.props.length + 16, kind, x: px, y, w, h, variant: rnd };
      this.props.push(prop);
      const x0 = Math.max(0, Math.floor((px - w / 2) * 2)), x1 = Math.min(this.fw, Math.ceil((px + w / 2) * 2));
      const y0 = Math.max(0, Math.floor((y - h) * 2)), y1 = Math.min(this.fh, (y + 3) * 2);
      for (let xx = x0; xx < x1; xx++) for (let yy = y0; yy < y1; yy++) {
        const dx = (xx / 2 - px) / w, v = (y - yy / 2) / h;
        if (propContains(kind, dx, v)) this.cells[xx * this.fh + yy] = prop.id;
      }
      // Foundations support the full width of structures without floating corners.
      if (kind === "house" || kind === "tower") for (let xx = x0; xx < x1; xx++) {
        for (let yy = y * 2; yy < Math.min(this.fh, y * 2 + 36) && !this.cells[xx * this.fh + yy]; yy++) this.cells[xx * this.fh + yy] = 2;
      }
      this.publish(x0, y0, x1, Math.min(this.fh, y1 + 36));
    }
  }
  /** Rock/structures remain when connected to the floor or a cave ceiling.
   * Detached cells become loose rubble and fall. No floating collision remnants. */
  settle(): void {
    if (!this.dirty) return;
    const {cells, fw, fh} = this;
    const visited = new Uint8Array(cells.length), queue = new Int32Array(cells.length);
    let head = 0, tail = 0;
    const add = (i: number) => { if (!visited[i] && cells[i] && cells[i] !== 3) { visited[i] = 1; queue[tail++] = i; } };
    for (let x = 0; x < fw; x++) { add(x * fh + fh - 1); if (this.layout === "CAVE") add(x * fh); }
    while (head < tail) {
      const i = queue[head++], y = i % fh;
      if (i >= fh) add(i - fh); if (i + fh < cells.length) add(i + fh);
      if (y > 0) add(i - 1); if (y + 1 < fh) add(i + 1);
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
        if (cells[i] >= 16 && i % 8 !== 0) { cells[i] = 0; mark(x, y, y); continue; }
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
      if (p.id !== i + 16 || !["pine", "tree", "cactus", "house", "tower", "car", "animal"].includes(p.kind) ||
        ![p.x,p.y,p.w,p.h,p.variant].every(Number.isFinite) || p.x < 0 || p.x >= w || p.y < 0 || p.y > h || p.w <= 0 || p.w > w || p.h <= 0 || p.h > h) throw new Error("Invalid Modern prop");
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
export function propContains(kind: PropKind, x: number, y: number): boolean {
  const ix = Math.floor((x + 0.5) * 128), iy = Math.floor((1 - y) * 128);
  if (ix < 0 || ix >= 128 || iy < 0 || iy >= 128) return false;
  return masks[kind].rows[iy][ix] === "1";
}
