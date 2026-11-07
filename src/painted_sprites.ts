/** Versioned painted scenery. Packed alpha is authoritative even before the
 * texture loads; saved older scenery keeps its original mask and artwork. */
import data from "./building_masks.json";
import plants from "./plant_masks.json";
export const PAINTED_ART = "painted-v2" as const;
export interface SpriteMask { bounds: number[]; size: number; bits: string; deck?: number }
export const buildingMasks: Partial<Record<string, SpriteMask>> = data;
export const plantMasks: Partial<Record<string, SpriteMask>> = plants;
export const paintedMasks = { ...buildingMasks, ...plantMasks };
const decoded = new Map<string, Uint8Array>();
export function buildingAspect(kind: string): number | undefined {
  const b = buildingMasks[kind]?.bounds;
  return b ? b[2] / b[3] : undefined;
}
export function paintedAspect(kind: string): number | undefined {
  const b = paintedMasks[kind]?.bounds;
  return b ? b[2] / b[3] : undefined;
}
export function paintedTexture(kind: string): string {
  return `${plantMasks[kind] ? "props-v2" : "buildings-v2"}/${kind}`;
}
/** The whole source sprite is sampled uniformly; no axis-specific stretching,
 * cropped floor repeats or separate roof/body scaling. */
export function paintedSample(kind: string, u: number, v: number): [number, number] {
  const mask = paintedMasks[kind]!;
  return [Math.floor(u * mask.size), Math.floor(v * mask.size)];
}
export function paintedContains(kind: string, x: number, y: number): boolean {
  const mask = paintedMasks[kind];
  if (!mask || x < -.5 || x >= .5 || y <= 0 || y > 1) return false;
  const [ix, iy] = paintedSample(kind, x + .5, 1 - y);
  if (ix < 0 || iy < 0 || ix >= mask.size || iy >= mask.size) return false;
  let bytes = decoded.get(kind);
  if (!bytes) { bytes = Uint8Array.from(atob(mask.bits), c => c.charCodeAt(0)); decoded.set(kind, bytes); }
  const bit = iy * mask.size + ix;
  return (bytes[bit >> 3] & (1 << (bit & 7))) !== 0;
}
