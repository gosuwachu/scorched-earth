/** Browser presentation only: broad cliff lighting inferred from the current
 * natural-ground mask. No original surface profile or simulation RNG is used. */
import { hash } from "./modern";

const STEP = 4;
const TILE = 128;
const KERNEL = [1, 6, 15, 20, 15, 6, 1];

export class LandformLight {
  /** Same column-major tile order as ModernWorld.tileVersions. Callers must
   * redraw these tiles in addition to tiles whose material mask changed. */
  readonly changedTiles: Uint8Array;
  private readonly width: number;
  private readonly height: number;
  private readonly tilesX: number;
  private readonly tilesY: number;
  private readonly occupied: Uint8Array;
  private readonly raw: Float32Array;
  private readonly horizontal: Float32Array;
  private readonly field: Float32Array;
  private readonly variation: Float32Array;
  private initialized = false;
  private versionsValid = false;
  private readonly versions: Uint32Array;
  private readonly dirtyRows: Uint8Array;

  constructor(private readonly fw: number, private readonly fh: number, seed: number) {
    this.width = Math.ceil(fw / STEP); this.height = Math.ceil(fh / STEP);
    this.tilesX = Math.ceil(fw / TILE); this.tilesY = Math.ceil(fh / TILE);
    this.changedTiles = new Uint8Array(this.tilesX * this.tilesY);
    this.versions = new Uint32Array(this.changedTiles.length);
    this.dirtyRows = new Uint8Array(this.height);
    const size = this.width * this.height;
    this.occupied = new Uint8Array(size);
    this.raw = new Float32Array(size);
    this.horizontal = new Float32Array(size);
    this.field = new Float32Array(size);
    this.variation = new Float32Array(size);
    // Weak, world-anchored modulation keeps continuous ground from acquiring
    // a screen-wide left-to-right lighting ramp or an artificial border bevel.
    const phase = hash(seed, 913) * Math.PI * 2;
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      this.variation[y * this.width + x] = Math.sin(x * .055 + y * .017 + phase) * 2.2 +
        Math.sin(x * .019 - y * .043 + phase * 2) * 1.3;
    }
  }

  /** Versions are optional for callers without terrain mutation tracking. */
  update(cells: Uint8Array, tileVersions?: Uint32Array): void {
    this.changedTiles.fill(0);
    this.dirtyRows.fill(0);
    // Resample only changed tiles. Count each 4x4 block exactly, including
    // partial map edges; painted props do not contribute to cliff lighting.
    for (let tx = 0; tx < this.tilesX; tx++) for (let ty = 0; ty < this.tilesY; ty++) {
      const tile = tx * this.tilesY + ty;
      if (this.versionsValid && tileVersions && this.versions[tile] === tileVersions[tile]) continue;
      const right = Math.min(this.width, (tx + 1) * TILE / STEP);
      const bottom = Math.min(this.height, (ty + 1) * TILE / STEP);
      for (let x = tx * TILE / STEP; x < right; x++) for (let y = ty * TILE / STEP; y < bottom; y++) {
        const endX = Math.min(this.fw, (x + 1) * STEP), endY = Math.min(this.fh, (y + 1) * STEP);
        let count = 0;
        for (let xx = x * STEP; xx < endX; xx++) for (let yy = y * STEP; yy < endY; yy++) {
          const material = cells[xx * this.fh + yy];
          if (material > 0 && material < 16) count++;
        }
        const area = (endX - x * STEP) * (endY - y * STEP);
        const i = y * this.width + x, occupied = count >= Math.ceil(area / 4) ? 1 : 0;
        if (!this.initialized || occupied !== this.occupied[i]) this.dirtyRows[y] = 1;
        this.occupied[i] = occupied;
      }
    }
    if (tileVersions) this.versions.set(tileVersions);
    this.versionsValid = !!tileVersions;
    // A cut can change the span across an entire row, but no other raw rows.
    for (let y = 0; y < this.height; y++) {
      if (!this.dirtyRows[y]) continue;
      this.raw.fill(0, y * this.width, (y + 1) * this.width);
      const row = y * this.width;
      let x = 0;
      while (x < this.width) {
        if (!this.occupied[row + x]) { x++; continue; }
        const start = x;
        while (x < this.width && this.occupied[row + x]) x++;
        const end = x, span = end - start;
        const leftFace = start > 0, rightFace = end < this.width;
        // Thin fragments do not acquire an exaggerated bright/dark outline.
        const strength = Math.min(1, span / 16);
        for (let xx = start; xx < end; xx++) {
          const t = (xx - start + .5) / span;
          const light = leftFace ? 14 * (1 - t) ** 2 : 0;
          const shadow = rightFace ? 32 * t ** 1.5 : 0;
          this.raw[row + xx] = (light - shadow) * strength + this.variation[row + xx];
        }
      }
    }
    // Smooth the broad field, not the collision mask. World edges clamp rather
    // than admitting false air. Final sampling is bilinear at fine resolution.
    for (let y = 0; y < this.height; y++) {
      if (!this.dirtyRows[y]) continue;
      for (let x = 0; x < this.width; x++) {
        let sum = 0;
        for (let k = -3; k <= 3; k++) {
          sum += this.raw[y * this.width + Math.max(0, Math.min(this.width - 1, x + k))] * KERNEL[k + 3];
        }
        this.horizontal[y * this.width + x] = sum / 64;
      }
    }
    for (let y = 0; y < this.height; y++) {
      let dirty = false;
      for (let yy = Math.max(0, y - 3); yy <= Math.min(this.height - 1, y + 3); yy++) {
        if (this.dirtyRows[yy]) { dirty = true; break; }
      }
      if (!dirty) continue;
      for (let x = 0; x < this.width; x++) {
        let sum = 0;
        for (let k = -3; k <= 3; k++) {
          sum += this.horizontal[Math.max(0, Math.min(this.height - 1, y + k)) * this.width + x] * KERNEL[k + 3];
        }
        const i = y * this.width + x, value = Math.fround(sum / 64);
        if (value !== this.field[i]) this.markSample(x, y);
        this.field[i] = value;
      }
    }
    if (!this.initialized) this.changedTiles.fill(1);
    this.initialized = true;
  }

  sample(xFine: number, yFine: number): number {
    const x = Math.max(0, Math.min(this.width - 1, xFine / STEP - .5));
    const y = Math.max(0, Math.min(this.height - 1, yFine / STEP - .5));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(this.width - 1, x0 + 1), y1 = Math.min(this.height - 1, y0 + 1);
    const u = x - x0, v = y - y0;
    const top = this.field[y0 * this.width + x0] * (1 - u) + this.field[y0 * this.width + x1] * u;
    const bottom = this.field[y1 * this.width + x0] * (1 - u) + this.field[y1 * this.width + x1] * u;
    return top * (1 - v) + bottom * v;
  }

  private markSample(x: number, y: number): void {
    // A changed coarse sample influences both neighboring interpolation cells.
    // Conservatively include their endpoints, especially across tile borders.
    const left = Math.max(0, Math.floor((x * STEP - STEP / 2) / TILE));
    const right = Math.min(this.tilesX - 1, Math.floor((x * STEP + STEP * 1.5) / TILE));
    const top = Math.max(0, Math.floor((y * STEP - STEP / 2) / TILE));
    const bottom = Math.min(this.tilesY - 1, Math.floor((y * STEP + STEP * 1.5) / TILE));
    for (let tx = left; tx <= right; tx++) for (let ty = top; ty <= bottom; ty++) {
      this.changedTiles[tx * this.tilesY + ty] = 1;
    }
  }
}
